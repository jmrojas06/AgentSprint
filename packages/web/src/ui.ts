import type { Sprint, Task, TaskPriority } from './types'
import { DEFAULT_STATUSES } from './types'

export const TASK_LOCK_TTL_MINUTES = 30

export interface TaskLockInfo {
  lockedBy: string
  lockedAt: string
}

/**
 * Active exclusive lock for a task, or null when unlocked/expired.
 * Mirrors getTaskLock in @jmrojas06/agentsprint-core (kept local so the browser
 * bundle never pulls in core's Node-only dist).
 */
export function getTaskLock(
  task: Pick<Task, 'lockedBy' | 'lockedAt'>,
  now: Date = new Date(),
): TaskLockInfo | null {
  if (!task.lockedBy || !task.lockedAt) return null
  const ageMs = now.getTime() - new Date(task.lockedAt).getTime()
  if (!Number.isFinite(ageMs)) return null
  if (ageMs > TASK_LOCK_TTL_MINUTES * 60_000) return null
  return { lockedBy: task.lockedBy, lockedAt: task.lockedAt }
}

export type ViewMode = 'overview' | 'kanban' | 'list'

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'overview' || value === 'kanban' || value === 'list'
}

/** Resolve the board view from a URL query string (e.g. "?view=list"), falling back to `fallback`. */
export function viewFromQuery(search: string, fallback: ViewMode = 'kanban'): ViewMode {
  const value = new URLSearchParams(search).get('view')
  return isViewMode(value) ? value : fallback
}

export interface ReviewState {
  verdict: 'approved' | 'changes'
  by: string
  at: string
}

/**
 * The review-gate verdict that still applies to a task: the latest `review`
 * activity event, unless the task moved again after it (a newer status change
 * means the verdict was about older work). Null when never reviewed.
 */
export function reviewState(task: Pick<Task, 'activity'>): ReviewState | null {
  const events = task.activity ?? []
  let idx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'review') {
      idx = i
      break
    }
  }
  if (idx === -1) return null
  const review = events[idx]!
  const movedLater = events.slice(idx + 1).some((e) => e.type === 'status' && e.at !== review.at)
  if (movedLater) return null
  return { verdict: review.detail.startsWith('approved') ? 'approved' : 'changes', by: review.actor, at: review.at }
}

/** Activity that changes the work itself; notes and reviews only talk about it. */
const WORK_CHANGES = new Set(['status', 'update', 'checklist', 'assignee'])

export interface ReviewVerdict extends ReviewState {
  /** One-line summary the reviewer gave, from the review note. */
  summary: string
  /** Findings listed under the review note (for `changes`). */
  findings: string[]
  /** False when the work changed after the verdict, so it was about older work. */
  current: boolean
}

const REVIEW_NOTE = /^- \[[^\]]*\] \(([^)]*)\) \*\*Review: (approved|changes requested)\*\*(?:\s+[—-]\s+(.*))?$/

/** The last `**Review: …**` note of a task: summary and findings (core's reviewTask writes them). */
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
export function latestReview(task: Pick<Task, 'activity' | 'notes'>): ReviewVerdict | null {
  const events = task.activity ?? []
  let idx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'review') {
      idx = i
      break
    }
  }
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
 * Tasks a human can close in one go: in Review, and their latest review event
 * is `approved` with no change to the work after it.
 */
export function closableApproved<T extends Pick<Task, 'status' | 'activity' | 'notes'>>(tasks: T[]): T[] {
  return tasks.filter((t) => {
    if (t.status !== 'Review') return false
    const r = latestReview(t)
    return r !== null && r.verdict === 'approved' && r.current
  })
}

/** Findings typed one per line (bullets allowed), without blanks. */
export function parseFindings(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
}

/** Short local date and time for a timestamp ("Oct 21, 14:02"); the raw value when it does not parse. */
export function fmtWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export const statusAccent: Record<string, string> = {
  Backlog: 'bg-zinc-700',
  'To Do': 'bg-sky-500',
  'In Progress': 'bg-indigo-500',
  Review: 'bg-amber-500',
  Done: 'bg-emerald-500',
}

export const statusText: Record<string, string> = {
  Backlog: 'text-zinc-300',
  'To Do': 'text-sky-400',
  'In Progress': 'text-indigo-400',
  Review: 'text-amber-400',
  Done: 'text-emerald-400',
}

export const priorityDot: Record<TaskPriority, string> = {
  low: 'bg-zinc-400',
  medium: 'bg-amber-400',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
}

export const priorityLabel: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function criterionChecked(criterion: string): boolean {
  return /^\[x\]\s*/i.test(criterion.trim())
}

