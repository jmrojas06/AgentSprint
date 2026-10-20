import { createContext, useContext } from 'react'
import type { AgentProfile } from './types'
import { cx } from './ui'

/** The board's specialized agents, provided once by App from the project state. */
export const AgentsContext = createContext<AgentProfile[]>([])

export function useAgents(): AgentProfile[] {
  return useContext(AgentsContext)
}

/** Workflow roles: the board's built-in assignees (not subagents). */
export const WORKFLOW_ROLES = [
  { value: 'scrum-master', label: 'Scrum Master' },
  { value: 'dev', label: 'Development' },
  { value: 'review', label: 'Review' },
  { value: 'perfect', label: 'Perfect Review' },
] as const

const ROLE_VALUES = new Set<string>(WORKFLOW_ROLES.map((r) => r.value))

/** First clause of an agent description ("Designer — UI/UX…" → "Designer"). */
export function agentRole(agent: Pick<AgentProfile, 'description'>): string {
  return agent.description.split(/\s[—–-]\s|\.\s/)[0]!.trim()
}

/** `<option>`s for an assignee `<select>`: workflow roles, then specialist agents. */
export function AssigneeOptions({ agents, current }: { agents: AgentProfile[]; current?: string }) {
  const unknown = current && !ROLE_VALUES.has(current) && !agents.some((a) => a.name === current)
  return (
    <>
      <optgroup label="Workflow">
        {WORKFLOW_ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </optgroup>
      {agents.length > 0 && (
        <optgroup label="Specialist agents">
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}
            </option>
          ))}
        </optgroup>
      )}
      {unknown && (
        <optgroup label="Unknown">
          <option value={current}>{current} (no agent file)</option>
        </optgroup>
      )}
    </>
  )
}

const ROLE_CHIP: Record<string, string> = {
  dev: 'bg-indigo-500/15 text-indigo-300',
  review: 'bg-amber-500/15 text-amber-300',
  perfect: 'bg-emerald-500/15 text-emerald-300',
}

/** Assignee chip: workflow roles keep their tint, agents show their color swatch. */
export function AssigneeChip({ assignee, className }: { assignee: string; className?: string }) {
  const agent = useAgents().find((a) => a.name === assignee)
  if (!agent) {
    return (
      <span className={cx('rounded-full px-2 py-0.5 text-[10px] font-medium', ROLE_CHIP[assignee] ?? 'bg-zinc-700/50 text-zinc-300', className)}>
        {assignee}
      </span>
    )
  }
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-200', className)}
      title={`Specialist agent: ${agentRole(agent)}`}
      translate="no"
      data-testid="agent-chip"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: agent.color || 'var(--color-zinc-500)' }} />
      {assignee}
    </span>
  )
}
