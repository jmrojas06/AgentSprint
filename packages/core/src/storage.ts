import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { withFileLock } from './filelock.js'
import { buildTaskBody, parseFrontmatter, parseTaskBody, serializeFrontmatter } from './frontmatter.js'
import { nowIso, ProjectConfig, Sprint, Task, DEFAULT_STATUSES, Brand, emptyBrand, getTaskLock, isWorkflowAssignee, TASK_LOCK_TTL_MINUTES, AgentProfile } from './types.js'
import type { AgentProfile as AgentProfileType, ActivityEvent as ActivityEventType, Assignee as AssigneeType, Brand as BrandType, BrandPatch, ProjectConfig as ProjectConfigType, ProjectState, Sprint as SprintType, SprintStatus, Task as TaskType, TaskInput, TaskLockInfo, TaskStatus } from './types.js'

/** Canonical assignee per status — used by setTaskStatus/updateTask auto-assignment. */
export const STATUS_ASSIGNEE_MAP: Record<TaskStatus, AssigneeType> = {
  Backlog: 'scrum-master',
  'To Do': 'scrum-master',
  'In Progress': 'dev',
  Review: 'review',
  Done: 'perfect',
}
import { buildSprintReport } from './spec.js'
import { SAMPLE_AGENTS, isValidAgentName, parseAgent, readAgents, serializeAgent } from './agents.js'
import { syncClaudeSubagents } from './subagents.js'
import type { SubagentSyncResult } from './subagents.js'
import { SAMPLE_TEMPLATES, isValidTemplateName, parseTemplate, readTemplates, renderTemplate } from './templates.js'
import type { TaskTemplate, TemplateVars } from './templates.js'
import { JOURNAL_HEADER, buildProjectContext, formatJournalEntry, parseJournal } from './context.js'
import type { JournalEntry } from './context.js'

/** Verdict of a review-gate agent (or human) on a task in Review. */
export type ReviewVerdict = 'approve' | 'changes'

const AGENTS_MD = `# AgentSprint instructions

This project uses a git-native sprint board under \`.agentboard/\`.

## Start and end every session here

- **Start:** run \`agentboard context\` (or call the \`project_context\` MCP tool). It prints where the project is: active sprint, work in progress, what is next, blockers, the last session handoff and recent learnings. Continue from there — never restart from scratch.
- **End:** leave a handoff with the \`session_handoff\` MCP tool (summary, done, next, blockers), or append it to \`.agentboard/journal.md\`. The next session — yours or another agent's — starts from it.

## Workflow

1. **Read \`.agentboard/sprints/\`** to learn the active sprint before doing any work.
2. Tasks are single Markdown files in \`.agentboard/tasks/\`. Their status lives in the YAML frontmatter.
3. Work on ONE task at a time. When you start one, set its \`status: In Progress\` and \`assignee: scrum-master\`.
4. When the task satisfies every acceptance criterion, set \`status: Review\` — a human reviews and moves it to \`Done\`.
5. Never skip or rewrite tasks. Update the file, don't create duplicates.
6. Prefer editing files directly over \`agentboard\` CLI/MCP when possible; the board UI reflects file changes instantly.
7. If \`.agentboard/brand.md\` exists and is configured, follow the brand guidelines when writing code, copy or UI.
8. \`.agentboard/agents/\` holds specialized agent profiles (developer, designer, tester, …), mirrored to \`.claude/agents/\` as real Claude Code subagents with their skills preloaded. A task assigned to one of them is done by that subagent — its prompt is also injected into the task spec. To run a sprint, ask \`sprint_dispatch\` (or \`agentboard dispatch\`) which subagent takes which task and what can run in parallel.
9. Work in Review passes a review gate first: \`code-reviewer\` (or \`ui-reviewer\` for UI work) records a verdict with \`task_review\`. \`changes\` sends the task back to In Progress with findings; \`approve\` leaves it for the human.
`

const BRAND_TEMPLATE = `---
name: ""
tagline: ""
mission: ""
tone: ""
logo: ""
colors:
  primary: ""
  secondary: ""
  accent: ""
  background: ""
  text: ""
fonts:
  heading: ""
  body: ""
assets: []
---

<!--
HOW TO USE THIS FILE (these comments are never injected into task specs).

Your company/brand kit. Frontmatter is structured data (identity, colors,
fonts, design files); the markdown body below is free-form brand rules.
These rules are appended to every task spec so AI agents follow your brand
when they work in this project.

Fill the frontmatter fields above and write real guidelines below, for example:
- Use the primary color for primary buttons.
- Address users with a friendly, informal tone.
- Keep UI copy short and imperative.
-->
`

export class ProjectStore extends EventEmitter {
  readonly rootDir: string
  readonly boardDir: string
  private config: ProjectConfigType
  private brand: BrandType = emptyBrand()
  private tasks = new Map<string, TaskType>()
  private sprints = new Map<number, SprintType>()
  private taskMax = 0
  private warnings: string[] = []
  private agents: AgentProfileType[] = []
  /** Per task file: change stamp (inode + mtime + size) and the parsed id, or null when unparseable. */
  private fileStamps = new Map<string, { stamp: string; id: string | null; error?: string }>()

  private constructor(rootDir: string) {
    super()
    this.rootDir = path.resolve(rootDir)
    this.boardDir = path.join(this.rootDir, '.agentboard')
    this.config = { name: path.basename(this.rootDir), workflow: { statuses: [...DEFAULT_STATUSES] } }
  }

  /** Scaffold a brand new board in `rootDir` (idempotent). */
  static init(rootDir: string, opts: { name?: string; sample?: boolean } = {}): ProjectStore {
    const dir = path.resolve(rootDir)
    const store = new ProjectStore(dir)
    fs.mkdirSync(path.join(store.boardDir, 'tasks'), { recursive: true })
    fs.mkdirSync(path.join(store.boardDir, 'sprints'), { recursive: true })
    fs.mkdirSync(path.join(store.boardDir, 'templates'), { recursive: true })
    fs.mkdirSync(path.join(store.boardDir, 'agents'), { recursive: true })

    const fresh = !fs.existsSync(store.configPath())
    if (fresh) {
      store.config = { name: opts.name ?? path.basename(dir), workflow: { statuses: [...DEFAULT_STATUSES] } }
      store._writeConfig()
    } else {
      store._readConfig()
    }

    store._load()

    if (fresh && opts.sample !== false) {
      store._createSample()
      store.syncSubagents()
    }
    return store
  }

