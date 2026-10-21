import { describe, expect, it } from 'vitest'
import { buildReviewQueue, closableApproved, latestReview, reviewState } from './review.js'
import type { ActivityEvent, Task } from './types.js'

const ev = (type: ActivityEvent['type'], detail: string, at: string, actor = 'code-reviewer'): ActivityEvent => ({ type, detail, at, actor })

function task(over: Partial<Task> = {}): Task {
  return {
    id: 'TK-1',
    title: 'Thing',
    status: 'Review',
    sprint: 1,
    priority: 'medium',
    assignee: 'developer',
    estimate: 0,
    tags: [],
    dependencies: [],
    acceptanceCriteria: ['[x] one', 'two'],
    description: '',
    notes: '',
    activity: [],
    createdAt: '0',
    updatedAt: '0',
    ...over,
  }
}

const approvedNote = '- [2] (code-reviewer) **Review: approved** — looks good'
const changesNote = '- [2] (code-reviewer) **Review: changes requested** — two gaps\n  - a.ts:1 — broken\n  - b.ts:2 — missing test'

describe('reviewState and latestReview', () => {
  it('reviewState drops a verdict once the task moved after it', () => {
    expect(reviewState({ activity: [ev('review', 'approved', '2')] })).toEqual({ verdict: 'approved', by: 'code-reviewer', at: '2' })
    expect(reviewState({ activity: [ev('review', 'approved', '2'), ev('status', 'Review → Done', '4', 'user')] })).toBeNull()
  })

  it('latestReview reads summary and findings and stops counting after a work change, not after a note', () => {
    const r = latestReview({ activity: [ev('review', 'changes requested (2 findings)', '2')], notes: changesNote })
    expect(r).toMatchObject({ verdict: 'changes', by: 'code-reviewer', summary: 'two gaps', findings: ['a.ts:1 — broken', 'b.ts:2 — missing test'], current: true })
    const approved = ev('review', 'approved', '2')
    expect(latestReview({ activity: [approved, ev('note', 'n', '5')], notes: '' })?.current).toBe(true)
    expect(latestReview({ activity: [approved, ev('update', 'title', '5')], notes: '' })?.current).toBe(false)
    expect(latestReview({ activity: [], notes: '' })).toBeNull()
  })

  it('closableApproved keeps Review tasks approved since their last change', () => {
    const ok = task({ id: 'TK-1', acceptanceCriteria: ['[x] one', '[x] two'], activity: [ev('review', 'approved', '2')] })
    const stale = task({ id: 'TK-2', activity: [ev('review', 'approved', '2'), ev('checklist', 'checked', '3')] })
    const done = task({ id: 'TK-3', status: 'Done', activity: [ev('review', 'approved', '2')] })
    const open = task({ id: 'TK-4', acceptanceCriteria: ['[x] one', 'two'], activity: [ev('review', 'approved', '2')] })
    expect(closableApproved([ok, stale, done, open]).map((t) => t.id)).toEqual(['TK-1'])
  })
})

describe('buildReviewQueue', () => {
  const tasks = [
    task({ id: 'TK-1', acceptanceCriteria: ['[x] one', '[x] two'], activity: [ev('review', 'approved', '2')], notes: approvedNote }),
    task({ id: 'TK-2', activity: [ev('review', 'approved', '2'), ev('assignee', 'a → b', '3', 'user')], notes: approvedNote }),
    task({ id: 'TK-3', sprint: 2, activity: [ev('review', 'changes requested (2 findings)', '2'), ev('status', 'In Progress → Review', '3', 'developer')], notes: changesNote }),
    task({ id: 'TK-4', sprint: null }),
    task({ id: 'TK-5', status: 'In Progress' }),
  ]

  it('lists only Review tasks with criteria, verdict, freshness and a recommendation', () => {
    const queue = buildReviewQueue(tasks)
    expect(queue.map((q) => [q.id, q.recommendation, q.approvedSinceLastChange])).toEqual([
      ['TK-1', 'approve', true],
      ['TK-2', 'look', false],
      ['TK-3', 'changes-pending', false],
      ['TK-4', 'look', false],
    ])
    expect(queue[0]).toMatchObject({ title: 'Thing', sprint: 1, assignee: 'developer', criteria: { done: 2, total: 2 } })
    expect(queue[0]!.review).toMatchObject({ verdict: 'approved', by: 'code-reviewer', at: '2', summary: 'looks good', findings: [] })
    expect(queue[2]!.review?.findings).toHaveLength(2)
    expect(queue[3]!.review).toBeNull()
    for (const q of queue) expect(q.reason).not.toBe('')
  })

  it('does not recommend approving work whose criteria are not all ticked, even with a current approval', () => {
    // The TK-25 case: the reviewer approved but left one criterion for the human.
    const [item] = buildReviewQueue([task({ id: 'TK-9', activity: [ev('review', 'approved', '2')], notes: approvedNote })])
    expect(item).toMatchObject({ recommendation: 'look', approvedSinceLastChange: true, criteria: { done: 1, total: 2 } })
    expect(item!.reason).toContain('1 of 2 criteria are not ticked')
  })

  it('filters by sprint and ids', () => {
    expect(buildReviewQueue(tasks, { sprint: 2 }).map((q) => q.id)).toEqual(['TK-3'])
    expect(buildReviewQueue(tasks, { ids: ['TK-4', 'TK-5', 'TK-1'] }).map((q) => q.id)).toEqual(['TK-1', 'TK-4'])
  })
})
