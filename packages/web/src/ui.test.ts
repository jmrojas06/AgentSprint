import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { sortTasks, viewFromQuery } from './ui'

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: overrides.id,
    status: 'To Do',
    sprint: null,
    priority: 'medium',
    assignee: 'scrum-master',
    estimate: 0,
    tags: [],
    dependencies: [],
    acceptanceCriteria: [],
    description: '',
    notes: '',
    activity: [],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  }
}

describe('viewFromQuery', () => {
  it('parses ?view=list', () => {
    expect(viewFromQuery('?view=list')).toBe('list')
  })

  it('accepts ?view=kanban', () => {
    expect(viewFromQuery('?view=kanban')).toBe('kanban')
  })

  it('falls back for unknown or missing values', () => {
    expect(viewFromQuery('?view=table')).toBe('kanban')
    expect(viewFromQuery('')).toBe('kanban')
    expect(viewFromQuery('?other=1', 'list')).toBe('list')
  })
})

describe('sortTasks with list-view keys', () => {
  const tasks = [
    makeTask({ id: 'TK-2', priority: 'high', sprint: 2, assignee: 'dev' }),
    makeTask({ id: 'TK-10', priority: 'low', sprint: null, assignee: 'scrum-master' }),
    makeTask({ id: 'TK-1', priority: 'critical', sprint: 1, assignee: 'scrum-master' }),
  ]

  it('sorts by id naturally (string compare)', () => {
    const sorted = sortTasks(tasks, 'id', 'asc').map((t) => t.id)
    expect(sorted).toEqual(['TK-1', 'TK-10', 'TK-2'])
  })

  it('sorts by priority rank desc', () => {
    const sorted = sortTasks(tasks, 'priority', 'desc').map((t) => t.priority)
    expect(sorted).toEqual(['critical', 'high', 'low'])
  })

  it('sorts by assignee', () => {
    const sorted = sortTasks(tasks, 'assignee', 'asc').map((t) => t.assignee)
    expect(sorted).toEqual(['dev', 'scrum-master', 'scrum-master'])
  })

  it('puts unsprinted tasks last regardless of direction', () => {
    const asc = sortTasks(tasks, 'sprint', 'asc').map((t) => t.sprint)
    expect(asc).toEqual([1, 2, null])
  })

  it('sorts by completed acceptance criteria count', () => {
    const withAc = [
      makeTask({ id: 'TK-1', acceptanceCriteria: ['[x] a', 'b'] }),
      makeTask({ id: 'TK-2', acceptanceCriteria: ['[x] a'] }),
    ]
    expect(sortTasks(withAc, 'ac', 'desc')[0]!.id).toBe('TK-1')
  })
})
