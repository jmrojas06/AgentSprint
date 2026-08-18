import path from 'node:path'
import fs from 'node:fs'
import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import staticPlugin from '@fastify/static'
import { ProjectStore } from '@agentsprint/core'
import { Broadcast } from './broadcast.js'
import { createIndex } from './indexdb.js'
import { registerApi } from './routes.js'
import { registerMcpRoute } from './mcpRoute.js'
import { createWatcher } from './watcher.js'

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
  close: () => Promise<void>
}

export async function buildApp(opts: ServerOptions): Promise<BuiltApp> {
  const rootDir = path.resolve(opts.rootDir)
  const store = opts.autoInit
    ? ProjectStore.init(rootDir, { sample: true })
    : ProjectStore.open(rootDir)

  const index = await createIndex()
  index.rebuild(store.state.tasks)
  const broadcast = new Broadcast()

  const app = Fastify({ logger: opts.logger ?? false })

  await app.register(cors, { origin: true })
  await registerApi(app, { store, index, broadcast })
  if (opts.mcp) {
    registerMcpRoute(app, { rootDir, store })
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

  const watcher = createWatcher(store, () => {
    index.rebuild(store.state.tasks)
    broadcast.send('change', { at: new Date().toISOString() })
  })

  return {
    app,
    store,
    close: async () => {
      await watcher.close()
      await app.close()
    },
  }
}

export interface BuiltServer extends BuiltApp {
  url: string
}

export async function startServer(opts: ServerOptions): Promise<BuiltServer> {
  const { app, store, close } = await buildApp(opts)
  const host = opts.host ?? '127.0.0.1'
  const port = opts.port ?? 4310
  await app.listen({ port, host })
  const url = `http://${host}:${port}`
  return { app, store, url, close }
}
