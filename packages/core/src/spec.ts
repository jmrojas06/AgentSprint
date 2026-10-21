import type { AgentProfile } from './agents.js'
import type { Brand, Sprint, Task } from './types.js'
import { hasBrand, DEFAULT_STATUSES } from './types.js'

/** Lines of learnings a task spec carries; the brief keeps fewer. */
const SPEC_LEARNINGS_LINES = 40

/**
 * Keep the tail of the learnings file: recent lessons matter most and
 * prompts must stay short. Automatic sprint retros (`## Sprint N retro …`)
 * are report dumps, not rules, so they are skipped; the full file stays
 * available through `learnings_get`. Retros written before their body
 * headings were nested also leave `## Tasks` / `## Retro` sections behind
 * them; those go too.
 */
export function learningsTail(learnings: string, maxLines: number): string {
  let inRetro = false
  const sections = learnings.split(/^(?=## )/m).filter((sec) => {
    const heading = sec.split('\n', 1)[0] ?? ''
    if (/^## .*\bretro\b/i.test(heading)) inRetro = true
    else if (!(inRetro && /^## Tasks\s*$/.test(heading))) inRetro = false
    return !inRetro
  })
  const lines = sections
    .join('\n')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('# '))
  return (lines.length > maxLines ? ['…', ...lines.slice(-maxLines)] : lines).join('\n')
}

/**
 * Render the specialized-agent profile block injected into task specs when
 * the task's assignee matches an agent in `.agentboard/agents/`. Returns
 * null when the profile has no usable prompt.
 */
export function buildAgentSection(agent: AgentProfile | null | undefined): string | null {
  if (!agent || !agent.prompt.trim()) return null
  const lines: string[] = []
  lines.push(`## Agent profile — ${agent.name}`)
  lines.push('')
  lines.push(`**Role:** ${agent.description}`)
  lines.push('')
  lines.push('Adopt this role for the whole task. Its rules override generic behavior:')
  lines.push('')
  lines.push(agent.prompt.trim())
  lines.push('')
  if (agent.skills.length > 0) {
    lines.push(`**Skills to load:** ${agent.skills.map((s) => `\`${s}\``).join(', ')} — invoke each one that is installed before you start.`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Render the brand guidelines block appended to task specs when the
 * project has a configured brand. Returns null when there is no brand.
 */
export function buildBrandSection(brand: Brand): string | null {
  if (!hasBrand(brand)) return null
  const lines: string[] = []
  lines.push('## Brand guidelines')
  lines.push('')
  if (brand.name) lines.push(`**Company:** ${brand.name}`)
  if (brand.tagline) lines.push(`**Tagline:** ${brand.tagline}`)
  if (brand.mission) lines.push(`**Mission:** ${brand.mission}`)
  if (brand.tone) lines.push(`**Tone of voice:** ${brand.tone}`)
  if (brand.logo) lines.push(`**Logo:** ${brand.logo}`)

  const colors = Object.entries(brand.colors).filter(([, v]) => v.trim() !== '')
  if (colors.length > 0) {
    lines.push('')
    lines.push('**Design tokens (colors):**')
    for (const [k, v] of colors) lines.push(`- \`${k}\`: ${v}`)
  }

  const fonts = Object.entries(brand.fonts).filter(([, v]) => v.trim() !== '')
  if (fonts.length > 0) {
    lines.push('')
    lines.push('**Design tokens (fonts):**')
    for (const [k, v] of fonts) lines.push(`- \`${k}\`: ${v}`)
  }

  if (brand.assets.length > 0) {
    lines.push('')
    lines.push('**Design files (do not lose them):**')
    for (const a of brand.assets) lines.push(`- ${a.name}: \`${a.path}\``)
  }

  if (brand.guidelines.trim()) {
    lines.push('')
    lines.push(brand.guidelines.trim())
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * Turn a task into a self-contained prompt that an AI coding agent can
 * execute without any other context. This is the "handoff" document.
 * Pass the project brand to append brand guidelines and `allTasks` to
 * show the status of each dependency.
 */
export function buildTaskSpec(task: Task, sprint: Sprint | null, projectName: string, options?: { brand?: Brand | null; allTasks?: Task[]; learnings?: string | null; agent?: AgentProfile | null }): string {
  const lines: string[] = []
  lines.push(`# ${task.id} — ${task.title}`)
  lines.push('')
  lines.push(`- **Project:** ${projectName}`)
  lines.push(`- **Status:** ${task.status}`)
  lines.push(`- **Priority:** ${task.priority}`)
  lines.push(`- **Assignee:** ${task.assignee}`)
  lines.push(`- **Estimate:** ${task.estimate} points`)
  if (sprint) lines.push(`- **Sprint ${sprint.id}:** ${sprint.goal || 'no goal'}`)
  lines.push('')
  lines.push('## Mission')
  lines.push('')
  lines.push(task.description.trim() || '_What needs to be done and why._')
  lines.push('')
  lines.push('## Acceptance criteria')
  lines.push('')
  if (task.acceptanceCriteria.length === 0) {
    lines.push('- [ ] ')
  } else {
    lines.push(...task.acceptanceCriteria.map((c) => {
      const checked = /^\[x\]\s*/i.test(c.trim())
      const text = c.replace(/^\[x\]\s*/i, '').replace(/^\[\s*\]\s*/i, '').trim()
      return `- [${checked ? 'x' : ' '}] ${text}`
    }))
  }
  lines.push('')
  if (task.tags.length > 0) {
    lines.push(`**Tags:** ${task.tags.join(', ')}`)
    lines.push('')
  }
  if (task.dependencies.length > 0) {
    if (options?.allTasks) {
      const depDetails = task.dependencies
        .map((depId) => {
          const dep = options!.allTasks!.find((t) => t.id === depId)
          if (!dep) return `${depId} — _not found_`
          return `${depId} — ${dep.title} (${dep.status})`
        })
        .join(', ')
      lines.push(`**Depends on:** ${depDetails}`)
    } else {
      lines.push(`**Depends on:** ${task.dependencies.join(', ')}`)
    }
    lines.push('')
  }

  const agentSection = buildAgentSection(options?.agent)
  if (agentSection) {
    lines.push(agentSection)
  }

  const brandSection = options?.brand ? buildBrandSection(options.brand) : null
  if (brandSection) {
    lines.push(brandSection)
  }

  const learnings = options?.learnings?.trim() ? learningsTail(options.learnings, SPEC_LEARNINGS_LINES) : ''
  if (learnings) {
    lines.push('## Learned principles')
    lines.push('')
    lines.push(learnings)
    lines.push('')
  }

  lines.push('## Rules for the agent')
  lines.push('')
  lines.push('- Update the task status in `.agentboard/tasks/` as you work: `In Progress` → `Review` when criteria are met.')
  lines.push('- Do not mark as done; leave it in `Review` for a human.')
  lines.push('- Keep changes focused on this task only.')
  lines.push('')
  return lines.join('\n')
}

export interface SprintStats {
  sprintId: number
  total: number
  backlog: number
  todo: number
  inProgress: number
  review: number
  done: number
  pointsTotal: number
  pointsDone: number
  completionPct: number
}

/** Aggregate task stats for a sprint (or the whole board if sprintId is null). */
export function computeSprintStats(tasks: Task[], sprintId: number | null): SprintStats {
  const scope = sprintId == null ? tasks : tasks.filter((t) => t.sprint === sprintId)
  const byStatus = (s: string) => scope.filter((t) => t.status === s).length

  const total = scope.length
  const done = byStatus('Done')
  const pointsTotal = scope.reduce((sum, t) => sum + t.estimate, 0)
  const pointsDone = scope.filter((t) => t.status === 'Done').reduce((sum, t) => sum + t.estimate, 0)

  return {
    sprintId: sprintId ?? 0,
    total,
    backlog: byStatus('Backlog'),
    todo: byStatus('To Do'),
    inProgress: byStatus('In Progress'),
    review: byStatus('Review'),
    done,
    pointsTotal,
    pointsDone,
    completionPct: total === 0 ? 0 : Math.round((done / total) * 100),
  }
}

/**
 * Generate a Markdown report summarizing sprint progress, status breakdown, and retro.
 */
export function buildSprintReport(sprint: Sprint, tasks: Task[], statuses: readonly string[] = DEFAULT_STATUSES): string {
  const sprintTasks = tasks.filter((t) => t.sprint === sprint.id)
  const stats = computeSprintStats(sprintTasks, sprint.id)
  const group = (status: string) => sprintTasks.filter((t) => t.status === status)
  const lines: string[] = [
    `# Sprint ${sprint.id} — ${sprint.goal || 'No goal'}`,
    '',
    `- **Status**: ${sprint.status}`,
    `- **Started**: ${sprint.startedAt ?? '—'}`,
    `- **Ended**: ${sprint.endedAt ?? '—'}`,
    `- **Progress**: ${stats.done}/${stats.total} tasks done (${stats.completionPct}%)`,
    '',
    '## Tasks',
  ]
  for (const status of statuses) {
    const list = group(status)
    lines.push('', `### ${status} (${list.length})`, '')
    if (list.length === 0) lines.push('_none_', '')
    for (const t of list) {
      lines.push(`- [${t.priority}] **${t.id}** — ${t.title}${t.assignee ? ` (${t.assignee})` : ''}`)
    }
  }
  lines.push('', '## Retro', '', '_Pendiente: qué fue bien, qué no, qué mejorar._')
  return lines.join('\n')
}
