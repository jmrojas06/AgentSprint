import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Task } from '../types'
import { criterionChecked, cx, fmtDate, priorityDot, priorityLabel, sortTasks, statusAccent, type SortBy, type SortDir } from '../ui'

const COLUMNS: Array<{ key: SortBy; label: string; className?: string }> = [
  { key: 'id', label: 'ID', className: 'w-20' },
  { key: 'title', label: 'Title' },
  { key: 'status', label: 'Status', className: 'w-28' },
  { key: 'priority', label: 'Priority', className: 'w-24' },
  { key: 'sprint', label: 'Sprint', className: 'w-16' },
  { key: 'assignee', label: 'Assignee', className: 'w-24' },
  { key: 'ac', label: 'AC', className: 'w-16' },
  { key: 'updatedAt', label: 'Updated', className: 'w-24' },
]

interface Props {
  tasks: Task[]
  sortBy: SortBy
  sortDir: SortDir
  onSortBy: (val: SortBy) => void
  onSortDir: (val: SortDir) => void
  onOpen: (task: Task) => void
}

export function ListView({ tasks, sortBy, sortDir, onSortBy, onSortDir, onOpen }: Props) {
  const sorted = sortTasks(tasks, sortBy, sortDir)

  const headerClick = (key: SortBy) => {
    if (sortBy === key) {
      onSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      onSortBy(key)
      onSortDir('desc')
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-800/80 bg-zinc-950/60" data-testid="list-view">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-zinc-800 text-[11px] uppercase tracking-wide text-zinc-500">
            {COLUMNS.map((col) => (
              <th key={col.key} scope="col" className={cx('px-3 py-2 font-medium', col.className)}>
                <button
                  type="button"
                  onClick={() => headerClick(col.key)}
                  className={cx(
                    'flex items-center gap-1 hover:text-zinc-200',
                    sortBy === col.key && 'text-indigo-400',
                  )}
                  title={`Sort by ${col.label.toLowerCase()}`}
                >
                  {col.label}
                  {sortBy === col.key &&
                    (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((task) => {
            const doneAc = task.acceptanceCriteria.filter(criterionChecked).length
            return (
              <tr
                key={task.id}
                onClick={() => onOpen(task)}
                data-testid="list-row"
                className={cx(
                  'cursor-pointer border-b border-zinc-900/80 transition-colors hover:bg-zinc-900/60',
                  task.status === 'Done' && 'opacity-60',
                )}
              >
                <td className="px-3 py-2 font-mono text-zinc-400">{task.id}</td>
                <td className="max-w-md truncate px-3 py-2 font-medium text-zinc-200">{task.title}</td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 text-zinc-300">
                    <span className={cx('h-1.5 w-1.5 rounded-full', statusAccent[task.status] ?? 'bg-zinc-600')} />
                    {task.status}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5 capitalize text-zinc-300">
                    <span className={cx('h-1.5 w-1.5 rounded-full', priorityDot[task.priority])} />
                    {priorityLabel[task.priority]}
                  </span>
                </td>
                <td className="px-3 py-2 font-mono text-zinc-400">{task.sprint ?? '—'}</td>
                <td className="px-3 py-2 text-zinc-300">{task.assignee}</td>
                <td className="px-3 py-2 font-mono text-zinc-400">
                  {doneAc}/{task.acceptanceCriteria.length}
                </td>
                <td className="px-3 py-2 text-zinc-400">{fmtDate(task.updatedAt)}</td>
              </tr>
            )
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-zinc-600" data-testid="list-empty">
                No tasks match the current filters
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
