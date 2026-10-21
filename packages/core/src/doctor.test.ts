import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, runDoctor, type DoctorCheck, type DoctorOptions } from '../src/index.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-doctor-'))
  ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const offline: DoctorOptions = {
  urls: [],
  git: async () => null,
  fetchJson: async () => {
    throw new Error('ECONNREFUSED')
  },
}

const check = (checks: DoctorCheck[], name: string): DoctorCheck => {
  const found = checks.find((c) => c.name === name)
  if (!found) throw new Error(`no "${name}" check in ${checks.map((c) => c.name).join(', ')}`)
  return found
}

const writeMcp = (servers: Record<string, unknown>): void => {
  fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: servers }))
}

const age = (file: string, ms: number): void => {
  const t = new Date(Date.now() - ms)
  fs.utimesSync(file, t, t)
}

describe('runDoctor — board', () => {
  it('passes a healthy board', async () => {
    const { checks } = await runDoctor(dir, offline)
    expect(check(checks, 'board').level).toBe('ok')
    expect(check(checks, 'board files').level).toBe('ok')
  })

  it('summarizes lint errors and fails', async () => {
    fs.writeFileSync(path.join(dir, '.agentboard', 'tasks', 'TK-99.md'), '---\nid: [broken\n---\n')
    const result = await runDoctor(dir, offline)
    expect(check(result.checks, 'board').level).toBe('error')
    expect(check(result.checks, 'board').message).toMatch(/1 error/)
    expect(result.ok).toBe(false)
  })

  it('reports a missing board as an error', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-doctor-empty-'))
    try {
      const result = await runDoctor(empty, offline)
      expect(check(result.checks, 'board').level).toBe('error')
      expect(result.ok).toBe(false)
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('flags orphaned .lock and .tmp files but not fresh ones', async () => {
    const tasks = path.join(dir, '.agentboard', 'tasks')
    fs.writeFileSync(path.join(tasks, 'TK-1.md.lock'), '{}')
    fs.writeFileSync(path.join(tasks, 'TK-2.md.123.abcd.tmp'), '')
    fs.writeFileSync(path.join(tasks, 'TK-3.md.lock'), '{}') // a write in progress
    age(path.join(tasks, 'TK-1.md.lock'), 60_000)
    age(path.join(tasks, 'TK-2.md.123.abcd.tmp'), 60_000)
    const files = check((await runDoctor(dir, offline)).checks, 'board files')
    expect(files.level).toBe('warn')
    expect(files.message).toContain('TK-1.md.lock')
    expect(files.message).toContain('TK-2.md.123.abcd.tmp')
    expect(files.message).not.toContain('TK-3.md.lock')
  })

  it('flags board files owned by another user', async () => {
    const uid = fs.statSync(path.join(dir, '.agentboard')).uid
    const files = check((await runDoctor(dir, { ...offline, uid: uid + 1 })).checks, 'board files')
    expect(files.level).toBe('error')
    expect(files.fix).toMatch(/chown/)
  })
})

describe('runDoctor — local build', () => {
  let repo: string
  const entry = (): string => path.join(repo, 'packages', 'cli', 'dist', 'index.js')
  const file = (rel: string, ageMs: number): void => {
    const abs = path.join(repo, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, '')
    age(abs, ageMs)
  }

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-doctor-repo-'))
    file('packages/cli/src/index.ts', 60_000)
    file('packages/cli/dist/index.js', 1_000)
    file('packages/core/src/storage.ts', 60_000)
    file('packages/core/dist/index.js', 1_000)
  })

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })

  it('is ok when every dist is newer than its src', async () => {
    const build = check((await runDoctor(dir, { ...offline, cliEntry: entry() })).checks, 'build')
    expect(build.level).toBe('ok')
  })

  it('warns when a package src is newer than its dist and suggests pnpm build', async () => {
    file('packages/core/src/storage.ts', 0)
    const build = check((await runDoctor(dir, { ...offline, cliEntry: entry() })).checks, 'build')
    expect(build.level).toBe('warn')
    expect(build.message).toContain('core')
    expect(build.message).not.toContain('cli')
    expect(build.fix).toBe('pnpm build')
  })

  it('ignores test files when comparing src and dist', async () => {
    file('packages/core/src/storage.test.ts', 0)
    const build = check((await runDoctor(dir, { ...offline, cliEntry: entry() })).checks, 'build')
    expect(build.level).toBe('ok')
  })

  it('skips the check when the CLI is an installed package', async () => {
    const installed = path.join(dir, 'node_modules', '@jmrojas06', 'agentsprint-cli', 'dist', 'index.js')
    const build = check((await runDoctor(dir, { ...offline, cliEntry: installed })).checks, 'build')
    expect(build.level).toBe('ok')
    expect(build.message).toMatch(/not a checkout/)
  })
})

