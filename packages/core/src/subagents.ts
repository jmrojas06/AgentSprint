import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { isReviewerAgent } from './agents.js'
import { serializeFrontmatter } from './frontmatter.js'
import type { AgentProfile } from './types.js'

/**
 * Marker written into every generated subagent file. Only files carrying it
 * are ever rewritten or removed — a hand-written `.claude/agents/<name>.md`
 * is never touched.
 */
export const SUBAGENT_MARKER = 'agentsprint:generated'

/** Where Claude Code looks for project subagents. */
export function claudeAgentsDir(rootDir: string): string {
  return path.join(rootDir, '.claude', 'agents')
}

/** Claude Code's named subagent colors, keyed by hue (degrees). */
const CLAUDE_COLORS: Array<[name: string, hue: number]> = [
  ['red', 0],
  ['orange', 28],
  ['yellow', 50],
  ['green', 130],
  ['cyan', 180],
  ['blue', 220],
  ['purple', 270],
  ['pink', 325],
]

/** Map a `#rrggbb` color to the closest Claude Code subagent color, or null. */
export function nearestClaudeColor(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1]!, 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const delta = max - Math.min(r, g, b)
  if (delta < 0.08) return null // greys have no meaningful hue
  let hue: number
  if (max === r) hue = 60 * (((g - b) / delta) % 6)
  else if (max === g) hue = 60 * ((b - r) / delta + 2)
  else hue = 60 * ((r - g) / delta + 4)
  if (hue < 0) hue += 360
  let best = CLAUDE_COLORS[0]!
  let bestDist = Infinity
  for (const entry of CLAUDE_COLORS) {
    const d = Math.min(Math.abs(hue - entry[1]), 360 - Math.abs(hue - entry[1]))
    if (d < bestDist) {
      best = entry
      bestDist = d
    }
  }
  return best[0]
}

/** The protocol a review-gate subagent follows: it judges a task in Review, it does not build it. */
function reviewerProtocolSection(agent: AgentProfile, projectName: string): string {
  return `## AgentSprint review protocol

You run as the \`${agent.name}\` review gate of the **${projectName}** board. The
orchestrator hands you ONE task id (e.g. \`TK-12\`) that a specialist just
moved to Review. You judge it; you never change the code.

Use the AgentSprint MCP tools (server \`agentsprint\`):

1. **Read the spec** — \`task_spec { id }\`: acceptance criteria, brand kit and
   learnings. Read the implementer's notes with \`task_get { id }\`.
2. **Inspect the work** — the diff, the running result and the test suite, as
   your rules say.
3. **Record the verdict** — \`task_review { id, reviewer: "${agent.name}",
   verdict: "approve" | "changes", summary, findings: [...] }\`. \`approve\`
   keeps the task in Review for the human; \`changes\` moves it back to In
   Progress with your findings so the orchestrator re-launches the
   implementer.

Without the MCP tools, append your verdict under \`## Notes\` in
\`.agentboard/tasks/<id>.md\` and, for \`changes\`, set \`status: In Progress\`.

Your final message is the report the orchestrator reads: task id, verdict,
findings and the commands you ran.`
}

