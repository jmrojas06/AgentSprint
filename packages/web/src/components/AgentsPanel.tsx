import { useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { AgentModel, AgentProfile, Task } from '../types'
import { AGENT_MODELS } from '../types'
import { api, type SubagentSync } from '../api'
import { agentRole } from '../agents'
import { cx } from '../ui'

interface Props {
  agents: AgentProfile[]
  tasks: Task[]
  onChanged: () => Promise<void> | void
}

interface Draft {
  name: string
  description: string
  prompt: string
  color: string
  model: AgentModel
}

const NAME_RE = /^[a-z][a-z0-9-]{0,63}$/

const NEW_AGENT_PROMPT = `You are the **<Role>**.

## Mission

<What this agent delivers, in one sentence.>

## Rules

1. <The non-negotiable way this agent works.>
2. <What it must never do.>

## Output

Report: <what the orchestrator should get back>.
`

function syncSummary(result: SubagentSync): string {
  if (!result.enabled) return 'Sync is off (subagents: false in config.yaml).'
  const parts: string[] = []
  if (result.installed.length) parts.push(`added ${result.installed.join(', ')}`)
  if (result.written?.length) parts.push(`wrote ${result.written.length}`)
  if (result.removed?.length) parts.push(`removed ${result.removed.length}`)
  if (result.unchanged?.length) parts.push(`${result.unchanged.length} up to date`)
  if (result.skipped?.length) parts.push(`${result.skipped.length} skipped (hand-written file with the same name)`)
  return parts.length ? `.claude/agents: ${parts.join(', ')}.` : 'Nothing to sync.'
}

export function AgentsPanel({ agents, tasks, onChanged }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const openTasks = (name: string) => tasks.filter((t) => t.assignee === name && t.status !== 'Done').length

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const sync = (installDefaults: boolean) =>
    run(async () => {
      const result = await api.syncAgents(installDefaults)
      setNotice(syncSummary(result))
      await onChanged()
    })

  const startNew = () => {
    setIsNew(true)
    setDraft({ name: '', description: '', prompt: NEW_AGENT_PROMPT, color: '#6366f1', model: 'inherit' })
    setNotice(null)
  }

  const startEdit = (agent: AgentProfile) => {
    setIsNew(false)
    setDraft({ name: agent.name, description: agent.description, prompt: agent.prompt, color: agent.color || '#71717a', model: agent.model })
    setNotice(null)
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft) return
    if (!NAME_RE.test(draft.name)) {
      setError('Name must be a lowercase slug, e.g. "stripe-expert".')
      return
    }
    if (isNew && agents.some((a) => a.name === draft.name)) {
      setError(`An agent named "${draft.name}" already exists.`)
      return
    }
    void run(async () => {
      const { name, ...patch } = draft
      await api.saveAgent(name, patch)
      setDraft(null)
      setOpen(name)
      setNotice(`Saved ${name}. Claude Code picks up new subagents after a restart (or /agents).`)
      await onChanged()
    })
  }

  const remove = (agent: AgentProfile) => {
    const assigned = openTasks(agent.name)
    const warning = assigned > 0 ? ` ${assigned} open task(s) are assigned to it and will need a new assignee.` : ''
    if (!confirm(`Delete the "${agent.name}" agent and its Claude Code subagent?${warning}`)) return
    void run(async () => {
      await api.deleteAgent(agent.name)
      setOpen(null)
      setNotice(`Deleted ${agent.name}.`)
      await onChanged()
    })
  }

  const field = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500'
  const label = 'mb-1 block text-[11px] font-medium text-zinc-400'

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3" data-testid="agents-panel">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <Bot className="h-3.5 w-3.5 text-zinc-400" /> Agents
        <span className="font-mono text-[11px] font-normal tabular-nums text-zinc-500">{agents.length}</span>
        <button
          type="button"
          onClick={() => void sync(false)}
          disabled={busy}
          title="Regenerate .claude/agents/ from .agentboard/agents/"
          className="ml-auto flex items-center gap-1 rounded-md border border-zinc-700 px-1.5 py-1 text-[11px] font-normal text-zinc-300 hover:border-zinc-600 hover:text-zinc-100 disabled:opacity-50"
        >
          <RefreshCw className={cx('h-3 w-3', busy && 'animate-spin')} /> Sync
        </button>
        <button
          type="button"
          onClick={startNew}
          disabled={busy}
          title="Create a specialist agent"
          className="flex items-center gap-1 rounded-md bg-indigo-600 px-1.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" /> New
        </button>
      </h2>
      <p className="mb-3 text-[11px] leading-snug text-zinc-500">
        Each agent is a real Claude Code subagent in <code className="rounded bg-zinc-800 px-1">.claude/agents/</code>. Assign tasks to one and it builds them.
      </p>

      {error && (
        <p role="alert" className="mb-2 rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">
          {error}
        </p>
      )}
      {notice && !error && (
        <p aria-live="polite" className="mb-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-400" data-testid="agents-notice">
          {notice}
        </p>
      )}

      {draft && (
        <form onSubmit={save} className="mb-3 space-y-2 rounded-md border border-zinc-700 bg-zinc-950/60 p-2.5" data-testid="agent-form">
          <div className="flex items-center">
            <span className="text-xs font-semibold text-zinc-200">{isNew ? 'New agent' : `Edit ${draft.name}`}</span>
            <button type="button" onClick={() => setDraft(null)} className="ml-auto rounded p-0.5 text-zinc-500 hover:text-zinc-200" aria-label="Cancel">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {isNew && (
            <div>
              <label className={label} htmlFor="agent-name">Name</label>
              <input
                id="agent-name"
                name="agent-name"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                placeholder="stripe-expert"
                className={cx(field, 'font-mono')}
              />
            </div>
          )}
          <div>
            <label className={label} htmlFor="agent-description">Description</label>
            <textarea
              id="agent-description"
              name="agent-description"
              autoComplete="off"
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Payments specialist: Stripe Checkout, webhooks…"
              className={field}
            />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <div>
              <label className={label} htmlFor="agent-color">Color</label>
              <input
                id="agent-color"
                type="color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                className="h-[30px] w-10 cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 p-0.5"
              />
            </div>
            <div>
              <label className={label} htmlFor="agent-model">Model</label>
              <select id="agent-model" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value as AgentModel })} className={field}>
                {AGENT_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m === 'inherit' ? 'Same as orchestrator' : m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="agent-prompt">Prompt</label>
            <textarea
              id="agent-prompt"
              name="agent-prompt"
              spellCheck={false}
              rows={10}
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              className={cx(field, 'font-mono text-[11px] leading-relaxed')}
            />
            <p className="mt-1 text-[10px] leading-snug text-zinc-500">The board protocol (claim, spec, checklist, Review) is appended automatically.</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !draft.name || !draft.description.trim() || !draft.prompt.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Save agent
            </button>
          </div>
        </form>
      )}

      {agents.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-700 p-3 text-center">
          <p className="text-xs text-zinc-300">No agents yet</p>
          <p className="mt-1 text-[11px] text-zinc-500">Add developer, designer, tester, fixer, docs, creative-director and ideator.</p>
          <button
            type="button"
            onClick={() => void sync(true)}
            disabled={busy}
            className="mt-2 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            Install default agents
          </button>
        </div>
      ) : (
        <ul className="space-y-1">
          {agents.map((agent) => {
            const expanded = open === agent.name
            const count = openTasks(agent.name)
            return (
              <li key={agent.name} className={cx('rounded-md border', expanded ? 'border-zinc-700 bg-zinc-950/60' : 'border-transparent')}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : agent.name)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/60"
                >
                  {expanded ? <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-zinc-500" />}
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: agent.color || 'var(--color-zinc-500)' }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-zinc-100" translate="no">{agent.name}</span>
                    <span className="block truncate text-[11px] text-zinc-500">{agentRole(agent)}</span>
                  </span>
                  {count > 0 && (
                    <span className="shrink-0 rounded-full bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-300" title={`${count} open task(s) assigned`}>
                      {count}
                    </span>
                  )}
                </button>
                {expanded && (
                  <div className="space-y-2 px-2 pb-2 pt-1">
                    <p className="text-[11px] leading-snug text-zinc-400">{agent.description}</p>
                    <div className="flex flex-wrap gap-1 text-[10px]">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">model: {agent.model === 'inherit' ? 'inherit' : agent.model}</span>
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-300">tools: {agent.tools.length ? agent.tools.join(', ') : 'all'}</span>
                      {agent.tags.map((t) => (
                        <span key={t} className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">
                          {t}
                        </span>
                      ))}
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-zinc-800 bg-zinc-950 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-300">
                      {agent.prompt}
                    </pre>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEdit(agent)}
                        className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                      >
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(agent)}
                        className="flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:border-red-800 hover:text-red-300"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
