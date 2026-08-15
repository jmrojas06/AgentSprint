import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { Sprint, TaskPriority } from '../types'
import { TASK_PRIORITIES } from '../types'
import { priorityDot, priorityLabel } from '../ui'

interface Props {
  sprints: Sprint[]
  onCreate: (input: { title: string; sprint: number | null; priority: TaskPriority; assignee: 'human' | 'agent' }) => void
  onClose: () => void
}

export function NewTaskModal({ sprints, onCreate, onClose }: Props) {
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assignee, setAssignee] = useState<'human' | 'agent'>('human')
  const [sprint, setSprint] = useState<number | null>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    onCreate({ title: title.trim(), sprint, priority, assignee })
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500'
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center">
          <h2 className="text-sm font-semibold text-zinc-100">New task</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className={label}>Title</label>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What should be done?"
          className={field + ' mb-3'}
        />

        <div className="mb-3 grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Priority</label>
            <div className="flex gap-1">
              {TASK_PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPriority(p)}
                  title={priorityLabel[p]}
                  className={
                    'h-7 flex-1 rounded-md border text-[10px] ' +
                    (priority === p ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200' : 'border-zinc-700 text-zinc-500 hover:border-zinc-500')
                  }
                >
                  <span className={'mx-auto block h-1.5 w-1.5 rounded-full ' + priorityDot[p]} />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={label}>Assignee</label>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value as 'human' | 'agent')} className={field}>
              <option value="human">Human</option>
              <option value="agent">AI agent</option>
            </select>
          </div>

          <div>
            <label className={label}>Sprint</label>
            <select value={sprint ?? ''} onChange={(e) => setSprint(e.target.value === '' ? null : Number(e.target.value))} className={field}>
              <option value="">Backlog</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  S{s.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim()}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Create
          </button>
        </div>
      </form>
    </div>
  )
}
