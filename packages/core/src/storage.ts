import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { buildTaskBody, parseFrontmatter, parseTaskBody, serializeFrontmatter } from './frontmatter.js'
import { nowIso, ProjectConfig, Sprint, Task, DEFAULT_STATUSES, Brand, emptyBrand } from './types.js'
import type { Brand as BrandType, BrandPatch, ProjectConfig as ProjectConfigType, ProjectState, Sprint as SprintType, SprintStatus, Task as TaskType, TaskInput, TaskStatus } from './types.js'

const AGENTS_MD = `# AgentSprint instructions

This project uses a git-native sprint board under \`.agentboard/\`.

## Workflow

1. **Read \`.agentboard/sprints/\`** to learn the active sprint before doing any work.
2. Tasks are single Markdown files in \`.agentboard/tasks/\`. Their status lives in the YAML frontmatter.
3. Work on ONE task at a time. When you start one, set its \`status: In Progress\` and \`assignee: agent\`.
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
  private tasksDir(): string {
    return path.join(this.boardDir, 'tasks')
  }
  private sprintsDir(): string {
    return path.join(this.boardDir, 'sprints')
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
      const { description, acceptanceCriteria } = parseTaskBody(body)
      return { ...data, description, acceptanceCriteria }
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

  // ── task mutations ───────────────────────────────────────────────────

  createTask(input: TaskInput): TaskType {
    const sprint = input.sprint == null ? null : this._requireSprint(input.sprint)
    const id = input.id ?? this._nextTaskId()
    const task = Task.parse({
      ...input,
      id,
      sprint: sprint?.id ?? null,
      status: input.status ?? (DEFAULT_STATUSES[1] ?? 'To Do'),
      priority: input.priority ?? 'medium',
      assignee: input.assignee ?? 'human',
      createdAt: input.createdAt ?? nowIso(),
      updatedAt: nowIso(),
    })
    this._assertStatus(task.status)
    this.tasks.set(id, task)
    this._bumpTaskMax(id)
    this._writeTask(task)
    this.emit('change')
    return task
  }

  updateTask(id: string, patch: Partial<Omit<TaskInput, 'id'>>): TaskType {
    const current = this.tasks.get(id)
    if (!current) throw new Error(`Task not found: ${id}`)
    const next = Task.parse({
      ...current,
      ...patch,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: nowIso(),
    })
    if (next.sprint != null) this._requireSprint(next.sprint)
    this._assertStatus(next.status)
    this.tasks.set(id, next)
    this._writeTask(next)
    this.emit('change')
    return next
  }

  setTaskStatus(id: string, status: TaskStatus): TaskType {
    return this.updateTask(id, { status })
  }

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

  setSprintStatus(id: number, status: SprintStatus): SprintType {
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
    this.emit('change')
    return updated
  }

  // ── writes ───────────────────────────────────────────────────────────

  private _writeTask(task: TaskType): void {
    const data: Record<string, unknown> = { ...task }
    delete data.description
    delete data.acceptanceCriteria
    const body = buildTaskBody(task.description, task.acceptanceCriteria)
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

    const sprint = this.createSprint('Kickoff — learn the board')
    const now = nowIso()
    this.createTask({
      id: 'TK-1',
      title: 'Write your first task spec',
      status: 'To Do',
      sprint: sprint.id,
      priority: 'high',
      assignee: 'agent',
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
      assignee: 'human',
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
      assignee: 'agent',
      estimate: 3,
      tags: ['starter'],
      dependencies: [],
      acceptanceCriteria: ['Code compiles', 'Tests pass'],
      description: 'A tiny feature to practice the agent workflow end to end.',
      createdAt: now,
    })
  }
}
