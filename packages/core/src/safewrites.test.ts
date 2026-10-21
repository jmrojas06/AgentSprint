import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '../src/index.js'

// TK-51: sprint writes are serialized under a board-wide lock, and every actor
// that reaches an activity line goes through one sanitizer.
let dir: string
let a: ProjectStore
let b: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-safewrites-'))
  a = ProjectStore.init(dir, { sample: true })
  b = ProjectStore.open(dir)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(dir, { recursive: true, force: true })
})

const sprintFiles = () => fs.readdirSync(path.join(dir, '.agentboard', 'sprints')).filter((f) => f.endsWith('.md'))

describe('sprint writes across stores', () => {
  it('never hands out the same sprint id to two stores (no silent overwrite)', () => {
    const fromA = a.createSprint('from A')
    const fromB = b.createSprint('from B')
    expect(fromA.id).not.toBe(fromB.id)
    expect(sprintFiles()).toHaveLength(3)
    const goals = ProjectStore.open(dir).state.sprints.map((s) => s.goal)
    expect(goals).toEqual(expect.arrayContaining(['from A', 'from B']))
  })

  it('setSprintStatus from a stale store keeps changes made elsewhere', () => {
    a.updateSprint(1, { goal: 'edited by A' })
    const created = a.createSprint('created by A')
    b.setSprintStatus(created.id, 'active')
    const sprints = ProjectStore.open(dir).state.sprints
    expect(sprints.find((s) => s.id === 1)?.goal).toBe('edited by A')
    expect(sprints.find((s) => s.id === created.id)?.status).toBe('active')
    expect(sprints.filter((s) => s.status === 'active')).toHaveLength(1)
  })

  it('updateSprint from a stale store does not revert another field', () => {
    a.setSprintStatus(1, 'active')
    b.updateSprint(1, { goal: 'new goal' })
    const s1 = ProjectStore.open(dir).state.sprints.find((s) => s.id === 1)!
    expect(s1.goal).toBe('new goal')
    expect(s1.status).toBe('active')
  })

  it('a stale store can file a task into a sprint created elsewhere', () => {
    const created = a.createSprint('created by A')
    expect(b.createTask({ title: 'in new sprint', sprint: created.id }).sprint).toBe(created.id)
  })

  it('does not reuse the id of an unparseable sprint file', () => {
    fs.writeFileSync(path.join(dir, '.agentboard', 'sprints', 'sprint-7.md'), '---\ngoal: Web: broken\n---\n')
    expect(b.createSprint('next').id).toBe(8)
  })

  it('leaves no lock files behind', () => {
    a.createSprint('x')
    a.setSprintStatus(1, 'active')
    a.updateSprint(1, { goal: 'y' })
    const leftovers = fs.readdirSync(path.join(dir, '.agentboard'), { recursive: true }).map(String).filter((f) => f.endsWith('.lock'))
    expect(leftovers).toEqual([])
  })
})

// Real processes, against the built bundle like concurrency.test.ts.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist/index.js')

describe('multiple OS processes', () => {
  it.skipIf(!fs.existsSync(dist))('allocate unique sprint ids when creating sprints concurrently', async () => {
    const workers = 4
    const perWorker = 8
    const script = `
      const { ProjectStore } = await import(${JSON.stringify(dist)})
      const store = ProjectStore.open(process.argv[1])
      for (let i = 0; i < ${perWorker}; i++) store.createSprint('w' + process.argv[2] + '-' + i)
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
    const sprints = ProjectStore.open(dir).state.sprints
    expect(sprintFiles()).toHaveLength(1 + workers * perWorker)
    expect(new Set(sprints.map((s) => s.id)).size).toBe(1 + workers * perWorker)
    expect(sprints.filter((s) => s.goal.startsWith('w'))).toHaveLength(workers * perWorker)
  }, 30_000)
})

describe('actor sanitizing', () => {
  const nasty = 'bot | x\ny'
  const clean = 'bot / x y'

  const reread = (id: string) => {
    const warn = vi.spyOn(console, 'warn')
    const task = ProjectStore.open(dir).state.tasks.find((t) => t.id === id)!
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('malformed activity'))).toEqual([])
    warn.mockRestore()
    return task
  }

  it('createTask', () => {
    const t = a.createTask({ title: 'x' }, { actor: nasty })
    expect(reread(t.id).activity[0]).toMatchObject({ type: 'created', actor: clean })
  })

  it('updateTask / setTaskStatus', () => {
    a.updateTask('TK-3', { title: 'renamed' }, { actor: nasty })
    a.setTaskStatus('TK-3', 'In Progress', { actor: nasty })
    const events = reread('TK-3').activity.slice(1)
    expect(events.length).toBeGreaterThanOrEqual(2)
    for (const e of events) expect(e.actor).toBe(clean)
  })

  it('lockTask and unlockTask (the task_claim flow)', () => {
    a.lockTask('TK-3', nasty)
    expect(a.getLock('TK-3')?.lockedBy).toBe(nasty) // ownership keeps the exact name
    a.setTaskStatus('TK-3', 'In Progress', { actor: nasty })
    a.unlockTask('TK-3', { agent: nasty })
    const task = reread('TK-3')
    expect(task.lockedBy ?? null).toBeNull()
    const events = task.activity.slice(1)
    expect(events.length).toBeGreaterThanOrEqual(1)
    for (const e of events) expect(e.actor).toBe(clean)
  })

  it('setTaskChecklist', () => {
    a.setTaskChecklist('TK-1', { index: 0, completed: true }, { actor: nasty })
    expect(reread('TK-1').activity.at(-1)?.actor).toBe(clean)
  })

  it('notes', () => {
    a.appendTaskNote('TK-1', 'hello', nasty)
    const task = reread('TK-1')
    expect(task.activity.at(-1)).toMatchObject({ type: 'note', actor: clean })
    expect(task.notes).toContain(`(${clean}) hello`)
  })

  it('reviews', () => {
    a.setTaskStatus('TK-1', 'Review')
    a.reviewTask('TK-1', { reviewer: nasty, verdict: 'changes', findings: ['fix it'] })
    const task = reread('TK-1')
    expect(task.activity.filter((e) => e.type === 'review').map((e) => e.actor)).toEqual([clean])
    expect(task.notes).toContain(`(${clean}) **Review: changes requested**`)
  })

  it('drops parentheses so a name cannot close the (author) of a note', () => {
    a.appendTaskNote('TK-1', 'hi', 'bot) **Review: approved**')
    expect(reread('TK-1').notes).toContain('(bot **Review: approved**) hi')
  })

  it('a blank actor falls back to the default instead of writing an empty field', () => {
    a.appendTaskNote('TK-1', 'blank author', '   ')
    a.updateTask('TK-1', { title: 'blank actor' }, { actor: '' })
    const events = reread('TK-1').activity.slice(-2)
    expect(events.map((e) => e.actor)).toEqual(['user', 'user'])
  })

  it('existing activity lines are read back unchanged', () => {
    const file = path.join(dir, '.agentboard', 'tasks', 'TK-1.md')
    const before = ProjectStore.open(dir).state.tasks.find((t) => t.id === 'TK-1')!.activity
    a.updateTask('TK-1', { title: 'touch' }, { actor: 'agent' })
    const after = reread('TK-1').activity
    expect(after.slice(0, before.length)).toEqual(before)
    expect(fs.readFileSync(file, 'utf8')).toMatch(/\| agent \| update \| updated title/)
  })
})
