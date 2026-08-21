import { SortAsc, SortDesc } from 'lucide-react'
import { useState } from 'react'
import type { Task } from '../types'
import { TaskCard } from './TaskCard'
import { cx, getBlockerTasks, sortTasks, type SortBy, type SortDir, statusAccent } from '../ui'

interface Props {
  statuses: string[]
  tasks: Task[]
  allTasks: Task[]
  sortBy: SortBy
  sortDir: SortDir
  onSortBy: (val: SortBy) => void
  onSortDir: (val: SortDir) => void
  onOpen: (task: Task) => void
  onMove: (task: Task, next: string) => void
}

export function Board({ statuses, tasks, allTasks, sortBy, sortDir, onSortBy, onSortDir, onOpen, onMove }: Props) {
  const [dragOver, setDragOver] = useState<string | null>(null)

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {statuses.map((status) => {
        const column = sortTasks(tasks.filter((t) => t.status === status), sortBy, sortDir)
        const isOver = dragOver === status
        return (
          <div
            key={status}
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dragOver !== status) setDragOver(status)
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(null)
            }}
             onDrop={(e) => {
               e.preventDefault()
               setDragOver(null)
               const id = e.dataTransfer.getData('text/plain')
               const task = allTasks.find((t) => t.id === id)
               if (!task || task.status === status) return
               if (status === 'In Progress' && task.dependencies.length > 0) {
                 const blockers = getBlockerTasks(task, allTasks)
                 if (blockers.length > 0) {
                   const depIds = blockers.map((b) => b.id).join(', ')
                   if (!confirm(`"${task.title}" is blocked by ${depIds}. Move to In Progress anyway?`)) {
                     return
                   }
                 }
               }
               onMove(task, status)
             }}
            className={cx(
              'flex w-72 shrink-0 flex-col rounded-lg border transition-colors',
              isOver ? 'border-indigo-500/70 bg-indigo-950/20' : 'border-zinc-800/80 bg-zinc-950/60',
            )}
          >
             <div className="flex items-center gap-1 px-3 py-2.5">
              <span className={cx('h-2 w-2 rounded-full', statusAccent[status] ?? 'bg-zinc-600')} />
              <h2 className="text-sm font-semibold text-zinc-200">{status}</h2>
              <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                {column.length}
              </span>
              <select
                value={sortBy}
                onChange={(e) => onSortBy(e.target.value as SortBy)}
                className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300 outline-none focus:border-indigo-500"
                title="Sort by"
              >
                <option value="priority">Priority</option>
                <option value="estimate">Estimate</option>
                <option value="updatedAt">Updated</option>
              </select>
              <button
                onClick={() => onSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
                className="rounded p-0.5 text-zinc-500 hover:text-zinc-300"
                title={`Sort ${sortDir === 'desc' ? 'descending' : 'ascending'}`}
              >
                {sortDir === 'desc' ? <SortDesc className="h-3 w-3" /> : <SortAsc className="h-3 w-3" />}
              </button>
            </div>
            <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
              {column.map((task) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', task.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragEnd={() => setDragOver(null)}
                  className={cx('cursor-grab active:cursor-grabbing', task.status === 'Done' && 'opacity-70')}
                >
                  <TaskCard task={task} allTasks={allTasks} statuses={statuses} onOpen={onOpen} onMove={onMove} />
                </div>
              ))}
              {column.length === 0 && (
                <div className="rounded-lg border border-dashed border-zinc-800 py-6 text-center text-xs text-zinc-600">
                  {isOver ? 'Drop here' : 'Empty'}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}