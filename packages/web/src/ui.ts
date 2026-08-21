import type { Sprint, Task, TaskPriority, TaskStatus } from './types'

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

export type SortBy = 'priority' | 'estimate' | 'updatedAt'
export type SortDir = 'asc' | 'desc'

const priorityRank: Record<TaskPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 }

/** Sort tasks by the given key and direction. `desc` puts higher-priority / larger-estimate / more-recent first. */
export function sortTasks(tasks: Task[], sortBy: SortBy, sortDir: SortDir): Task[] {
  const dir = sortDir === 'desc' ? 1 : -1
  return [...tasks].sort((a, b) => {
    let aVal: number, bVal: number
    if (sortBy === 'priority') {
      aVal = priorityRank[a.priority] ?? 0
      bVal = priorityRank[b.priority] ?? 0
    } else if (sortBy === 'estimate') {
      aVal = a.estimate
      bVal = b.estimate
    } else {
      aVal = new Date(a.updatedAt).getTime()
      bVal = new Date(b.updatedAt).getTime()
    }
    return (aVal - bVal) * dir
  })
}