  /** Open an existing board (throws if `.agentboard/` is missing). */
  static open(rootDir: string): ProjectStore {
    const store = new ProjectStore(rootDir)
    if (!fs.existsSync(store.boardDir)) {
      throw new Error(`No AgentSprint board found at ${store.rootDir} (missing ${store.boardDir}). Run: agentboard init`)
    }
    store._readConfig()
    store._load()
    return store
  }

  private configPath(): string {
    return path.join(this.boardDir, 'config.yaml')
  }
  private brandPath(): string {
    return path.join(this.boardDir, 'brand.md')
  }
  private learningsPath(): string {
    return path.join(this.boardDir, 'learnings.md')
  }
  private journalPath(): string {
    return path.join(this.boardDir, 'journal.md')
  }
  private tasksDir(): string {
    return path.join(this.boardDir, 'tasks')
  }
  private sprintsDir(): string {
    return path.join(this.boardDir, 'sprints')
  }
  private templatesDir(): string {
    return path.join(this.boardDir, 'templates')
  }
  private agentsDir(): string {
    return path.join(this.boardDir, 'agents')
  }
  private taskPath(id: string): string {
    return path.join(this.tasksDir(), `${id}.md`)
  }
  private sprintPath(id: number): string {
    return path.join(this.sprintsDir(), `sprint-${id}.md`)
  }

  // ── reads ────────────────────────────────────────────────────────────

  private _readConfig(): void {
    const raw = fs.readFileSync(this.configPath(), 'utf8')
    this.config = ProjectConfig.parse(parseFrontmatter(raw, ProjectConfig).data)
  }

  private _writeConfig(): void {
    fs.writeFileSync(this.configPath(), serializeFrontmatter({ ...this.config }, ''), 'utf8')
  }

  private _load(): void {
    this.tasks.clear()
    this.fileStamps.clear()
    this.taskMax = 0
    this.brand = this._readBrand()
    this.agents = readAgents(this.boardDir)
    this._syncTasks()
    this._syncSprints()
    this.emit('change')
  }

  /**
   * Bring the in-memory tasks in line with `.agentboard/tasks/`: only files
   * whose stamp changed are re-parsed and vanished files are dropped, so it is
   * cheap enough to run before every read. Returns true when anything changed.
   */
  private _syncTasks(): boolean {
    const dir = this.tasksDir()
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : []
    const present = new Set(files)
    let changed = false
    for (const [file, entry] of this.fileStamps) {
      if (present.has(file)) continue
      this.fileStamps.delete(file)
      if (entry.id) this.tasks.delete(entry.id)
      changed = true
    }
    for (const file of files) {
      const full = path.join(dir, file)
      const stamp = fileStamp(full)
      if (stamp == null) continue // vanished between readdir and stat
      const prev = this.fileStamps.get(file)
      if (prev?.stamp === stamp) continue
      changed = true
      if (prev?.id) this.tasks.delete(prev.id)
      const parsed = this._parseTaskFile(full)
      if ('error' in parsed) {
        this.fileStamps.set(file, { stamp, id: null, error: parsed.error })
        console.warn(`[agentboard] ${unparseableTaskWarning(file, parsed.error)}`)
        continue
      }
      const { task } = parsed
      this.fileStamps.set(file, { stamp, id: task.id })
      this.tasks.set(task.id, task)
      this._bumpTaskMax(task.id)
    }
    this.warnings = [...this.fileStamps]
      .filter(([, e]) => e.id == null)
      .map(([file, e]) => unparseableTaskWarning(file, e.error))
    return changed
  }

  /** Re-read every sprint file (there are few). Returns true when anything changed. */
  private _syncSprints(): boolean {
    const next = new Map<number, SprintType>()
    if (fs.existsSync(this.sprintsDir())) {
      for (const file of fs.readdirSync(this.sprintsDir())) {
        if (!file.endsWith('.md')) continue
        const sprint = this._parseSprintFile(path.join(this.sprintsDir(), file))
        if (sprint) next.set(sprint.id, sprint)
      }
    }
    const changed = JSON.stringify([...next]) !== JSON.stringify([...this.sprints])
    this.sprints = next
    return changed
  }

  private _parseTaskFile(file: string): { task: TaskType } | { error: string } {
    try {
      const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'), Task)
      const { description, acceptanceCriteria, notes, activity } = parseTaskBody(body)
      return { task: { ...data, description, acceptanceCriteria, notes, activity } }
    } catch (err) {
      return { error: describeParseError(err) }
    }
  }

  private _parseSprintFile(file: string): SprintType | null {
    try {
      const { data } = parseFrontmatter(fs.readFileSync(file, 'utf8'), Sprint)
      return data
    } catch {
      return null
    }
  }

  /**
   * Latest view of a task: re-parsed from disk when possible so mutations
   * started by another process (after this store was loaded) are picked up
   * instead of overwritten. Falls back to the in-memory copy.
   */
  private _freshTask(id: string): TaskType {
    const file = this.taskPath(id)
    if (!fs.existsSync(file)) {
      // Deleted by another process (or never persisted): the disk wins.
      this.tasks.delete(id)
      throw new Error(`Task not found: ${id}`)
    }
    const fresh = this._parseTaskFile(file)
    if ('task' in fresh) {
      this.tasks.set(id, fresh.task)
      this._bumpTaskMax(id)
      return fresh.task
    }
    const known = this.tasks.get(id)
    if (!known) throw new Error(`Task not found: ${id}`)
    return known
  }

  /** Like `_freshTask`, but undefined instead of throwing for unknown ids. */
  private _peekTask(id: string): TaskType | undefined {
    try {
      return this._freshTask(id)
    } catch {
      return undefined
    }
  }

  private _readBrand(): BrandType {
    try {
      if (!fs.existsSync(this.brandPath())) return emptyBrand()
      const { data, body } = parseFrontmatter(fs.readFileSync(this.brandPath(), 'utf8'), Brand)
      return { ...data, guidelines: body.replace(/<!--[\s\S]*?-->/g, '').trim() }
    } catch {
      return emptyBrand()
    }
  }

  private _writeBrand(): void {
    const { guidelines, ...data } = this.brand
    fs.writeFileSync(this.brandPath(), serializeFrontmatter(data, guidelines), 'utf8')
  }

  /** Re-scan the board from disk (used by the file watcher). */
  syncFromDisk(): void {
    this._load()
  }

  /**
   * Cheap incremental re-sync with the files on disk, for processes without
   * a file watcher (the stdio MCP server): picks up tasks, sprints and brand
   * edits made by other processes or by hand. Emits `change` only when needed.
   */
  refresh(): void {
    const tasksChanged = this._syncTasks()
    const sprintsChanged = this._syncSprints()
    const brand = this._readBrand()
    const brandChanged = JSON.stringify({ ...brand, updatedAt: '' }) !== JSON.stringify({ ...this.brand, updatedAt: '' })
    if (brandChanged) this.brand = brand
    const agentsChanged = this._syncAgents()
    if (tasksChanged || sprintsChanged || brandChanged || agentsChanged) this.emit('change')
  }

