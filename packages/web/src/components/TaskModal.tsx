import { useEffect, useState } from 'react'
import { CheckSquare, ClipboardCopy, GitCommitHorizontal, GitBranch, Lock, Plus, Save, Square, Trash2, X } from 'lucide-react'
import type { GitCommit, Sprint, Task, TaskPriority, TaskStatus } from '../types'
import { TASK_PRIORITIES } from '../types'
import { api } from '../api'
import { ActivityTimeline } from './ActivityTimeline'
import { cx, criterionChecked, criterionText, getBlockerTasks, getTaskLock } from '../ui'

interface Props {
  task: Task
  allTasks: Task[]
  sprints: Sprint[]
  statuses: string[]
  onSave: (id: string, patch: Partial<Task>) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const PRIORITY_ORDER: TaskPriority[] = ['low', 'medium', 'high', 'critical']

export function TaskModal({ task, allTasks, sprints, statuses, onSave, onDelete, onClose }: Props) {
  const lock = getTaskLock(task)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [status, setStatus] = useState<TaskStatus>(task.status as TaskStatus)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [assignee, setAssignee] = useState<'human' | 'agent'>(task.assignee)
  const [sprint, setSprint] = useState<number | null>(task.sprint)
  const [estimate, setEstimate] = useState(task.estimate)
  const [tags, setTags] = useState(task.tags.join(', '))
  const [criteria, setCriteria] = useState<string[]>(task.acceptanceCriteria)
  const [criteriaInput, setCriteriaInput] = useState('')
  const [copied, setCopied] = useState(false)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [branches, setBranches] = useState<string[]>([])
  const [gitAvailable, setGitAvailable] = useState(true)
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [tab, setTab] = useState<'details' | 'activity'>('details')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

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

  const save = () => {
    onSave(task.id, {
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
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500'
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
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
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            className="flex-1 bg-transparent text-base font-semibold text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 border-b border-zinc-800 px-4 py-1.5">
          {(['details', 'activity'] as const).map((t) => (
            <button
              key={t}
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

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
          {tab === 'activity' ? (
            <ActivityTimeline taskId={task.id} />
          ) : (
          <>
          <div className="sm:col-span-2">
            <label className={label}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What needs to be done and why?"
              className={field}
            />
          </div>

          <div>
            <label className={label}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={field}>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={label}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className={field}>
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
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
            <select
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
            <label className={label}>Estimate (points)</label>
            <input
              type="number"
              min={0}
              max={100}
              value={estimate}
              onChange={(e) => setEstimate(Number(e.target.value))}
              className={field}
            />
          </div>

          <div>
            <label className={label}>Tags (comma separated)</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="api, bug, docs" className={field} />
          </div>

          {task.dependencies.length > 0 && (
            <div className="sm:col-span-2">
              <label className={label}>Dependencies</label>
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
              <label className={label}>Linked commits</label>
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
            <label className={label}>Acceptance criteria</label>
            <ul className="mb-2 space-y-1">
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
                    >
                      {checked ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                    </button>
                    <span className={cx('text-xs', checked ? 'line-through text-zinc-500' : 'text-zinc-300')}>{text}</span>
                    <button
                      onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
                      className="ml-auto rounded p-0.5 text-zinc-500 hover:text-red-400"
                      title="Remove criterion"
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
                className={field}
              />
              <button onClick={addCriterion} className="rounded-md bg-zinc-800 px-2 text-zinc-300 hover:bg-zinc-700">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={() => onDelete(task.id)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/40"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
          <button
            onClick={copySpec}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            title="Copy a ready-made agent prompt for this task"
          >
            {copied ? <ClipboardCopy className="h-3.5 w-3.5 text-emerald-400" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? 'Copied!' : 'Copy spec'}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!dirty || !title.trim()}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" /> Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
