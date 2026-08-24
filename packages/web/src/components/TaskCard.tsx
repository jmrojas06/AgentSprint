import { ChevronLeft, ChevronRight, Dot, GitCommitHorizontal, Lock } from 'lucide-react'
import type { Task } from '../types'
import { cx, criterionChecked, getBlockerTasks, getTaskLock, priorityDot, priorityLabel, statusAccent } from '../ui'

interface Props {
  task: Task
  allTasks: Task[]
  statuses: string[]
  commitCount?: number
  onOpen: (task: Task) => void
  onMove: (task: Task, next: string) => void
}

export function TaskCard({ task, allTasks, statuses, commitCount, onOpen, onMove }: Props) {
  const idx = statuses.indexOf(task.status)
  const prev = idx > 0 ? statuses[idx - 1] : null
  const next = idx >= 0 && idx < statuses.length - 1 ? statuses[idx + 1] : null
  const total = task.acceptanceCriteria.length
  const completed = task.acceptanceCriteria.filter((c) => criterionChecked(c)).length
  const blockers = task.dependencies.length > 0 ? getBlockerTasks(task, allTasks) : []
  const isBlocked = task.dependencies.length > 0 && blockers.length > 0
  const lock = getTaskLock(task)

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className={cx(
        'group w-full rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-left',
        'transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-600 hover:bg-zinc-800/80 hover:shadow-md hover:shadow-black/20',
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', priorityDot[task.priority])} title={`${priorityLabel[task.priority]} priority`} />
        <span className="font-mono text-xs text-zinc-500">{task.id}</span>
        {lock && (
          <span
            className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
            title={`Locked by ${lock.lockedBy}`}
            data-testid="task-lock"
          >
            <Lock className="h-2.5 w-2.5" />
            {lock.lockedBy}
          </span>
        )}
        <span
          className={cx(
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-medium',
            task.assignee === 'dev' ? 'bg-indigo-500/15 text-indigo-300' : task.assignee === 'review' ? 'bg-amber-500/15 text-amber-300' : task.assignee === 'perfect' ? 'bg-green-500/15 text-green-300' : 'bg-zinc-700/50 text-zinc-300',
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
        {total > 0 && (
          <span className="text-[11px] text-zinc-500">
            {completed}/{total} AC
          </span>
        )}
        {task.dependencies.length > 0 && (
          <span
            className={cx(
              'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              isBlocked ? 'bg-red-500/15 text-red-300' : 'bg-emerald-500/15 text-emerald-300',
            )}
            title={isBlocked ? `Blocked by ${blockers.map((b) => b.id).join(', ')}` : 'All dependencies complete'}
          >
            <Dot className="h-3 w-3" />
            {isBlocked ? `Blocked by ${blockers.length}` : 'Ready'}
          </span>
        )}
        {commitCount != null && commitCount > 0 && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
            title={`${commitCount} linked commit${commitCount === 1 ? '' : 's'}`}
          >
            <GitCommitHorizontal className="h-3 w-3" />
            {commitCount}
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
