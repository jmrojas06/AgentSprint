import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { buildTaskBody, parseFrontmatter, parseTaskBody, serializeFrontmatter } from './frontmatter.js'
import { nowIso, ProjectConfig, Sprint, Task, DEFAULT_STATUSES, Brand, emptyBrand, getTaskLock, TASK_LOCK_TTL_MINUTES } from './types.js'
import type { ActivityEvent as ActivityEventType, Brand as BrandType, BrandPatch, ProjectConfig as ProjectConfigType, ProjectState, Sprint as SprintType, SprintStatus, Task as TaskType, TaskInput, TaskLockInfo, TaskStatus } from './types.js'
import { buildSprintReport } from './spec.js'
import { SAMPLE_TEMPLATES, parseTemplate, readTemplates, renderTemplate } from './templates.js'
import type { TaskTemplate, TemplateVars } from './templates.js'

const AGENTS_MD = `# AgentSprint instructions

This project uses a git-native sprint board under \`.agentboard/\`.

## Workflow

1. **Read \`.agentboard/sprints/\`** to learn the active sprint before doing any work.
2. Tasks are single Markdown files in \`.agentboard/tasks/\`. Their status lives in the YAML frontmatter.
3. Work on ONE task at a time. When you start one, set its \`status: In Progress\` and \`assignee: scrum-master\`.
4. When the task satisfies every acceptance criterion, set \`status: Review\` — a human reviews and moves it to \`Done\`.
5. Never skip or rewrite tasks. Update the file, don't create duplicates.
6. Prefer editing files directly over \`agentboard\` CLI/MCP when possible; the board UI reflects file changes instantly.
7. If \`.agentboard/brand.md\` exists and is configured, follow the brand guidelines when writing code, copy or UI.
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
  private tasksDir(): string {
    return path.join(this.boardDir, 'tasks')
  }
  private sprintsDir(): string {
    return path.join(this.boardDir, 'sprints')
  }
  private templatesDir(): string {
    return path.join(this.boardDir, 'templates')
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
    this.sprints.clear()
    this.taskMax = 0
    this.warnings = []
    this.brand = this._readBrand()

    if (fs.existsSync(this.tasksDir())) {
      for (const file of fs.readdirSync(this.tasksDir())) {
        if (!file.endsWith('.md')) continue
        const task = this._parseTaskFile(path.join(this.tasksDir(), file))
        if (!task) {
          const warning = `Task file not parseable (skipped): .agentboard/tasks/${file}. Check the YAML frontmatter — e.g. quote titles containing ": " like  title: "Web: foo".`
          this.warnings.push(warning)
          console.warn(`[agentboard] ${warning}`)
          continue
        }
        this.tasks.set(task.id, task)
        this._bumpTaskMax(task.id)
      }
    }

    if (fs.existsSync(this.sprintsDir())) {
      for (const file of fs.readdirSync(this.sprintsDir())) {
        if (!file.endsWith('.md')) continue
        const sprint = this._parseSprintFile(path.join(this.sprintsDir(), file))
        if (sprint) this.sprints.set(sprint.id, sprint)
      }
    }

    this.emit('change')
  }

  private _parseTaskFile(file: string): TaskType | null {
    try {
      const { data, body } = parseFrontmatter(fs.readFileSync(file, 'utf8'), Task)
      const { description, acceptanceCriteria, notes, activity } = parseTaskBody(body)
      return { ...data, description, acceptanceCriteria, notes, activity }
    } catch {
      return null
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
    this._atomicWrite(this.learningsPath(), content)
    this.emit('change')
    return content
  }

  /** Append a new learning entry (e.g. a retro bullet or rule learned). */
  appendLearning(entry: string): string {
    const existing = this.getLearnings()
    const trimmed = entry.trim()
    const next = existing ? `${existing}\n- ${trimmed}` : `- ${trimmed}`
    return this.setLearnings(next)
  }

  /**
   * Append a multi-line section (e.g. an automatic sprint retro) to the
   * learnings file, preceded by a `## header` line.
   */
  appendLearningsSection(header: string, body: string): string {
    const existing = this.getLearnings()
    const section = `## ${header.trim()}\n\n${body.trim()}`
    const next = existing ? `${existing}\n\n${section}` : section
    return this.setLearnings(next)
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

  private _nextTaskId(): string {
    this.taskMax += 1
    return `TK-${this.taskMax}`
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
    const file = path.join(this.templatesDir(), `${name}.md`)
    if (!fs.existsSync(file)) return null
    try {
      return parseTemplate(fs.readFileSync(file, 'utf8'), name)
    } catch {
      return null
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
    return this.createTask(
      {
        title: rendered.title?.trim() || 'Untitled task',
        priority: rendered.priority,
        assignee: rendered.assignee,
        estimate: rendered.estimate,
        tags: rendered.tags,
        acceptanceCriteria: rendered.acceptanceCriteria,
        description: rendered.description,
        ...opts.overrides,
      },
      { actor: opts.actor },
    )
  }

  // ── task mutations ───────────────────────────────────────────────────

  setTaskStatus(id: string, status: TaskStatus, opts: { actor?: string } = {}): TaskType {
    return this.updateTask(id, { status }, opts)
  }

  appendTaskNote(id: string, note: string, author?: string): TaskType {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    const timestamp = nowIso()
    const prefix = author ? `[${timestamp}] (${author})` : `[${timestamp}]`
    const entry = `- ${prefix} ${note.trim()}`
    const updatedNotes = task.notes && task.notes.trim() ? `${task.notes.trim()}\n${entry}` : entry
    return this.updateTask(
      id,
      { notes: updatedNotes },
      { actor: author ?? 'user', noteEvent: note.trim() },
    )
  }

  /**
   * Determine if a task is blocked by any incomplete dependencies.
   * A task is blocked when at least one of its `dependencies` is not in `Done` status.
   */
  isTaskBlocked(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return task.dependencies.some((depId) => {
      const dep = this.tasks.get(depId)
      return !dep || dep.status !== 'Done'
    })
  }

  /**
   * Return the list of dependency IDs that are currently blocking the task.
   */
  getBlockers(id: string): string[] {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return task.dependencies.filter((depId) => {
      const dep = this.tasks.get(depId)
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
    const sprint = input.sprint == null ? null : this._requireSprint(input.sprint)
    const id = input.id ?? this._nextTaskId()
    const createdAt = input.createdAt ?? nowIso()
    const task = Task.parse({
      ...input,
      id,
      sprint: sprint?.id ?? null,
      status: input.status ?? (DEFAULT_STATUSES[1] ?? 'To Do'),
      priority: input.priority ?? 'medium',
      assignee: input.assignee ?? 'scrum-master',
      createdAt,
      updatedAt: nowIso(),
      activity: [
        {
          at: createdAt,
          actor: opts.actor ?? 'user',
          type: 'created',
          detail: `task created (${input.title.trim()})`,
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

  // Extend updateTask to validate cycles after mutation and record diff-based activity events
  updateTask(id: string, patch: Partial<Omit<TaskInput, 'id'>>, opts: { actor?: string; noteEvent?: string } = {}): TaskType {
    const current = this.tasks.get(id)
    if (!current) throw new Error(`Task not found: ${id}`)
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
    next.activity = [...current.activity, ...diffActivityEvents(current, next, patch, { actor, noteEvent: opts.noteEvent, at: now })]
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
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
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
    return this.updateTask(id, { acceptanceCriteria: criteria }, opts)
  }

/**
 * Delete a task permanently.
 */
deleteTask(id: string): void {
  if (!this.tasks.has(id)) throw new Error(`Task not found: ${id}`)
  this.tasks.delete(id)
  try {
    fs.rmSync(this.taskPath(id))
  } catch {
    /* already gone */
  }
  this.emit('change')
}

  // ── exclusive locks (multi-agent coordination) ──────────────────────

  /** Active lock for a task, or null when unlocked or stale (past TTL). */
  getLock(id: string): TaskLockInfo | null {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    return getTaskLock(task)
  }

  /**
   * Acquire or heartbeat the exclusive lock on a task for `agent`.
   * Fails when another agent holds an active lock. Re-claiming your own
   * lock refreshes `lockedAt` (acts as a heartbeat).
   */
  lockTask(id: string, agent = 'agent'): TaskType {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    const active = getTaskLock(task)
    if (active && active.lockedBy !== agent) {
      throw new Error(
        `Task ${id} is locked by "${active.lockedBy}" since ${active.lockedAt}. Use task_release or wait for expiry (${TASK_LOCK_TTL_MINUTES}m).`,
      )
    }
    return this.updateTask(id, { lockedBy: agent, lockedAt: nowIso() }, { actor: agent })
  }

  /**
   * Release the lock on a task. Pass `agent` to verify ownership;
   * omit it (or pass force: true) to force-release a stale/foreign lock.
   */
  unlockTask(id: string, opts: { agent?: string; force?: boolean } = {}): TaskType {
    const task = this.tasks.get(id)
    if (!task) throw new Error(`Task not found: ${id}`)
    if (!task.lockedBy && !task.lockedAt) return task
    if (!opts.force && opts.agent != null) {
      const active = getTaskLock(task)
      if (active && active.lockedBy !== opts.agent) {
        throw new Error(`Task ${id} is locked by "${active.lockedBy}", not by "${opts.agent}".`)
      }
    }
    return this.updateTask(id, { lockedBy: null, lockedAt: null }, { actor: opts.agent ?? 'user' })
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
  }

  private _writeSprint(sprint: SprintType): void {
    this._atomicWrite(this.sprintPath(sprint.id), serializeFrontmatter({ ...sprint }, ''))
  }

  private _atomicWrite(file: string, content: string): void {
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, content, 'utf8')
    fs.renameSync(tmp, file)
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

const isCheckedCriterion = (c?: string): boolean => !!c && /^\[[xX]\]\s*/.test(c)
const criterionTextOf = (c?: string): string => (c ?? '').replace(/^\s*\[[xX]?\]\s*/, '').trim()

/**
 * Compute the activity events produced by an update, comparing the previous
 * and next task states: status changes, assignee changes, checklist toggles,
 * appended notes and generic field updates.
 */
function diffActivityEvents(
  current: TaskType,
  next: TaskType,
  patch: Partial<Omit<TaskInput, 'id'>>,
  ctx: { actor: string; noteEvent?: string; at: string },
): ActivityEventType[] {
  const events: ActivityEventType[] = []
  if (patch.status != null && patch.status !== current.status) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'status', detail: `${current.status} → ${next.status}` })
  }
  if (patch.assignee != null && patch.assignee !== current.assignee) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'assignee', detail: `${current.assignee} → ${next.assignee}` })
  }
  const len = Math.max(current.acceptanceCriteria.length, next.acceptanceCriteria.length)
  for (let i = 0; i < len; i++) {
    const wasChecked = isCheckedCriterion(current.acceptanceCriteria[i])
    const isChecked = isCheckedCriterion(next.acceptanceCriteria[i])
    if (wasChecked !== isChecked) {
      events.push({
        at: ctx.at,
        actor: ctx.actor,
        type: 'checklist',
        detail: `${isChecked ? 'checked' : 'unchecked'} "${criterionTextOf(next.acceptanceCriteria[i])}"`,
      })
    }
  }
  if (ctx.noteEvent) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'note', detail: ctx.noteEvent })
  }
  const tracked = ['title', 'description', 'priority', 'sprint', 'estimate', 'tags', 'dependencies'] as const
  const changed = tracked.filter(
    (k) =>
      patch[k] !== undefined &&
      JSON.stringify(patch[k]) !== JSON.stringify((current as unknown as Record<string, unknown>)[k]),
  )
  if (changed.length > 0) {
    events.push({ at: ctx.at, actor: ctx.actor, type: 'update', detail: `updated ${changed.join(', ')}` })
  }
  return events
}
