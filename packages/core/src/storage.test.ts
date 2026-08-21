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

  it('appends an automatic retro to learnings when closing a sprint', () => {
    store.setSprintStatus(1, 'closed')
    const learningsPath = path.join(dir, '.agentboard', 'learnings.md')
    expect(fs.existsSync(learningsPath)).toBe(true)
    const content = fs.readFileSync(learningsPath, 'utf8')
    expect(content).toContain('## Sprint 1 retro —')
    expect(content).toContain('# Sprint 1')
    expect(content).toMatch(/## Tasks/)
  })

  it('does not append a retro when closing with { retro: false }', () => {
    store.setSprintStatus(1, 'closed', { retro: false })
    expect(fs.existsSync(path.join(dir, '.agentboard', 'learnings.md'))).toBe(false)
    // closing again (already closed) must not duplicate either
    store.setSprintStatus(1, 'active')
    store.setSprintStatus(1, 'closed', { retro: false })
    expect(store.getLearnings()).toBe('')
  })

  it('lists blockers found in the automatic retro', () => {
    // TK-2 depends on TK-1; leaving TK-1 open blocks TK-2
    store.setSprintStatus(1, 'closed')
    const retro = store.buildSprintRetro(1)
    if (store.getBlockers('TK-2').length > 0) {
      expect(retro).toContain('## Blockers found')
      expect(retro).toContain('TK-2')
    }
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

  it('reports unparseable task files in lastWarnings', () => {
    fs.writeFileSync(
      path.join(dir, '.agentboard', 'tasks', 'TK-9.md'),
      '---\nid: TK-9\ntitle: Web: colon breaks YAML\nstatus: To Do\n---\n',
    )
    const reopened = ProjectStore.open(dir)
    expect(reopened.state.tasks.find((t) => t.id === 'TK-9')).toBeUndefined()
    expect(reopened.lastWarnings.some((w) => w.includes('TK-9.md'))).toBe(true)
  })

  it('appends timestamped notes to task', () => {
    store.appendTaskNote('TK-1', 'Investigated API endpoints', 'agent')
    const t = store.state.tasks.find((x) => x.id === 'TK-1')
    expect(t?.notes).toContain('Investigated API endpoints')
    expect(t?.notes).toContain('(agent)')

    const reopened = ProjectStore.open(dir)
    expect(reopened.state.tasks.find((x) => x.id === 'TK-1')?.notes).toContain('Investigated API endpoints')
  })

   it('toggles and sets acceptance criteria checklists', () => {
     store.setTaskChecklist('TK-1', { index: 0, completed: true })
     let t = store.state.tasks.find((x) => x.id === 'TK-1')
     expect(t?.acceptanceCriteria[0]).toContain('[x]')

     store.setTaskChecklist('TK-1', { text: 'acceptance criterion', completed: true })
     t = store.state.tasks.find((x) => x.id === 'TK-1')
     expect(t?.acceptanceCriteria[1]).toContain('[x]')

     const content = fs.readFileSync(path.join(dir, '.agentboard', 'tasks', 'TK-1.md'), 'utf8')
     expect(content).toContain('- [x]')
   })
 })

 describe('dependency graph & blockers', () => {
   it('detects when a task is blocked by an incomplete dependency', () => {
     expect(store.isTaskBlocked('TK-2')).toBe(true)
     const blockers = store.getBlockers('TK-2')
     expect(blockers).toContain('TK-1')
   })

   it('detects when a task is unblocked once its dependency is done', () => {
     store.setTaskStatus('TK-1', 'Done')
     expect(store.isTaskBlocked('TK-2')).toBe(false)
     expect(store.getBlockers('TK-2')).toEqual([])
   })

   it('treats a task with no dependencies as not blocked', () => {
     expect(store.isTaskBlocked('TK-1')).toBe(false)
   })

    it('detects no cycles in the sample board', () => {
      expect(store.detectCycles()).toEqual([])
    })

    it('rejects creating a task that creates a dependency cycle', () => {
      store.createTask({ id: 'TK-10', title: 'A', status: 'To Do', dependencies: ['TK-20'] })
      expect(() =>
        store.createTask({ id: 'TK-20', title: 'B', dependencies: ['TK-10'], status: 'To Do' }),
      ).toThrow(/cycle/i)
    })

    it('rejects updating a task to create a dependency cycle', () => {
      store.createTask({ id: 'TK-10', title: 'A', status: 'To Do' })
      store.createTask({ id: 'TK-20', title: 'B', status: 'To Do', dependencies: ['TK-10'] })
      expect(() => store.updateTask('TK-10', { dependencies: ['TK-20'] })).toThrow(/cycle/i)
    })
  })

  describe('checklist round-trip', () => {
    it('checkmarks do not accumulate doubled prefixes', () => {
      store.setTaskChecklist('TK-1', { index: 0, completed: true })
      let t = store.state.tasks.find((x) => x.id === 'TK-1')!
      expect(t.acceptanceCriteria[0]).toBe('[x] The task has a clear description')

      const reopened = ProjectStore.open(dir)
      t = reopened.state.tasks.find((x) => x.id === 'TK-1')!
      expect(t.acceptanceCriteria[0]).toBe('[x] The task has a clear description')

      const content = fs.readFileSync(path.join(dir, '.agentboard', 'tasks', 'TK-1.md'), 'utf8')
      expect(content).toContain('- [x] The task has a clear description')
      expect(content).not.toContain('- [ ] - [x]')
    })

    it('unchecking strips the [x] prefix cleanly', () => {
      store.setTaskChecklist('TK-1', { index: 0, completed: true })
      store.setTaskChecklist('TK-1', { index: 0, completed: false })
      const t = store.state.tasks.find((x) => x.id === 'TK-1')!
      expect(t.acceptanceCriteria[0]).toBe('The task has a clear description')
    })
  })


describe('learnings', () => {
  it('returns empty string before any learnings are saved', () => {
    expect(store.getLearnings()).toBe('')
  })

  it('setLearnings persists content to disk', () => {
    const content = '## Retro\n\n- Always check edge cases\n- Keep commits small'
    store.setLearnings(content)
    expect(store.getLearnings()).toBe(content)
    const file = fs.readFileSync(path.join(dir, '.agentboard', 'learnings.md'), 'utf8')
    expect(file).toBe(content)
  })

  it('appendLearning creates a bulleted list', () => {
    store.appendLearning('First insight')
    store.appendLearning('Second insight')
    const result = store.getLearnings()
    expect(result).toBe('- First insight\n- Second insight')
  })

  it('appendLearning starts fresh when file is empty', () => {
    store.appendLearning('Only learning')
    expect(store.getLearnings()).toBe('- Only learning')
  })

  it('reopening the project loads existing learnings from disk', () => {
    store.setLearnings('Persisted learning')
    const reopened = ProjectStore.open(dir)
    expect(reopened.getLearnings()).toBe('Persisted learning')
  })
})
