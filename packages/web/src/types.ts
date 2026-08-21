export type {
  ActivityEvent,
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
} from '@jmrojas06/agentsprint-core'

export const DEFAULT_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export const ACTIVITY_TYPES = ['created', 'status', 'assignee', 'checklist', 'note', 'update'] as const

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
