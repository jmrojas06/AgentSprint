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

export const DEFAULT_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const

export interface ProjectInfo {
  name: string
  rootDir: string
  configName: string
}
