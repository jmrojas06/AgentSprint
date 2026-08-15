import fs from 'node:fs'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ProjectStore } from '@agentsprint/core'
import { buildTaskSpec, computeSprintStats } from '@agentsprint/core'
import { z } from 'zod'
import type { SprintStatus, TaskInput } from '@agentsprint/core'

const STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const

function textResponse(value: unknown): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

export function createMcpServer(rootDir: string): McpServer {
  const store = ProjectStore.open(rootDir)
  const projectName = store.getConfig().name

  const server = new McpServer({ name: 'agentsprint', version: '0.1.0' })

  // ── board ────────────────────────────────────────────────────────────

  server.registerTool(
    'board_summary',
    {
      title: 'Board summary',
      description:
        'High-level overview of the board: active sprint, task counts per status, total points and completion percentage.',
      inputSchema: z.object({}),
    },
    async () => {
      const state = store.state
      const stats = computeSprintStats(state.tasks, null)
      return textResponse({
        project: projectName,
        rootDir: store.rootDir,
        activeSprint: state.activeSprint,
        counts: {
          backlog: stats.backlog,
          todo: stats.todo,
          inProgress: stats.inProgress,
          review: stats.review,
          done: stats.done,
          total: stats.total,
        },
        completionPct: stats.completionPct,
      })
    },
  )

  // ── tasks ────────────────────────────────────────────────────────────

  server.registerTool(
    'task_list',
    {
      title: 'List tasks',
      description:
        'List tasks with optional filters (status, sprint id, assignee, free-text search). Results are the full task objects.',
      inputSchema: z.object({
        status: z.enum(STATUSES).optional(),
        sprint: z.number().int().positive().optional(),
        assignee: z.enum(['human', 'agent']).optional(),
        q: z.string().optional(),
      }),
    },
    async ({ status, sprint, assignee, q }) => {
      let tasks = store.state.tasks
      if (status) tasks = tasks.filter((t) => t.status === status)
      if (sprint) tasks = tasks.filter((t) => t.sprint === sprint)
      if (assignee) tasks = tasks.filter((t) => t.assignee === assignee)
      if (q) {
        const needle = q.toLowerCase()
        tasks = tasks.filter((t) => `${t.id} ${t.title} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(needle))
      }
      return textResponse(tasks)
    },
  )

  server.registerTool(
    'task_get',
    {
      title: 'Get task',
      description: 'Get a single task by id (e.g. TK-1).',
      inputSchema: z.object({ id: z.string().regex(/^[A-Z]{2}-\d+$/) }),
    },
    async ({ id }) => {
      const task = store.state.tasks.find((t) => t.id === id)
      if (!task) return textResponse(`Task not found: ${id}`)
      return textResponse(task)
    },
  )

  server.registerTool(
    'task_create',
    {
      title: 'Create task',
      description:
        'Create a new task. Returns the created task with its generated id. Defaults: status "To Do", priority "medium", assignee "human".',
      inputSchema: z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        sprint: z.number().int().positive().optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        assignee: z.enum(['human', 'agent']).optional(),
        estimate: z.number().int().min(0).max(100).optional(),
        tags: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
      }),
    },
    async (input) => {
      try {
        const task = store.createTask(input as TaskInput)
        return textResponse(task)
      } catch (err) {
        return textResponse(`Error: ${(err as Error).message}`)
      }
    },
  )

  server.registerTool(
    'task_update',
    {
      title: 'Update task',
      description: 'Update fields of an existing task (title, description, priority, assignee, sprint, tags, acceptanceCriteria, estimate).',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-\d+$/),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        assignee: z.enum(['human', 'agent']).optional(),
        sprint: z.number().int().positive().nullable().optional(),
        estimate: z.number().int().min(0).max(100).optional(),
        tags: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
      }),
    },
    async ({ id, ...patch }) => {
      try {
        const task = store.updateTask(id, patch)
        return textResponse(task)
      } catch (err) {
        return textResponse(`Error: ${(err as Error).message}`)
      }
    },
  )

  server.registerTool(
    'task_status',
    {
      title: 'Set task status',
      description: 'Move a task to a given status. When starting work use task_claim instead.',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-\d+$/),
        status: z.enum(STATUSES),
      }),
    },
    async ({ id, status }) => {
      try {
        const task = store.setTaskStatus(id, status)
        return textResponse(task)
      } catch (err) {
        return textResponse(`Error: ${(err as Error).message}`)
      }
    },
  )

  server.registerTool(
    'task_claim',
    {
      title: 'Claim a task',
      description:
        'Mark a task as In Progress and assigned to an agent. Use this when you start working on a task. After claiming, if the task is not the current one, you may return it with task_status.',
      inputSchema: z.object({ id: z.string().regex(/^[A-Z]{2}-\d+$/) }),
    },
    async ({ id }) => {
      try {
        const task = store.updateTask(id, { status: 'In Progress', assignee: 'agent' })
        return textResponse(task)
      } catch (err) {
        return textResponse(`Error: ${(err as Error).message}`)
      }
    },
  )

  server.registerTool(
    'task_spec',
    {
      title: 'Get task spec',
      description:
        'Returns a self-contained, copy-pasteable prompt for the task (mission + acceptance criteria + agent rules). Use this to get context before implementing.',
      inputSchema: z.object({ id: z.string().regex(/^[A-Z]{2}-\d+$/) }),
    },
    async ({ id }) => {
      const state = store.state
      const task = state.tasks.find((t) => t.id === id)
      if (!task) return textResponse(`Task not found: ${id}`)
      const sprint = task.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
      return textResponse(buildTaskSpec(task, sprint, projectName))
    },
  )

  // ── sprints ──────────────────────────────────────────────────────────

  server.registerTool(
    'sprint_current',
    {
      title: 'Current sprint',
      description:
        'Shows the active sprint (goal, status, dates), its tasks and completion stats. Read this before doing any work.',
      inputSchema: z.object({}),
    },
    async () => {
      const state = store.state
      const active = state.activeSprint
      if (!active) return textResponse({ activeSprint: null, message: 'No active sprint. Use sprint_activate to start one.' })
      const tasks = state.tasks.filter((t) => t.sprint === active.id)
      return textResponse({
        sprint: active,
        stats: computeSprintStats(state.tasks, active.id),
        tasks,
      })
    },
  )

  server.registerTool(
    'sprint_list',
    {
      title: 'List sprints',
      description: 'List all sprints with their status (planned / active / closed).',
      inputSchema: z.object({}),
    },
    async () => textResponse(store.state.sprints),
  )

  server.registerTool(
    'sprint_activate',
    {
      title: 'Activate sprint',
      description: 'Set a sprint as the active one. Any other active sprint is demoted to planned.',
      inputSchema: z.object({ id: z.number().int().positive() }),
    },
    async ({ id }) => {
      try {
        const sprint = store.setSprintStatus(id, 'active' as SprintStatus)
        return textResponse(sprint)
      } catch (err) {
        return textResponse(`Error: ${(err as Error).message}`)
      }
    },
  )

  return server
}

export async function main(argv: string[]): Promise<void> {
  const rootFlag = argv.indexOf('--root')
  const rootEnv = process.env.AGENTSPRINT_ROOT
  const rootDir = rootFlag !== -1 ? argv[rootFlag + 1] : rootEnv ?? process.cwd()

  if (!rootDir) {
    process.stderr.write('Error: no project root. Pass --root <dir> or set AGENTSPRINT_ROOT.\n')
    process.exit(1)
  }
  const resolved = path.resolve(rootDir)
  if (!fs.existsSync(path.join(resolved, '.agentboard'))) {
    process.stderr.write(`Error: no AgentSprint board at ${resolved}. Run "agentboard init" there first.\n`)
    process.exit(1)
  }

  const server = createMcpServer(resolved)
  await server.connect(new StdioServerTransport())
}

main(process.argv.slice(2)).catch((err: unknown) => {
  process.stderr.write(`agentboard-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