export function criterionText(criterion: string): string {
  return criterion.replace(/^\[x\]\s*/i, '').replace(/^\[\s*\]\s*/, '').trim()
}

/** Return dependency tasks that are not yet Done (i.e. blockers for `task`). */
export function getBlockerTasks(task: Task, allTasks: Task[]): Task[] {
  return task.dependencies
    .map((depId) => allTasks.find((t) => t.id === depId))
    .filter((dep): dep is Task => dep !== undefined && dep.status !== 'Done')
}

/**
 * Average points completed per sprint across the last `windowSize` (default 3)
 * closed sprints. Returns null when there are no closed sprints.
 */
export function computeVelocity(sprints: Sprint[], tasks: Task[], windowSize = 3): number | null {
  const closed = sprints
    .filter((s) => s.status === 'closed')
    .sort((a, b) => b.id - a.id)
    .slice(0, windowSize)
  if (closed.length === 0) return null
  const points = closed.map(
    (s) => tasks.filter((t) => t.sprint === s.id && t.status === 'Done').reduce((sum, t) => sum + t.estimate, 0),
  )
  return Math.round(points.reduce((a, b) => a + b, 0) / closed.length)
}

/**
 * Fuzzy subsequence match. Returns a relevance score (higher is better) when
 * every character of `query` appears in order in `text`, otherwise null.
 * Consecutive matches and matches at word starts score higher.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().trim()
  const t = text.toLowerCase()
  if (!q) return 0
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    const atWordStart = ti === 0 || /[\s\-_/]/.test(t[ti - 1]!)
    if (t[ti] === q[qi]) {
      qi++
      streak++
      score += 2 + streak + (atWordStart ? 3 : 0)
    } else {
      streak = 0
    }
  }
  if (qi < q.length) return null
  return score - t.length * 0.01
}

export type SortBy = 'priority' | 'estimate' | 'updatedAt' | 'id' | 'title' | 'status' | 'sprint' | 'assignee' | 'ac'
export type SortDir = 'asc' | 'desc'

const priorityRank: Record<TaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 }

const statusRank = (status: string): number => {
  const idx = DEFAULT_STATUSES.indexOf(status as (typeof DEFAULT_STATUSES)[number])
  return idx === -1 ? DEFAULT_STATUSES.length : idx
}

function taskSortValue(task: Task, sortBy: SortBy): number | string {
  switch (sortBy) {
    case 'priority':
      return priorityRank[task.priority] ?? 0
    case 'estimate':
      return task.estimate
    case 'updatedAt':
      return new Date(task.updatedAt).getTime()
    case 'ac':
      return task.acceptanceCriteria.filter(criterionChecked).length
    case 'status':
      return statusRank(task.status)
    case 'sprint':
      return task.sprint ?? Number.POSITIVE_INFINITY
    case 'id':
    case 'title':
    case 'assignee':
      return task[sortBy]
  }
}

/** Sort tasks by the given key and direction. `desc` puts higher-priority / larger-estimate / more-recent first. */
export function sortTasks(tasks: Task[], sortBy: SortBy, sortDir: SortDir): Task[] {
  const dir = sortDir === 'desc' ? -1 : 1
  return [...tasks].sort((a, b) => {
    const aVal = taskSortValue(a, sortBy)
    const bVal = taskSortValue(b, sortBy)
    if (typeof aVal === 'number' && typeof bVal === 'number') return (aVal - bVal) * dir
    return String(aVal).localeCompare(String(bVal)) * dir
  })
}

/** Last top-level note of a task, without its `[timestamp] (author)` prefix (mirrors core's lastNote). */
export function lastNoteText(task: Pick<Task, 'notes'>): string | null {
  const entries = (task.notes ?? '').split('\n').filter((l) => l.startsWith('- '))
  const last = entries[entries.length - 1]
  if (!last) return null
  return last.replace(/^-\s+(\[[^\]]+\]\s*)?(\([^)]+\)\s*)?/, '').replace(/\*\*/g, '').trim() || null
}

/**
 * The server build as `v0.1.0 · c4b4338` (only the version when the build has
 * no commit), with `builtAt` for a tooltip. Null for servers that predate it.
 */
export function buildInfo(health: { version?: string; commit?: string | null; builtAt?: string | null } | null): {
  label: string
  title?: string
} | null {
  if (!health?.version) return null
  const label = health.commit ? `v${health.version} · ${health.commit}` : `v${health.version}`
  return { label, title: health.builtAt ? `Server built ${health.builtAt}` : undefined }
}