/** The board protocol every generated subagent follows, whatever its role. */
function protocolSection(agent: AgentProfile, projectName: string): string {
  if (isReviewerAgent(agent)) return reviewerProtocolSection(agent, projectName)
  return `## AgentSprint protocol

You run as the \`${agent.name}\` subagent of the **${projectName}** board. The
board is git-native: every task is a Markdown file in \`.agentboard/tasks/\`.
The orchestrator hands you ONE task id (e.g. \`TK-12\`); work only on that task.

Use the AgentSprint MCP tools (server \`agentsprint\`, e.g.
\`mcp__agentsprint__task_claim\`):

1. **Claim** — \`task_claim { id, agent: "${agent.name}" }\`. If it fails
   because of blockers or another agent's lock, stop and report it.
2. **Read the spec** — \`task_spec { id }\`. Acceptance criteria, dependencies,
   brand kit and past learnings live there; it is your source of truth.
3. **Do the work** inside this role and inside the task's scope.
4. **Track progress** — tick each satisfied criterion with \`task_checklist\`
   and log key decisions with \`task_note\`.
5. **Hand over** — \`task_status { id, status: "Review" }\`. Never move a task
   to Done; a human does that. If blocked: \`task_note\` the blocker, then
   \`task_release { id }\` and stop.

Without the MCP tools, edit \`.agentboard/tasks/<id>.md\` directly: set
\`status: In Progress\` and \`assignee: ${agent.name}\` in the frontmatter when
you start, tick \`- [x]\` criteria, and set \`status: Review\` when done.

Your final message is the report the orchestrator reads: task id, what changed
(files), commands run with their results, and anything left open.`
}

/** Render one agent profile as a Claude Code subagent definition. */
export function renderClaudeSubagent(agent: AgentProfile, projectName: string): string {
  const data: Record<string, unknown> = {
    name: agent.name,
    description: `${agent.description.trim()} Use for AgentSprint tasks assigned to "${agent.name}" (pass the task id, e.g. TK-12).`,
  }
  if (agent.tools.length > 0) data.tools = agent.tools.join(', ')
  if (agent.disallowedTools.length > 0) data.disallowedTools = agent.disallowedTools.join(', ')
  if (agent.skills.length > 0) data.skills = agent.skills
  if (agent.model !== 'inherit') data.model = agent.model
  const color = nearestClaudeColor(agent.color)
  if (color) data.color = color
  const body = [
    '',
    `<!-- ${SUBAGENT_MARKER} — edit .agentboard/agents/${agent.name}.md instead; this file is regenerated. -->`,
    '',
    agent.prompt.trim(),
    '',
    protocolSection(agent, projectName),
    '',
  ].join('\n')
  return serializeFrontmatter(data, body)
}

export interface SubagentSyncResult {
  /** Absolute path of `.claude/agents/`. */
  dir: string
  written: string[]
  unchanged: string[]
  removed: string[]
  /** Agents not written because a hand-written file with that name exists. */
  skipped: Array<{ name: string; reason: string }>
}

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
  } finally {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* already renamed */
    }
  }
}

function readOrNull(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/**
 * Make `.claude/agents/` mirror the board's agent profiles. Idempotent: it
 * compares content, so a second run writes nothing. Generated files whose
 * profile was deleted are removed; files without the marker are left alone.
 */
export function syncClaudeSubagents(rootDir: string, agents: AgentProfile[], projectName: string): SubagentSyncResult {
  const dir = claudeAgentsDir(rootDir)
  const result: SubagentSyncResult = { dir, written: [], unchanged: [], removed: [], skipped: [] }
  const wanted = new Map(agents.map((a) => [`${a.name}.md`, { name: a.name, content: renderClaudeSubagent(a, projectName) }]))
  if (wanted.size === 0 && !fs.existsSync(dir)) return result
  fs.mkdirSync(dir, { recursive: true })

  for (const [file, { name, content }] of wanted) {
    const target = path.join(dir, file)
    const existing = readOrNull(target)
    if (existing !== null && !existing.includes(SUBAGENT_MARKER)) {
      result.skipped.push({ name, reason: `${path.join('.claude', 'agents', file)} is hand-written; rename one of them to sync` })
    } else if (existing === content) {
      result.unchanged.push(name)
    } else {
      writeAtomic(target, content)
      result.written.push(name)
    }
  }

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md') || wanted.has(file)) continue
    const target = path.join(dir, file)
    if (readOrNull(target)?.includes(SUBAGENT_MARKER)) {
      fs.unlinkSync(target)
      result.removed.push(file.replace(/\.md$/, ''))
    }
  }
  return result
}
