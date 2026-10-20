import { z } from 'zod'

export const DEFAULT_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const

export const TaskStatus = z.enum(DEFAULT_STATUSES)
export type TaskStatus = z.infer<typeof TaskStatus>

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export const TaskPriority = z.enum(TASK_PRIORITIES)
export type TaskPriority = z.infer<typeof TaskPriority>

/** Team roles available for new assignment in the UI. */
export const ASSIGNEES = ['scrum-master', 'dev', 'review', 'perfect'] as const
export const Assignee = z.enum(ASSIGNEES)
export type Assignee = z.infer<typeof Assignee>

/**
 * Legacy assignee values ('human' | 'agent') found in boards created before
 * team roles existed. Kept valid so every existing task file still parses;
 * the UI only offers the role values above.
 */
export const LEGACY_ASSIGNEES = ['human', 'agent'] as const

/** Lowercase slug shared by team roles and specialized agent names (`designer`, `fixer`, …). */
export const ASSIGNEE_SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/

/**
 * Any valid assignee: a workflow role, a legacy value, or the name of a
 * specialized agent defined in `.agentboard/agents/<name>.md`.
 */
export const AssigneeAny = z
  .string()
  .regex(ASSIGNEE_SLUG_RE, 'Assignee must be a lowercase slug like "dev" or "designer"')
export type AssigneeAny = z.infer<typeof AssigneeAny>

/** True when the assignee is a workflow role (or legacy value) rather than a specialized agent. */
export function isWorkflowAssignee(value: string): boolean {
  return (
    (ASSIGNEES as readonly string[]).includes(value) ||
    (LEGACY_ASSIGNEES as readonly string[]).includes(value)
  )
}

/** Model a generated Claude Code subagent runs on; `inherit` uses the orchestrator's model. */
export const AGENT_MODELS = ['inherit', 'sonnet', 'opus', 'haiku'] as const
export const AgentModel = z.enum(AGENT_MODELS)
export type AgentModel = z.infer<typeof AgentModel>

/** Frontmatter of an agent profile file (`.agentboard/agents/<name>.md`). */
export const AgentMeta = z.object({
  description: z.string().min(1),
  color: z.string().default(''),
  tags: z.array(z.string()).default([]),
  /** Tool allowlist for the generated subagent; empty inherits every tool (MCP included). */
  tools: z.array(z.string()).default([]),
  model: AgentModel.default('inherit'),
})
export type AgentMeta = z.infer<typeof AgentMeta>

/** A specialized agent: name comes from the filename, prompt from the markdown body. */
export const AgentProfile = AgentMeta.extend({
  name: z.string().regex(ASSIGNEE_SLUG_RE, 'Agent name must be a lowercase slug like "designer"'),
  prompt: z.string(),
})
export type AgentProfile = z.infer<typeof AgentProfile>

export const ACTIVITY_TYPES = ['created', 'status', 'assignee', 'checklist', 'note', 'update'] as const
export const ActivityEventType = z.enum(ACTIVITY_TYPES)
export type ActivityEventType = z.infer<typeof ActivityEventType>

/** One structured entry of a task's timeline (persisted under `## Activity`). */
export const ActivityEvent = z.object({
  at: z.string(),
  actor: z.string().default('user'),
  type: ActivityEventType,
  detail: z.string().default(''),
})
export type ActivityEvent = z.infer<typeof ActivityEvent>

const taskId = z
  .string()
  .regex(/^[A-Z]{2}-[0-9]+$/, 'Task id must look like TK-1')

export const Task = z.object({
  id: taskId,
  title: z.string().min(1),
  status: TaskStatus,
  sprint: z.number().int().positive().nullable(),
  priority: TaskPriority,
  assignee: AssigneeAny,
  estimate: z.number().int().min(0).max(100).default(0),
  tags: z.array(z.string()).default([]),
  dependencies: z.array(taskId).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  description: z.string().default(''),
  notes: z.string().default(''),
  activity: z.array(ActivityEvent).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Exclusive-lock holder (agent name). Absent/null when unlocked. */
  lockedBy: z.string().nullable().optional(),
  /** ISO timestamp of the last lock heartbeat/claim. */
  lockedAt: z.string().nullable().optional(),
})
export type Task = z.infer<typeof Task>

/** A lock older than this many minutes without a heartbeat is considered stale. */
export const TASK_LOCK_TTL_MINUTES = 30

export interface TaskLockInfo {
  lockedBy: string
  lockedAt: string
}

