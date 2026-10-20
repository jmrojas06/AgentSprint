import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { buildApp, createRequestGuard, hostnameOf } from './index.js'
import type { FastifyInstance } from 'fastify'

describe('request guard', () => {
  it('parses hostnames from Host headers', () => {
    expect(hostnameOf('localhost:4310')).toBe('localhost')
    expect(hostnameOf('[::1]:4310')).toBe('[::1]')
    expect(hostnameOf('Board.Example.com')).toBe('board.example.com')
  })

  it('on loopback: rejects foreign Host (DNS rebinding) and foreign Origin (CSRF)', () => {
    const guard = createRequestGuard({ bindHost: '127.0.0.1' })
    expect(guard.enforcesHost).toBe(true)
    expect(guard.check({ host: '127.0.0.1:4310' })).toBeNull()
    expect(guard.check({ host: 'localhost:5173', origin: 'http://localhost:5173' })).toBeNull()
    expect(guard.check({ host: '[::1]:4310', origin: 'http://[::1]:4310' })).toBeNull()
    expect(guard.check({ host: 'attacker.example:4310' })).toContain('Host not allowed')
    expect(guard.check({ host: '127.0.0.1:4310', origin: 'https://evil.example' })).toContain('Origin not allowed')
    expect(guard.check({ host: '127.0.0.1:4310', origin: 'null' })).toContain('Origin not allowed')
    expect(guard.check({})).toContain('Host not allowed')
  })

  it('on 0.0.0.0: accepts any Host but still only same-origin or allowed browser origins', () => {
    const guard = createRequestGuard({ bindHost: '0.0.0.0', allowedOrigins: ['https://board.example.com/'] })
    expect(guard.enforcesHost).toBe(false)
    expect(guard.check({ host: '192.168.1.10:4310', origin: 'http://192.168.1.10:4310' })).toBeNull()
    expect(guard.check({ host: '192.168.1.10:4310', origin: 'https://board.example.com' })).toBeNull()
    expect(guard.check({ host: '192.168.1.10:4310', origin: 'https://evil.example' })).toContain('Origin not allowed')
  })

  it('allowed hosts re-enable the Host check for exposed servers', () => {
    const guard = createRequestGuard({ bindHost: '0.0.0.0', allowedHosts: ['board.lan'] })
    expect(guard.enforcesHost).toBe(true)
    expect(guard.check({ host: 'board.lan:4310', origin: 'http://board.lan:4310' })).toBeNull()
    expect(guard.check({ host: 'attacker.example:4310' })).toContain('Host not allowed')
  })
})

describe('server rejects cross-site browser requests', () => {
  let dir: string
  let app: FastifyInstance
  let close: () => Promise<void>

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-security-'))
    ProjectStore.init(dir, { sample: true })
    const built = await buildApp({ rootDir: dir, mcp: true })
    app = built.app
    close = built.close
  })

  afterEach(async () => {
    await close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const taskExists = (id: string) => fs.existsSync(path.join(dir, '.agentboard', 'tasks', `${id}.md`))

  it('blocks a DELETE from a foreign origin and leaves the task in place', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/tasks/TK-3', headers: { origin: 'https://evil.example' } })
    expect(res.statusCode).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
    expect(taskExists('TK-3')).toBe(true)
  })

  it('blocks the CORS preflight from a foreign origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/tasks/TK-1',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' },
    })
    expect(res.statusCode).toBe(403)
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('blocks cross-site reads and MCP calls', async () => {
    const read = await app.inject({ method: 'GET', url: '/api/project', headers: { origin: 'https://evil.example' } })
    expect(read.statusCode).toBe(403)
    const mcp = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    expect(mcp.statusCode).toBe(403)
  })

  it('blocks a rebound Host header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/brand', headers: { host: 'attacker.example:4310' } })
    expect(res.statusCode).toBe(403)
  })

  it('still serves the local UI, the Vite dev proxy and non-browser clients', async () => {
    const sameOrigin = await app.inject({
      method: 'DELETE',
      url: '/api/tasks/TK-3',
      headers: { host: '127.0.0.1:4310', origin: 'http://127.0.0.1:4310' },
    })
    expect(sameOrigin.statusCode).toBe(204)
    const devProxy = await app.inject({ method: 'GET', url: '/api/project', headers: { host: 'localhost:5173', origin: 'http://localhost:5173' } })
    expect(devProxy.statusCode).toBe(200)
    expect(devProxy.headers['access-control-allow-origin']).toBe('http://localhost:5173')
    const cli = await app.inject({ method: 'GET', url: '/api/health' })
    expect(cli.statusCode).toBe(200)
  })
})
