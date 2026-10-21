import { useEffect, useId, useRef, useState } from 'react'
import { CircleAlert, Plus, X } from 'lucide-react'
import type { Sprint, TaskPriority, TaskTemplate } from '../types'
import { TASK_PRIORITIES } from '../types'
import { api } from '../api'
import { priorityDot, priorityLabel } from '../ui'
import { AssigneeOptions, agentRole, useAgents } from '../agents'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { writeErrorMessage } from './TaskModal'

interface Props {
  sprints: Sprint[]
  onCreate: (input: {
    title: string
    sprint: number | null
    priority: TaskPriority
    assignee: string
    template?: string
    vars?: Record<string, string>
  }) => void | Promise<void>
  onClose: () => void
}

export function NewTaskModal({ sprints, onCreate, onClose }: Props) {
  const agents = useAgents()
  const [title, setTitle] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const fieldId = (name: string) => `${uid}-${name}`

  // A real dialog: focus moves to the title on open, Tab stays inside, Escape
  // closes only the top surface (a token prompt over it first), and focus goes
  // back to what opened it on close.
  useDialogFocus(formRef, onClose, titleRef)
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [assignee, setAssignee] = useState<string>('scrum-master')
  const [priorityTouched, setPriorityTouched] = useState(false)
  const [assigneeTouched, setAssigneeTouched] = useState(false)
  const [sprint, setSprint] = useState<number | null>(null)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [template, setTemplate] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    api.templates().then(setTemplates).catch(() => {})
  }, [])

  const selectTemplate = (name: string) => {
    setTemplate(name)
    const tpl = templates.find((t) => t.name === name)
    // Only apply template defaults for fields the user has not chosen manually.
    if (tpl) {
      if (tpl.priority && !priorityTouched) setPriority(tpl.priority)
      if (tpl.assignee && !assigneeTouched) setAssignee(tpl.assignee)
    }
  }

  const selected = templates.find((t) => t.name === template)

  // A refused create (dismissed token prompt included) keeps the form filled in.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if ((!title.trim() && !template) || creating) return
    setCreating(true)
    setCreateError(null)
    try {
      await onCreate({
        title: title.trim(),
        sprint,
        priority,
        assignee,
        ...(template ? { template, vars: title.trim() ? { title: title.trim() } : {} } : {}),
      })
    } catch (err) {
      setCreateError(`${writeErrorMessage(err, 'Not created')} What you typed is still here.`)
    } finally {
      setCreating(false)
    }
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-indigo-500'
  const label = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        ref={formRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={fieldId('heading')}
        tabIndex={-1}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl outline-none"
        data-testid="new-task-modal"
      >
        <div className="mb-3 flex items-center">
          <h2 id={fieldId('heading')} className="text-sm font-semibold text-zinc-100">
            New task
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" title="Close" className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <label htmlFor={fieldId('title')} className={label}>
          Title
        </label>
        <input
          ref={titleRef}
          id={fieldId('title')}
          autoComplete="off"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What should be done?"
          className={field + ' mb-3'}
        />

        <label htmlFor={fieldId('template')} className={label}>
          Template
        </label>
        <select id={fieldId('template')} value={template} onChange={(e) => selectTemplate(e.target.value)} className={field + ' mb-3'}>
          <option value="">Blank task</option>
          {templates.map((t) => (
            <option key={t.name} value={t.name}>
              {t.name}
            </option>
          ))}
        </select>
        {selected && (
          <p className="-mt-1 mb-3 text-[11px] leading-snug text-zinc-500">
            {selected.acceptanceCriteria.length} acceptance criteria
            {selected.tags?.length ? ` · tags: ${selected.tags.join(', ')}` : ''}
            {selected.description.includes('{{') ? ' · fill {{variables}} after creation' : ''}
          </p>
        )}

        <div className="mb-3 grid grid-cols-3 gap-3">
          <div role="group" aria-labelledby={fieldId('priority')}>
            <p id={fieldId('priority')} className={label}>
              Priority
            </p>
            <div className="flex gap-1">
              {TASK_PRIORITIES.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                  setPriority(p)
                  setPriorityTouched(true)
                }}
                  title={priorityLabel[p]}
                  aria-label={priorityLabel[p]}
                  aria-pressed={priority === p}
                  className={
                    'h-7 flex-1 rounded-md border text-[10px] ' +
                    (priority === p ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200' : 'border-zinc-700 text-zinc-500 hover:border-zinc-500')
                  }
                >
                  <span className={'mx-auto block h-1.5 w-1.5 rounded-full ' + priorityDot[p]} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor={fieldId('assignee')} className={label}>
              Assignee
            </label>
            <select
              id={fieldId('assignee')}
              value={assignee}
              onChange={(e) => {
                setAssignee(e.target.value)
                setAssigneeTouched(true)
              }}
              className={field}
            >
              <AssigneeOptions agents={agents} current={assignee} />
            </select>
          </div>

          <div>
            <label htmlFor={fieldId('sprint')} className={label}>
              Sprint
            </label>
            <select id={fieldId('sprint')} value={sprint ?? ''} onChange={(e) => setSprint(e.target.value === '' ? null : Number(e.target.value))} className={field}>
              <option value="">Backlog</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  S{s.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {agents.some((a) => a.name === assignee) && (
          <p className="-mt-1 mb-3 text-[11px] leading-snug text-zinc-500" data-testid="agent-hint">
            Built by the <span className="font-medium text-zinc-300">{assignee}</span> subagent: {agentRole(agents.find((a) => a.name === assignee)!)}.
          </p>
        )}

        {createError && (
          <p
            role="alert"
            className="mb-3 flex items-start gap-1.5 rounded-md bg-red-950/30 px-2.5 py-2 text-xs leading-relaxed text-red-300"
            data-testid="create-error"
          >
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{createError}</span>
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            type="submit"
            disabled={!title.trim() && !template}
            aria-disabled={creating || undefined}
            className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:cursor-wait"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  )
}
