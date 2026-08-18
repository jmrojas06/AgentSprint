export type {
  Brand,
  BrandAsset,
  ProjectConfig,
  ProjectState,
  Sprint,
  SprintStatus,
  Task,
  TaskInput,
  TaskPriority,
  TaskStatus,
} from '@agentsprint/core'

import type { ProjectState as CoreProjectState } from '@agentsprint/core'

export const DEFAULT_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

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
