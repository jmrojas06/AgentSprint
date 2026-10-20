import { useCallback, useEffect, useState } from 'react'
import { BookOpenText, Check, CircleAlert, ClipboardCopy, Hourglass, NotebookPen, PlayCircle, ShieldCheck, Sparkles, X } from 'lucide-react'
import type { JournalEntry, ProjectContext, Task } from '../types'
import { api } from '../api'
import { AssigneeChip } from '../agents'
import { cx, criterionChecked, lastNoteText, priorityDot, reviewState, statusAccent } from '../ui'

interface Props {
  /** Changes whenever the board changes, so the brief is refetched. */
  version: unknown
  onOpenTask: (id: string) => void
}

const AUTHOR_KEY = 'agentsprint.author'

function storedAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) || 'human'
  } catch {
    return 'human'
  }
}

function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const lines = (text: string): string[] => text.split('\n').map((l) => l.replace(/^\s*[-*]\s*/, '').trim()).filter(Boolean)

export function Overview({ version, onOpenTask }: Props) {
  const [ctx, setCtx] = useState<ProjectContext | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [writing, setWriting] = useState(false)

  const load = useCallback(async () => {
    try {
      setCtx(await api.context())
      setFailed(null)
    } catch (e) {
      setFailed((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, version])

  const copyBrief = async () => {
    if (!ctx) return
    try {
      await navigator.clipboard.writeText(ctx.markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setFailed('Clipboard is not available in this browser.')
    }
  }

  if (failed && !ctx) {
    return (
      <p role="alert" className="flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
        <CircleAlert className="h-4 w-4" /> Could not load the project brief: {failed}
      </p>
    )
  }
  if (!ctx) return <OverviewSkeleton />

  const { snapshot: snap, journal } = ctx
  const stats = snap.stats
  const handoff = journal[0] ?? null

  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-4 pb-8" data-testid="overview">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5" aria-labelledby="ov-sprint">
          {snap.sprint && stats ? (
            <>
              <p className="text-xs text-zinc-500">
                Sprint <span className="font-mono text-zinc-300">{snap.sprint.id}</span> is active
              </p>
              <h2 id="ov-sprint" className="mt-1 line-clamp-2 text-pretty text-lg font-semibold leading-snug tracking-tight text-zinc-50">
                {snap.sprint.goal || 'No goal set for this sprint'}
              </h2>
              <div className="mt-5 flex items-end gap-4">
                <span className="tabular text-4xl font-semibold leading-none tracking-tight text-zinc-50">{stats.completionPct}%</span>
                <span className="tabular pb-1 text-xs text-zinc-400">
                  {stats.done} of {stats.total} tasks done, {stats.pointsDone} of {stats.pointsTotal} points
                </span>
              </div>
              <StatusBar
                segments={[
                  { label: 'Done', count: stats.done },
                  { label: 'Review', count: stats.review },
                  { label: 'In Progress', count: stats.inProgress },
                  { label: 'To Do', count: stats.todo },
                  { label: 'Backlog', count: stats.backlog },
                ]}
                total={stats.total}
              />
            </>
          ) : (
            <>
              <h2 id="ov-sprint" className="text-lg font-semibold tracking-tight text-zinc-50">No active sprint</h2>
              <p className="mt-1 max-w-[60ch] text-sm text-zinc-400">
                Below is the unscheduled work. Activate a sprint from the side panel, or ask your agent to run the
                <code className="mx-1 rounded bg-zinc-800 px-1 font-mono text-xs">sprint-plan</code>prompt.
              </p>
            </>
          )}
          <dl className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="In progress" value={snap.inProgress.length} tone="text-indigo-300" />
            <Stat label="Waiting for review" value={snap.review.length} tone="text-amber-300" />
            <Stat label="Ready next" value={snap.next.length} tone="text-sky-300" />
            <Stat label="Blocked" value={snap.blocked.length} tone={snap.blocked.length ? 'text-red-300' : 'text-zinc-300'} />
          </dl>
        </section>

        <section className="flex flex-col rounded-xl border border-zinc-800 bg-zinc-900/70 p-5" aria-labelledby="ov-resume">
          <h2 id="ov-resume" className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            <PlayCircle className="h-4 w-4 text-indigo-400" /> Continue in a new session
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
            Agents start every session from this brief and end it with a handoff, so nothing is lost between chats.
          </p>
          <ul className="mt-3 space-y-1.5 text-xs text-zinc-400">
            <li className="flex items-center gap-2">
              <code translate="no" className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">agentboard context</code>
              <span>in a terminal</span>
            </li>
            <li className="flex items-center gap-2">
              <code translate="no" className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-zinc-200">/mcp__agentsprint__resume</code>
              <span>in Claude Code</span>
            </li>
          </ul>
          <div className="mt-auto flex gap-2 pt-4">
            <button
              type="button"
              onClick={() => void copyBrief()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-500 active:translate-y-px"
              data-testid="copy-brief"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy brief'}
            </button>
            <button
              type="button"
              onClick={() => setWriting((v) => !v)}
              aria-expanded={writing}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 active:translate-y-px"
              data-testid="write-handoff"
            >
              <NotebookPen className="h-3.5 w-3.5" /> Write handoff
            </button>
          </div>
        </section>
      </div>

      {writing && (
        <HandoffForm
          onCancel={() => setWriting(false)}
          onSaved={async () => {
            setWriting(false)
            await load()
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <TaskSection
            title="In progress"
            empty="Nothing is being worked on right now."
            tasks={snap.inProgress}
            onOpen={onOpenTask}
            detail={(t) => lastNoteText(t)}
          />
          <TaskSection
            title="Waiting for review"
            empty="No work is waiting for review."
            tasks={snap.review}
            onOpen={onOpenTask}
          />
          <TaskSection
            title="Ready next"
            hint="Unblocked, highest priority first"
            empty="Nothing is ready to start. Plan more work or unblock a task."
            tasks={snap.next}
            onOpen={onOpenTask}
            limit={6}
          />
          {snap.blocked.length > 0 && (
            <TaskSection
              title="Blocked"
              empty=""
              tasks={snap.blocked.map((b) => b.task)}
              onOpen={onOpenTask}
              detail={(t) => {
                const b = snap.blocked.find((x) => x.task.id === t.id)
                return b ? `Waits on ${b.blockers.join(', ')}` : null
              }}
            />
          )}
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4" aria-labelledby="ov-handoff">
            <h2 id="ov-handoff" className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <BookOpenText className="h-4 w-4 text-zinc-400" /> Last handoff
            </h2>
            {handoff ? (
              <HandoffCard entry={handoff} />
            ) : (
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                No handoff yet. Agents leave one with <code className="rounded bg-zinc-800 px-1 font-mono">session_handoff</code> when a
                session ends, or you can write one above.
              </p>
            )}
            {journal.length > 1 && (
              <details className="group mt-3 border-t border-zinc-800 pt-3">
                <summary className="cursor-pointer list-none text-xs text-zinc-400 hover:text-zinc-200">
                  Earlier sessions <span className="tabular text-zinc-500">({journal.length - 1})</span>
                </summary>
                <ol className="mt-2 space-y-3">
                  {journal.slice(1).map((e) => (
                    <li key={`${e.at}-${e.author}`} className="text-xs">
                      <p className="text-zinc-500">
                        {when(e.at)} by <span className="text-zinc-300">{e.author}</span>
                      </p>
                      {e.summary && <p className="mt-0.5 leading-relaxed text-zinc-300">{e.summary}</p>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>

          <section className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4" aria-labelledby="ov-done">
            <h2 id="ov-done" className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
              <Sparkles className="h-4 w-4 text-zinc-400" /> Recently done
            </h2>
            {snap.recentlyDone.length === 0 ? (
              <p className="mt-2 text-xs text-zinc-500">Nothing finished yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {snap.recentlyDone.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => onOpenTask(t.id)}
                      className="flex w-full items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-zinc-800/70"
                    >
                      <span className="font-mono text-[11px] text-zinc-500" translate="no">{t.id}</span>
                      <span className="min-w-0 flex-1 truncate text-zinc-300">{t.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-zinc-950/60 px-3 py-2">
      <dt className="text-[11px] text-zinc-500">{label}</dt>
      <dd className={cx('tabular mt-0.5 text-lg font-semibold leading-tight', tone)}>{value}</dd>
    </div>
  )
}

function StatusBar({ segments, total }: { segments: Array<{ label: string; count: number }>; total: number }) {
  if (total === 0) return <p className="mt-3 text-xs text-zinc-500">This sprint has no tasks yet.</p>
  return (
    <div className="mt-3">
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${s.label}: ${s.count}`).join(', ')}>
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <span key={s.label} className={cx('h-full', statusAccent[s.label] ?? 'bg-zinc-700')} style={{ width: `${(s.count / total) * 100}%` }} />
          ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className={cx('h-1.5 w-1.5 rounded-full', statusAccent[s.label] ?? 'bg-zinc-700')} />
              {s.label} <span className="tabular text-zinc-300">{s.count}</span>
            </li>
          ))}
      </ul>
    </div>
  )
}

function TaskSection({
  title,
  hint,
  empty,
  tasks,
  onOpen,
  detail,
  limit = 8,
}: {
  title: string
  hint?: string
  empty: string
  tasks: Task[]
  onOpen: (id: string) => void
  detail?: (t: Task) => string | null
  limit?: number
}) {
  const [all, setAll] = useState(false)
  const shown = all ? tasks : tasks.slice(0, limit)
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70" aria-label={title}>
      <header className="flex items-baseline gap-2 border-b border-zinc-800 px-4 py-3">
        <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
        <span className="tabular text-xs text-zinc-500">{tasks.length}</span>
        {hint && <span className="ml-auto hidden text-[11px] text-zinc-500 sm:inline">{hint}</span>}
      </header>
      {tasks.length === 0 ? (
        <p className="px-4 py-4 text-xs text-zinc-500">{empty}</p>
      ) : (
        <ul className="p-1.5">
          {shown.map((t) => (
            <li key={t.id}>
              <TaskRow task={t} onOpen={onOpen} detail={detail?.(t) ?? null} />
            </li>
          ))}
          {tasks.length > limit && (
            <li>
              <button type="button" onClick={() => setAll((v) => !v)} className="w-full rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200">
                {all ? 'Show less' : `Show ${tasks.length - limit} more`}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  )
}

function TaskRow({ task, onOpen, detail }: { task: Task; onOpen: (id: string) => void; detail: string | null }) {
  const total = task.acceptanceCriteria.length
  const done = task.acceptanceCriteria.filter(criterionChecked).length
  const review = reviewState(task)
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-zinc-800/70"
    >
      <span className="flex items-center gap-1.5 pt-0.5">
        <span className={cx('h-1.5 w-1.5 rounded-full', priorityDot[task.priority])} title={`${task.priority} priority`} />
        <span className="font-mono text-[11px] text-zinc-500" translate="no">{task.id}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-zinc-100">{task.title}</span>
        {detail && <span className="mt-0.5 block truncate text-xs text-zinc-500">{detail}</span>}
      </span>
      <span className="flex items-center gap-2 pt-0.5">
        {review && <ReviewBadge verdict={review.verdict} by={review.by} />}
        {total > 0 && (
          <span className="tabular hidden text-[11px] text-zinc-500 sm:inline" title="Acceptance criteria done">
            {done}/{total}
          </span>
        )}
        <AssigneeChip assignee={task.assignee} />
      </span>
    </button>
  )
}

export function ReviewBadge({ verdict, by }: { verdict: 'approved' | 'changes'; by: string }) {
  return verdict === 'approved' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300" title={`Approved by ${by}`} data-testid="review-badge">
      <ShieldCheck className="h-3 w-3" /> Approved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300" title={`Changes requested by ${by}`} data-testid="review-badge">
      <Hourglass className="h-3 w-3" /> Changes
    </span>
  )
}

function HandoffCard({ entry }: { entry: JournalEntry }) {
  const list = (title: string, items: string[], tone: string) =>
    items.length > 0 && (
      <div className="mt-2.5">
        <p className={cx('text-[11px] font-medium', tone)}>{title}</p>
        <ul className="mt-1 space-y-1">
          {items.map((i, n) => (
            <li key={n} className="flex gap-2 text-xs leading-relaxed text-zinc-300">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-zinc-600" />
              <span className="min-w-0">{i}</span>
            </li>
          ))}
        </ul>
      </div>
    )
  return (
    <div className="mt-2" data-testid="last-handoff">
      <p className="text-[11px] text-zinc-500">
        {when(entry.at)} by <span className="text-zinc-300">{entry.author}</span>
      </p>
      {entry.summary && <p className="mt-1.5 text-sm leading-relaxed text-zinc-200">{entry.summary}</p>}
      {list('Next', entry.next, 'text-sky-300')}
      {list('Blockers', entry.blockers, 'text-red-300')}
      {list('Done', entry.done, 'text-emerald-300')}
    </div>
  )
}

function HandoffForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => Promise<void> }) {
  const [author, setAuthor] = useState(storedAuthor)
  const [summary, setSummary] = useState('')
  const [done, setDone] = useState('')
  const [next, setNext] = useState('')
  const [blockers, setBlockers] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      try {
        localStorage.setItem(AUTHOR_KEY, author.trim() || 'human')
      } catch {
        /* storage unavailable */
      }
      await api.addHandoff({ author: author.trim() || 'human', summary, done: lines(done), next: lines(next), blockers: lines(blockers) })
      await onSaved()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500'
  const label = 'mb-1.5 block text-xs font-medium text-zinc-300'
  return (
    <form onSubmit={submit} className="rounded-xl border border-zinc-700 bg-zinc-900 p-5" data-testid="handoff-form" aria-label="Write a session handoff">
      <div className="flex items-center">
        <h2 className="text-sm font-semibold text-zinc-100">Session handoff</h2>
        <button type="button" onClick={onCancel} className="ml-auto rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200" aria-label="Close handoff form">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-zinc-500">Saved to .agentboard/journal.md. The next session reads it first.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_200px]">
        <div>
          <label className={label} htmlFor="handoff-summary">What happened this session</label>
          <textarea id="handoff-summary" name="handoff-summary" autoComplete="off" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} className={field} placeholder="Finished the API, started the settings screen…" />
        </div>
        <div>
          <label className={label} htmlFor="handoff-author">Author</label>
          <input id="handoff-author" name="handoff-author" value={author} onChange={(e) => setAuthor(e.target.value)} className={field} autoComplete="off" spellCheck={false} />
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div>
          <label className={label} htmlFor="handoff-next">Next steps</label>
          <textarea id="handoff-next" name="handoff-next" autoComplete="off" rows={3} value={next} onChange={(e) => setNext(e.target.value)} className={field} placeholder={'One per line\nTK-12 finish settings'} />
        </div>
        <div>
          <label className={label} htmlFor="handoff-blockers">Blockers</label>
          <textarea id="handoff-blockers" name="handoff-blockers" autoComplete="off" rows={3} value={blockers} onChange={(e) => setBlockers(e.target.value)} className={field} placeholder="One per line" />
        </div>
        <div>
          <label className={label} htmlFor="handoff-done">Done</label>
          <textarea id="handoff-done" name="handoff-done" autoComplete="off" rows={3} value={done} onChange={(e) => setDone(e.target.value)} className={field} placeholder="One per line" />
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || (!summary.trim() && !next.trim() && !done.trim() && !blockers.trim())}
          className="rounded-md bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save handoff
        </button>
      </div>
    </form>
  )
}

function OverviewSkeleton() {
  const block = 'animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/70'
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-4" aria-busy="true" aria-label="Loading project brief">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cx(block, 'h-56')} />
        <div className={cx(block, 'h-56')} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className={cx(block, 'h-72')} />
        <div className={cx(block, 'h-72')} />
      </div>
    </div>
  )
}
