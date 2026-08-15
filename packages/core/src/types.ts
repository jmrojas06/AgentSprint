import { z } from 'zod'

export const DEFAULT_STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const

export const TaskStatus = z.enum(DEFAULT_STATUSES)
export type TaskStatus = z.infer<typeof TaskStatus>

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export const TaskPriority = z.enum(TASK_PRIORITIES)
export type TaskPriority = z.infer<typeof TaskPriority>

export const ASSIGNEES = ['human', 'agent'] as const
export const Assignee = z.enum(ASSIGNEES)
export type Assignee = z.infer<typeof Assignee>

const taskId = z
  .string()
  .regex(/^[A-Z]{2}-\d+$/, 'Task id must look like TK-1')

export const Task = z.object({
  id: taskId,
  title: z.string().min(1),
  status: TaskStatus,
  sprint: z.number().int().positive().nullable(),
  priority: TaskPriority,
  assignee: Assignee,
  estimate: z.number().int().min(0).max(100).default(0),
  tags: z.array(z.string()).default([]),
  dependencies: z.array(taskId).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  description: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Task = z.infer<typeof Task>

export interface TaskInput {
  id?: string
  title: string
  status?: TaskStatus
  sprint?: number | null
  priority?: TaskPriority
  assignee?: Assignee
  estimate?: number
  tags?: string[]
  dependencies?: string[]
  acceptanceCriteria?: string[]
  description?: string
  createdAt?: string
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
})
export type ProjectConfig = z.infer<typeof ProjectConfig>

export const ProjectState = z.object({
  rootDir: z.string(),
  config: ProjectConfig,
  tasks: z.array(Task),
  sprints: z.array(Sprint),
  activeSprint: Sprint.nullable(),
})
export type ProjectState = z.infer<typeof ProjectState>

export function nowIso(): string {
  return new Date().toISOString()
}
