import type { TaskPriority, TaskStatus } from './types'

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
