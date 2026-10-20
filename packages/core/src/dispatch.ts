import type { AgentProfile, Sprint, Task, TaskPriority } from './types.js'
import { getTaskLock, isWorkflowAssignee } from './types.js'
import { CODE_REVIEWER, UI_REVIEWER, isReviewerAgent } from './agents.js'

type AgentRef = Pick<AgentProfile, 'name'> & Partial<Pick<AgentProfile, 'tags'>>

/** Agent that takes tasks assigned to a workflow role (dev, scrum-master, …). */
export const DEFAULT_SUBAGENT = 'developer'

export interface DispatchItem {
  id: string
  title: string
  priority: TaskPriority
  assignee: string
  /** Subagent to launch for this task, or null for a general-purpose agent. */
  subagent: string | null
  /** Review-gate subagent that checks the work once it reaches Review, or null for no gate. */
  reviewer: string | null
  dependencies: string[]
}

export interface DispatchPlan {
  sprint: Sprint | null
  /**
   * waves[0] can start now (it may be empty when everything waits on work
   * already in progress); waves[n] starts once waves[0..n-1] are done.
   */
  waves: DispatchItem[][]
  inProgress: Array<DispatchItem & { lockedBy: string | null }>
  review: DispatchItem[]
  blocked: Array<DispatchItem & { reason: string }>
}

const PENDING = new Set(['Backlog', 'To Do'])
const IN_FLIGHT = new Set(['In Progress', 'Review'])
const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * Pick the subagent for a task: its specialized assignee when that profile
 * exists, `developer` for workflow roles, otherwise null (general-purpose).
 */
export function subagentFor(assignee: string, agents: AgentRef[]): string | null {
  const names = new Set(agents.map((a) => a.name))
  if (!isWorkflowAssignee(assignee)) return names.has(assignee) ? assignee : null
  return names.has(DEFAULT_SUBAGENT) ? DEFAULT_SUBAGENT : null
}

/** Tags that route a task to the UI reviewer instead of the code reviewer. */
const UI_TAGS = new Set(['design', 'ui', 'ux', 'frontend', 'web', 'css', 'a11y'])
/** Profile tags whose work is a decision, not an artifact a reviewer can check. */
const UNREVIEWED_TAGS = new Set(['ideas', 'creative'])

/**
 * Pick the review gate for a task: `ui-reviewer` for UI work (task or
 * assignee tagged design/ui/ux/…), `code-reviewer` for everything else.
 * Null when the board has no reviewer agents, when the task is itself done
 * by a reviewer, or when its assignee produces decisions (ideator, creative
 * director) rather than code.
 */
export function reviewerFor(task: Pick<Task, 'assignee' | 'tags'>, agents: AgentRef[]): string | null {
  const names = new Set(agents.map((a) => a.name))
  const owner = agents.find((a) => a.name === task.assignee)
  const ownerTags = owner?.tags ?? []
  if (owner && (isReviewerAgent({ tags: ownerTags }) || ownerTags.some((t) => UNREVIEWED_TAGS.has(t)))) return null
  const isUi = [...task.tags, ...ownerTags].some((t) => UI_TAGS.has(t.toLowerCase()))
  if (isUi && names.has(UI_REVIEWER)) return UI_REVIEWER
  return names.has(CODE_REVIEWER) ? CODE_REVIEWER : null
}

/**
 * Split a sprint's pending tasks into waves of mutually independent work:
 * a task lands one wave after the latest of its dependencies. Tasks that can
 * never start (missing dependency, dependency outside the plan that is not
 * moving, or a cycle) are reported as blocked instead.
 */
