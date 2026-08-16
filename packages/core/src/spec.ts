import type { Brand, Sprint, Task } from './types.js'
import { hasBrand } from './types.js'

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
 * Pass the project brand to append brand guidelines.
 */
export function buildTaskSpec(task: Task, sprint: Sprint | null, projectName: string, brand?: Brand | null): string {
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
    lines.push(...task.acceptanceCriteria.map((c) => `- [ ] ${c}`))
  }
  lines.push('')
  if (task.tags.length > 0) {
    lines.push(`**Tags:** ${task.tags.join(', ')}`)
    lines.push('')
  }
  if (task.dependencies.length > 0) {
    lines.push(`**Depends on:** ${task.dependencies.join(', ')}`)
    lines.push('')
  }

  const brandSection = brand ? buildBrandSection(brand) : null
  if (brandSection) {
    lines.push(brandSection)
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
