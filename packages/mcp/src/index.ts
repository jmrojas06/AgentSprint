import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { buildBoardMarkdown, buildSprintReport, buildTaskSpec, computeSprintStats } from '@jmrojas06/agentsprint-core'
import { z } from 'zod'
import type { SprintStatus, TaskInput } from '@jmrojas06/agentsprint-core'

const STATUSES = ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] as const

/**
 * Multi-project provider used by the HTTP MCP route. Lets the agent see and
 * switch between the projects served by the board, and resolves the active
 * project's store for every tool call.
 */
export interface ProjectProvider {
  list(): Array<{ name: string; rootDir: string; configName: string }>
  current(): string
  use(name: string): void
  store(): ProjectStore
  rootDir(): string
}

export function textResponse(value: unknown): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

export function createMcpServer(rootOrProvider: string | ProjectProvider, opts?: { store?: ProjectStore }): McpServer {
  let provider: ProjectProvider | null = null
  let baseRoot: string
  let baseStore: ProjectStore

  if (typeof rootOrProvider === 'string') {
    baseRoot = rootOrProvider
    baseStore = opts?.store ?? ProjectStore.open(baseRoot)
  } else {
    provider = rootOrProvider
    baseRoot = provider.rootDir()
    baseStore = provider.store()
  }

  const getStore = (): ProjectStore => (provider ? provider.store() : baseStore)
  const getProjectName = (): string => getStore().getConfig().name || ''

  const server = new McpServer({ name: 'agentsprint', version: '0.1.0' })

  // ── projects (multi-project only) ────────────────────────────────────

  if (provider) {
    server.registerTool(
      'project_list',
      {
        title: 'List projects',
        description:
          'List every project served by this board (name, rootDir, configName). Use project_use to pick the one you are working on.',
        inputSchema: z.object({}),
      },
      async () => textResponse(provider!.list()),
    )

    server.registerTool(
      'project_current',
      {
        title: 'Current project',
        description: 'Show which project is currently active, so you never work on the wrong folder.',
        inputSchema: z.object({}),
      },
      async () => {
        const name = provider!.current()
        const info = provider!.list().find((p) => p.name === name)
        return textResponse(info ?? { name })
      },
    )

    server.registerTool(
      'project_use',
      {
        title: 'Switch project',
        description:
          'Set the active project. Call project_list first to see the available names, then project_use with the exact name. All task/sprint/brand tools operate on the active project.',
        inputSchema: z.object({ name: z.string().min(1) }),
      },
      async ({ name }) => {
        try {
          provider!.use(name)
          return textResponse({ ok: true, activeProject: provider!.current() })
        } catch (err) {
          return textResponse({ error: (err as Error).message })
        }
      },
    )
  }

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
      const store = getStore()
      const state = store.state
      const stats = computeSprintStats(state.tasks, null)
      return textResponse({
        project: getProjectName(),
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
        ...(store.lastWarnings.length ? { warnings: [...store.lastWarnings] } : {}),
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
      const store = getStore()
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
      inputSchema: z.object({ id: z.string().regex(/^[A-Z]{2}-[0-9]+$/) }),
    },
    async ({ id }) => {
      const task = getStore().state.tasks.find((t) => t.id === id)
      if (!task) return textResponse(`Task not found: ${id}`)
      return textResponse(task)
    },
  )

  server.registerTool(
    'task_create',
    {
      title: 'Create task',
      description:
        'Create a new task. Returns the created task with its generated id. Defaults: status "To Do", priority "medium", assignee "human". Optionally create from a reusable template in .agentboard/templates/ by passing `template` (name without .md) and `vars` for its {{placeholders}}; explicit fields override the template defaults.',
      inputSchema: z.object({
        title: z.string().min(1).optional(),
        template: z.string().optional(),
        vars: z.record(z.string()).optional(),
        description: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        sprint: z.number().int().positive().optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        assignee: z.enum(['scrum-master', 'dev', 'review', 'perfect']).optional(),
        estimate: z.number().int().min(0).max(100).optional(),
        tags: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
      }),
    },
    async ({ template, vars, ...input }) => {
      try {
        const store = getStore()
        if (!template && !input.title) {
          return textResponse({ error: 'Provide a title or a template.' })
        }
        const task = template
          ? store.createTaskFromTemplate(template, { vars, overrides: input, actor: 'agent' })
          : store.createTask(input as TaskInput, { actor: 'agent' })
        return textResponse(task)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'template_list',
    {
      title: 'List task templates',
      description:
        'List the reusable task templates in .agentboard/templates/ (name, defaults, acceptance criteria and {{placeholder}} variables). Use a name with task_create `template`.',
      inputSchema: z.object({}),
    },
    async () => textResponse(getStore().listTemplates()),
  )

  server.registerTool(
    'task_update',
    {
      title: 'Update task',
      description: 'Update fields of an existing task (title, description, priority, assignee, sprint, tags, acceptanceCriteria, estimate).',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-[0-9]+$/),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        assignee: z.enum(['scrum-master', 'dev', 'review', 'perfect']).optional(),
        sprint: z.number().int().positive().nullable().optional(),
        estimate: z.number().int().min(0).max(100).optional(),
        tags: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
      }),
    },
    async ({ id, ...patch }) => {
      try {
        const task = getStore().updateTask(id, patch, { actor: 'agent' })
        return textResponse(task)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'task_status',
    {
      title: 'Set task status',
      description: 'Move a task to a given status. When starting work use task_claim instead.',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-[0-9]+$/),
        status: z.enum(STATUSES),
      }),
    },
    async ({ id, status }) => {
      try {
        const task = getStore().setTaskStatus(id, status, { actor: 'agent' })
        return textResponse(task)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'task_claim',
    {
      title: 'Claim a task',
      description:
        'Mark a task as In Progress and assigned to an agent. Use this when you start working on a task. If the task has incomplete dependencies, the call will fail unless `force` is true. Claims also take an exclusive lock (30 min TTL): pass `agent` to identify yourself — if another agent holds an active lock the call fails unless `force`.',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-[0-9]+$/),
        agent: z.string().min(1).optional(),
        force: z.boolean().optional(),
      }),
    },
    async ({ id, agent, force }) => {
      try {
        const store = getStore()
        const blocked = store.isTaskBlocked(id)
        if (blocked && !force) {
          const blockers = store.getBlockers(id)
          return textResponse({ error: `Task ${id} is blocked by ${blockers.join(', ')}`, blockers })
        }
        try {
          store.lockTask(id, agent ?? 'agent')
        } catch (err) {
          if (!force) return textResponse({ error: (err as Error).message })
          await Promise.resolve()
          store.unlockTask(id, { force: true })
          store.lockTask(id, agent ?? 'agent')
        }
        const task = store.updateTask(id, { status: 'In Progress', assignee: 'scrum-master' }, { actor: 'agent' })
        return textResponse(task)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'task_release',
    {
      title: 'Release task lock',
      description:
        "Release your exclusive lock on a task so other agents can claim it. Pass `agent` to verify ownership; use `force` to break a foreign or stale lock.",
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-[0-9]+$/),
        agent: z.string().min(1).optional(),
        force: z.boolean().optional(),
      }),
    },
    async ({ id, agent, force }) => {
      try {
        const task = getStore().unlockTask(id, { agent, force })
        return textResponse({ ok: true, id: task.id, lockedBy: null })
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'task_checklist',
    {
      title: 'Update task checklist',
      description:
        'Toggle or set the completion status of an acceptance criterion on a task by index (0-based) or text substring match.',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-[0-9]+$/),
        index: z.number().int().min(0).optional(),
        text: z.string().optional(),
        completed: z.boolean().optional(),
      }),
    },
    async ({ id, index, text, completed }) => {
      try {
        const task = getStore().setTaskChecklist(id, { index, text, completed }, { actor: 'agent' })
        return textResponse(task)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'task_note',
    {
      title: 'Append note to task',
      description:
        'Append a timestamped execution note, decision, or blocker under ## Notes in the task body.',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-[0-9]+$/),
        note: z.string().min(1),
        author: z.string().optional(),
      }),
    },
    async ({ id, note, author }) => {
      try {
        const task = getStore().appendTaskNote(id, note, author ?? 'agent')
        return textResponse(task)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'task_spec',
    {
      title: 'Get task spec',
      description:
        'Returns a self-contained, copy-pasteable prompt for the task (mission + acceptance criteria + agent rules). Use this to get context before implementing.',
      inputSchema: z.object({ id: z.string().regex(/^[A-Z]{2}-[0-9]+$/) }),
    },
    async ({ id }) => {
      const store = getStore()
      const state = store.state
      const task = state.tasks.find((t) => t.id === id)
      if (!task) return textResponse(`Task not found: ${id}`)
      const sprint = task.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
      return textResponse(buildTaskSpec(task, sprint, getProjectName(), { brand: store.getBrand(), allTasks: state.tasks, learnings: store.getLearnings() }))
    },
  )

  server.registerTool(
    'task_delete',
    {
      title: 'Delete task',
      description: 'Permanently delete a task by id (e.g. TK-1).',
      inputSchema: z.object({ id: z.string().regex(/^[A-Z]{2}-[0-9]+$/) }),
    },
    async ({ id }) => {
      try {
        getStore().deleteTask(id)
        return textResponse({ ok: true, deleted: id })
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'export_board',
    {
      title: 'Export board to Markdown',
      description:
        'Export the full board as a static Markdown document: sprints with stats (points, completion %), all tasks grouped by status with their acceptance criteria, and current learnings. Optionally limit the export to a single sprint with `sprint`.',
      inputSchema: z.object({
        sprint: z.number().int().positive().optional(),
      }),
    },
    async ({ sprint }) => {
      try {
        const store = getStore()
        const markdown = buildBoardMarkdown(store.state, {
          sprintId: sprint ?? null,
          learnings: store.getLearnings(),
        })
        return textResponse(markdown)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  // ── brand ────────────────────────────────────────────────────────────

  server.registerTool(
    'brand_get',
    {
      title: 'Get brand guidelines',
      description:
        'Returns the company/brand kit: identity (name, tagline, mission, tone), design tokens (colors, fonts), design file locations and brand guidelines. Read this before building UI, copy or anything with a visible surface.',
      inputSchema: z.object({}),
    },
    async () => {
      const brand = getStore().getBrand()
      return textResponse(
        Object.values(brand.colors).some((c) => c) ||
          brand.name ||
          brand.guidelines.trim()
          ? brand
          : { message: 'No brand configured. Edit .agentboard/brand.md or use the UI.' },
      )
    },
  )

  server.registerTool(
    'brand_update',
    {
      title: 'Update brand guidelines',
      description:
        'Update company/brand kit (identity, design tokens, colors, fonts, assets, and guidelines).',
      inputSchema: z.object({
        name: z.string().optional(),
        tagline: z.string().optional(),
        mission: z.string().optional(),
        tone: z.string().optional(),
        logo: z.string().optional(),
        colors: z
          .object({
            primary: z.string().optional(),
            secondary: z.string().optional(),
            accent: z.string().optional(),
            background: z.string().optional(),
            text: z.string().optional(),
          })
          .optional(),
        fonts: z
          .object({
            heading: z.string().optional(),
            body: z.string().optional(),
          })
          .optional(),
        assets: z
          .array(
            z.object({
              name: z.string(),
              path: z.string(),
            }),
          )
          .optional(),
        guidelines: z.string().optional(),
      }),
    },
    async (patch) => {
      try {
        const brand = getStore().updateBrand(patch)
        return textResponse(brand)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  // ── learnings ──────────────────────────────────────────────────────────

  server.registerTool(
    'learnings_get',
    {
      title: 'Get learnings',
      description:
        'Return the full contents of `.agentboard/learnings.md` — retro notes, rules and principles captured from past sprints. Useful before planning so you don’t repeat mistakes.',
      inputSchema: z.object({}),
    },
    async () => {
      const content = getStore().getLearnings()
      return textResponse(content ? { content } : { message: 'No learnings recorded yet.' })
    },
  )

  server.registerTool(
    'learnings_append',
    {
      title: 'Append learning',
      description: 'Append a single learning/retro entry to `.agentboard/learnings.md`.',
      inputSchema: z.object({
        entry: z.string().describe('A rule, insight or retro bullet to remember.'),
      }),
    },
    async ({ entry }) => {
      const content = getStore().appendLearning(entry)
      return textResponse({ ok: true, content })
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
      const store = getStore()
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
    async () => textResponse(getStore().state.sprints),
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
        const sprint = getStore().setSprintStatus(id, 'active' as SprintStatus)
        return textResponse(sprint)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'sprint_create',
    {
      title: 'Create sprint',
      description: 'Create a new planned sprint with an optional goal. Returns the created sprint.',
      inputSchema: z.object({
        goal: z.string().optional(),
      }),
    },
    async ({ goal }) => {
      try {
        const sprint = getStore().createSprint(goal ?? '')
        return textResponse(sprint)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'sprint_close',
    {
      title: 'Close sprint',
      description:
        'Mark a sprint as closed (sets endedAt to now). If id is omitted, closes the currently active sprint. By default an automatic retrospective is appended to .agentboard/learnings.md; pass retro=false to skip it.',
      inputSchema: z.object({
        id: z.number().int().positive().optional(),
        retro: z.boolean().optional(),
      }),
    },
    async ({ id, retro }) => {
      try {
        const store = getStore()
        const targetId = id ?? store.state.activeSprint?.id
        if (!targetId) return textResponse('Error: no active sprint to close and no sprint id provided.')
        const sprint = store.setSprintStatus(targetId, 'closed', { retro })
        return textResponse(sprint)
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'sprint_retro',
    {
      title: 'Get sprint retro',
      description:
        'Generate the retrospective for a sprint (report + blockers found) together with a list of suggested learnings worth persisting. If id is omitted, uses the active sprint.',
      inputSchema: z.object({
        id: z.number().int().positive().optional(),
      }),
    },
    async ({ id }) => {
      try {
        const store = getStore()
        const state = store.state
        const targetId = id ?? state.activeSprint?.id
        if (!targetId) return textResponse('Error: no active sprint and no sprint id provided.')
        const sprint = state.sprints.find((s) => s.id === targetId)
        if (!sprint) return textResponse(`Sprint not found: ${targetId}`)
        const report = store.buildSprintRetro(targetId)
        const sprintTasks = state.tasks.filter((t) => t.sprint === targetId)
        const done = sprintTasks.filter((t) => t.status === 'Done')
        const pending = sprintTasks.filter((t) => t.status !== 'Done')
        const suggestedLearnings: string[] = []
        if (pending.length > 0) {
          suggestedLearnings.push(`${pending.length} task(s) did not finish (${pending.map((t) => t.id).join(', ')}) — consider carrying them over with updated estimates.`)
        }
        for (const task of pending) {
          const blockers = store.getBlockers(task.id)
          if (blockers.length > 0) {
            suggestedLearnings.push(`${task.id} stayed blocked by ${blockers.join(', ')} — review dependency ordering before planning the next sprint.`)
          }
        }
        suggestedLearnings.push(`${done.length}/${sprintTasks.length} tasks completed — record what made the difference (scope, clarity of AC, agent vs human).`)
        return textResponse({ report, suggestedLearnings })
      } catch (err) {
        return textResponse({ error: (err as Error).message })
      }
    },
  )

  server.registerTool(
    'sprint_report',
    {
      title: 'Get sprint report',
      description:
        'Generate a full Markdown summary report of a sprint (goal, status, dates, progress, task breakdown and retro section). If id is omitted, reports the active sprint.',
      inputSchema: z.object({
        id: z.number().int().positive().optional(),
      }),
    },
    async ({ id }) => {
      const store = getStore()
      const state = store.state
      const targetId = id ?? state.activeSprint?.id
      if (!targetId) return textResponse('Error: no active sprint and no sprint id provided.')
      const sprint = state.sprints.find((s) => s.id === targetId)
      if (!sprint) return textResponse(`Sprint not found: ${targetId}`)
      const report = buildSprintReport(sprint, state.tasks, state.config.workflow.statuses)
      return textResponse(report)
    },
  )

  // ── resources ─────────────────────────────────────────────────────────

  server.registerResource(
    'tasks',
    'agentboard://tasks',
    {
      title: 'AgentSprint Tasks',
      description: 'List of all tasks in the board',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(getStore().state.tasks, null, 2),
        },
      ],
    }),
  )

  server.registerResource(
    'sprint_current',
    'agentboard://sprint/current',
    {
      title: 'Active Sprint',
      description: 'Currently active sprint, its tasks and stats',
      mimeType: 'application/json',
    },
    async (uri) => {
      const store = getStore()
      const state = store.state
      const active = state.activeSprint
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(
              {
                sprint: active,
                stats: active ? computeSprintStats(state.tasks, active.id) : null,
                tasks: active ? state.tasks.filter((t) => t.sprint === active.id) : [],
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  server.registerResource(
    'brand',
    'agentboard://brand',
    {
      title: 'Brand Kit',
      description: 'Brand identity, colors, typography and guidelines',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(getStore().getBrand(), null, 2),
        },
      ],
    }),
  )

  // ── prompts ───────────────────────────────────────────────────────────

  server.registerPrompt(
    'execute-task',
    {
      title: 'Execute Task',
      description: 'Get full instructions and spec to execute an AgentSprint task',
      argsSchema: { id: z.string() },
    },
    ({ id }) => {
      const store = getStore()
      const state = store.state
      const task = state.tasks.find((t) => t.id === id)
      const sprint = task?.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
      const spec = task ? buildTaskSpec(task, sprint, getProjectName(), { brand: store.getBrand(), allTasks: state.tasks, learnings: store.getLearnings() }) : `Task ${id} not found.`
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Please implement this task according to the specification below:\n\n${spec}`,
            },
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'sprint-plan',
    {
      title: 'Sprint Planning (agent-assisted)',
      description:
        'Analyze the backlog and produce a suggested plan for the next sprint: which tasks to include, order, estimates, priorities and dependencies. Includes backlog, historical velocity and accumulated learnings.',
      argsSchema: {
        goal: z.string().optional().describe('Proposed sprint goal (optional).'),
        capacity: z.string().optional().describe('Capacity for this sprint in story points (optional).'),
        sprint: z.string().optional().describe('Id of an existing planned sprint to fill (optional).'),
      },
    },
    ({ goal, capacity, sprint }) => {
      const store = getStore()
      const state = store.state

      const backlog = state.tasks.filter((t) => t.status === 'Backlog')
      const closed = state.sprints
        .filter((s) => s.status === 'closed')
        .sort((a, b) => b.id - a.id)
        .slice(0, 3)
      const velocity =
        closed.length > 0
          ? Math.round(
              closed.reduce(
                (sum, s) =>
                  sum +
                  state.tasks
                    .filter((t) => t.sprint === s.id && t.status === 'Done')
                    .reduce((acc, t) => acc + t.estimate, 0),
                0,
              ) / closed.length,
            )
          : null
      const plannedSprint = sprint ? state.sprints.find((s) => String(s.id) === sprint) ?? null : null
      const learnings = store.getLearnings()

      const backlogLines = backlog.length
        ? backlog
            .map(
              (t) =>
                `- **${t.id}** — ${t.title} [priority: ${t.priority}, estimate: ${t.estimate}${t.tags.length ? `, tags: ${t.tags.join('/')}` : ''}]${t.dependencies.length ? ` (depends on: ${t.dependencies.join(', ')})` : ''}`,
            )
            .join('\n')
        : '_Backlog is empty._'
      const historyLines = closed.length
        ? closed.map((s) => `- Sprint ${s.id} (${s.endedAt?.slice(0, 10) ?? '?'}): ${s.goal || 'no goal'}`).join('\n')
        : '_No closed sprints yet — no velocity data._'

      const text = [
        'You are planning the next sprint for this AgentSprint board.',
        '',
        '## Context',
        `- Proposed goal: ${goal?.trim() || '(not provided — propose one from the backlog)'}`,
        `- Capacity: ${capacity?.trim() || (velocity != null ? `(not provided — assume ~${velocity} pts)` : '(not provided)')}`,
        `- Historical velocity: ${velocity != null ? `${velocity} points/sprint (avg of last ${closed.length} closed sprints)` : 'unknown (no closed sprints)'}`,
        `- Target sprint: ${plannedSprint ? `existing planned Sprint ${plannedSprint.id} — "${plannedSprint.goal || 'no goal'}"` : 'none selected — propose creating one'}`,
        '',
        '## Available backlog',
        backlogLines,
        '',
        '## Recent sprint history',
        historyLines,
        '',
        ...(learnings.trim()
          ? ['## Learned principles (respect them)', learnings.trim(), '']
          : []),
        '## Your job',
        '1. Propose a concise sprint goal aligned with the context above.',
        '2. Select tasks from the backlog that fit the capacity, respecting dependencies (a task may only be scheduled if its dependencies are included or already Done).',
        '3. Propose priority, estimate and dependency ordering for each selected task.',
        '4. Output a plan using EXACTLY this template:',
        '',
        '```markdown',
        '## Sprint plan proposal',
        '**Goal:** <one-line goal>',
        '**Capacity:** <pts> · **Planned total:** <pts> · **Velocity reference:** <pts>',
        '',
        '| Order | Task | Priority | Estimate | Dependencies | Rationale |',
        '|---|---|---|---|---|---|',
        '| 1 | TK-x | high | 3 | — | ... |',
        '',
        '**Carry-over / not included:** <task ids + reason>',
        '**Risks:** <anything that might block the sprint>',
        '```',
        '',
        '5. Present the plan to the human for review. Do NOT modify the board until they approve.',
        '6. Once approved, execute it with task_update (sprint, priority, estimate), sprint_create + sprint_activate if needed.',
        '',
        'Produce the plan now.',
      ]
        .filter(Boolean)
        .join('\n')

      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text },
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'sprint-retro',
    {
      title: 'Sprint Retrospective',
      description: 'Review completed sprint metrics, blockers, and learnings',
    },
    () => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: 'Let us perform a sprint retrospective. Review the sprint report, analyze completed vs open tasks, note what went well, and document learnings.',
          },
        },
      ],
    }),
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

const isEntry = process.argv[1]
  ? import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
  : false
if (isEntry) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    process.stderr.write(`agentboard-mcp: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}