export function planDispatch(
  input: { tasks: Task[]; sprints: Sprint[]; activeSprint: Sprint | null; agents: AgentRef[] },
  opts: { sprintId?: number; now?: Date } = {},
): DispatchPlan {
  const sprint = opts.sprintId != null ? input.sprints.find((s) => s.id === opts.sprintId) ?? null : input.activeSprint
  if (opts.sprintId != null && !sprint) throw new Error(`Sprint not found: ${opts.sprintId}`)
  const byId = new Map(input.tasks.map((t) => [t.id, t]))
  const inScope = input.tasks.filter((t) => (sprint ? t.sprint === sprint.id : t.sprint == null))
  const item = (t: Task): DispatchItem => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    assignee: t.assignee,
    subagent: subagentFor(t.assignee, input.agents),
    reviewer: reviewerFor(t, input.agents),
    dependencies: t.dependencies,
  })

  // level: 0 = done, 1 = already moving, n+1 = one wave after its latest dependency.
  const level = new Map<string, number>()
  const reasons = new Map<string, string>()
  const visiting = new Set<string>()
  const scopeIds = new Set(inScope.map((t) => t.id))

  const levelOf = (id: string): number => {
    const known = level.get(id)
    if (known !== undefined) return known
    const task = byId.get(id)
    if (!task) return Infinity
    if (task.status === 'Done') return 0
    if (IN_FLIGHT.has(task.status)) return 1
    if (!scopeIds.has(id)) return Infinity // pending work outside this plan never unblocks by itself
    if (visiting.has(id)) {
      reasons.set(id, 'dependency cycle')
      return Infinity
    }
    visiting.add(id)
    let worst = 0
    for (const dep of task.dependencies) {
      const depLevel = levelOf(dep)
      if (depLevel === Infinity && !reasons.has(id)) {
        const depTask = byId.get(dep)
        reasons.set(
          id,
          !depTask
            ? `depends on missing task ${dep}`
            : reasons.get(dep) === 'dependency cycle'
              ? 'dependency cycle'
              : reasons.has(dep)
                ? `waits on blocked ${dep}`
                : `waits on ${dep} (${depTask.status}, outside this sprint)`,
        )
      }
      worst = Math.max(worst, depLevel)
    }
    visiting.delete(id)
    const result = worst === Infinity ? Infinity : worst + 1
    level.set(id, result)
    return result
  }

  const waves: DispatchItem[][] = []
  const blocked: DispatchPlan['blocked'] = []
  const pending = inScope
    .filter((t) => PENDING.has(t.status))
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id, undefined, { numeric: true }))
  for (const t of pending) {
    const l = levelOf(t.id)
    if (l === Infinity) {
      blocked.push({ ...item(t), reason: reasons.get(t.id) ?? 'blocked' })
      continue
    }
    // Level 1 means "all deps done" (wave 0); level 2 waits on something already moving.
    const wave = l - 1
    while (waves.length <= wave) waves.push([])
    waves[wave]!.push(item(t))
  }

  const now = opts.now ?? new Date()
  return {
    sprint,
    waves,
    inProgress: inScope
      .filter((t) => t.status === 'In Progress')
      .map((t) => ({ ...item(t), lockedBy: getTaskLock(t, now)?.lockedBy ?? null })),
    review: inScope.filter((t) => t.status === 'Review').map(item),
    blocked,
  }
}

function launchPrompt(it: DispatchItem): string {
  return `Work on AgentSprint task ${it.id} ("${it.title}"). Follow your AgentSprint protocol: claim it, read task_spec, deliver every acceptance criterion, move it to Review and report back.`
}

function reviewPrompt(it: DispatchItem): string {
  return `Review AgentSprint task ${it.id} ("${it.title}"). Follow your review protocol: read task_spec, inspect the change, then record your verdict with task_review.`
}

/**
 * Render a dispatch plan as orchestrator instructions: which subagent to
 * launch for which task, which tasks can run in parallel and what to check
 * between waves.
 */
