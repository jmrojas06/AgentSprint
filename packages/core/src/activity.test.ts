import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/index.js'

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-activity-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('activity recording', () => {
  it('records a created event on createTask', () => {
    const task = store.createTask({ title: 'Fresh task', assignee: 'scrum-master' }, { actor: 'agent' })
    expect(task.activity).toHaveLength(1)
    const event = task.activity[0]!
    expect(event.type).toBe('created')
    expect(event.actor).toBe('agent')
    expect(event.detail).toContain('Fresh task')
    expect(event.at).toBeTruthy()
  })

  it('records status changes through setTaskStatus', () => {
    store.setTaskStatus('TK-1', 'In Progress')
    store.setTaskStatus('TK-1', 'Review', { actor: 'agent' })
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const statusEvents = task.activity.filter((e) => e.type === 'status')
    expect(statusEvents).toHaveLength(2)
    expect(statusEvents[0]!.detail).toBe('To Do → In Progress')
    expect(statusEvents[1]!.detail).toBe('In Progress → Review')
    expect(statusEvents[1]!.actor).toBe('agent')
  })

it('records assignee changes', () => {
    const task = store.createTask({ title: 'Assignee probe' })
    store.updateTask(task.id, { assignee: 'dev' }, { actor: 'agent' })
    const updated = store.state.tasks.find((t) => t.id === task.id)!
    const events = updated.activity.filter((e) => e.type === 'assignee')
    expect(events).toHaveLength(1)
    expect(events[0]!.detail).toBe('scrum-master → dev')
    expect(events[0]!.actor).toBe('agent')
  })

  it('records checklist toggles with the criterion text', () => {
    store.setTaskChecklist('TK-1', { index: 0, completed: true }, { actor: 'agent' })
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const events = task.activity.filter((e) => e.type === 'checklist')
    expect(events).toHaveLength(1)
    expect(events[0]!.detail).toContain('checked')
    // unchecking records the inverse
    store.setTaskChecklist('TK-1', { index: 0, completed: false })
    const task2 = store.state.tasks.find((t) => t.id === 'TK-1')!
    expect(task2.activity.filter((e) => e.type === 'checklist')).toHaveLength(2)
  })

  it('records appended notes as note events', () => {
    store.appendTaskNote('TK-1', 'Blocked by CI', 'agent')
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const events = task.activity.filter((e) => e.type === 'note')
    expect(events).toHaveLength(1)
    expect(events[0]!.actor).toBe('agent')
    expect(events[0]!.detail).toBe('Blocked by CI')
    // the note itself is still stored under ## Notes
    expect(task.notes).toContain('Blocked by CI')
  })

  it('records generic field updates without noise for no-op patches', () => {
    const task = store.createTask({ title: 'Update probe', priority: 'low', estimate: 1 })
    store.updateTask(task.id, { priority: 'high', estimate: 5 })
    const before = store.state.tasks.find((t) => t.id === task.id)!.activity.length
    store.updateTask(task.id, {})
    const after = store.state.tasks.find((t) => t.id === task.id)!.activity.length
    expect(after).toBe(before)
    const updateEvents = store.state.tasks.find((t) => t.id === task.id)!.activity.filter((e) => e.type === 'update')
    expect(updateEvents).toHaveLength(1)
    expect(updateEvents[0]!.detail).toBe('updated priority, estimate')
  })

  it('keeps a chronological timeline across mutation types', () => {
    const probe = store.createTask({ title: 'Timeline probe', acceptanceCriteria: ['First AC'] }, { actor: 'agent' })
    const id = probe.id
    store.updateTask(id, { assignee: 'dev' })
    store.setTaskChecklist(id, { index: 0, completed: true })
    store.appendTaskNote(id, 'halfway there')
    store.setTaskStatus(id, 'Review')
    const task = store.state.tasks.find((t) => t.id === id)!
    expect(task.activity.map((e) => e.type)).toEqual(['created', 'assignee', 'checklist', 'note', 'status'])
    const times = task.activity.map((e) => e.at)
    expect([...times].sort()).toEqual(times)
  })

  it('persists activity to disk as parseable lines and reloads it', () => {
    store.setTaskStatus('TK-3', 'In Progress', { actor: 'agent' })
    const raw = fs.readFileSync(path.join(dir, '.agentboard/tasks/TK-3.md'), 'utf8')
    expect(raw).toContain('## Activity')
    expect(raw).toMatch(/^- \S+ \| agent \| status \| Backlog → In Progress$/m)

    const reopened = ProjectStore.open(dir)
    const task = reopened.state.tasks.find((t) => t.id === 'TK-3')!
    expect(task.activity).toHaveLength(2)
    expect(task.activity[1]).toMatchObject({ type: 'status', actor: 'agent', detail: 'Backlog → In Progress' })
  })

  it('defaults to empty activity for legacy tasks without an Activity section', () => {
    const task = store.state.tasks.find((t) => t.id === 'TK-2')!
    expect(Array.isArray(task.activity)).toBe(true)
  })
})
