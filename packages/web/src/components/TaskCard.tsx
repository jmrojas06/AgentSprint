import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Task } from '../types'
import { cx, priorityDot, priorityLabel, statusAccent } from '../ui'

interface Props {
  task: Task
  statuses: string[]
  onOpen: (task: Task) => void
  onMove: (task: Task, next: string) => void
}

export function TaskCard({ task, statuses, onOpen, onMove }: Props) {
  const idx = statuses.indexOf(task.status)
  const prev = idx > 0 ? statuses[idx - 1] : null
  const next = idx >= 0 && idx < statuses.length - 1 ? statuses[idx + 1] : null
  const done = task.acceptanceCriteria.length

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cx(
        'group w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left',
        'transition-colors hover:border-zinc-600 hover:bg-zinc-800/80',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', priorityDot[task.priority])} title={`${priorityLabel[task.priority]} priority`} />
        <span className="font-mono text-xs text-zinc-500">{task.id}</span>
        <span
          className={cx(
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium',
            task.assignee === 'agent' ? 'bg-violet-500/15 text-violet-300' : 'bg-zinc-700/50 text-zinc-300',
          )}
        >
          {task.assignee}
        </span>
      </div>

      <h3 className="mt-2 text-sm font-medium leading-snug text-zinc-100">{task.title}</h3>

      {task.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {task.tags.slice(0, 3).map((t) => (
            <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
              {t}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        {done > 0 && (
          <span className="text-[11px] text-zinc-500">
            {done} {done === 1 ? 'criterion' : 'criteria'}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {prev && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                onMove(task, prev)
              }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
              title={`Move to ${prev}`}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </span>
          )}
          {next && (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation()
                onMove(task, next)
              }}
              className="rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
              title={`Move to ${next}`}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
        </span>
      </div>

      {task.status !== 'Done' && (
        <div className={cx('mt-2 h-0.5 w-full rounded', statusAccent[task.status] ?? 'bg-zinc-700')} />
      )}
    </button>
  )
}
