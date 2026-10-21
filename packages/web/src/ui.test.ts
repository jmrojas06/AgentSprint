import { describe, expect, it } from 'vitest'
import type { Task } from './types'
import { closableApproved, lastNoteText, latestReview, parseFindings, reviewState, sortTasks, viewFromQuery } from './ui'

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

describe('reviewState', () => {
  const ev = (type: string, detail: string, at: string, actor = 'code-reviewer') => ({ type, detail, at, actor }) as never
  it('returns null when never reviewed', () => {
    expect(reviewState({ activity: [ev('status', 'To Do → Review', '1')] })).toBeNull()
  })
  it('reads the latest verdict', () => {
    expect(reviewState({ activity: [ev('review', 'approved', '2')] })).toEqual({ verdict: 'approved', by: 'code-reviewer', at: '2' })
    expect(reviewState({ activity: [ev('status', 'Review → In Progress', '3'), ev('review', 'changes requested (2 findings)', '3')] })?.verdict).toBe('changes')
  })
  it('drops a verdict once the task moved again', () => {
    expect(reviewState({ activity: [ev('review', 'approved', '2'), ev('status', 'Review → Done', '4', 'user')] })).toBeNull()
  })
})

describe('lastNoteText', () => {
  it('strips the timestamp and author and skips sub-items', () => {
    expect(lastNoteText({ notes: '- [2026] (dev) first\n- [2026] (code-reviewer) **Review: approved**\n  - finding' })).toBe('Review: approved')
    expect(lastNoteText({ notes: '' })).toBeNull()
  })
})

describe('latestReview and closableApproved', () => {
  const ev = (type: string, detail: string, at: string, actor = 'code-reviewer') => ({ type, detail, at, actor }) as never
  const notes = '- [t1] (dev) built it\n- [t2] (ui-reviewer) **Review: approved** — Looks right at 375px\n- [t3] (user) **Review: changes requested** — Two gaps\n  - Empty state\n  - Focus lost'

  it('reads verdict, author, summary and findings from activity and the review note', () => {
    const r = latestReview({ activity: [ev('review', 'changes requested (2 findings)', '3', 'user')], notes })
    expect(r).toEqual({ verdict: 'changes', by: 'user', at: '3', summary: 'Two gaps', findings: ['Empty state', 'Focus lost'], current: true })
    expect(latestReview({ activity: [], notes })).toBeNull()
  })

  it('marks a verdict stale after a change to the work, but not after a note or its own status move', () => {
    const approved = ev('review', 'approved', '2')
    expect(latestReview({ activity: [approved, ev('note', 'added a note', '5')], notes: '' })?.current).toBe(true)
    expect(latestReview({ activity: [approved, ev('checklist', 'checked "x"', '5')], notes: '' })?.current).toBe(false)
    expect(latestReview({ activity: [ev('status', 'Review → In Progress', '3'), ev('review', 'changes requested (1 finding)', '3')], notes: '' })?.current).toBe(true)
  })

  it('only closes tasks in Review whose latest verdict is a current approval', () => {
    const t = (id: string, status: Task['status'], activity: never[]) => makeTask({ id, status, activity })
    const tasks = [
      t('TK-1', 'Review', [ev('review', 'approved', '2')]),
      t('TK-2', 'Review', [ev('review', 'approved', '2'), ev('review', 'changes requested (1 finding)', '3')]),
      t('TK-3', 'Review', [ev('review', 'approved', '2'), ev('update', 'updated title', '4')]),
      t('TK-4', 'Review', []),
      t('TK-5', 'Done', [ev('review', 'approved', '2')]),
    ]
    expect(closableApproved(tasks).map((x) => x.id)).toEqual(['TK-1'])
  })
})

describe('parseFindings', () => {
  it('keeps one finding per non-empty line without bullets', () => {
    expect(parseFindings('- first\n\n  * second \n3. third\n   ')).toEqual(['first', 'second', 'third'])
    expect(parseFindings('  \n')).toEqual([])
  })
})
