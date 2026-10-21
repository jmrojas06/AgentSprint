import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react'
import { AlertTriangle, Check, CheckCheck, CircleAlert, Hourglass, ShieldCheck, Undo2 } from 'lucide-react'
import type { Task } from '../types'
import { api } from '../api'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { cx, fmtWhen, latestReview, parseFindings } from '../ui'

/**
 * Human side of the review gate: the verdict badge, the panel TaskModal shows
 * for a task in Review, and the two dialogs (request changes, close approved).
 *
 * Layers: TaskModal is z-50, these dialogs z-[55] so they sit over it, and the
 * token prompt stays on top at z-[60] when one of their requests gets a 401.
 */

/** The reviewer the board records for a decision taken in this UI. */
export const HUMAN_REVIEWER = 'user'

export function ReviewBadge({ verdict, by }: { verdict: 'approved' | 'changes'; by: string }) {
  return verdict === 'approved' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300" title={`Approved by ${by}`} data-testid="review-badge">
      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Approved
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300" title={`Changes requested by ${by}`} data-testid="review-badge">
      <Hourglass className="h-3 w-3" aria-hidden="true" /> Changes
    </span>
  )
}

/** Shared look for the two review buttons; `size` sm is the Overview row, md the TaskModal panel. */
export function markDoneClass(size: 'sm' | 'md' = 'md') {
  return cx(
    'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-700 font-medium text-zinc-100 transition-colors',
    'hover:border-emerald-500/60 hover:bg-emerald-500/10 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-1.5 text-xs',
  )
}
export function requestChangesClass(size: 'sm' | 'md' = 'md') {
  return cx(
    'inline-flex shrink-0 items-center gap-1.5 rounded-md font-medium text-zinc-400 transition-colors',
    'hover:bg-zinc-800 hover:text-zinc-100 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50',
    size === 'sm' ? 'px-2 py-1.5 text-[11px]' : 'px-3 py-1.5 text-xs',
  )
}

/**
 * What TaskModal shows above its tabs while a task is in Review: the latest
 * verdict (who, when, summary, findings) and the human's two decisions.
 */
