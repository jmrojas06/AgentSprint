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
    // Review auto-maps assignee dev → review, so extra assignee event after status
    expect(task.activity.map((e) => e.type)).toEqual(['created', 'assignee', 'checklist', 'note', 'status', 'assignee'])
    const times = task.activity.map((e) => e.at)
    expect([...times].sort()).toEqual(times)
  })

  it('persists activity to disk as parseable lines and reloads it', () => {
    store.setTaskStatus('TK-3', 'In Progress', { actor: 'agent' })
    const raw = fs.readFileSync(path.join(dir, '.agentboard/tasks/TK-3.md'), 'utf8')
    expect(raw).toContain('## Activity')
    expect(raw).toMatch(/^- \S+ \| agent \| status \| Backlog → In Progress$/m)
    expect(raw).toMatch(/\| assignee \| scrum-master → dev/)

    const reopened = ProjectStore.open(dir)
    const task = reopened.state.tasks.find((t) => t.id === 'TK-3')!
    expect(task.activity).toHaveLength(3)
    expect(task.activity[1]).toMatchObject({ type: 'status', actor: 'agent', detail: 'Backlog → In Progress' })
    expect(task.activity[2]).toMatchObject({ type: 'assignee', actor: 'agent', detail: 'scrum-master → dev' })
  })

  it('defaults to empty activity for legacy tasks without an Activity section', () => {
    const task = store.state.tasks.find((t) => t.id === 'TK-2')!
    expect(Array.isArray(task.activity)).toBe(true)
  })
})

describe('auto-assignee by status', () => {
  it('maps Backlog → scrum-master and To Do → scrum-master', () => {
    const t = store.createTask({ title: 'Backlog probe', status: 'Backlog' })
    expect(t.assignee).toBe('scrum-master')
    store.setTaskStatus(t.id, 'To Do')
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('scrum-master')
  })

  it('maps To Do → In Progress → dev and creates both status and assignee events', () => {
    // TK-1 starts To Do / scrum-master
    const before = store.state.tasks.find((t) => t.id === 'TK-1')!
    expect(before.status).toBe('To Do')
    expect(before.assignee).toBe('scrum-master')
    const updated = store.setTaskStatus('TK-1', 'In Progress', { actor: 'agent' })
    expect(updated.status).toBe('In Progress')
    expect(updated.assignee).toBe('dev')
    const statusEv = updated.activity.filter((e) => e.type === 'status').pop()!
    expect(statusEv.detail).toBe('To Do → In Progress')
    const assigneeEv = updated.activity.filter((e) => e.type === 'assignee').pop()!
    expect(assigneeEv.detail).toBe('scrum-master → dev')
    // persisted
    const raw = fs.readFileSync(path.join(dir, '.agentboard/tasks/TK-1.md'), 'utf8')
    expect(raw).toMatch(/\| assignee \| scrum-master → dev/)
  })

  it('maps In Progress → Review → review and Review → Done → perfect', () => {
    const t = store.createTask({ title: 'Flow probe', status: 'To Do' })
    store.setTaskStatus(t.id, 'In Progress')
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('dev')
    store.setTaskStatus(t.id, 'Review')
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('review')
    const rev = store.state.tasks.find((x) => x.id === t.id)!
    expect(rev.activity.some((e) => e.type === 'assignee' && e.detail.includes('dev → review'))).toBe(true)
    store.setTaskStatus(t.id, 'Done')
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('perfect')
  })

  it('maps Backlog → To Do and full chain Backlog → In Progress → Review → Done', () => {
    const t = store.createTask({ title: 'Chain probe', status: 'Backlog' })
    expect(t.assignee).toBe('scrum-master')
    store.updateTask(t.id, { status: 'To Do' })
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('scrum-master')
    store.updateTask(t.id, { status: 'In Progress' })
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('dev')
    store.updateTask(t.id, { status: 'Review' })
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('review')
    store.updateTask(t.id, { status: 'Done' })
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('perfect')
  })

  it('does not override explicit assignee (task_claim priority) and does not emit spurious assignee event when unchanged', () => {
    const t = store.createTask({ title: 'Explicit probe', status: 'To Do' })
    store.updateTask(t.id, { status: 'In Progress', assignee: 'review' })
    const updated = store.state.tasks.find((x) => x.id === t.id)!
    expect(updated.assignee).toBe('review')
    // explicit flow should still have status event but assignee is as requested
    expect(updated.activity.some((e) => e.type === 'status' && e.detail.includes('To Do → In Progress'))).toBe(true)
    // Backlog→To Do with same assignee must not add extra assignee event
    const t2 = store.createTask({ title: 'Noop assignee', status: 'Backlog' })
    const beforeLen = t2.activity.length
    store.setTaskStatus(t2.id, 'To Do')
    const after = store.state.tasks.find((x) => x.id === t2.id)!
    // status event yes, assignee no
    expect(after.activity.filter((e) => e.type === 'status')).toHaveLength(1)
    expect(after.activity.filter((e) => e.type === 'assignee')).toHaveLength(0)
    expect(after.assignee).toBe('scrum-master')
  })

  it('PUT-style updateTask with status triggers mapping', () => {
    const t = store.createTask({ title: 'PUT probe', status: 'To Do' })
    store.updateTask(t.id, { status: 'Review' })
    expect(store.state.tasks.find((x) => x.id === t.id)!.assignee).toBe('review')
  })

  it('createTask with explicit status maps assignee when not provided', () => {
    const a = store.createTask({ title: 'Create In Progress', status: 'In Progress' })
    expect(a.assignee).toBe('dev')
    const b = store.createTask({ title: 'Create Review', status: 'Review' })
    expect(b.assignee).toBe('review')
    const c = store.createTask({ title: 'Create Done', status: 'Done' })
    expect(c.assignee).toBe('perfect')
  })
})
