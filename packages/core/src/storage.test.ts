import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '../src/index.js'

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-test-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('ProjectStore', () => {
  it('scaffolds sample content', () => {
    const state = store.state
    expect(state.tasks).toHaveLength(3)
    expect(state.sprints).toHaveLength(1)
    expect(state.sprints[0]?.status).toBe('planned')
    expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true)
  })

  it('creates tasks with auto ids', () => {
    const t = store.createTask({ title: 'New task', sprint: null })
    expect(t.id).toBe('TK-4')
    expect(t.status).toBe('To Do')
    expect(store.state.tasks).toHaveLength(4)
    expect(fs.existsSync(path.join(dir, '.agentboard', 'tasks', 'TK-4.md'))).toBe(true)
  })

  it('updates task status and persists to file', () => {
    store.setTaskStatus('TK-1', 'Review')
    const content = fs.readFileSync(path.join(dir, '.agentboard', 'tasks', 'TK-1.md'), 'utf8')
    expect(content).toContain('status: Review')
    expect(store.state.tasks.find((t) => t.id === 'TK-1')?.status).toBe('Review')
  })

  it('rejects unknown statuses', () => {
    expect(() => store.setTaskStatus('TK-1', 'Nope' as never)).toThrow()
  })

  it('activates a sprint and demotes the previous one', () => {
    const s2 = store.createSprint('Second sprint')
    store.setSprintStatus(s2.id, 'active')
    store.setSprintStatus(1, 'active')
    const state = store.state
    expect(state.activeSprint?.id).toBe(1)
    expect(state.sprints.find((s) => s.id === s2.id)?.status).toBe('planned')
  })

  it('round-trips through disk: reload matches state', () => {
    store.createTask({ title: 'Persisted', sprint: 1, acceptanceCriteria: ['a'], description: 'desc' })
    const reopened = ProjectStore.open(dir)
    const tasks = reopened.state.tasks
    expect(tasks).toHaveLength(4)
    const t = tasks.find((x) => x.title === 'Persisted')
    expect(t?.acceptanceCriteria).toEqual(['a'])
    expect(t?.description).toBe('desc')
    expect(t?.sprint).toBe(1)
  })

  it('deletes tasks', () => {
    store.deleteTask('TK-1')
    expect(store.state.tasks.find((t) => t.id === 'TK-1')).toBeUndefined()
    expect(fs.existsSync(path.join(dir, '.agentboard', 'tasks', 'TK-1.md'))).toBe(false)
  })
})
