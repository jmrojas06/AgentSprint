import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/index.js'

// Two ProjectStore instances on the same board behave like two processes
// (e.g. two stdio MCP servers): each has its own in-memory cache.
let dir: string
let a: ProjectStore
let b: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-concurrency-'))
  a = ProjectStore.init(dir, { sample: true })
  b = ProjectStore.open(dir)
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const taskFiles = () => fs.readdirSync(path.join(dir, '.agentboard', 'tasks')).filter((f) => f.endsWith('.md'))

describe('cross-process consistency', () => {
  it('never hands out the same id to two stores (no silent overwrite)', () => {
    const fromA = a.createTask({ title: 'from A' })
    const fromB = b.createTask({ title: 'from B' })
    expect(fromA.id).not.toBe(fromB.id)
    expect(taskFiles()).toHaveLength(5)
    const reopened = ProjectStore.open(dir).state.tasks
    expect(reopened.find((t) => t.id === fromA.id)?.title).toBe('from A')
    expect(reopened.find((t) => t.id === fromB.id)?.title).toBe('from B')
  })

  it('refuses to create a task over an existing file', () => {
    expect(() => b.createTask({ id: 'TK-1', title: 'clobber' })).toThrow('Task already exists: TK-1')
    expect(ProjectStore.open(dir).state.tasks.find((t) => t.id === 'TK-1')?.title).toBe('Write your first task spec')
  })

  it('a lock taken by one store blocks a claim from another', () => {
    a.lockTask('TK-3', 'agent-a')
    expect(() => b.lockTask('TK-3', 'agent-b')).toThrow('locked by "agent-a"')
    expect(ProjectStore.open(dir).getLock('TK-3')?.lockedBy).toBe('agent-a')
    expect(b.getLock('TK-3')?.lockedBy).toBe('agent-a')
  })

  it('release checks ownership against the on-disk lock', () => {
    a.lockTask('TK-3', 'agent-a')
    expect(() => b.unlockTask('TK-3', { agent: 'agent-b' })).toThrow('not by "agent-b"')
    b.unlockTask('TK-3', { agent: 'agent-a' })
    expect(a.getLock('TK-3')).toBeNull()
  })

  it('checklist toggles from a stale store do not resurrect old criteria', () => {
    expect(b.state.tasks.find((t) => t.id === 'TK-1')?.acceptanceCriteria).toHaveLength(2) // b holds the original criteria
    a.updateTask('TK-1', { acceptanceCriteria: ['A1', 'A2', 'A3'] })
    b.setTaskChecklist('TK-1', { index: 0, completed: true })
    const onDisk = ProjectStore.open(dir).state.tasks.find((t) => t.id === 'TK-1')!
    expect(onDisk.acceptanceCriteria).toEqual(['[x] A1', 'A2', 'A3'])
  })

  it('dependency status is read from disk when claiming', () => {
    expect(b.isTaskBlocked('TK-2')).toBe(true)
    a.setTaskStatus('TK-1', 'Done')
    expect(b.isTaskBlocked('TK-2')).toBe(false)
  })

  it('refresh() picks up tasks created, edited and deleted elsewhere', () => {
    const created = a.createTask({ title: 'created by A' })
    const tk3 = path.join(dir, '.agentboard', 'tasks', 'TK-3.md')
    fs.writeFileSync(tk3, fs.readFileSync(tk3, 'utf8').replace(/^title: .*$/m, 'title: edited by hand'))
    a.deleteTask('TK-1')

    b.refresh()
    const ids = b.state.tasks.map((t) => t.id)
    expect(ids).toContain(created.id)
    expect(ids).not.toContain('TK-1')
    expect(b.state.tasks.find((t) => t.id === 'TK-3')?.title).toBe('edited by hand')
  })

  it('refresh() keeps reporting unparseable files', () => {
    fs.writeFileSync(path.join(dir, '.agentboard', 'tasks', 'TK-99.md'), '---\ntitle: Web: broken\n---\n')
    b.refresh()
    expect(b.lastWarnings.some((w) => w.includes('TK-99.md'))).toBe(true)
    b.refresh()
    expect(b.lastWarnings.filter((w) => w.includes('TK-99.md'))).toHaveLength(1)
  })

  it('deleting a task already removed by another store reports not found', () => {
    a.deleteTask('TK-3')
    expect(() => b.deleteTask('TK-3')).toThrow('Task not found: TK-3')
  })
})

// Real processes: every worker opens the board and creates tasks at the same
// time. Uses the built package, which CI builds before running tests.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js')

describe('multiple OS processes', () => {
  it.skipIf(!fs.existsSync(dist))('allocate unique ids when creating tasks concurrently', async () => {
    const workers = 4
    const perWorker = 10
    const script = `
      const { ProjectStore } = await import(${JSON.stringify(dist)})
      const store = ProjectStore.open(process.argv[1])
      for (let i = 0; i < ${perWorker}; i++) store.createTask({ title: 'w' + process.argv[2] + '-' + i })
    `
    await Promise.all(
      Array.from({ length: workers }, (_, w) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, ['--input-type=module', '-e', script, dir, String(w)], { stdio: 'pipe' })
          let stderr = ''
          child.stderr.on('data', (d) => (stderr += d))
          child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(stderr))))
        }),
      ),
    )
    const tasks = ProjectStore.open(dir).state.tasks
    expect(taskFiles()).toHaveLength(3 + workers * perWorker)
    expect(new Set(tasks.map((t) => t.id)).size).toBe(3 + workers * perWorker)
    expect(tasks.filter((t) => t.title.startsWith('w'))).toHaveLength(workers * perWorker)
  }, 30_000)
})
