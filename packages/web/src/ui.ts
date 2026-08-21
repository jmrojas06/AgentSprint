import type { Sprint, Task, TaskPriority, TaskStatus } from './types'
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

export type ViewMode = 'kanban' | 'list'

/** Resolve the board view from a URL query string (e.g. "?view=list"), falling back to `fallback`. */
export function viewFromQuery(search: string, fallback: ViewMode = 'kanban'): ViewMode {
  const value = new URLSearchParams(search).get('view')
  return value === 'list' || value === 'kanban' ? value : fallback
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
