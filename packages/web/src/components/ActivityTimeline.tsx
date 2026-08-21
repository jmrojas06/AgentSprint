import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRightCircle,
  CheckSquare,
  CircleAlert,
  Pencil,
  Plus,
  StickyNote,
  User,
} from 'lucide-react'
import type { ActivityEvent } from '../types'
import { ACTIVITY_TYPES } from '../types'
import { api } from '../api'
import { cx } from '../ui'

const EVENT_META: Record<string, { icon: typeof Plus; color: string; label: string }> = {
  created: { icon: Plus, color: 'text-emerald-400', label: 'Created' },
  status: { icon: ArrowRightCircle, color: 'text-indigo-400', label: 'Status' },
  assignee: { icon: User, color: 'text-sky-400', label: 'Assignee' },
  checklist: { icon: CheckSquare, color: 'text-amber-400', label: 'Checklist' },
  note: { icon: StickyNote, color: 'text-zinc-400', label: 'Note' },
  update: { icon: Pencil, color: 'text-violet-400', label: 'Updated' },
}

function formatWhen(at: string): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return at
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ActivityTimeline({ taskId }: { taskId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    api
      .getTaskActivity(taskId)
      .then((res) => {
        if (!cancelled) setEvents(res.activity)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskId])

  const presentTypes = useMemo(() => ACTIVITY_TYPES.filter((t) => events.some((e) => e.type === t)), [events])

  const visible = filter === 'all' ? events : events.filter((e) => e.type === filter)

  const select = 'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-indigo-500'

  return (
    <div className="sm:col-span-2">
      <div className="mb-3 flex items-center">
        <label className="mb-0 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">Activity</label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className={cx(select, 'ml-auto')}>
          <option value="all">All events</option>
          {presentTypes.map((t) => (
            <option key={t} value={t}>
              {EVENT_META[t]?.label ?? t}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="py-4 text-xs text-zinc-500">Loading activity…</p>}
      {failed && (
        <p className="flex items-center gap-1.5 py-4 text-xs text-red-400">
          <CircleAlert className="h-3.5 w-3.5" /> Could not load activity.
        </p>
      )}
      {!loading && !failed && visible.length === 0 && (
        <p className="py-4 text-xs text-zinc-500">No activity recorded{filter !== 'all' ? ' for this event type' : ''}.</p>
      )}

      {!loading && !failed && visible.length > 0 && (
        <ol className="relative ml-2 border-l border-zinc-800 pl-4">
          {visible.map((e, i) => {
            const meta = EVENT_META[e.type] ?? EVENT_META['update']!
            const Icon = meta.icon
            return (
              <li key={`${e.at}-${i}`} className="relative pb-4 last:pb-0">
                <span
                  className={cx(
                    'absolute -left-[26px] flex h-4 w-4 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950',
                  )}
                >
                  <Icon className={cx('h-2.5 w-2.5', meta.color)} />
                </span>
                <p className="text-xs leading-snug text-zinc-200">{e.detail || meta.label}</p>
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  {meta.label} · {e.actor} · {formatWhen(e.at)}
                </p>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
