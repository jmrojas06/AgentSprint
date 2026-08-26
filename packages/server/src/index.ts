import path from 'node:path'
import fs from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { registerApi } from './routes.js'
import { registerMcpRoute } from './mcpRoute.js'
import { ProjectManager } from './projects.js'

export interface ServerOptions {
  rootDir: string
  port?: number
  host?: string
  /** Absolute path to the built web assets (optional). */
  webDist?: string | null
  /** Auto-create a board when none exists. Defaults to false. */
  autoInit?: boolean
  /** Expose the MCP server over Streamable HTTP at /mcp. Defaults to false. */
  mcp?: boolean
  logger?: boolean
  /** When true (default), automatically tries the next port if the requested one is busy. */
  fallback?: boolean
  /** Optional bearer token. If set (or AGENTBOARD_TOKEN env), mutating routes require Authorization: Bearer <token>. */
  token?: string
  /** When true, all routes (including GET) require the bearer token. Default false: only POST/PUT/PATCH/DELETE are protected. */
  tokenAll?: boolean
}

export interface BuiltApp {
  app: FastifyInstance
  store: ProjectStore
  projects: ProjectManager
  close: () => Promise<void>
}

export async function buildApp(opts: ServerOptions): Promise<BuiltApp> {
  const projects = await ProjectManager.discover(opts.rootDir, { autoInit: opts.autoInit })
  const defaultProject = projects.get()

  const token = (opts.token ?? process.env.AGENTBOARD_TOKEN ?? '').trim()
  const tokenAll = opts.tokenAll ?? false

  const app = Fastify({ logger: opts.logger ?? false })

  // Optional bearer auth: when AGENTBOARD_TOKEN / --token is set, protect API+MCP routes.
  // Default protects only mutating methods (POST/PUT/PATCH/DELETE); with tokenAll=true also GETs/HEAD.
  // Never log the secret.
  if (token) {
    app.addHook('onRequest', async (req, reply) => {
      const method = (req.method ?? '').toUpperCase()
      if (method === 'OPTIONS') return
      const url = req.raw.url ?? ''
      const isApiOrMcp = url.startsWith('/api/') || url.startsWith('/mcp')
      if (!isApiOrMcp) return
      const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
      const needsAuth = tokenAll || isMutating
      if (!needsAuth) return
      const auth = req.headers.authorization
      if (!auth || auth !== `Bearer ${token}`) {
        reply.code(401).send({ error: 'Unauthorized' })
        return
      }
    })
  }

  await app.register(cors, { origin: true, allowedHeaders: ['Content-Type', 'Authorization'] })
  await registerApi(app, projects)
  if (opts.mcp) {
    registerMcpRoute(app, { manager: projects })
  }

  const webDist = opts.webDist ? path.resolve(opts.webDist) : null
  if (webDist && fs.existsSync(webDist)) {
    await app.register(staticPlugin, { root: webDist, maxAge: '1h', index: 'index.html' })
    app.setNotFoundHandler((req, reply) => {
      if (req.raw.url?.startsWith('/api/')) {
        reply.code(404).send({ error: 'Not found' })
      } else {
        reply.sendFile('index.html')
      }
    })
  }

  return {
    app,
    store: defaultProject.store,
    projects,
    close: async () => {
      await projects.closeAll()
      await app.close()
    },
  }
}

export interface BuiltServer extends BuiltApp {
  url: string
}

export async function startServer(opts: ServerOptions): Promise<BuiltServer> {
  const built = await buildApp(opts)
  const host = opts.host ?? '127.0.0.1'
  const startPort = opts.port ?? 4310
  const fallback = opts.fallback ?? true

  let port = startPort
  while (true) {
    try {
      await built.app.listen({ port, host })
      break
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE' && fallback && port < startPort + 100) {
        console.warn(`[agentboard] Port ${port} is in use, trying ${port + 1}...`)
        port += 1
        continue
      }
      throw e
    }
  }

  const actualPort = (built.app.server.address() as { port: number })?.port ?? port
  const url = `http://${host}:${actualPort}`
  return { ...built, url }
}