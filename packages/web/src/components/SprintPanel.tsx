import { useState } from 'react'
import { CheckCircle2, Circle, Play, Plus, Square } from 'lucide-react'
import type { Sprint } from '../types'
import { cx, fmtDate } from '../ui'

interface Props {
  sprints: Sprint[]
  activeSprintId: number | null
  tasksBySprint: Map<number, number>
  doneBySprint: Map<number, number>
  onActivate: (id: number) => void
  onClose: (id: number) => void
  onCreate: (goal: string) => void
}

export function SprintPanel({ sprints, activeSprintId, tasksBySprint, doneBySprint, onActivate, onClose, onCreate }: Props) {
  const [goal, setGoal] = useState('')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!goal.trim()) return
    onCreate(goal.trim())
    setGoal('')
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <Square className="h-3.5 w-3.5 text-zinc-400" /> Sprints
      </h2>

      <form onSubmit={submit} className="mb-2 flex gap-1.5">
        <input
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="New sprint goal…"
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-indigo-500"
        />
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          title="Create sprint"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>

      <ul className="space-y-1.5">
        {sprints.map((s) => {
          const active = s.id === activeSprintId
          const total = tasksBySprint.get(s.id) ?? 0
          const done = doneBySprint.get(s.id) ?? 0
          const pct = total === 0 ? 0 : Math.round((done / total) * 100)
          return (
            <li key={s.id} className={cx('rounded-md border p-2', active ? 'border-indigo-600/60 bg-indigo-950/30' : 'border-zinc-800')}>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-zinc-500">S{s.id}</span>
                {active ? (
                  <Play className="h-3 w-3 text-indigo-400" />
                ) : s.status === 'closed' ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Circle className="h-3 w-3 text-zinc-600" />
                )}
                <span className="ml-auto text-[11px] text-zinc-500">
                  {done}/{total} {total > 0 && `· ${pct}%`}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-300">{s.goal || <i className="text-zinc-600">No goal</i>}</p>
              {total > 0 && (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    className={cx('h-full rounded-full', pct === 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                <span className="text-zinc-500">{fmtDate(s.startedAt)}</span>
                <span className="ml-auto flex gap-1">
                  {!active && s.status === 'planned' && (
                    <button
                      onClick={() => onActivate(s.id)}
                      className="rounded bg-indigo-600/20 px-1.5 py-0.5 text-indigo-300 hover:bg-indigo-600/40"
                    >
                      Activate
                    </button>
                  )}
                  {active && (
                    <button
                      onClick={() => onClose(s.id)}
                      className="rounded bg-emerald-600/20 px-1.5 py-0.5 text-emerald-300 hover:bg-emerald-600/40"
                    >
                      Close
                    </button>
                  )}
                  <button
                    onClick={() => onActivate(s.id)}
                    className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400 hover:bg-zinc-700"
                    title="Set active"
                  >
                    Set active
                  </button>
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
