import { computeSprintStats } from './spec.js'
import type { SprintStats } from './spec.js'
import { getTaskLock } from './types.js'
import type { Sprint, Task, TaskPriority } from './types.js'

/**
 * One session handoff in `.agentboard/journal.md`: what a session (human or
 * agent) did, what comes next and what is in the way. The journal is how the
 * next session — possibly a fresh agent with no memory — picks up the thread.
 */
export interface JournalEntry {
  at: string
  author: string
  summary: string
  done: string[]
  next: string[]
  blockers: string[]
}

export const JOURNAL_HEADER = `# Session journal

<!-- Append-only log of session handoffs, oldest first. Written by session_handoff
     (MCP), the board UI or by hand: "## <ISO date> — <author>" then the sections. -->
`

const SECTION_RE = /^\*\*(Summary|Done|Next|Blockers):\*\*\s*(.*)$/

/** Parse the journal file into entries (oldest first). Unknown lines are ignored. */
export function parseJournal(raw: string): JournalEntry[] {
  const entries: JournalEntry[] = []
  const chunks = raw.replace(/<!--[\s\S]*?-->/g, '').split(/^## /m).slice(1)
  for (const chunk of chunks) {
    const [heading = '', ...rest] = chunk.split('\n')
    const m = /^(\S+)\s+—\s+(.+)$/.exec(heading.trim())
    if (!m) continue
    const entry: JournalEntry = { at: m[1]!, author: m[2]!.trim(), summary: '', done: [], next: [], blockers: [] }
    let section = null as 'summary' | 'done' | 'next' | 'blockers' | null
    for (const line of rest) {
      const sm = SECTION_RE.exec(line.trim())
      if (sm) {
        section = sm[1]!.toLowerCase() as 'summary' | 'done' | 'next' | 'blockers'
        if (section === 'summary') entry.summary = sm[2]!.trim()
        continue
      }
      const item = /^\s*-\s+(.*)$/.exec(line)
      if (item && section !== null && section !== 'summary') entry[section].push(item[1]!.trim())
      else if (section === 'summary' && line.trim()) entry.summary = `${entry.summary} ${line.trim()}`.trim()
    }
    entries.push(entry)
  }
  return entries
}

/** Render one entry in the journal's Markdown form. */
export function formatJournalEntry(entry: JournalEntry): string {
  const lines = [`## ${entry.at} — ${entry.author}`, '']
  if (entry.summary.trim()) lines.push(`**Summary:** ${entry.summary.trim()}`, '')
  const list = (title: string, items: string[]): void => {
    const clean = items.map((i) => i.trim()).filter(Boolean)
    if (clean.length === 0) return
    lines.push(`**${title}:**`, ...clean.map((i) => `- ${i}`), '')
  }
  list('Done', entry.done)
  list('Next', entry.next)
  list('Blockers', entry.blockers)
  return lines.join('\n').trimEnd() + '\n'
}

const PRIORITY_RANK: Record<TaskPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const byPriority = (a: Task, b: Task): number =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.id.localeCompare(b.id, undefined, { numeric: true })

function criteriaProgress(t: Task): string {
  if (t.acceptanceCriteria.length === 0) return ''
  const done = t.acceptanceCriteria.filter((c) => /^\[[xX]\]/.test(c)).length
  return ` · AC ${done}/${t.acceptanceCriteria.length}`
}

/** Last note line of a task, without its `[timestamp] (author)` prefix. */
export function lastNote(t: Task): string | null {
  // Top-level entries only: indented lines are sub-items (e.g. review findings).
  const lines = t.notes.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.trim())
  const last = lines[lines.length - 1]
  if (!last) return null
  const text = last.replace(/^-\s+(\[[^\]]+\]\s*)?(\([^)]+\)\s*)?/, '').trim()
  return text.length > 160 ? `${text.slice(0, 157)}…` : text
}

export interface ProjectSnapshot {
  sprint: Sprint | null
  stats: SprintStats | null
  inProgress: Task[]
  review: Task[]
  next: Task[]
  blocked: Array<{ task: Task; blockers: string[] }>
  recentlyDone: Task[]
  lastHandoff: JournalEntry | null
}

/**
 * Structured "where are we" view of the board: the active sprint (or the
 * unscheduled backlog when none is active), what is moving, what is ready
 * next, what is stuck and the latest session handoff.
 */
export function snapshotProject(
  input: { tasks: Task[]; activeSprint: Sprint | null; journal: JournalEntry[] },
  opts: { recent?: number } = {},
): ProjectSnapshot {
  const { tasks, activeSprint: sprint } = input
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const scope = sprint ? tasks.filter((t) => t.sprint === sprint.id) : tasks
  const blockersOf = (t: Task): string[] => t.dependencies.filter((d) => byId.get(d)?.status !== 'Done')
  const pending = scope.filter((t) => t.status === 'To Do' || (t.status === 'Backlog' && (sprint != null || t.sprint == null)))
  const recentlyDone = tasks
    .filter((t) => t.status === 'Done')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, opts.recent ?? 5)
  return {
    sprint,
    stats: sprint ? computeSprintStats(tasks, sprint.id) : null,
    inProgress: scope.filter((t) => t.status === 'In Progress').sort(byPriority),
    review: scope.filter((t) => t.status === 'Review').sort(byPriority),
    next: pending.filter((t) => blockersOf(t).length === 0).sort(byPriority),
    blocked: pending.filter((t) => blockersOf(t).length > 0).sort(byPriority).map((task) => ({ task, blockers: blockersOf(task) })),
    recentlyDone,
    lastHandoff: input.journal[input.journal.length - 1] ?? null,
  }
}

