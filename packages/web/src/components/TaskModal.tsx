import { useEffect, useId, useRef, useState } from 'react'
import { CheckSquare, CircleAlert, ClipboardCopy, GitCommitHorizontal, GitBranch, Lock, Plus, Save, Square, Trash2, X } from 'lucide-react'
import type { GitCommit, Sprint, Task, TaskPriority, TaskStatus } from '../types'
import { api } from '../api'
import { ActivityTimeline } from './ActivityTimeline'
import { cx, criterionChecked, criterionText, getTaskLock } from '../ui'
import { AssigneeOptions, agentRole, useAgents } from '../agents'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { useReturnFocus } from '../hooks/useReturnFocus'
import { RequestChangesDialog, ReviewPanel } from './ReviewControls'

interface Props {
  task: Task
  allTasks: Task[]
  sprints: Sprint[]
  statuses: string[]
  /** May reject (a dismissed token prompt, a refused write): the modal then stays open with the edits. */
  onSave: (id: string, patch: Partial<Task>) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  onClose: () => void
  /** After Mark done or Request changes succeeded; defaults to closing the modal. */
  onReviewed?: (task: Task) => void | Promise<void>
}

const PRIORITY_ORDER: TaskPriority[] = ['low', 'medium', 'high', 'critical']

/**
 * One line for a write the board refused, e.g. "Not saved: the board needs a
 * token." A 401 at this point means the token prompt was dismissed.
 */
export function writeErrorMessage(error: unknown, failed: string): string {
  const err = error as { status?: number; message?: string } | null
  if (err?.status === 401) return `${failed}: the board needs a token.`
  if (error instanceof TypeError) return `${failed}: could not reach the server.`
  const reason = err?.message?.trim().replace(/\.+$/, '')
  return reason ? `${failed}: ${reason}.` : `${failed}.`
}

