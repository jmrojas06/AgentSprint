import { useState } from 'react'
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
  const [dragOver, setDragOver] = useState<string | null>(null)

  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {statuses.map((status) => {
        const column = tasks.filter((t) => t.status === status)
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
              const task = tasks.find((t) => t.id === id)
              if (task && task.status !== status) onMove(task, status)
            }}
            className={cx(
              'flex w-72 shrink-0 flex-col rounded-lg border transition-colors',
              isOver ? 'border-indigo-500/70 bg-indigo-950/20' : 'border-zinc-800/80 bg-zinc-950/60',
            )}
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
                  <TaskCard task={task} statuses={statuses} onOpen={onOpen} onMove={onMove} />
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