  get lastWarnings(): readonly string[] {
    return this.warnings
  }

  get state(): ProjectState {
    const active = [...this.sprints.values()].find((s) => s.status === 'active') ?? null
    return {
      rootDir: this.rootDir,
      config: this.config,
      brand: this.brand,
      tasks: [...this.tasks.values()].sort((a, b) => a.id.localeCompare(b.id)),
      sprints: [...this.sprints.values()].sort((a, b) => a.id - b.id),
      activeSprint: active,
      agents: this.agents,
    }
  }

  getConfig(): ProjectConfigType {
    return this.config
  }

  getBrand(): BrandType {
    return this.brand
  }

  updateBrand(patch: BrandPatch): BrandType {
    const next = Brand.parse({ ...this.brand, ...patch, updatedAt: nowIso() })
    this.brand = next
    this._writeBrand()
    this.emit('change')
    return this.brand
  }

  /** Read learnings/retrospectives from `.agentboard/learnings.md` (empty string if missing). */
  getLearnings(): string {
    try {
      if (!fs.existsSync(this.learningsPath())) return ''
      return fs.readFileSync(this.learningsPath(), 'utf8').trim()
    } catch {
      return ''
    }
  }

  /** Overwrite the entire learnings file. */
  setLearnings(content: string): string {
    withFileLock(this.learningsPath(), () => this._writeLearnings(content))
    return content
  }

  /** Write learnings content. Caller must hold the file lock. */
  private _writeLearnings(content: string): void {
    this._atomicWrite(this.learningsPath(), content)
    this.emit('change')
  }

  /** Append a new learning entry (e.g. a retro bullet or rule learned). */
  appendLearning(entry: string): string {
    // Read-modify-write under the file lock so concurrent processes never
    // lose each other's entries.
    return withFileLock(this.learningsPath(), () => {
      const existing = this.getLearnings()
      const trimmed = entry.trim()
      const next = existing ? `${existing}\n- ${trimmed}` : `- ${trimmed}`
      this._writeLearnings(next)
      return next
    })
  }

  /**
   * Append a multi-line section (e.g. an automatic sprint retro) to the
   * learnings file, preceded by a `## header` line. Body headings are nested
   * two levels down (`#` → `###`, `##` → `####`) so the section stays a
   * single `##` block for readers that split the file on `## `.
   */
  appendLearningsSection(header: string, body: string): string {
    // Read-modify-write under the file lock (see appendLearning).
    return withFileLock(this.learningsPath(), () => {
      const existing = this.getLearnings()
      const section = `## ${header.trim()}\n\n${body.trim().replace(/^#{1,4} /gm, '##$&')}`
      const next = existing ? `${existing}\n\n${section}` : section
      this._writeLearnings(next)
      return next
    })
  }

  // ── session journal & context ───────────────────────────────────────

