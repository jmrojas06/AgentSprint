import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// The stdio server as Claude Code runs it: a separate process speaking
// newline-delimited JSON-RPC on stdin/stdout, logging to stderr.
const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts')

type RpcResponse = { id: number; result?: { isError?: boolean; content?: Array<{ text: string }> }; error?: { message: string } }

interface Server {
  child: ChildProcessWithoutNullStreams
  stderr: () => string
  request: (method: string, params?: unknown) => Promise<RpcResponse>
  callTool: (name: string, args?: Record<string, unknown>) => Promise<NonNullable<RpcResponse['result']>>
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

let dir: string
let server: Server | null = null

async function startServer(nodeArgs: string[] = []): Promise<Server> {
  const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', ...nodeArgs, ENTRY, '--root', dir], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => (stderr += chunk))
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  )
  const pending = new Map<number, (msg: RpcResponse) => void>()
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line) as RpcResponse
      pending.get(msg.id)?.(msg)
      pending.delete(msg.id)
    }
  })
  let nextId = 1
  const request = (method: string, params?: unknown): Promise<RpcResponse> => {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, resolve)
      exited.then(({ code, signal }) => reject(new Error(`server exited (${code ?? signal}) before answering ${method}: ${stderr}`)))
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'stdio-test', version: '0' } })
  expect(init.error).toBeUndefined()
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const callTool = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await request('tools/call', { name, arguments: args })
    expect(res.error).toBeUndefined()
    return res.result!
  }
  return { child, stderr: () => stderr, request, callTool, exited }
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-stdio-'))
  await ProjectStore.init(dir, { sample: true })
})

afterEach(async () => {
  if (server && server.child.exitCode === null && server.child.signalCode === null) {
    server.child.kill('SIGKILL')
    await server.exited
  }
  server = null
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('stdio server exit reasons', () => {
  it('logs "stdin closed" and exits 0 when the client closes stdin', async () => {
    server = await startServer()
    const result = await server.callTool('board_summary')
    expect(result.isError).toBeUndefined()

    server.child.stdin.end()
    const exit = await server.exited
    expect(exit.code).toBe(0)
    expect(server.stderr()).toContain('[agentboard mcp] exiting: stdin closed')
  })

  it('finishes a large in-flight response before exiting when stdin closes', async () => {
    // Bigger than a pipe buffer, so an early process.exit() would truncate it.
    fs.writeFileSync(path.join(dir, '.agentboard', 'learnings.md'), `- ${'lesson '.repeat(40)}\n`.repeat(4000))
    server = await startServer()
    let out = ''
    server.child.stdout.on('data', (chunk) => (out += chunk))
    const closed = new Promise<void>((resolve) => server!.child.once('close', () => resolve()))
    server.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'tools/call', params: { name: 'learnings_get', arguments: {} } }) + '\n')
    server.child.stdin.end()
    await closed
    const line = out.split('\n').find((l) => l.includes('"id":99'))
    expect(line).toBeDefined()
    const msg = JSON.parse(line!) as RpcResponse
    expect(msg.result?.content?.[0]?.text.length).toBeGreaterThan(1_000_000)
    expect(server.stderr()).toContain('[agentboard mcp] exiting: stdin closed')
  })

  it.skipIf(process.platform === 'win32').each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('logs the signal it received (%s)', async (signal) => {
    server = await startServer()
    server.child.kill(signal)
    const exit = await server.exited
    expect(server.stderr()).toContain(`[agentboard mcp] exiting: received ${signal}`)
    // Still ends by the signal, as before the logging existed, so hosts see the same status.
    expect(exit.signal).toBe(signal)
  })

  it.skipIf(process.platform === 'win32')('logs an uncaught exception with its message', async () => {
    const preload = path.join(dir, 'throw.mjs')
    fs.writeFileSync(preload, "process.on('SIGUSR2', () => { throw new Error('boom from the test') })\n")
    server = await startServer(['--import', pathToFileURL(preload).href])
    server.child.kill('SIGUSR2')
    const exit = await server.exited
    expect(exit.code).toBe(1)
    expect(server.stderr()).toContain('[agentboard mcp] exiting: uncaught exception: boom from the test')
  })

  it.skipIf(process.platform === 'win32')('logs an unhandled rejection with its message', async () => {
    const preload = path.join(dir, 'reject.mjs')
    fs.writeFileSync(preload, "process.on('SIGUSR2', () => { Promise.reject(new Error('rejected in the test')) })\n")
    server = await startServer(['--import', pathToFileURL(preload).href])
    server.child.kill('SIGUSR2')
    const exit = await server.exited
    expect(exit.code).toBe(1)
    expect(server.stderr()).toContain('[agentboard mcp] exiting: unhandled rejection: rejected in the test')
  })

  it('logs exactly one exiting line', async () => {
    server = await startServer()
    server.child.stdin.end()
    await server.exited
    expect(server.stderr().match(/exiting:/g)).toHaveLength(1)
  })
})

describe('stdio server survives failures', () => {
  it('returns a failed board re-sync as an isError result, logs it and keeps serving', async () => {
    server = await startServer()
    const tasksDir = path.join(dir, '.agentboard', 'tasks')
    const moved = path.join(dir, 'tasks-moved')
    // `.agentboard/tasks` replaced by a file: refresh() throws ENOTDIR on the next call
    fs.renameSync(tasksDir, moved)
    fs.writeFileSync(tasksDir, 'not a directory')

    const failed = await server.callTool('task_list')
    expect(failed.isError).toBe(true)
    const body = JSON.parse(failed.content![0]!.text) as { error: string }
    expect(body.error).toMatch(/re-sync.*ENOTDIR/)
    expect(server.stderr()).toMatch(/\[agentboard mcp\] tool task_list failed: .*ENOTDIR/)
    expect(server.child.exitCode).toBeNull()

    fs.rmSync(tasksDir)
    fs.renameSync(moved, tasksDir)
    const ok = await server.callTool('task_list')
    expect(ok.isError).toBeUndefined()
    expect(JSON.parse(ok.content![0]!.text)).toHaveLength(3)
    expect(server.stderr()).not.toContain('exiting:')
  })
})