export function TaskModal({ task, allTasks, sprints, statuses, onSave, onDelete, onClose, onReviewed }: Props) {
  const lock = getTaskLock(task)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [status, setStatus] = useState<TaskStatus>(task.status as TaskStatus)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const agents = useAgents()
  const [assignee, setAssignee] = useState<string>(task.assignee)
  const assignedAgent = agents.find((a) => a.name === assignee)
  const [sprint, setSprint] = useState<number | null>(task.sprint)
  const [estimate, setEstimate] = useState(task.estimate)
  const [tags, setTags] = useState(task.tags.join(', '))
  const [criteria, setCriteria] = useState<string[]>(task.acceptanceCriteria)
  const [criteriaInput, setCriteriaInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [, setGitAvailable] = useState(true)
  const [, setCommitsLoading] = useState(false)
  const [tab, setTab] = useState<'details' | 'activity'>('details')
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)

  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const fieldId = (name: string) => `${uid}-${name}`

  // A real dialog: focus moves to the title on open and Tab stays inside.
  // The token prompt and the request-changes dialog join the same surface
  // stack, so Escape closes them first; the palette swallows its own Escape.
  // Focus-on-close belongs to useReturnFocus alone (restoreFocus: false).
  useDialogFocus(dialogRef, onClose, titleRef, { restoreFocus: false })
  // The opening focus puts the caret at the start, so a long title shows its
  // beginning instead of scrolling to its tail. Later focuses behave as usual.
  const openingFocus = useRef(true)

  // However the modal closes (Escape, X, Cancel, Save, a review decision),
  // focus goes back to the card or row that opened it, or to its neighbour
  // when the task left that list.
  useReturnFocus(task.id)

  const reviewed = async (updated: Task) => {
    if (onReviewed) await onReviewed(updated)
    else onClose()
  }

  const markDone = async () => {
    setReviewBusy(true)
    setReviewError(null)
    try {
      const updated = await api.setTaskStatus(task.id, 'Done')
      await reviewed(updated)
    } catch (e) {
      setReviewError(`Could not move ${task.id}: ${(e as Error).message}`)
      setReviewBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setCommitsLoading(true)
    api
      .getTaskCommits(task.id)
      .then((refs) => {
        if (cancelled) return
        setCommits(refs.commits)
        setBranches(refs.branches)
        setGitAvailable(refs.gitAvailable)
      })
      .catch(() => {
        if (!cancelled) setGitAvailable(false)
      })
      .finally(() => {
        if (!cancelled) setCommitsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [task.id])

  const copySpec = async () => {
    try {
      const { spec } = await api.getTaskSpec(task.id)
      await navigator.clipboard.writeText(spec)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const dirty =
    title !== task.title ||
    description !== task.description ||
    status !== task.status ||
    priority !== task.priority ||
    assignee !== task.assignee ||
    sprint !== task.sprint ||
    estimate !== task.estimate ||
    tags !== task.tags.join(', ') ||
    criteria.join('\u0001') !== task.acceptanceCriteria.join('\u0001')

  const addCriterion = () => {
    const c = criteriaInput.trim()
    if (!c) return
    setCriteria((prev) => [...prev, c])
    setCriteriaInput('')
  }

  const toggleCriterion = async (idx: number) => {
    const currentlyChecked = criterionChecked(criteria[idx]!)
    const next = !currentlyChecked
    setCriteria((prev) =>
      prev.map((c, i) => (i === idx ? (next ? `[x] ${criterionText(c)}` : criterionText(c)) : c)),
    )
    try {
      await api.setTaskChecklist(task.id, { index: idx, completed: next })
    } catch {
      setCriteria((prev) =>
        prev.map((c, i) => (i === idx ? (currentlyChecked ? `[x] ${criterionText(c)}` : criterionText(c)) : c)),
      )
    }
  }

  // Save stays focusable while busy (aria-disabled, not disabled): a token
  // prompt opened by the save gives focus back to it when it closes.
  const save = async () => {
    if (saving) return
    setSaving(true)
    setWriteError(null)
    try {
      await onSave(task.id, {
        title,
        description,
        status,
        priority,
        assignee,
        sprint,
        estimate,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        acceptanceCriteria: criteria,
      })
    } catch (e) {
      setWriteError(`${writeErrorMessage(e, 'Not saved')} Your edits are still here.`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setWriteError(null)
    try {
      await onDelete(task.id)
    } catch (e) {
      setWriteError(writeErrorMessage(e, 'Not deleted'))
    }
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500'
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${task.id}: ${task.title}`}
        tabIndex={-1}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none"
        onClick={(e) => e.stopPropagation()}
        data-testid="task-modal"
      >
        <div className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3">
          <span className="font-mono text-xs text-zinc-500">{task.id}</span>
          {lock && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-300"
              title={`Exclusively locked by ${lock.lockedBy} (auto-expires after 30 min without a heartbeat)`}
              data-testid="modal-lock"
            >
              <Lock className="h-3 w-3" />
              locked by {lock.lockedBy}
            </span>
          )}
          <input
            ref={titleRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={(e) => {
              if (!openingFocus.current) return
              openingFocus.current = false
              e.currentTarget.setSelectionRange(0, 0)
              e.currentTarget.scrollLeft = 0
            }}
            placeholder="Task title"
            aria-label="Task title"
            className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-0.5 text-base font-semibold text-zinc-100 outline-none ring-indigo-500/60 placeholder:text-zinc-500 focus-visible:ring-2"
          />
          <button type="button" onClick={onClose} aria-label="Close task" title="Close" className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        {task.status === 'Review' && (
          <ReviewPanel
            task={task}
            busy={reviewBusy}
            error={reviewError}
            lockedReason={dirty ? 'Save or cancel your edits first.' : null}
            onMarkDone={() => void markDone()}
            onRequestChanges={() => setRequesting(true)}
          />
        )}

        <div className="flex items-center gap-1 border-b border-zinc-800 px-4 py-1.5">
          {(['details', 'activity'] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={cx(
                'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:bg-zinc-800/60 hover:text-zinc-300',
              )}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto overscroll-contain p-4 sm:grid-cols-2">
          {tab === 'activity' ? (
            <ActivityTimeline taskId={task.id} />
          ) : (
          <>
          <div className="sm:col-span-2">
            <label htmlFor={fieldId('description')} className={label}>Description</label>
            <textarea
              id={fieldId('description')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What needs to be done and why?"
              className={field}
            />
          </div>

          <div>
            <label htmlFor={fieldId('status')} className={label}>Status</label>
            <select id={fieldId('status')} value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={field}>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={fieldId('priority')} className={label}>Priority</label>
            <select id={fieldId('priority')} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={field}>
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={fieldId('assignee')} className={label}>Assignee</label>
            <select id={fieldId('assignee')} value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
              <AssigneeOptions agents={agents} current={assignee} />
            </select>
            {assignedAgent && (
              <p className="mt-1 text-[11px] leading-snug text-zinc-500" data-testid="agent-hint">
                Subagent: {agentRole(assignedAgent)}
              </p>
            )}
          </div>

          <div>
            <label htmlFor={fieldId('sprint')} className={label}>Sprint</label>
            <select
              id={fieldId('sprint')}
              value={sprint ?? ''}
              onChange={(e) => setSprint(e.target.value === '' ? null : Number(e.target.value))}
              className={field}
            >
              <option value="">Backlog (no sprint)</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  Sprint {s.id}: {s.goal || 'no goal'}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor={fieldId('estimate')} className={label}>Estimate (points)</label>
            <input
              id={fieldId('estimate')}
              type="number"
              min={0}
              max={100}
              value={estimate}
              onChange={(e) => setEstimate(Number(e.target.value))}
              className={field}
            />
          </div>

          <div>
            <label htmlFor={fieldId('tags')} className={label}>Tags (comma separated)</label>
            <input id={fieldId('tags')} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="api, bug, docs" className={field} />
          </div>

          {task.dependencies.length > 0 && (
            <div className="sm:col-span-2">
              <p className={label}>Dependencies</p>
              <ul className="mb-2 space-y-1">
                {task.dependencies.map((depId) => {
                  const dep = allTasks.find((t) => t.id === depId)
                  const isBlocked = dep && dep.status !== 'Done'
                  return (
                    <li key={depId} className="flex items-center gap-2 rounded bg-zinc-950/60 px-2 py-1">
                      <span className="font-mono text-[10px] text-zinc-500">{depId}</span>
                      {dep ? (
                        <>
                          <span className={cx('text-xs', isBlocked ? 'text-red-400' : 'text-emerald-400')}>
                            {dep.status}
                          </span>
                          <span className="text-xs text-zinc-300">{dep.title}</span>
                        </>
                      ) : (
                        <span className="text-xs text-red-400">not found</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {(commits.length > 0 || branches.length > 0) && (
            <div className="sm:col-span-2">
              <p className={label}>Linked commits</p>
              {branches.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {branches.map((b) => (
                    <span key={b} className="inline-flex items-center gap-1 rounded bg-zinc-950/60 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
                      <GitBranch className="h-3 w-3" /> {b}
                    </span>
                  ))}
                </div>
              )}
              <ul className="space-y-1">
                {commits.map((c) => (
                  <li key={c.hash} className="flex items-center gap-2 rounded bg-zinc-950/60 px-2 py-1">
                    <GitCommitHorizontal className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                    <span className="font-mono text-[10px] text-sky-300">{c.shortHash}</span>
                    <span className="truncate text-xs text-zinc-300" title={c.message}>
                      {c.message}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                      {c.author} · {new Date(c.date).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="sm:col-span-2">
            <p id={fieldId('criteria')} className={label}>Acceptance criteria</p>
            <ul className="mb-2 space-y-1" aria-labelledby={fieldId('criteria')}>
              {criteria.map((c, i) => {
                const checked = criterionChecked(c)
                const text = criterionText(c)
                return (
                  <li key={i} className="flex items-center gap-2 rounded bg-zinc-950/60 px-2 py-1">
                    <button
                      type="button"
                      onClick={() => toggleCriterion(i)}
                      className={cx(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                        checked
                          ? 'border-indigo-500 bg-indigo-600/20 text-indigo-400'
                          : 'border-zinc-600 text-transparent hover:border-zinc-500',
                      )}
                      title={checked ? 'Mark incomplete' : 'Mark complete'}
                      aria-label={text}
                      aria-pressed={checked}
                    >
                      {checked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    </button>
                    <span className={cx('text-xs', checked ? 'line-through text-zinc-500' : 'text-zinc-300')}>{text}</span>
                    <button
                      type="button"
                      onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
                      className="ml-auto rounded p-0.5 text-zinc-500 hover:text-red-400"
                      title="Remove criterion"
                      aria-label="Remove criterion"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                )
              })}
            </ul>
            <div className="flex gap-1.5">
              <input
                value={criteriaInput}
                onChange={(e) => setCriteriaInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCriterion()
                  }
                }}
                placeholder="Add an acceptance criterion…"
                aria-label="New acceptance criterion"
                className={field}
              />
              <button type="button" onClick={addCriterion} aria-label="Add criterion" title="Add criterion" className="shrink-0 rounded-md bg-zinc-800 px-2 text-zinc-300 hover:bg-zinc-700">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          </>
          )}
        </div>

        {writeError && (
          <p
            role="alert"
            className="flex items-start gap-1.5 border-t border-zinc-800 bg-red-950/30 px-4 py-2 text-xs leading-relaxed text-red-300"
            data-testid="save-error"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{writeError}</span>
          </p>
        )}

        {/* One line from 360px up: buttons never wrap, and Delete drops its label below sm (the icon keeps an accessible name). */}
        <div className="flex items-center gap-1.5 border-t border-zinc-800 px-3 py-3 sm:gap-2 sm:px-4">
          <button
            type="button"
            onClick={() => void remove()}
            aria-label="Delete task"
            title="Delete task"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/40 sm:px-2.5"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Delete</span>
          </button>
          <button
            type="button"
            onClick={copySpec}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 sm:px-2.5"
            title="Copy a ready-made agent prompt for this task"
            data-testid="copy-spec"
          >
            <ClipboardCopy className={cx('h-3.5 w-3.5', copied && 'text-emerald-400')} aria-hidden="true" />
            <span aria-live="polite">{copied ? 'Copied!' : 'Copy spec'}</span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={onClose} className="whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || !title.trim()}
              aria-disabled={saving || undefined}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-wait"
              data-testid="save-task"
            >
              <Save className="h-3.5 w-3.5" aria-hidden="true" /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
      {requesting && (
        // Inside the backdrop, whose click closes the modal: keep the dialog's clicks here.
        <div onClick={(e) => e.stopPropagation()}>
          <RequestChangesDialog
            task={task}
            onClose={() => setRequesting(false)}
            onDone={async (updated) => {
              setRequesting(false)
              await reviewed(updated)
            }}
          />
        </div>
      )}
    </div>
  )
}