/**
 * Keep the tail of the learnings file: recent lessons matter most and the
 * brief must stay short. Automatic sprint retros (`## Sprint N retro …`) are
 * report dumps, not rules, so they are skipped; the full file stays available
 * through `learnings_get`.
 */
export function learningsTail(learnings: string, maxLines: number): string {
  const sections = learnings.split(/^(?=## )/m).filter((sec) => !/^## .*\bretro\b/i.test(sec))
  const lines = sections
    .join('\n')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('# '))
  return (lines.length > maxLines ? ['…', ...lines.slice(-maxLines)] : lines).join('\n')
}

/**
 * Render the session-start brief: everything a fresh agent (or a human after
 * a break) needs to continue the project without re-reading the history —
 * sprint state, work in flight, what is next, blockers, the last handoff and
 * the most recent learnings. Printed by `agentboard context`, served by the
 * `project_context` MCP tool and injected by the Claude Code SessionStart hook.
 */
export function buildProjectContext(
  input: { projectName: string; tasks: Task[]; activeSprint: Sprint | null; journal: JournalEntry[]; learnings?: string },
  opts: { now?: Date; limit?: number } = {},
): string {
  const snap = snapshotProject(input)
  const limit = opts.limit ?? 8
  const now = opts.now ?? new Date()
  const lines: string[] = []
  const task = (t: Task, extra = ''): string => `- **${t.id}** ${t.title} — \`${t.assignee}\`, ${t.priority}${criteriaProgress(t)}${extra}`
  const capped = <T,>(items: T[], render: (item: T) => string): void => {
    for (const item of items.slice(0, limit)) lines.push(render(item))
    if (items.length > limit) lines.push(`- …and ${items.length - limit} more`)
  }

  lines.push(`# Where we are — ${input.projectName}`)
  lines.push('')
  lines.push(`_AgentSprint board snapshot, ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC. The board in \`.agentboard/\` is the source of truth._`)
  lines.push('')

  if (snap.sprint && snap.stats) {
    const s = snap.stats
    lines.push(`## Sprint ${snap.sprint.id} (active): ${snap.sprint.goal || 'no goal set'}`)
    lines.push('')
    lines.push(`Progress: **${s.done}/${s.total} tasks done (${s.completionPct}%)**, ${s.pointsDone}/${s.pointsTotal} points.`)
  } else {
    lines.push('## No active sprint')
    lines.push('')
    lines.push('Showing unscheduled work. Plan one with the `sprint-plan` prompt or `sprint_create` + `sprint_activate`.')
  }
  lines.push('')

  const h = snap.lastHandoff
  if (h) {
    lines.push(`## Last session handoff — ${h.at.slice(0, 16).replace('T', ' ')} by ${h.author}`)
    lines.push('')
    if (h.summary) lines.push(h.summary, '')
    if (h.done.length) lines.push('Done:', ...h.done.map((i) => `- ${i}`), '')
    if (h.next.length) lines.push('Planned next:', ...h.next.map((i) => `- ${i}`), '')
    if (h.blockers.length) lines.push('Blockers:', ...h.blockers.map((i) => `- ${i}`), '')
  }

  lines.push('## In progress')
  lines.push('')
  if (snap.inProgress.length === 0) lines.push('_Nothing in progress._')
  capped(snap.inProgress, (t) => {
    const lock = getTaskLock(t, now)
    const note = lastNote(t)
    return task(t, `${lock ? ` · locked by ${lock.lockedBy}` : ' · no active lock'}${note ? `\n  - last note: ${note}` : ''}`)
  })
  lines.push('')

  if (snap.review.length > 0) {
    lines.push('## Waiting for review')
    lines.push('')
    capped(snap.review, (t) => task(t))
    lines.push('')
  }

  lines.push('## Next up (unblocked, by priority)')
  lines.push('')
  if (snap.next.length === 0) lines.push('_Nothing ready to start._')
  capped(snap.next, (t) => task(t))
  lines.push('')

  if (snap.blocked.length > 0) {
    lines.push('## Blocked')
    lines.push('')
    capped(snap.blocked, (b) => task(b.task, ` · waits on ${b.blockers.join(', ')}`))
    lines.push('')
  }

  if (snap.recentlyDone.length > 0) {
    lines.push('## Recently done')
    lines.push('')
    for (const t of snap.recentlyDone) lines.push(`- ${t.id} ${t.title} (${t.updatedAt.slice(0, 10)})`)
    lines.push('')
  }

  const learnings = input.learnings?.trim() ? learningsTail(input.learnings, 15) : ''
  if (learnings) {
    lines.push('## Recent learnings (respect them)')
    lines.push('')
    lines.push(learnings)
    lines.push('')
  }

  lines.push('## How to continue')
  lines.push('')
  lines.push('1. Resume what is in progress before starting anything new; otherwise take the first task of "Next up" (`task_claim`, then `task_spec`).')
  lines.push('2. Keep the board current while you work: tick criteria (`task_checklist`), log decisions (`task_note`), move finished work to Review.')
  lines.push('3. Before the session ends, write a handoff with `session_handoff` (summary, done, next, blockers) — or append it to `.agentboard/journal.md`. The next session starts from it.')
  return lines.join('\n').trimEnd() + '\n'
}
