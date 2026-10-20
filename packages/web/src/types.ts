export type {
  ActivityEvent,
  AgentModel,
  AgentProfile,
  DispatchItem,
  DispatchPlan,
  ActivityEventType,
  Brand,
  BrandAsset,
  GitCommit,
  ProjectConfig,
  ProjectState,
  Sprint,
  SprintStatus,
  Task,
  TaskInput,
  TaskPriority,
  TaskStatus,
  TaskTemplate,
  JournalEntry,
  ProjectSnapshot,
  SkillInfo,
} from '@jmrojas06/agentsprint-core'

export const DEFAULT_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export const AGENT_MODELS = ['inherit', 'sonnet', 'opus', 'haiku'] as const
export const ACTIVITY_TYPES = ['created', 'status', 'assignee', 'checklist', 'note', 'update', 'review'] as const

import type { ProjectState as CoreProjectState } from '@jmrojas06/agentsprint-core'

export interface ProjectInfo {
  name: string
  rootDir: string
  configName: string
}

export type BoardState = CoreProjectState & { warnings?: string[] }

export interface BurndownPoint {
  date: string
  remaining: number
}

export interface Burndown {
  sprintId: number
  total: number
  startedAt: string | null
  points: BurndownPoint[]
}

/** GET /api/context: the session brief, its structured snapshot and recent handoffs (newest first). */
export interface ProjectContext {
  markdown: string
  snapshot: import('@jmrojas06/agentsprint-core').ProjectSnapshot
  journal: import('@jmrojas06/agentsprint-core').JournalEntry[]
}