  /** Session handoffs from `.agentboard/journal.md`, oldest first (empty when missing). */
  getJournal(): JournalEntry[] {
    try {
      return parseJournal(fs.readFileSync(this.journalPath(), 'utf8'))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
  }

  /**
   * Append a session handoff to the journal (append-only, so concurrent
   * sessions and git merges never lose an entry). Returns the stored entry.
   */
  appendJournal(input: { author?: string; summary?: string; done?: string[]; next?: string[]; blockers?: string[] }): JournalEntry {
    const entry: JournalEntry = {
      at: nowIso(),
      author: (input.author ?? 'agent').trim().replace(/\s+/g, ' ') || 'agent',
      summary: (input.summary ?? '').trim().replace(/\n+/g, ' '),
      done: (input.done ?? []).map((i) => i.trim().replace(/\n+/g, ' ')).filter(Boolean),
      next: (input.next ?? []).map((i) => i.trim().replace(/\n+/g, ' ')).filter(Boolean),
      blockers: (input.blockers ?? []).map((i) => i.trim().replace(/\n+/g, ' ')).filter(Boolean),
    }
    if (!entry.summary && entry.done.length + entry.next.length + entry.blockers.length === 0) {
      throw new Error('A handoff needs a summary or at least one done / next / blockers item')
    }
    withFileLock(this.journalPath(), () => {
      let existing = ''
      try {
        existing = fs.readFileSync(this.journalPath(), 'utf8')
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      const base = existing.trim() ? existing.trimEnd() + '\n\n' : JOURNAL_HEADER + '\n'
      this._atomicWrite(this.journalPath(), base + formatJournalEntry(entry))
    })
    this.emit('change')
    return entry
  }

  /** The session-start brief (see `buildProjectContext`). */
  buildContext(opts: { now?: Date; limit?: number } = {}): string {
    const state = this.state
    return buildProjectContext(
      {
        projectName: this.config.name,
        tasks: state.tasks,
        activeSprint: state.activeSprint,
        journal: this.getJournal(),
        learnings: this.getLearnings(),
      },
      opts,
    )
  }

  /**
   * Build the automatic retro summary for a sprint: report plus blockers found.
   * Used when a sprint is closed (see `setSprintStatus`).
   */
  buildSprintRetro(id: number): string {
    const sprint = this._requireSprint(id)
    const report = buildSprintReport(sprint, this.state.tasks, this.config.workflow.statuses)
    const blocked = this.state.tasks.filter((t) => t.sprint === id && t.status !== 'Done' && t.dependencies.some((d) => {
      const dep = this.tasks.get(d)
      return !dep || dep.status !== 'Done'
    }))
    if (blocked.length === 0) return report
    return `${report}\n\n## Blockers found\n${blocked.map((t) => `- ${t.id} (${t.status}) blocked by ${this.getBlockers(t.id).join(', ')}`).join('\n')}\n`
  }

  updateConfig(patch: Partial<ProjectConfigType>): ProjectConfigType {
    const next = ProjectConfig.parse({ ...this.config, ...patch })
    this.config = next
    this._writeConfig()
    this.emit('change')
    return this.config
  }

  private _bumpTaskMax(id: string): void {
    const n = Number(id.split('-')[1])
    if (Number.isFinite(n) && n > this.taskMax) this.taskMax = n
  }

  /** Next free id. Caller must hold the id lock: it also scans the disk for ids taken by other processes. */
  private _nextTaskId(): string {
    if (fs.existsSync(this.tasksDir())) {
      for (const file of fs.readdirSync(this.tasksDir())) {
        const m = /^[A-Z]{2}-(\d+)\.md$/.exec(file)
        if (m) this._bumpTaskMax(`TK-${m[1]}`)
      }
    }
    this.taskMax += 1
    return `TK-${this.taskMax}`
  }

  /** Board-wide lock serializing id allocation + file creation across processes. */
  private idLockPath(): string {
    return path.join(this.boardDir, 'task-ids')
  }

  private _nextSprintId(): number {
    const ids = [...this.sprints.keys()]
    return ids.length === 0 ? 1 : Math.max(...ids) + 1
  }

  // ── templates ────────────────────────────────────────────────────────

  /** List every reusable task template in `.agentboard/templates/`. */
  listTemplates(): TaskTemplate[] {
    return readTemplates(this.boardDir)
  }

  /** Get a single template by name (filename without `.md`). */
  getTemplate(name: string): TaskTemplate | null {
    // Security: reject anything that could escape `<boardDir>/templates/`
    // (path separators, `..`, absolute paths) before touching the filesystem.
    if (!isValidTemplateName(name)) {
      throw new Error(`Invalid template name: "${name}" (allowed: letters, digits, dot, underscore, dash; no ".." or path separators)`)
    }
    const file = path.join(this.templatesDir(), `${name}.md`)
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    try {
      return parseTemplate(raw, name)
    } catch (err) {
      throw new Error(`Template "${name}" has invalid frontmatter: ${(err as Error).message}`)
    }
  }

  /**
   * Create a task from a template, rendering `{{var}}` placeholders with
   * `vars` and applying `overrides` on top of the template defaults.
   */
  createTaskFromTemplate(
    name: string,
    opts: { vars?: TemplateVars; overrides?: Partial<TaskInput>; actor?: string } = {},
  ): TaskType {
    const template = this.getTemplate(name)
    if (!template) throw new Error(`Template not found: ${name} (looked in ${this.templatesDir()})`)
    const rendered = renderTemplate(template, opts.vars ?? {})
    // An empty title override (e.g. the UI sending `title: ''` alongside a
    // template) must not clobber the rendered template title.
    const overrides: Partial<TaskInput> = { ...opts.overrides }
    if (typeof overrides.title === 'string' && overrides.title.trim() === '') {
      delete overrides.title
    }
    return this.createTask(
      {
        title: rendered.title?.trim() || 'Untitled task',
        priority: rendered.priority,
        assignee: rendered.assignee,
        estimate: rendered.estimate,
        tags: rendered.tags,
        acceptanceCriteria: rendered.acceptanceCriteria,
        description: rendered.description,
        ...overrides,
      },
      { actor: opts.actor },
    )
  }

  // ── agents ───────────────────────────────────────────────────────────

  /** Every specialized agent profile in `.agentboard/agents/` (sorted by name). */
  listAgents(): AgentProfileType[] {
    return this.agents
  }

  /**
   * Get a single agent profile by name (filename without `.md`), or null.
   * Reads the file so a broken profile surfaces its parse error.
   */
  getAgent(name: string): AgentProfileType | null {
    const file = this._agentPath(name)
    let raw: string
    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw err
    }
    try {
      return parseAgent(raw, name)
    } catch (err) {
      throw new Error(`Agent "${name}" has invalid frontmatter: ${(err as Error).message}`)
    }
  }

  /**
   * Create or replace a specialized agent profile, then refresh the
   * generated Claude Code subagents. Omitted optional fields keep their
   * current value when the agent already exists.
   */
  saveAgent(input: { name: string; description?: string; prompt?: string } & Partial<Pick<AgentProfileType, 'color' | 'tags' | 'tools' | 'disallowedTools' | 'skills' | 'model'>>): AgentProfileType {
    const file = this._agentPath(input.name)
    const current = this.agents.find((a) => a.name === input.name)
    const merged = Object.fromEntries(Object.entries({ ...current, ...input }).filter(([, v]) => v !== undefined))
    const agent = AgentProfile.parse(merged)
    if (!agent.prompt.trim()) throw new Error('Agent prompt is required: describe the role, its mission and its rules')
    fs.mkdirSync(this.agentsDir(), { recursive: true })
    this._atomicWrite(file, serializeAgent(agent))
    this._syncAgents()
    this.syncSubagents()
    this.emit('change')
    return this.agents.find((a) => a.name === agent.name) ?? agent
  }

  /** Delete an agent profile (and its generated subagent). Tasks keep their assignee. */
  deleteAgent(name: string): void {
    const file = this._agentPath(name)
    if (!fs.existsSync(file)) throw new Error(`Agent not found: ${name}`)
    fs.unlinkSync(file)
    this._syncAgents()
    this.syncSubagents()
    this.emit('change')
  }

  /**
   * Mirror the agent profiles into `.claude/agents/` so Claude Code can
   * launch them as real subagents. No-op (returns null) when the project
   * opted out with `subagents: false` in config.yaml.
   */
  syncSubagents(): SubagentSyncResult | null {
    if (this.config.subagents === false) return null
    return syncClaudeSubagents(this.rootDir, this.agents, this.config.name)
  }

  /**
   * Write the default specialized agents that are missing from
   * `.agentboard/agents/` (never overwrites an existing profile). Returns the
   * names that were added; call syncSubagents() to mirror them.
   */
  installDefaultAgents(): string[] {
    fs.mkdirSync(this.agentsDir(), { recursive: true })
    const added: string[] = []
    for (const [file, content] of Object.entries(SAMPLE_AGENTS)) {
      const target = path.join(this.agentsDir(), file)
      if (fs.existsSync(target)) continue
      fs.writeFileSync(target, content, 'utf8')
      added.push(file.replace(/\.md$/, ''))
    }
    if (added.length > 0 && this._syncAgents()) this.emit('change')
    return added
  }

  private _agentPath(name: string): string {
    // Security: reject anything that could escape `<boardDir>/agents/`
    // (path separators, `..`, absolute paths) before touching the filesystem.
    if (!isValidAgentName(name)) {
      throw new Error(`Invalid agent name: "${name}" (allowed: lowercase letters, digits and dashes; must start with a letter)`)
    }
    return path.join(this.agentsDir(), `${name}.md`)
  }

  /** Re-read agent profiles; returns true when they changed. */
  private _syncAgents(): boolean {
    const next = readAgents(this.boardDir)
    if (JSON.stringify(next) === JSON.stringify(this.agents)) return false
    this.agents = next
    return true
  }

  /**
   * Resolve the specialized agent profile matching a task's assignee.
   * Returns null for workflow roles (scrum-master, dev, …) and for names
   * with no `.agentboard/agents/<name>.md` file.
   */
  agentForTask(task: Pick<TaskType, 'assignee'>): AgentProfile | null {
    if (isWorkflowAssignee(task.assignee)) return null
    return this.getAgent(task.assignee)
  }

  // ── task mutations ───────────────────────────────────────────────────

  setTaskStatus(id: string, status: TaskStatus, opts: { actor?: string } = {}): TaskType {
    return this.updateTask(id, { status }, opts)
  }

  appendTaskNote(id: string, note: string, author?: string): TaskType {
    // The note is merged with the on-disk notes inside the file lock so
    // concurrent processes appending notes never lose each other's entries.
    return withFileLock(this.taskPath(id), () => {
      const task = this._freshTask(id)
      const timestamp = nowIso()
      const who = author === undefined ? undefined : oneLine(author)
      const prefix = who ? `[${timestamp}] (${who})` : `[${timestamp}]`
      const entry = `- ${prefix} ${note.trim()}`
      const updatedNotes = task.notes && task.notes.trim() ? `${task.notes.trim()}\n${entry}` : entry
      return this._updateTaskUnlocked(
        id,
        { notes: updatedNotes },
        { actor: who ?? 'user', noteEvent: note.trim() },
      )
    })
  }

  /**
   * Record a review-gate verdict on a task in Review. The verdict, summary
   * and findings become a note plus a `review` activity event; `changes`
   * moves the task back to In Progress so its implementer picks it up again,
   * `approve` leaves it in Review for the human who moves it to Done.
   */
  reviewTask(
    id: string,
    input: { reviewer: string; verdict: ReviewVerdict; summary?: string; findings?: string[] },
  ): TaskType {
    return withFileLock(this.taskPath(id), () => {
      const task = this._freshTask(id)
      if (task.status !== 'Review') {
        throw new Error(`Task ${id} is "${task.status}", not "Review" — only work handed over for review can get a verdict`)
      }
      const findings = (input.findings ?? []).map((f) => f.trim().replace(/\n+/g, ' ')).filter(Boolean)
      if (input.verdict === 'changes' && findings.length === 0) {
        throw new Error('A "changes" verdict needs at least one finding the implementer can act on')
      }
      const label = input.verdict === 'approve' ? 'approved' : 'changes requested'
      const summary = (input.summary ?? '').trim().replace(/\n+/g, ' ')
      const reviewer = oneLine(input.reviewer)
      const head = `- [${nowIso()}] (${reviewer}) **Review: ${label}**${summary ? ` — ${summary}` : ''}`
      const entry = [head, ...findings.map((f) => `  - ${f}`)].join('\n')
      const notes = task.notes.trim() ? `${task.notes.trim()}\n${entry}` : entry
      return this._updateTaskUnlocked(
        id,
        { notes, ...(input.verdict === 'changes' ? { status: 'In Progress' as TaskStatus } : {}) },
        { actor: reviewer, reviewEvent: `${label}${findings.length ? ` (${findings.length} finding${findings.length === 1 ? '' : 's'})` : ''}` },
      )
    })
  }

  /**
   * Determine if a task is blocked by any incomplete dependencies.
   * A task is blocked when at least one of its `dependencies` is not in `Done` status.
   */
  isTaskBlocked(id: string): boolean {
    return this.getBlockers(id).length > 0
  }

  /**
   * Return the list of dependency IDs that are currently blocking the task.
   * Reads the task and its dependencies from disk, so a dependency finished
   * by another process unblocks it immediately.
   */
  getBlockers(id: string): string[] {
    const task = this._freshTask(id)
    return task.dependencies.filter((depId) => {
      const dep = this._peekTask(depId)
      return !dep || dep.status !== 'Done'
    })
  }

  /**
   * Detect cycles in the task dependency graph.
   * Returns an array of cycles, each cycle is an array of task IDs.
   * If any cycle exists, callers should throw an error.
   */
  detectCycles(): string[][] {
    const visited = new Set<string>()
    const stack = new Set<string>()
    const cycles: string[][] = []

    const dfs = (id: string, path: string[]) => {
      if (stack.has(id)) {
        const cycleStart = path.indexOf(id)
        cycles.push(path.slice(cycleStart))
        return
      }
      if (visited.has(id)) return
      visited.add(id)
      stack.add(id)
      const task = this.tasks.get(id)
      if (task) {
        for (const dep of task.dependencies) {
          dfs(dep, [...path, dep])
        }
      }
      stack.delete(id)
    }

    for (const id of this.tasks.keys()) {
      if (!visited.has(id)) dfs(id, [id])
    }
    return cycles
  }

  // Extend createTask to validate cycles after insertion and record the `created` activity event
  createTask(input: TaskInput, opts: { actor?: string } = {}): TaskType {
    // Validate the title before touching Zod so HTTP callers get a clean
    // error message instead of a raw TypeError from `.trim()`.
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    if (!title) throw new Error('Task title is required')
    const sprint = input.sprint == null ? null : this._requireSprint(input.sprint)
    // Allocate the id and write the file under a board-wide lock, so two
    // processes creating tasks at once never pick (and overwrite) the same id.
    return withFileLock(this.idLockPath(), () => this._createTaskUnlocked(input, title, sprint, opts))
  }

  /**
   * Create several tasks in one call — the shape a planner produces when it
   * breaks an idea into work. Each item may carry a `ref` (any label unique
   * in the batch) and list `dependsOn` refs or existing task ids; refs are
   * resolved to the generated ids. Everything is validated before the first
   * write, and tasks are created dependencies-first.
   */
  createTaskBatch(
    items: Array<TaskInput & { ref?: string; dependsOn?: string[] }>,
    opts: { actor?: string } = {},
  ): TaskType[] {
    if (items.length === 0) throw new Error('Batch is empty: pass at least one task')
    const refIndex = new Map<string, number>()
    items.forEach((item, i) => {
      const where = `item ${i + 1}${item.ref ? ` ("${item.ref}")` : ''}`
      if (typeof item.title !== 'string' || !item.title.trim()) throw new Error(`Task title is required (${where})`)
      if (item.sprint != null) this._requireSprint(item.sprint)
      if (item.ref === undefined) return
      if (refIndex.has(item.ref)) throw new Error(`Duplicate ref "${item.ref}" in batch`)
      refIndex.set(item.ref, i)
    })
    items.forEach((item, i) => {
      for (const dep of item.dependsOn ?? []) {
        if (refIndex.has(dep) || this.tasks.has(dep)) continue
        throw new Error(`Unknown dependency "${dep}" in item ${i + 1}: not a ref in this batch nor an existing task id`)
      }
    })

    // Dependencies-first order (Kahn), stable with respect to the input order.
    const order: number[] = []
    const placed = new Set<number>()
    while (order.length < items.length) {
      const next = items.findIndex(
        (item, i) => !placed.has(i) && (item.dependsOn ?? []).every((d) => !refIndex.has(d) || placed.has(refIndex.get(d)!)),
      )
      if (next === -1) {
        const stuck = items.filter((_, i) => !placed.has(i)).map((it) => it.ref ?? it.title)
        throw new Error(`Dependency cycle in batch between: ${stuck.join(', ')}`)
      }
      placed.add(next)
      order.push(next)
    }

    const created = new Array<TaskType>(items.length)
    const idOfRef = new Map<string, string>()
    for (const i of order) {
      const { ref, dependsOn, ...input } = items[i]!
      const deps = [...(input.dependencies ?? []), ...(dependsOn ?? []).map((d) => idOfRef.get(d) ?? d)]
      const task = this.createTask({ ...input, dependencies: [...new Set(deps)] }, opts)
      if (ref !== undefined) idOfRef.set(ref, task.id)
      created[i] = task
    }
    return created
  }

  private _createTaskUnlocked(input: TaskInput, title: string, sprint: SprintType | null, opts: { actor?: string }): TaskType {
    if (input.id && fs.existsSync(this.taskPath(input.id))) {
      throw new Error(`Task already exists: ${input.id}`)
    }
    const id = input.id ?? this._nextTaskId()
    const createdAt = input.createdAt ?? nowIso()
    const effectiveStatus = (input.status ?? (DEFAULT_STATUSES[1] ?? 'To Do')) as TaskStatus
    const effectiveAssignee = (input.assignee ?? STATUS_ASSIGNEE_MAP[effectiveStatus] ?? 'scrum-master') as TaskInput['assignee']
    const task = Task.parse({
      ...input,
      title,
      id,
      sprint: sprint?.id ?? null,
      status: effectiveStatus,
      priority: input.priority ?? 'medium',
      assignee: effectiveAssignee,
      createdAt,
      updatedAt: nowIso(),
      activity: [
        {
          at: createdAt,
          actor: opts.actor ?? 'user',
          type: 'created',
          detail: `task created (${title})`,
        },
      ],
    })
    this._assertStatus(task.status)
    this.tasks.set(id, task)
    this._bumpTaskMax(id)
    // Check for cycles before persisting
    const cycles = this.detectCycles()
    if (cycles.length > 0) {
      // revert addition
      this.tasks.delete(id)
      throw new Error(`Dependency cycle detected: ${cycles.map((c) => c.join(' -> ')).join('; ')}`)
    }
    this._writeTask(task)
    this.emit('change')
    return task
  }

  // Extend updateTask to validate cycles after mutation and record diff-based activity events.
  // The whole read-modify-write cycle runs under the per-file lock (and re-reads
  // the task from disk) so concurrent processes updating the same task never
  // clobber each other's changes with a stale in-memory copy.
  // Auto-assign assignee according to STATUS_ASSIGNEE_MAP when status changes,
  // unless patch already contains an explicit assignee (preserves task_claim priority).
  updateTask(id: string, patch: Partial<Omit<TaskInput, 'id'>>, opts: { actor?: string; noteEvent?: string; reviewEvent?: string } = {}): TaskType {
    return withFileLock(this.taskPath(id), () => this._updateTaskUnlocked(id, patch, opts))
  }

  /** Update a task without acquiring the file lock. Caller must hold it. */
  private _updateTaskUnlocked(id: string, patch: Partial<Omit<TaskInput, 'id'>>, opts: { actor?: string; noteEvent?: string; reviewEvent?: string } = {}): TaskType {
    const current = this._freshTask(id)
    if (!current) throw new Error(`Task not found: ${id}`)
    // Auto-map assignee before persist — distinguish generic status change from explicit assignee (task_claim).
    // A task assigned to a specialized agent (designer, tester, …) keeps that
    // assignee across status changes; only workflow roles follow the map.
    // Echoing the current assignee (the web task modal sends every field) is
    // not an explicit choice, so it does not block the mapping.
    if (
      patch.status !== undefined &&
      patch.status !== current.status &&
      (patch.assignee === undefined || patch.assignee === current.assignee) &&
      isWorkflowAssignee(current.assignee)
    ) {
      const mapped = STATUS_ASSIGNEE_MAP[patch.status as TaskStatus]
      if (mapped) patch = { ...patch, assignee: mapped }
    }
    const now = nowIso()
    const actor = opts.actor ?? 'user'
    const next = Task.parse({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: now,
    })
    if (next.sprint != null) this._requireSprint(next.sprint)
    this._assertStatus(next.status)
    next.activity = [...current.activity, ...diffActivityEvents(current, next, patch, { actor, noteEvent: opts.noteEvent, reviewEvent: opts.reviewEvent, at: now })]
    this.tasks.set(id, next)
    // Check for cycles after update
    const cycles = this.detectCycles()
    if (cycles.length > 0) {
      // revert to previous state
      this.tasks.set(id, current)
      throw new Error(`Dependency cycle detected: ${cycles.map((c) => c.join(' -> ')).join('; ')}`)
    }
    this._writeTask(next)
    this.emit('change')
    return next
  }
/**
 * Update task checklist items.
 * Accepts either an index (0‑based) or a text substring to locate the criterion.
 * If `completed` is true, the item is marked with `[x] `; unchecked items are stored
 * as bare text (no prefix), matching the `parseTaskBody` / `buildTaskBody` format.
 */
  setTaskChecklist(
    id: string,
    { index, text, completed }: { index?: number; text?: string; completed?: boolean },
    opts: { actor?: string } = {},
  ): TaskType {
    // Read-modify-write under the file lock against the on-disk criteria:
    // toggling from a stale copy would write back an outdated list.
    return withFileLock(this.taskPath(id), () => {
      const task = this._freshTask(id)
      const criteria = this._toggleCriterion(task, { index, text, completed })
      return this._updateTaskUnlocked(id, { acceptanceCriteria: criteria }, opts)
    })
  }

  private _toggleCriterion(
    task: TaskType,
    { index, text, completed }: { index?: number; text?: string; completed?: boolean },
  ): string[] {
    const id = task.id
    const criteria = [...task.acceptanceCriteria]
    let targetIdx = -1
    if (typeof index === 'number') {
      targetIdx = index
    } else if (text) {
      targetIdx = criteria.findIndex((c) => c.includes(text))
    }
    if (targetIdx < 0 || targetIdx >= criteria.length) {
      throw new Error(`Acceptance criterion not found for task ${id}`)
    }
    const raw = criteria[targetIdx]!.replace(/^\s*-?\s*\[[ xX]?\]\s*/, '').trim()
    const mark = completed ? '[x] ' : ''
    criteria[targetIdx] = `${mark}${raw}`
    return criteria
  }

  /**
   * Delete a task permanently.
   */
  deleteTask(id: string): void {
    withFileLock(this.taskPath(id), () => {
      this._freshTask(id) // throws when it no longer exists on disk
      this.tasks.delete(id)
      this.fileStamps.delete(`${id}.md`)
      fs.rmSync(this.taskPath(id), { force: true })
    })
    this.emit('change')
  }

  // ── exclusive locks (multi-agent coordination) ──────────────────────

  /** Active lock for a task, or null when unlocked or stale (past TTL). */
  getLock(id: string): TaskLockInfo | null {
    return getTaskLock(this._freshTask(id))
  }

  /**
   * Acquire or heartbeat the exclusive lock on a task for `agent`.
   * Fails when another agent holds an active lock. Re-claiming your own
   * lock refreshes `lockedAt` (acts as a heartbeat). The check and the write
   * happen inside the per-file lock against the on-disk state, so an agent in
   * another process can never take a lock that is already held.
   */
  lockTask(id: string, agent = 'agent'): TaskType {
    return withFileLock(this.taskPath(id), () => {
      const active = getTaskLock(this._freshTask(id))
      if (active && active.lockedBy !== agent) {
        throw new Error(
          `Task ${id} is locked by "${active.lockedBy}" since ${active.lockedAt}. Use task_release or wait for expiry (${TASK_LOCK_TTL_MINUTES}m).`,
        )
      }
      return this._updateTaskUnlocked(id, { lockedBy: agent, lockedAt: nowIso() }, { actor: agent })
    })
  }

  /**
   * Release the lock on a task. Pass `agent` to verify ownership;
   * omit it (or pass force: true) to force-release a stale/foreign lock.
   */
  unlockTask(id: string, opts: { agent?: string; force?: boolean } = {}): TaskType {
    return withFileLock(this.taskPath(id), () => {
      const task = this._freshTask(id)
      if (!task.lockedBy && !task.lockedAt) return task
      if (!opts.force && opts.agent != null) {
        const active = getTaskLock(task)
        if (active && active.lockedBy !== opts.agent) {
          throw new Error(`Task ${id} is locked by "${active.lockedBy}", not by "${opts.agent}".`)
        }
      }
      return this._updateTaskUnlocked(id, { lockedBy: null, lockedAt: null }, { actor: opts.agent ?? 'user' })
    })
  }

  // ── sprint mutations ─────────────────────────────────────────────────

  createSprint(goal: string): SprintType {
    const sprint: SprintType = {
      id: this._nextSprintId(),
      goal,
      status: 'planned',
      startedAt: null,
      endedAt: null,
    }
    this.sprints.set(sprint.id, sprint)
    this._writeSprint(sprint)
    this.emit('change')
    return sprint
  }

  updateSprint(id: number, patch: Partial<Pick<SprintType, 'goal' | 'status'>>): SprintType {
    const sprint = this._requireSprint(id)
    const updated: SprintType = { ...sprint, ...patch }
    if (patch.status === 'active') updated.startedAt = updated.startedAt ?? nowIso()
    if (patch.status === 'closed') updated.endedAt = nowIso()
    this.sprints.set(id, updated)
    this._writeSprint(updated)
    this.emit('change')
    return updated
  }

  /**
   * Change sprint status. When closing a sprint (and `opts.retro !== false`),
   * an automatic retrospective is appended to `.agentboard/learnings.md`.
   */
  setSprintStatus(id: number, status: SprintStatus, opts: { retro?: boolean } = {}): SprintType {
    const sprint = this._requireSprint(id)
    const updated: SprintType = { ...sprint, status }
    if (status === 'active') {
      for (const other of this.sprints.values()) {
        if (other.id !== id && other.status === 'active') {
          this.sprints.set(other.id, { ...other, status: 'planned', startedAt: null })
          this._writeSprint(this.sprints.get(other.id)!)
        }
      }
      updated.startedAt = updated.startedAt ?? nowIso()
    } else if (status === 'closed') {
      updated.endedAt = nowIso()
    }
    this.sprints.set(id, updated)
    this._writeSprint(updated)
    const closing = sprint.status !== 'closed' && status === 'closed'
    if (closing && opts.retro !== false) {
      this.appendLearningsSection(
        `Sprint ${id} retro — ${nowIso().slice(0, 10)}`,
        this.buildSprintRetro(id),
      )
    }
    this.emit('change')
    return updated
  }

  // ── writes ───────────────────────────────────────────────────────────

  private _writeTask(task: TaskType): void {
    const data: Record<string, unknown> = { ...task }
    delete data.description
    delete data.acceptanceCriteria
    delete data.notes
    delete data.activity
    // Lock fields are omitted from frontmatter entirely when unlocked
    if (data.lockedBy == null) delete data.lockedBy
    if (data.lockedAt == null) delete data.lockedAt
    const body = buildTaskBody(task.description, task.acceptanceCriteria, task.notes, task.activity)
    this._atomicWrite(this.taskPath(task.id), serializeFrontmatter(data, body))
    // Our own write is already in memory: record its stamp so the next
    // refresh() does not re-parse it.
    const stamp = fileStamp(this.taskPath(task.id))
    if (stamp) this.fileStamps.set(`${task.id}.md`, { stamp, id: task.id })
  }

  private _writeSprint(sprint: SprintType): void {
    this._atomicWrite(this.sprintPath(sprint.id), serializeFrontmatter({ ...sprint }, ''))
  }

  /**
   * Write `content` to `file` atomically: the payload goes to a unique
   * temporary file (pid + random suffix so concurrent processes never share
   * one) which is then renamed over the target. The temp file is removed on
   * failure, even if the write or rename throws.
   */
  private _atomicWrite(file: string, content: string): void {
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

  private _requireSprint(id: number): SprintType {
    const sprint = this.sprints.get(id)
    if (!sprint) throw new Error(`Sprint not found: ${id}`)
    return sprint
  }

  private _assertStatus(status: string): void {
    if (!this.config.workflow.statuses.includes(status)) {
      throw new Error(`Unknown status "${status}". Valid: ${this.config.workflow.statuses.join(', ')}`)
    }
  }

  // ── sample content ───────────────────────────────────────────────────

  private _createSample(): void {
    const agents = path.join(this.rootDir, 'AGENTS.md')
    if (!fs.existsSync(agents)) fs.writeFileSync(agents, AGENTS_MD, 'utf8')

    if (!fs.existsSync(this.brandPath())) {
      fs.writeFileSync(this.brandPath(), BRAND_TEMPLATE, 'utf8')
    }

    fs.mkdirSync(this.templatesDir(), { recursive: true })
    for (const [file, content] of Object.entries(SAMPLE_TEMPLATES)) {
      const target = path.join(this.templatesDir(), file)
      if (!fs.existsSync(target)) fs.writeFileSync(target, content, 'utf8')
    }

    this.installDefaultAgents()

    const sprint = this.createSprint('Kickoff — learn the board')
    const now = nowIso()
    this.createTask({
      id: 'TK-1',
      title: 'Write your first task spec',
      status: 'To Do',
      sprint: sprint.id,
      priority: 'high',
      assignee: 'scrum-master',
      estimate: 1,
      tags: ['getting-started'],
      dependencies: [],
      acceptanceCriteria: ['The task has a clear description', 'It has at least one acceptance criterion'],
      description: 'Every task lives in `.agentboard/tasks/` as Markdown with YAML frontmatter.',
      createdAt: now,
    })
    this.createTask({
      id: 'TK-2',
      title: 'Plan sprint goals',
      status: 'In Progress',
      sprint: sprint.id,
      priority: 'medium',
      assignee: 'scrum-master',
      estimate: 2,
      tags: ['planning'],
      dependencies: ['TK-1'],
      acceptanceCriteria: ['Sprint goal is defined', 'Tasks are assigned to the sprint'],
      description: 'Sprints are Markdown files in `.agentboard/sprints/`. Activate one and assign tasks.',
      createdAt: now,
    })
    this.createTask({
      id: 'TK-3',
      title: 'Ship something small',
      status: 'Backlog',
      sprint: null,
      priority: 'low',
      assignee: 'scrum-master',
      estimate: 3,
      tags: ['starter'],
      dependencies: [],
      acceptanceCriteria: ['Code compiles', 'Tests pass'],
      description: 'A tiny feature to practice the agent workflow end to end.',
      createdAt: now,
    })
  }
}

/** Change stamp of a file (a new inode on every atomic write), or null if it is gone. */
function fileStamp(file: string): string | null {
  try {
    const st = fs.statSync(file)
    return `${st.ino}:${st.mtimeMs}:${st.size}`
  } catch {
    return null
  }
}

function unparseableTaskWarning(file: string, reason = 'invalid frontmatter'): string {
  return `Task file not parseable (skipped): .agentboard/tasks/${file} — ${reason}`
}

/**
 * Say why a task file was rejected. A schema failure names the field: on a
 * hand-edited file it is a typo, but a file written by a newer AgentSprint
 * (a new assignee, status or field) fails the same way on an older server,
 * so the message says so instead of blaming the YAML.
 */
function describeParseError(err: unknown): string {
  if (err instanceof z.ZodError) {
    const issue = err.issues[0]
    const field = issue?.path.length ? issue.path.join('.') : 'frontmatter'
    return `field \`${field}\`: ${issue?.message ?? 'invalid value'}. If another AgentSprint wrote this file, this one may be older than it — upgrade or rebuild it.`
  }
  const first = ((err as Error)?.message ?? String(err)).split('\n')[0]
  return `YAML error: ${first}. Quote values that contain ": " — e.g. title: "Web: foo".`
}

/** Collapse a name to one line (as the journal does) so it cannot break note or activity lines. */
const oneLine = (name: string): string => name.trim().replace(/\s+/g, ' ')
const isCheckedCriterion = (c?: string): boolean => !!c && /^\[[xX]\]\s*/.test(c)
const criterionTextOf = (c?: string): string => (c ?? '').replace(/^\s*\[[xX]?\]\s*/, '').trim()

/** Checked-count per criterion text, so diffs match by content instead of position. */
function criteriaStats(criteria: string[]): Map<string, { total: number; checked: number }> {
  const stats = new Map<string, { total: number; checked: number }>()
  for (const c of criteria) {
    const key = criterionTextOf(c)
    const entry = stats.get(key) ?? { total: 0, checked: 0 }
    entry.total += 1
    if (isCheckedCriterion(c)) entry.checked += 1
    stats.set(key, entry)
  }
  return stats
}

/**
 * Compute the activity events produced by an update, comparing the previous
 * and next task states: status changes, assignee changes, checklist toggles,
 * appended notes and generic field updates.
 */
function diffActivityEvents(
  current: TaskType,
  next: TaskType,
  patch: Partial<Omit<TaskInput, 'id'>>,
  ctx: { actor: string; noteEvent?: string; reviewEvent?: string; at: string },
): ActivityEventType[] {
  const events: ActivityEventType[] = []
  if (patch.status != null && patch.status !== current.status) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'status', detail: `${current.status} → ${next.status}` })
  }
  if (patch.assignee != null && patch.assignee !== current.assignee) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'assignee', detail: `${current.assignee} → ${next.assignee}` })
  }
  // Checklist diff by criterion TEXT (not index): removing or reordering
  // criteria must not produce phantom checked/unchecked events. Criteria that
  // only exist on one side are additions/removals, covered by the
  // acceptanceCriteria update event below.
  const before = criteriaStats(current.acceptanceCriteria)
  const afterStats = criteriaStats(next.acceptanceCriteria)
  for (const [text, afterEntry] of afterStats) {
    const beforeEntry = before.get(text)
    if (!beforeEntry) continue // added criterion → update event, not a toggle
    if (beforeEntry.checked !== afterEntry.checked) {
      events.push({
        at: ctx.at,
        actor: ctx.actor,
        type: 'checklist',
        detail: `${afterEntry.checked > beforeEntry.checked ? 'checked' : 'unchecked'} "${text}"`,
      })
    }
  }
  if (ctx.noteEvent) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'note', detail: ctx.noteEvent })
  }
  if (ctx.reviewEvent) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'review', detail: ctx.reviewEvent })
  }
  const tracked = ['title', 'description', 'priority', 'sprint', 'estimate', 'tags', 'dependencies'] as const
  const changed: string[] = tracked.filter(
    (k) =>
      patch[k] !== undefined &&
      JSON.stringify(patch[k]) !== JSON.stringify((current as unknown as Record<string, unknown>)[k]),
  )
  // acceptanceCriteria: record add/remove/reorder as an update, but stay quiet
  // for pure check-state toggles (those already emit checklist events).
  if (
    patch.acceptanceCriteria !== undefined &&
    patch.acceptanceCriteria.map(criterionTextOf).join('\u0000') !==
      current.acceptanceCriteria.map(criterionTextOf).join('\u0000')
  ) {
    changed.push('acceptanceCriteria')
  }
  if (changed.length > 0) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'update', detail: `updated ${changed.join(', ')}` })
  }
  return events
}
