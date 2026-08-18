import path from 'node:path'
import fs from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import { ProjectStore } from '@agentsprint/core'
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

  const app = Fastify({ logger: opts.logger ?? false })

  await app.register(cors, { origin: true })
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
  const port = opts.port ?? 4310
  await built.app.listen({ port, host })
  const url = `http://${host}:${port}`
  return { ...built, url }
}