export function buildDispatchPlan(plan: DispatchPlan, projectName: string): string {
  const lines: string[] = []
  const scope = plan.sprint ? `Sprint ${plan.sprint.id} — ${plan.sprint.goal}` : 'Backlog (no sprint)'
  lines.push(`# Dispatch plan — ${projectName}`)
  lines.push('')
  lines.push(`**Scope:** ${scope}`)
  lines.push('')

  const total = plan.waves.reduce((n, w) => n + w.length, 0)
  if (total === 0) {
    lines.push(
      plan.inProgress.length + plan.review.length > 0
        ? 'Nothing new to dispatch: every remaining task is in progress or waiting for review.'
        : 'Nothing to dispatch: there are no pending tasks in this scope.',
    )
    lines.push('')
  } else {
    lines.push('You are the **orchestrator**. Do not implement these tasks yourself — delegate each one to its subagent and coordinate.')
    lines.push('')
    lines.push('- Run the waves **in order**. Tasks inside a wave do not depend on each other: launch them **in parallel** (one subagent per task, all in the same message).')
    lines.push('- Claude Code: use the Agent tool with `subagent_type` set to the subagent below (they live in `.claude/agents/`). Pass `isolation: "worktree"` when two tasks of the same wave edit the same files.')
    lines.push('- `general-purpose` means no specialist matches: use the default agent and paste the task spec (`task_spec`) into its prompt.')
    lines.push('')
    plan.waves.forEach((wave, i) => {
      if (wave.length === 0) return
      const when =
        i === 0 ? 'start now' : plan.waves.slice(0, i).every((w) => w.length === 0) ? 'once the in-progress tasks are done' : `once wave ${i} is done`
      lines.push(`## Wave ${i + 1} — ${when} (${wave.length} task${wave.length === 1 ? '' : 's'})`)
      lines.push('')
      lines.push('| Task | Title | Priority | Subagent | Review gate | Depends on |')
      lines.push('| --- | --- | --- | --- | --- | --- |')
      for (const it of wave) {
        lines.push(`| ${it.id} | ${it.title.replace(/\|/g, '\\|')} | ${it.priority} | \`${it.subagent ?? 'general-purpose'}\` | ${it.reviewer ? `\`${it.reviewer}\`` : '—'} | ${it.dependencies.join(', ') || '—'} |`)
      }
      lines.push('')
      for (const it of wave) {
        lines.push(`- **${it.id} → \`${it.subagent ?? 'general-purpose'}\`:** ${launchPrompt(it)}`)
      }
      lines.push('')
    })
  }

  if (plan.inProgress.length > 0) {
    lines.push('## In progress')
    lines.push('')
    for (const it of plan.inProgress) {
      lines.push(`- ${it.id} — ${it.title}${it.lockedBy ? ` (locked by ${it.lockedBy})` : ' (no active lock — may be abandoned; re-dispatch if nobody is on it)'}`)
    }
    lines.push('')
  }
  if (plan.review.length > 0) {
    const gated = plan.review.filter((it) => it.reviewer)
    if (gated.length > 0) {
      lines.push('## Review gate')
      lines.push('')
      lines.push('Launch these reviewers in parallel before the human looks. Skip a task whose notes already hold an approving review newer than its last change.')
      lines.push('')
      for (const it of gated) lines.push(`- **${it.id} → \`${it.reviewer}\`:** ${reviewPrompt(it)}`)
      lines.push('')
    }
    lines.push('## Waiting for human review')
    lines.push('')
    for (const it of plan.review) lines.push(`- ${it.id} — ${it.title}`)
    lines.push('')
  }
  if (plan.blocked.length > 0) {
    lines.push('## Blocked')
    lines.push('')
    for (const it of plan.blocked) lines.push(`- ${it.id} — ${it.title}: ${it.reason}`)
    lines.push('')
  }

  if (total > 0) {
    lines.push('## Between waves')
    lines.push('')
    lines.push('1. Read every subagent report and confirm its task is in Review (`task_get`). Re-launch or fix any that stopped early.')
    lines.push('2. **Review gate:** launch each task\'s reviewer subagent (column "Review gate") in parallel. A `changes` verdict moves the task back to In Progress with findings — re-launch its subagent with those findings, then review again.')
    lines.push('3. Run the full test suite, typecheck and lint once for the whole wave; send failures to the `fixer` subagent.')
    lines.push('4. Call `sprint_dispatch` again before the next wave — the plan is recomputed from the board, so it reflects what actually landed.')
    lines.push('5. Before you stop, leave a handoff with `session_handoff` (done, next, blockers) so the next session starts where this one ended.')
    lines.push('')
  }
  return lines.join('\n')
}