export function ReviewPanel({
  task,
  busy,
  error,
  lockedReason,
  onMarkDone,
  onRequestChanges,
  requestRef,
}: {
  task: Task
  busy: boolean
  error: string | null
  /** Why the decisions are unavailable right now (unsaved edits), or null. */
  lockedReason: string | null
  onMarkDone: () => void
  onRequestChanges: () => void
  requestRef?: RefObject<HTMLButtonElement | null>
}) {
  const review = latestReview(task)
  const findingsShown = review?.findings.slice(0, 3) ?? []
  const hidden = (review?.findings.length ?? 0) - findingsShown.length
  return (
    <section className="border-b border-zinc-800 bg-zinc-950/50 px-4 py-3" aria-labelledby="review-panel-title" data-testid="review-panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h3 id="review-panel-title" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold text-zinc-100">
            Waiting for your decision
            {review && <ReviewBadge verdict={review.verdict} by={review.by} />}
          </h3>
          {review ? (
            <>
              <p className="mt-1 text-[11px] text-zinc-500" data-testid="review-verdict-meta">
                {review.verdict === 'approved' ? 'Approved' : 'Changes requested'} by <span className="text-zinc-300">{review.by}</span>,{' '}
                <time dateTime={review.at}>{fmtWhen(review.at)}</time>
                {!review.current && <span className="text-amber-300"> (the work changed after this verdict)</span>}
              </p>
              {review.summary && <p className="mt-1.5 line-clamp-3 text-pretty text-xs leading-relaxed text-zinc-300">{review.summary}</p>}
              {findingsShown.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-xs text-zinc-400">
                  {findingsShown.map((f, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-zinc-600" aria-hidden="true" />
                      {/* Two lines on a phone; screen readers and the tooltip keep the full finding. */}
                      <span className="line-clamp-2 min-w-0 break-words sm:line-clamp-none" title={f} data-testid="review-finding">
                        {f}
                      </span>
                    </li>
                  ))}
                  {hidden > 0 && <li className="pl-3 text-zinc-500">and {hidden} more in the notes</li>}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">No review verdict yet. You can still close it or send it back.</p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button type="button" ref={requestRef} onClick={onRequestChanges} disabled={busy || lockedReason !== null} className={requestChangesClass()} data-testid="request-changes">
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" /> Request changes
          </button>
          <button type="button" onClick={onMarkDone} disabled={busy || lockedReason !== null} className={markDoneClass()} data-testid="mark-done">
            <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" /> {busy ? 'Moving…' : 'Mark done'}
          </button>
        </div>
      </div>
      {lockedReason && <p className="mt-2 text-[11px] text-zinc-500">{lockedReason}</p>}
      {error && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-red-300">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {error}
        </p>
      )}
    </section>
  )
}

function DialogFrame({
  formRef,
  titleId,
  descId,
  onSubmit,
  testId,
  children,
}: {
  formRef: RefObject<HTMLFormElement | null>
  titleId: string
  descId: string
  onSubmit: (e: FormEvent) => void
  testId: string
  children: ReactNode
}) {
  return (
    <div className="scrim-in fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-4">
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onSubmit={onSubmit}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        data-testid={testId}
        noValidate
      >
        {children}
      </form>
    </div>
  )
}

function TaskLine({ task }: { task: Pick<Task, 'id' | 'title'> }) {
  return (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className="shrink-0 font-mono text-[11px] text-zinc-500" translate="no">
        {task.id}
      </span>
      <span className="min-w-0 truncate text-zinc-200">{task.title}</span>
    </span>
  )
}

/**
 * Sends a task in Review back to its implementer: at least one finding (one
 * per line) and an optional summary, recorded as the `user` reviewer's
 * `changes` verdict. The server moves the task to In Progress.
 */
export function RequestChangesDialog({ task, onClose, onDone }: { task: Task; onClose: () => void; onDone: (updated: Task) => void | Promise<void> }) {
  const [findings, setFindings] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const findingsRef = useRef<HTMLTextAreaElement>(null)
  useDialogFocus(formRef, () => !busy && onClose(), findingsRef)

  const list = parseFindings(findings)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (list.length === 0) {
      setError('Add at least one finding, one per line.')
      findingsRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await api.reviewTask(task.id, { verdict: 'changes', reviewer: HUMAN_REVIEWER, summary: summary.trim() || undefined, findings: list })
      await onDone(updated)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500'
  return (
    <DialogFrame formRef={formRef} titleId="request-changes-title" descId="request-changes-desc" onSubmit={submit} testId="request-changes-dialog">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 id="request-changes-title" className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Undo2 className="h-4 w-4 text-amber-400" aria-hidden="true" /> Request changes
        </h2>
        <p id="request-changes-desc" className="mt-1 text-xs leading-relaxed text-zinc-400">
          The task goes back to In Progress with your findings, so its implementer can pick it up again.
        </p>
        <p className="mt-2 text-xs">
          <TaskLine task={task} />
        </p>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <label htmlFor="request-changes-findings" className="text-xs font-medium text-zinc-300">
              Findings
            </label>
            <span className="tabular text-[11px] text-zinc-500" aria-live="polite">
              {list.length === 1 ? '1 finding' : `${list.length} findings`}
            </span>
          </div>
          <textarea
            ref={findingsRef}
            id="request-changes-findings"
            name="findings"
            rows={5}
            autoComplete="off"
            value={findings}
            onChange={(e) => {
              setFindings(e.target.value)
              if (error) setError(null)
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'request-changes-hint request-changes-error' : 'request-changes-hint'}
            className={field}
          />
          <p id="request-changes-hint" className="mt-1.5 text-[11px] text-zinc-500">
            One per line, at least one. Each line becomes a finding in the task notes.
          </p>
          {error && (
            <p id="request-changes-error" role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs text-red-300">
              <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /> {error}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="request-changes-summary" className="mb-1.5 block text-xs font-medium text-zinc-300">
            Summary <span className="font-normal text-zinc-500">(optional)</span>
          </label>
          <input
            id="request-changes-summary"
            name="summary"
            autoComplete="off"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className={field}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
        <button type="button" onClick={onClose} disabled={busy} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50">
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="request-changes-submit"
        >
          {busy ? 'Sending…' : 'Request changes'}
        </button>
      </div>
    </DialogFrame>
  )
}

/**
 * Confirms closing every approved task at once and moves them to Done one by
 * one. Tasks that fail stay listed with the error, ready for a retry.
 */
export function CloseApprovedDialog({
  tasks,
  onClose,
  onClosed,
}: {
  tasks: Task[]
  onClose: () => void
  /**
   * Called after each run with the ids that reached Done, so the caller
   * refreshes its counts. `closing` is false when some failed and the dialog
   * stays open on Retry: the caller must not move focus then.
   */
  onClosed: (ids: string[], closing: boolean) => void | Promise<void>
}) {
  const [pending, setPending] = useState<Task[]>(tasks)
  const [progress, setProgress] = useState<number | null>(null)
  const [failed, setFailed] = useState<Array<{ id: string; message: string }>>([])
  const [result, setResult] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const busy = progress !== null
  useDialogFocus(formRef, () => !busy && onClose(), confirmRef)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || pending.length === 0) return
    const closed: string[] = []
    const errors: Array<{ id: string; message: string }> = []
    // One at a time: each move rewrites a task file under its own lock.
    for (let i = 0; i < pending.length; i++) {
      setProgress(i + 1)
      const t = pending[i]!
      try {
        await api.setTaskStatus(t.id, 'Done')
        closed.push(t.id)
      } catch (err) {
        errors.push({ id: t.id, message: (err as Error).message })
      }
    }
    setProgress(null)
    await onClosed(closed, errors.length === 0)
    if (errors.length === 0) {
      onClose()
      return
    }
    setFailed(errors)
    setPending((prev) => prev.filter((t) => errors.some((f) => f.id === t.id)))
    setResult(
      `${closed.length} moved to Done, ${errors.length} could not be closed. ${errors.length === 1 ? `${errors[0]!.id}: ${errors[0]!.message}` : 'See the errors below.'}`,
    )
    // The confirm button was disabled while busy, which drops focus: put it on Retry.
    requestAnimationFrame(() => confirmRef.current?.focus())
  }

  const n = pending.length
  return (
    <DialogFrame formRef={formRef} titleId="close-approved-title" descId="close-approved-desc" onSubmit={submit} testId="close-approved-dialog">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 id="close-approved-title" className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          {/* After a run with failures: a warning, not the green all-done mark. */}
          {failed.length > 0 ? (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden="true" data-testid="close-approved-warning" />
          ) : (
            <CheckCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
          )}
          {failed.length > 0 ? `${n} ${n === 1 ? 'task' : 'tasks'} could not be closed` : `Close ${n} approved ${n === 1 ? 'task' : 'tasks'}?`}
        </h2>
        <p id="close-approved-desc" className="mt-1 text-xs leading-relaxed text-zinc-400">
          {failed.length > 0
            ? 'The others moved to Done. Check the errors below and try again.'
            : 'Each one moves to Done. Only tasks whose latest review approved them, with no change since, are included.'}
        </p>
      </div>
      <ul className="flex-1 divide-y divide-zinc-800 overflow-y-auto overscroll-contain px-4 py-1 text-xs" aria-label="Tasks to close">
        {pending.map((t) => {
          const review = latestReview(t)
          const error = failed.find((f) => f.id === t.id)
          return (
            <li key={t.id} className="py-2">
              <TaskLine task={t} />
              {review && !error && (
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Approved by {review.by}, <time dateTime={review.at}>{fmtWhen(review.at)}</time>
                </p>
              )}
              {error && <p className="mt-0.5 text-[11px] text-red-300">{error.message}</p>}
            </li>
          )
        })}
      </ul>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
        {busy && (
          <span className="tabular mr-auto text-[11px] text-zinc-500" role="status">
            Closing {progress} of {n}…
          </span>
        )}
        {/* Spoken once a run ends with failures; the list above shows the same errors. */}
        <span className="sr-only" role="status" data-testid="close-approved-result">
          {busy ? '' : result}
        </span>
        <button type="button" onClick={onClose} disabled={busy} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-50">
          Cancel
        </button>
        <button
          type="submit"
          ref={confirmRef}
          disabled={busy || n === 0}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="close-approved-confirm"
        >
          {failed.length > 0 ? `Retry ${n}` : `Move ${n} to Done`}
        </button>
      </div>
    </DialogFrame>
  )
}