/**
 * Active exclusive lock for a task, or null when unlocked/expired.
 * Expiration is passive: a lock older than TASK_LOCK_TTL_MINUTES is stale
 * and no longer blocks claims.
 */
export function getTaskLock(
  task: Pick<Task, 'lockedBy' | 'lockedAt'>,
  now: Date = new Date(),
): TaskLockInfo | null {
  if (!task.lockedBy || !task.lockedAt) return null
  const ageMs = now.getTime() - new Date(task.lockedAt).getTime()
  if (!Number.isFinite(ageMs)) return null
  if (ageMs > TASK_LOCK_TTL_MINUTES * 60_000) return null
  return { lockedBy: task.lockedBy, lockedAt: task.lockedAt }
}

export interface TaskInput {
  id?: string
  title: string
  status?: TaskStatus
  sprint?: number | null
  priority?: TaskPriority
  assignee?: AssigneeAny
  estimate?: number
  tags?: string[]
  dependencies?: string[]
  acceptanceCriteria?: string[]
  description?: string
  notes?: string
  createdAt?: string
  lockedBy?: string | null
  lockedAt?: string | null
}

export const SprintStatus = z.enum(['planned', 'active', 'closed'])
export type SprintStatus = z.infer<typeof SprintStatus>

export const Sprint = z.object({
  id: z.number().int().positive(),
  goal: z.string().default(''),
  status: SprintStatus,
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
})
export type Sprint = z.infer<typeof Sprint>

export const ProjectConfig = z.object({
  name: z.string().default('My Project'),
  workflow: z.object({
    statuses: z.array(z.string()).min(1).default([...DEFAULT_STATUSES]),
  }),
  /**
   * Mirror `.agentboard/agents/` into `.claude/agents/` as Claude Code
   * subagents (default on). Set `subagents: false` in config.yaml to opt out.
   */
  subagents: z.boolean().optional(),
})
export type ProjectConfig = z.infer<typeof ProjectConfig>

export const BrandAsset = z.object({
  name: z.string(),
  path: z.string(),
})
export type BrandAsset = z.infer<typeof BrandAsset>

/** Company / brand kit: identity, design tokens and rules for the project. */
export const Brand = z.object({
  name: z.string().default(''),
  tagline: z.string().default(''),
  mission: z.string().default(''),
  tone: z.string().default(''),
  logo: z.string().default(''),
  colors: z
    .object({
      primary: z.string().default(''),
      secondary: z.string().default(''),
      accent: z.string().default(''),
      background: z.string().default(''),
      text: z.string().default(''),
    })
    .default({}),
  fonts: z
    .object({
      heading: z.string().default(''),
      body: z.string().default(''),
    })
    .default({}),
  assets: z.array(BrandAsset).default([]),
  guidelines: z.string().default(''),
  updatedAt: z.string().default(''),
})
export type Brand = z.infer<typeof Brand>

/** Partial brand that allows shallow patches of nested tokens. */
export type BrandPatch = {
  name?: string
  tagline?: string
  mission?: string
  tone?: string
  logo?: string
  colors?: Partial<Brand['colors']>
  fonts?: Partial<Brand['fonts']>
  assets?: BrandAsset[]
  guidelines?: string
}

export const ProjectState = z.object({
  rootDir: z.string(),
  config: ProjectConfig,
  brand: Brand,
  tasks: z.array(Task),
  sprints: z.array(Sprint),
  activeSprint: Sprint.nullable(),
  agents: z.array(AgentProfile),
})
export type ProjectState = z.infer<typeof ProjectState>

export function emptyBrand(): Brand {
  return {
    name: '',
    tagline: '',
    mission: '',
    tone: '',
    logo: '',
    colors: { primary: '', secondary: '', accent: '', background: '', text: '' },
    fonts: { heading: '', body: '' },
    assets: [],
    guidelines: '',
    updatedAt: nowIso(),
  }
}

/** True when the brand has any meaningful content configured. */
export function hasBrand(brand: Brand): boolean {
  return (
    brand.name.trim() !== '' ||
    brand.tagline.trim() !== '' ||
    brand.mission.trim() !== '' ||
    brand.tone.trim() !== '' ||
    brand.logo.trim() !== '' ||
    Object.values(brand.colors).some((c) => c.trim() !== '') ||
    Object.values(brand.fonts).some((f) => f.trim() !== '') ||
    brand.assets.length > 0 ||
    brand.guidelines.trim() !== ''
  )
}

export function nowIso(): string {
  return new Date().toISOString()
}