describe('runDoctor — servers', () => {
  let repo: string
  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-doctor-repo-'))
    fs.mkdirSync(path.join(repo, 'packages', 'cli', 'src'), { recursive: true })
  })
  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true })
  })
  const withHealth = (health: unknown): DoctorOptions => ({
    ...offline,
    urls: ['http://127.0.0.1:4310'],
    cliEntry: path.join(repo, 'packages', 'cli', 'dist', 'index.js'),
    git: async (args, cwd) => (cwd === repo && args.join(' ') === 'rev-parse --short HEAD' ? '7fc3e3c' : null),
    fetchJson: async (url) => {
      expect(url).toBe('http://127.0.0.1:4310/api/health')
      return health
    },
  })

  it('is ok when the server commit matches HEAD', async () => {
    const server = check((await runDoctor(dir, withHealth({ ok: true, version: '0.1.0', commit: '7fc3e3c' }))).checks, 'server http://127.0.0.1:4310')
    expect(server.level).toBe('ok')
  })

  it('warns when the server was built from another commit and treats -dirty as a modified tree', async () => {
    const server = check((await runDoctor(dir, withHealth({ ok: true, version: '0.1.0', commit: 'c4b4338-dirty' }))).checks, 'server http://127.0.0.1:4310')
    expect(server.level).toBe('warn')
    expect(server.message).toContain('c4b4338')
    expect(server.message).toContain('7fc3e3c')
    expect(server.message).toMatch(/modified tree/)
    expect(server.fix).toBe('pnpm docker:up')
  })

  it('warns on a dirty build of the current HEAD', async () => {
    const server = check((await runDoctor(dir, withHealth({ ok: true, version: '0.1.0', commit: '7fc3e3c-dirty' }))).checks, 'server http://127.0.0.1:4310')
    expect(server.level).toBe('warn')
    expect(server.message).toMatch(/modified tree/)
  })

  it('compares short hashes of different lengths by prefix', async () => {
    const server = check((await runDoctor(dir, withHealth({ ok: true, version: '0.1.0', commit: '7fc3e3c1' }))).checks, 'server http://127.0.0.1:4310')
    expect(server.level).toBe('ok')
  })

  it('warns when the server reports no commit (image older than build stamping)', async () => {
    const server = check((await runDoctor(dir, withHealth({ ok: true, version: '0.1.0' }))).checks, 'server http://127.0.0.1:4310')
    expect(server.level).toBe('warn')
    expect(server.message).toMatch(/no commit/)
    expect(server.fix).toBe('pnpm docker:up')
  })

  it('only reports the commit when the CLI is not a checkout (no HEAD to compare)', async () => {
    const opts = { ...withHealth({ ok: true, version: '0.1.0', commit: 'c4b4338' }), cliEntry: path.join(dir, 'x', 'dist', 'index.js') }
    const server = check((await runDoctor(dir, opts)).checks, 'server http://127.0.0.1:4310')
    expect(server.level).toBe('ok')
    expect(server.message).toContain('c4b4338')
  })

  it('warns when the server is unreachable', async () => {
    const server = check((await runDoctor(dir, { ...offline, urls: ['http://127.0.0.1:4310'] })).checks, 'server http://127.0.0.1:4310')
    expect(server.level).toBe('warn')
    expect(server.message).toMatch(/not reachable/)
  })

  it('defaults to http://127.0.0.1:4310 and strips a trailing slash from --url', async () => {
    const seen: string[] = []
    const fetchJson = async (url: string): Promise<unknown> => {
      seen.push(url)
      throw new Error('down')
    }
    await runDoctor(dir, { git: offline.git, fetchJson })
    await runDoctor(dir, { git: offline.git, fetchJson, urls: ['http://localhost:5000/'] })
    expect(seen).toEqual(['http://127.0.0.1:4310/api/health', 'http://localhost:5000/api/health'])
  })
})

describe('runDoctor — MCP', () => {
  it('warns when there is no .mcp.json', async () => {
    const mcp = check((await runDoctor(dir, offline)).checks, 'mcp')
    expect(mcp.level).toBe('warn')
    expect(mcp.fix).toMatch(/agentboard connect/)
  })

  it('warns when .mcp.json has no agentsprint entry', async () => {
    writeMcp({ other: { command: 'x' } })
    expect(check((await runDoctor(dir, offline)).checks, 'mcp').level).toBe('warn')
  })

  it('is ok when the agentsprint entry points at an existing file', async () => {
    const script = path.join(dir, 'cli.js')
    fs.writeFileSync(script, '')
    writeMcp({ agentsprint: { type: 'stdio', command: process.execPath, args: [script, 'mcp', dir] } })
    expect(check((await runDoctor(dir, offline)).checks, 'mcp').level).toBe('ok')
  })

  it('fails when the agentsprint entry points at a missing file', async () => {
    const script = path.join(dir, 'gone', 'index.js')
    writeMcp({ agentsprint: { type: 'stdio', command: process.execPath, args: [script, 'mcp', dir] } })
    const result = await runDoctor(dir, offline)
    expect(check(result.checks, 'mcp').level).toBe('error')
    expect(check(result.checks, 'mcp').message).toContain(script)
    expect(result.ok).toBe(false)
  })

  it('fails on invalid JSON', async () => {
    fs.writeFileSync(path.join(dir, '.mcp.json'), '{nope')
    expect(check((await runDoctor(dir, offline)).checks, 'mcp').level).toBe('error')
  })
})
