/**
 * Review-gate reading, shared by the web board, MCP, CLI and API. Pure (no fs,
 * no runtime imports) so the browser bundle can import it through the
 * `@jmrojas06/agentsprint-core/review` subpath.
 */
import type { Task } from './types.js'

export interface ReviewState {
  verdict: 'approved' | 'changes'
  by: string
  at: string
}

/** Index of the latest `review` activity event, or -1. */
function lastReviewIndex(events: Task['activity']): number {
  for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === 'review') return i
  return -1
}

/**
 * The review-gate verdict that still applies to a task: the latest `review`
 * activity event, unless the task moved again after it (a newer status change
 * means the verdict was about older work). Null when never reviewed.
 */
export function reviewState(task: Pick<Task, 'activity'>): ReviewState | null {
  const events = task.activity ?? []
  const idx = lastReviewIndex(events)
  if (idx === -1) return null
  const review = events[idx]!
  const movedLater = events.slice(idx + 1).some((e) => e.type === 'status' && e.at !== review.at)
  if (movedLater) return null
  return { verdict: review.detail.startsWith('approved') ? 'approved' : 'changes', by: review.actor, at: review.at }
}

/** Activity that changes the work itself; notes and reviews only talk about it. */
const WORK_CHANGES = new Set(['status', 'update', 'checklist', 'assignee'])

export interface LatestReview extends ReviewState {
  /** One-line summary the reviewer gave, from the review note. */
  summary: string
  /** Findings listed under the review note (for `changes`). */
  findings: string[]
  /** False when the work changed after the verdict, so it was about older work. */
  current: boolean
}

const REVIEW_NOTE = /^- \[[^\]]*\] \(([^)]*)\) \*\*Review: (approved|changes requested)\*\*(?:\s+[—-]\s+(.*))?$/

/** The last `**Review: …**` note of a task: summary and findings (ProjectStore.reviewTask writes them). */
function lastReviewNote(notes: string): { by: string; summary: string; findings: string[] } | null {
  const rows = notes.split('\n')
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = REVIEW_NOTE.exec(rows[i]!.trimEnd())
    if (!m) continue
    const findings: string[] = []
    for (let j = i + 1; j < rows.length && /^\s+-\s+/.test(rows[j]!); j++) findings.push(rows[j]!.replace(/^\s+-\s+/, '').trim())
    return { by: m[1]!, summary: (m[3] ?? '').trim(), findings }
  }
  return null
}

/**
 * The latest review verdict on a task, whether or not it still applies:
 * who gave it, when, its summary and findings. `current` is false when the
 * work changed afterwards (status, fields, checklist or assignee; a note does
 * not count). Null when the task was never reviewed.
 */
export function latestReview(task: Pick<Task, 'activity' | 'notes'>): LatestReview | null {
  const events = task.activity ?? []
  const idx = lastReviewIndex(events)
  if (idx === -1) return null
  const review = events[idx]!
  const current = !events.slice(idx + 1).some((e) => WORK_CHANGES.has(e.type) && e.at !== review.at)
  const note = lastReviewNote(task.notes ?? '')
  return {
    verdict: review.detail.startsWith('approved') ? 'approved' : 'changes',
    by: review.actor,
    at: review.at,
    summary: note?.summary ?? '',
    findings: note?.findings ?? [],
    current,
  }
}

/**
 * Tasks a human can close in one go: in Review, their latest review event is
 * `approved` with no change to the work after it, and every criterion is
 * ticked (the same bar as the queue's `approve`).
 */
export function closableApproved<T extends Pick<Task, 'status' | 'activity' | 'notes'> & Partial<Pick<Task, 'acceptanceCriteria'>>>(tasks: T[]): T[] {
  return tasks.filter((t) => {
    if (t.status !== 'Review') return false
    // Same bar as the queue's `approve`: a current approval and no criterion left open.
    if ((t.acceptanceCriteria ?? []).some((c) => !/^\[x\]\s*/i.test(c.trim()))) return false
    const r = latestReview(t)
    return r !== null && r.verdict === 'approved' && r.current
  })
}

export type ReviewRecommendation = 'approve' | 'look' | 'changes-pending'

export interface ReviewQueueItem {
  id: string
  title: string
  sprint: number | null
  assignee: string
  criteria: { done: number; total: number }
  /** Latest verdict (null when never reviewed), even when it no longer applies. */
  review: Omit<LatestReview, 'current'> | null
  /** The latest verdict is `approved` and the work did not change after it. */
  approvedSinceLastChange: boolean
  recommendation: ReviewRecommendation
  reason: string
}

export interface ReviewQueueOptions {
  sprint?: number
  ids?: string[]
}

/**
 * The human review queue: every task in Review (optionally only one sprint or
 * some ids), with its latest verdict and what to do about it — `approve` when
 * the latest verdict approved it with no change since and every criterion is
 * ticked, `changes-pending` when the latest verdict asked for changes, `look`
 * otherwise (never reviewed, changed after the approval, or approved with
 * criteria still open).
 */
export function buildReviewQueue(tasks: Task[], opts: ReviewQueueOptions = {}): ReviewQueueItem[] {
  return tasks
    .filter((t) => t.status === 'Review' && (opts.sprint === undefined || t.sprint === opts.sprint) && (!opts.ids || opts.ids.includes(t.id)))
    .map((t) => {
      const latest = latestReview(t)
      const approvedSinceLastChange = latest !== null && latest.verdict === 'approved' && latest.current
      const total = t.acceptanceCriteria.length
      const done = t.acceptanceCriteria.filter((c) => /^\[x\]\s*/i.test(c.trim())).length
      let recommendation: ReviewRecommendation = 'look'
      let reason = 'No review verdict yet.'
      if (approvedSinceLastChange && done < total) {
        // A reviewer may approve while leaving a criterion for the human to judge.
        reason = `Approved by ${latest.by}, but ${total - done} of ${total} criteria are not ticked.`
      } else if (approvedSinceLastChange) {
        recommendation = 'approve'
        reason = `Approved by ${latest.by}; no change since.`
      } else if (latest?.verdict === 'approved') {
        reason = `Approved by ${latest.by}, but the work changed after the verdict.`
      } else if (latest) {
        recommendation = 'changes-pending'
        const n = latest.findings.length
        reason = `${latest.by} requested changes${n ? ` (${n} finding${n === 1 ? '' : 's'})` : ''}; not re-reviewed since.`
      }
      const review = latest ? { verdict: latest.verdict, by: latest.by, at: latest.at, summary: latest.summary, findings: latest.findings } : null
      return {
        id: t.id,
        title: t.title,
        sprint: t.sprint,
        assignee: t.assignee,
        criteria: { done, total },
        review,
        approvedSinceLastChange,
        recommendation,
        reason,
      }
    })
}
