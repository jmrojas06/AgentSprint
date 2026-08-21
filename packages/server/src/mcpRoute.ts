import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { createMcpServer, type ProjectProvider } from '@jmrojas06/agentsprint-mcp'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { randomUUID } from 'node:crypto'
import type { ProjectManager } from './projects.js'

/**
 * Expose the AgentSprint MCP server over Streamable HTTP on the same
 * Fastify instance (`POST/GET/DELETE /mcp`). Any MCP client that supports
 * the Streamable HTTP transport can connect by URL — no separate process.
 *
 * Each MCP session gets its own transport + McpServer (the SDK Protocol is
 * single-connection). We use the web-standard transport directly and convert
 * the Web `Response` back into Fastify's reply.
 */
export function registerMcpRoute(app: FastifyInstance, opts: { manager: ProjectManager }): void {
  interface Session {
    transport: WebStandardStreamableHTTPServerTransport
    close: () => Promise<void>
  }
  const sessions = new Map<string, Session>()

  function newProvider(): ProjectProvider {
    let active = opts.manager.defaultName()
    return {
      list: () => opts.manager.list(),
      current: () => active,
      use: (name) => {
        if (!opts.manager.list().some((p) => p.name === name)) throw new Error(`Unknown project: ${name}`)
        active = name
      },
      store: () => opts.manager.get(active).store,
      rootDir: () => opts.manager.get(active).info.rootDir,
    }
  }

  function newTransport(): WebStandardStreamableHTTPServerTransport {
    return new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    })
  }

  function toWebRequest(req: FastifyRequest): Request {
    const base = new URL(`${req.protocol}://${req.host ?? 'localhost'}`)
    const url = new URL(req.raw.url ?? '/', base)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headers[k] = v
      else if (Array.isArray(v)) headers[k] = v.join(', ')
    }
    let body: string | undefined
    if (req.method !== 'GET' && req.body !== undefined) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    }
    return new Request(url, { method: req.method, headers, body })
  }

  async function pipe(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const incoming = req.headers['mcp-session-id']
    const sessionId = Array.isArray(incoming) ? incoming[0] : incoming
    let session = sessionId ? sessions.get(sessionId) : undefined
    if (!session) {
      const transport = newTransport()
      const mcpServer = createMcpServer(newProvider())
      await mcpServer.connect(transport)
      session = { transport, close: async () => mcpServer.close() }
    }
    const webRes = await session.transport.handleRequest(toWebRequest(req))
    if (session.transport.sessionId && !sessions.has(session.transport.sessionId)) {
      sessions.set(session.transport.sessionId, session)
    }
    reply.hijack()
    reply.raw.statusCode = webRes.status
    for (const [k, v] of webRes.headers) reply.raw.setHeader(k, v)
    const body = await webRes.arrayBuffer()
    reply.raw.end(Buffer.from(body))
  }

  app.post('/mcp', async (req, reply) => {
    try {
      await pipe(req, reply)
    } catch (err) {
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500
        reply.raw.setHeader('content-type', 'application/json')
        reply.raw.end(JSON.stringify({ error: (err as Error).message }))
      }
    }
  })

  app.get('/mcp', async (req, reply) => {
    await pipe(req, reply)
  })

  app.delete('/mcp', async (req, reply) => {
    const incoming = req.headers['mcp-session-id']
    const sessionId = Array.isArray(incoming) ? incoming[0] : incoming
    const session = sessionId ? sessions.get(sessionId) : undefined
    if (!session) {
      return reply.code(404).send({ error: 'No such session' })
    }
    sessions.delete(sessionId ?? '')
    await session.close()
    await pipe(req, reply)
  })
}