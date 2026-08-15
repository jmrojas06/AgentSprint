import type { Task } from '../types'
import { TaskCard } from './TaskCard'
import { cx, statusAccent } from '../ui'

interface Props {
  statuses: string[]
  tasks: Task[]
  onOpen: (task: Task) => void
  onMove: (task: Task, next: string) => void
}

export function Board({ statuses, tasks, onOpen, onMove }: Props) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {statuses.map((status) => {
        const column = tasks.filter((t) => t.status === status)
        return (
          <div
            key={status}
            className="flex w-72 shrink-0 flex-col rounded-lg border border-zinc-800/80 bg-zinc-950/60"
          >
            <div className="flex items-center gap-2 px-3 py-2.5">
              <span className={cx('h-2 w-2 rounded-full', statusAccent[status] ?? 'bg-zinc-600')} />
              <h2 className="text-sm font-semibold text-zinc-200">{status}</h2>
              <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                {column.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {column.map((task) => (
                <TaskCard key={task.id} task={task} statuses={statuses} onOpen={onOpen} onMove={onMove} />
              ))}
              {column.length === 0 && (
                <div className="rounded-lg border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-600">
                  Empty
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
