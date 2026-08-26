import { DEFAULT_STATUSES, type ProjectState } from './types.js'
import { computeSprintStats } from './spec.js'

function criterionChecked(criterion: string): boolean {
  return /^\[x\]\s*/i.test(criterion.trim())
}

function criterionText(criterion: string): string {
  return criterion.replace(/^\[x\]\s*/i, '').replace(/^\[\s*\]\s*/, '').trim()
}

export interface BoardExportOptions {
  /** Export only this sprint id (null = whole board). */
  sprintId?: number | null
  projectName?: string
  learnings?: string
  generatedAt?: string
}

/**
 * Generate a static BOARD.md snapshot: sprints with stats, all tasks grouped
 * by status (with their acceptance criteria) and the current learnings.
 */
export function buildBoardMarkdown(state: ProjectState, opts: BoardExportOptions = {}): string {
  const statuses = state.config.workflow.statuses.length > 0 ? state.config.workflow.statuses : [...DEFAULT_STATUSES]
  const sprintId = opts.sprintId ?? null
  const sprints = sprintId != null ? state.sprints.filter((s) => s.id === sprintId) : state.sprints
  if (sprintId != null && sprints.length === 0) {
    throw new Error(`Sprint not found: ${sprintId}`)
  }

  const tasksInScope = sprintId != null ? state.tasks.filter((t) => t.sprint === sprintId) : state.tasks
  const lines: string[] = [
    `# ${opts.projectName || state.config.name || 'AgentSprint'} — Board export`,
    '',
    `_Generated: ${opts.generatedAt ?? new Date().toISOString()}_`,
    '',
  ]

  // ── Sprint summary ────────────────────────────────────────────────
  lines.push('## Sprints', '')
  if (sprints.length === 0) {
    lines.push('_No sprints defined._', '')
  } else {
    lines.push('| Sprint | Goal | Status | Points | Done | % |', '|---|---|---|---|---|---|')
    for (const sprint of sprints) {
      const stats = computeSprintStats(tasksInScope, sprint.id)
      lines.push(
        `| ${sprint.id} | ${sprint.goal || '—'} | ${sprint.status} | ${stats.pointsDone}/${stats.pointsTotal} | ${stats.done}/${stats.total} | ${stats.completionPct}% |`,
      )
    }
    lines.push('')
    for (const sprint of sprints) {
      const stats = computeSprintStats(tasksInScope, sprint.id)
      lines.push(
        `- **Sprint ${sprint.id}** (${sprint.status}): ${stats.pointsDone}/${stats.pointsTotal} pts, ${stats.completionPct}% complete`,
      )
    }
    lines.push('')
  }

  // ── Tasks grouped by status ───────────────────────────────────────
  lines.push('## Tasks', '')
  for (const status of statuses) {
    const list = tasksInScope
      .filter((t) => t.status === status)
      .sort((a, b) => a.id.localeCompare(b.id))
    lines.push(`### ${status} (${list.length})`, '')
    if (list.length === 0) {
      lines.push('_none_', '')
      continue
    }
    for (const task of list) {
      const acDone = task.acceptanceCriteria.filter(criterionChecked).length
      const meta = [`priority: ${task.priority}`, `assignee: ${task.assignee}`, task.sprint != null ? `sprint: ${task.sprint}` : 'sprint: —']
      lines.push(`#### **${task.id}** — ${task.title}`, '')
      lines.push(`_${meta.join(' · ')} · AC ${acDone}/${task.acceptanceCriteria.length}_`, '')
      if (task.description.trim()) {
        lines.push(task.description.trim(), '')
      }
      for (const criterion of task.acceptanceCriteria) {
        lines.push(`- [${criterionChecked(criterion) ? 'x' : ' '}] ${criterionText(criterion)}`)
      }
      if (task.acceptanceCriteria.length > 0) lines.push('')
    }
  }

  // ── Learnings / retro ────────────────────────────────────────────
  lines.push('## Retro & learnings', '')
  const learnings = opts.learnings ?? ''
  if (learnings.trim()) {
    lines.push(learnings.trim(), '')
  } else {
    lines.push('_No learnings recorded yet._', '')
  }

  return lines.join('\n')
}
