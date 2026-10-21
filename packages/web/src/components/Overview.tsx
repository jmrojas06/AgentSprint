import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { BookOpenText, Check, CheckCheck, CircleAlert, ClipboardCopy, Lightbulb, NotebookPen, PlayCircle, Sparkles, Undo2, X } from 'lucide-react'
import type { JournalEntry, ProjectContext, Task } from '../types'
import { api } from '../api'
import { AssigneeChip } from '../agents'
import { closableApproved, cx, criterionChecked, lastNoteText, latestReview, priorityDot, reviewState, statusAccent } from '../ui'
import { CloseApprovedDialog, RequestChangesDialog, ReviewBadge, markDoneClass, requestChangesClass } from './ReviewControls'

interface Props {
  /** Changes whenever the board changes, so the brief is refetched. */
  version: unknown
  onOpenTask: (id: string) => void
  /** Opens the Sprints side panel (a drawer below 1024px). */
  onOpenSprints?: () => void
  /** Opens the Idea → MVP dialog; offered when no sprint is active or nothing is pending. */
  onStartIdea?: () => void
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

export function Overview({ version, onOpenTask, onOpenSprints, onStartIdea }: Props) {
  const [ctx, setCtx] = useState<ProjectContext | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [writing, setWriting] = useState(false)
  const writeButton = useRef<HTMLButtonElement>(null)

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
  const nothingPending = snap.inProgress.length + snap.review.length + snap.next.length + snap.blocked.length === 0
  const offerIdea = Boolean(onStartIdea) && (!snap.sprint || nothingPending)

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
              <SprintProgress
                pct={stats.completionPct}
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
                Below is the unscheduled work. Activate a sprint from the{' '}
                {onOpenSprints ? (
                  <button type="button" onClick={onOpenSprints} className="font-medium text-indigo-300 underline decoration-indigo-300/40 underline-offset-2 hover:decoration-indigo-300">
                    Sprints panel
                  </button>
                ) : (
                  'Sprints panel'
                )}
                , or ask your agent to run the
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
              ref={writeButton}
              onClick={() => setWriting((v) => !v)}
              aria-expanded={writing}
              aria-controls="handoff-form"
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 active:translate-y-px"
              data-testid="write-handoff"
            >
              <NotebookPen className="h-3.5 w-3.5" /> Write handoff
            </button>
          </div>
        </section>
      </div>

      {offerIdea && (
        <section
          className="flex flex-col gap-3 rounded-xl border border-dashed border-zinc-700 bg-zinc-900/40 p-4 sm:flex-row sm:items-center sm:gap-4"
          aria-labelledby="ov-idea"
          data-testid="overview-idea"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-950 text-indigo-300" aria-hidden="true">
            <Lightbulb className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="ov-idea" className="text-sm font-semibold text-zinc-100">
              {snap.sprint ? 'Nothing left to start' : 'Turn an idea into a sprint'}
            </h2>
            <p className="mt-0.5 max-w-[65ch] text-pretty text-xs leading-relaxed text-zinc-400">
              Describe an idea and get a prompt for Claude Code that plans it as linked tasks on this board.
            </p>
          </div>
          <button
            type="button"
            onClick={onStartIdea}
            aria-haspopup="dialog"
            className="flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-indigo-500/50 px-3 py-2 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-950 active:translate-y-px"
            data-testid="overview-start-idea"
          >
            <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" /> Start from an idea
          </button>
        </section>
      )}

      {writing && (
        <HandoffForm
          onCancel={() => {
            setWriting(false)
            writeButton.current?.focus()
          }}
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
          <ReviewSection tasks={snap.review} onOpen={onOpenTask} onChanged={load} />
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

/**
 * Completion (Done share) as the filled part over a neutral track, so the bar
 * always agrees with the percentage next to it. The status mix lives in the
 * legend underneath.
 */
function SprintProgress({ pct, segments, total }: { pct: number; segments: Array<{ label: string; count: number }>; total: number }) {
  if (total === 0) return <p className="mt-3 text-xs text-zinc-500">This sprint has no tasks yet.</p>
  const value = Math.max(0, Math.min(100, pct))
  return (
    <div className="mt-3">
      <div
        className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-label="Sprint completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${value}% done`}
        data-testid="sprint-progress"
      >
        <div className={cx('h-full rounded-full transition-[width] duration-500', statusAccent.Done)} style={{ width: `${value}%` }} />
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500" aria-label="Tasks by status">
        {segments
          .filter((s) => s.count > 0)
          .map((s) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className={cx('h-1.5 w-1.5 rounded-full', statusAccent[s.label] ?? 'bg-zinc-700')} aria-hidden="true" />
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
        <h2 tabIndex={-1} data-task-list-heading={`overview:${title}`} className="text-sm font-semibold text-zinc-100">
          {title}
        </h2>
        <span className="tabular text-xs text-zinc-500">{tasks.length}</span>
        {hint && <span className="ml-auto hidden text-[11px] text-zinc-500 sm:inline">{hint}</span>}
      </header>
      {tasks.length === 0 ? (
        <p className="px-4 py-4 text-xs text-zinc-500">{empty}</p>
      ) : (
        <ul className="p-1.5" data-task-list={`overview:${title}`}>
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

function TaskRow({ task, onOpen, detail, actions }: { task: Task; onOpen: (id: string) => void; detail: string | null; actions?: ReactNode }) {
  const total = task.acceptanceCriteria.length
  const done = task.acceptanceCriteria.filter(criterionChecked).length
  // In Review the badge follows the same rule as Close approved: a verdict
  // stops counting once the work changes after it.
  const latest = task.status === 'Review' ? latestReview(task) : null
  const review = task.status === 'Review' ? (latest?.current ? latest : null) : reviewState(task)
  // Sized by its own column, not the viewport: next to the side panel the
  // Overview columns are narrow even on a wide screen. A row with actions
  // needs more room before the meta and the actions move beside the title.
  const layout = actions
    ? { row: '@xl:flex-row @xl:items-start', grid: '@3xl:grid-cols-[auto_minmax(0,1fr)_auto]', title: '@3xl:line-clamp-1', meta: '@3xl:col-start-3 @3xl:row-start-1 @3xl:pt-0.5', actions: '@xl:py-1 @xl:pl-0 @xl:pr-1.5' }
    : { row: '@md:flex-row @md:items-start', grid: '@md:grid-cols-[auto_minmax(0,1fr)_auto]', title: '@md:line-clamp-1', meta: '@md:col-start-3 @md:row-start-1 @md:pt-0.5', actions: '' }
  return (
    <div className="@container">
      <div className={cx('flex flex-col rounded-lg transition-colors hover:bg-zinc-800/70', layout.row)}>
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          data-task-id={task.id}
          className={cx('grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 rounded-lg px-2.5 py-2 text-left', layout.grid)}
        >
          <span className="flex items-center gap-1.5 pt-0.5">
            <span className={cx('h-1.5 w-1.5 rounded-full', priorityDot[task.priority])} title={`${task.priority} priority`} />
            <span className="font-mono text-[11px] text-zinc-500" translate="no">{task.id}</span>
          </span>
          <span className="min-w-0">
            <span className={cx('line-clamp-2 break-words text-sm text-zinc-100', layout.title)}>{task.title}</span>
            {detail && <span className="mt-0.5 block truncate text-xs text-zinc-500">{detail}</span>}
          </span>
          {/* In a narrow row the meta drops under the title so the title keeps the full width. */}
          <span className={cx('col-start-2 flex flex-wrap items-center gap-2', layout.meta)}>
            {review && <ReviewBadge verdict={review.verdict} by={review.by} />}
            {total > 0 && (
              <span className="tabular text-[11px] text-zinc-500" title="Acceptance criteria done">
                {done}/{total}
              </span>
            )}
            <AssigneeChip assignee={task.assignee} />
          </span>
        </button>
        {actions && <div className={cx('flex flex-wrap items-center gap-1 px-1.5 pb-1.5', layout.actions)}>{actions}</div>}
      </div>
    </div>
  )
}

/**
 * Waiting for review, with the human's decisions on each row (Mark done,
 * Request changes) and Close approved for every task the review gate
 * approved since its last change.
 */
function ReviewSection({ tasks, onOpen, onChanged }: { tasks: Task[]; onOpen: (id: string) => void; onChanged: () => Promise<void> }) {
  const limit = 8
  const [all, setAll] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [requesting, setRequesting] = useState<Task | null>(null)
  const [confirming, setConfirming] = useState<Task[] | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const approved = closableApproved(tasks)
  const shown = all ? tasks : tasks.slice(0, limit)

  // The row the user acted on is gone after a refresh: keep focus in the section.
  const refocus = () => requestAnimationFrame(() => headingRef.current?.focus())

  const markDone = async (t: Task) => {
    setBusyId(t.id)
    setMessage(null)
    try {
      await api.setTaskStatus(t.id, 'Done')
      setMessage({ tone: 'ok', text: `${t.id} moved to Done.` })
      await onChanged()
      refocus()
    } catch (e) {
      setMessage({ tone: 'error', text: `Could not move ${t.id}: ${(e as Error).message}` })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/70" aria-label="Waiting for review" data-testid="review-section">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-zinc-800 px-4 py-2.5">
        <h2 ref={headingRef} tabIndex={-1} data-task-list-heading="overview:review" className="text-sm font-semibold text-zinc-100">
          Waiting for review
        </h2>
        <span className="tabular text-xs text-zinc-500">{tasks.length}</span>
        {approved.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirming(approved)}
            aria-haspopup="dialog"
            title="Move every task whose latest review approved it, with no change since, to Done"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-500 active:translate-y-px"
            data-testid="close-approved"
          >
            <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
            <span>
              Close approved <span className="tabular">({approved.length})</span>
            </span>
          </button>
        )}
      </header>
      <p
        role="status"
        className={cx('px-4 text-xs', message && 'pt-2.5', message?.tone === 'error' ? 'text-red-300' : 'text-emerald-300')}
        data-testid="review-message"
      >
        {message?.text}
      </p>
      {tasks.length === 0 ? (
        <p className="px-4 py-4 text-xs text-zinc-500">No work is waiting for review.</p>
      ) : (
        <ul className="p-1.5" data-task-list="overview:review">
          {shown.map((t) => (
            <li key={t.id}>
              <TaskRow
                task={t}
                onOpen={onOpen}
                detail={null}
                actions={
                  <>
                    <button
                      type="button"
                      onClick={() => setRequesting(t)}
                      disabled={busyId !== null}
                      aria-haspopup="dialog"
                      aria-label={`Request changes: ${t.id}`}
                      className={requestChangesClass('sm')}
                      data-testid={`request-changes-${t.id}`}
                    >
                      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Request changes
                    </button>
                    <button
                      type="button"
                      onClick={() => void markDone(t)}
                      disabled={busyId !== null}
                      aria-label={`Mark done: ${t.id}`}
                      className={markDoneClass('sm')}
                      data-testid={`mark-done-${t.id}`}
                    >
                      <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> {busyId === t.id ? 'Moving…' : 'Mark done'}
                    </button>
                  </>
                }
              />
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

      {requesting && (
        <RequestChangesDialog
          task={requesting}
          onClose={() => setRequesting(null)}
          onDone={async (updated) => {
            setRequesting(null)
            setMessage({ tone: 'ok', text: `${updated.id} went back to ${updated.status} with your findings.` })
            await onChanged()
            refocus()
          }}
        />
      )}
      {confirming && (
        <CloseApprovedDialog
          tasks={confirming}
          onClose={() => setConfirming(null)}
          onClosed={async (ids, closing) => {
            if (ids.length > 0) setMessage({ tone: 'ok', text: `${ids.length} ${ids.length === 1 ? 'task' : 'tasks'} moved to Done.` })
            await onChanged()
            // A partial failure keeps the dialog open on Retry: focus stays in it.
            if (ids.length > 0 && closing) refocus()
          }}
        />
      )}
    </section>
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
  const formRef = useRef<HTMLFormElement>(null)
  const summaryRef = useRef<HTMLTextAreaElement>(null)

  // On a phone the form opens below the fold: bring it up and put the caret in it.
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    formRef.current?.scrollIntoView?.({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    summaryRef.current?.focus({ preventScroll: true })
  }, [])

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
    <form ref={formRef} id="handoff-form" onSubmit={submit} className="scroll-mt-4 rounded-xl border border-zinc-700 bg-zinc-900 p-5" data-testid="handoff-form" aria-label="Write a session handoff">
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
          <textarea ref={summaryRef} id="handoff-summary" name="handoff-summary" autoComplete="off" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} className={field} placeholder="Finished the API, started the settings screen…" />
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
