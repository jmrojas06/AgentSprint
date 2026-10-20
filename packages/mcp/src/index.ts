import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { buildBoardMarkdown, buildSprintReport, buildTaskSpec, computeSprintStats } from '@jmrojas06/agentsprint-core'
import { AGENT_MODELS, ASSIGNEE_SLUG_RE, buildDispatchPlan, isWorkflowAssignee, planDispatch } from '@jmrojas06/agentsprint-core'
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

/**
 * A failed tool call: `isError: true` so the agent can tell it apart from a
 * result, with a JSON `{ error, ...extra }` body it can parse.
 */
export function errorResponse(
  message: string,
  extra: Record<string, unknown> = {},
): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { ...textResponse({ error: message, ...extra }), isError: true }
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

  // Re-sync with the disk before every tool call: the stdio server has no file
  // watcher, and other agents (separate processes) or humans edit the board.
  const getStore = (): ProjectStore => {
    const store = provider ? provider.store() : baseStore
    store.refresh()
    return store
  }
  // Config is not re-synced, so no refresh() here (it is always called right after getStore()).
  const getProjectName = (): string => (provider ? provider.store() : baseStore).getConfig().name || ''

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
          return errorResponse((err as Error).message)
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
        'List tasks with optional filters (status, sprint id, assignee, free-text search). `assignee` accepts any workflow role (scrum-master, dev, review, perfect) or specialized agent name (designer, tester, …). Results are the full task objects.',
      inputSchema: z.object({
        status: z.enum(STATUSES).optional(),
        sprint: z.number().int().positive().optional(),
        assignee: z.string().min(1).optional(),
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
      if (!task) return errorResponse(`Task not found: ${id}`)
      return textResponse(task)
    },
  )

  server.registerTool(
    'task_create',
    {
      title: 'Create task',
      description:
        'Create a new task. Returns the created task with its generated id. Defaults: status "To Do", priority "medium", assignee "scrum-master". `assignee` may be a workflow role or the name of a specialized agent from `.agentboard/agents/`. Optionally create from a reusable template in .agentboard/templates/ by passing `template` (name without .md) and `vars` for its {{placeholders}}; explicit fields override the template defaults.',
      inputSchema: z.object({
        title: z.string().min(1).optional(),
        template: z.string().optional(),
        vars: z.record(z.string()).optional(),
        description: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        sprint: z.number().int().positive().optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        assignee: z.string().regex(ASSIGNEE_SLUG_RE, 'Assignee must be a lowercase slug like "dev" or "designer"').optional(),
        estimate: z.number().int().min(0).max(100).optional(),
        tags: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
      }),
    },
    async ({ template, vars, ...input }) => {
      try {
        const store = getStore()
        if (!template && !input.title) {
          return errorResponse('Provide a title or a template.')
        }
        const task = template
          ? store.createTaskFromTemplate(template, { vars, overrides: input, actor: 'agent' })
          : store.createTask(input as TaskInput, { actor: 'agent' })
        return textResponse(task)
      } catch (err) {
        return errorResponse((err as Error).message)
      }
    },
  )

  const batchItem = z.object({
    ref: z.string().min(1).optional().describe('Label for this task inside the batch, used by other items in dependsOn (e.g. "api").'),
    title: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(STATUSES).optional(),
    sprint: z.number().int().positive().optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    assignee: z.string().regex(ASSIGNEE_SLUG_RE, 'Assignee must be a lowercase slug like "dev" or "designer"').optional(),
    estimate: z.number().int().min(0).max(100).optional(),
    tags: z.array(z.string()).optional(),
    acceptanceCriteria: z.array(z.string()).optional(),
    dependsOn: z.array(z.string()).optional().describe('refs of earlier/later items in this batch, or existing task ids (TK-3).'),
  })

  server.registerTool(
    'task_create_batch',
    {
      title: 'Create tasks in batch',
      description:
        'Create a whole plan in one call: up to 50 tasks, each optionally with a `ref` label and `dependsOn` (refs in this batch or existing task ids). Refs resolve to the generated ids and tasks are created dependencies-first. The batch is validated before anything is written (unknown refs, duplicate refs and cycles are rejected). Assign each task to the specialist that should build it (developer, designer, tester, docs, …) so sprint_dispatch can route it to that subagent.',
      inputSchema: z.object({ tasks: z.array(batchItem).min(1).max(50) }),
    },
    async ({ tasks }) => {
      try {
        const created = getStore().createTaskBatch(tasks as Array<TaskInput & { ref?: string; dependsOn?: string[] }>, { actor: 'agent' })
        return textResponse(
          created.map((t, i) => ({ ref: tasks[i]!.ref ?? null, id: t.id, title: t.title, assignee: t.assignee, sprint: t.sprint, dependencies: t.dependencies })),
        )
      } catch (err) {
        return errorResponse((err as Error).message)
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
      description: 'Update fields of an existing task (title, description, priority, assignee, sprint, tags, acceptanceCriteria, estimate). `assignee` may be a workflow role or the name of a specialized agent from `.agentboard/agents/`.',
      inputSchema: z.object({
        id: z.string().regex(/^[A-Z]{2}-[0-9]+$/),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        assignee: z.string().regex(ASSIGNEE_SLUG_RE, 'Assignee must be a lowercase slug like "dev" or "designer"').optional(),
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
        return errorResponse((err as Error).message)
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
        return errorResponse((err as Error).message)
      }
    },
  )

  server.registerTool(
    'task_claim',
    {
      title: 'Claim a task',
      description:
        'Mark a task as In Progress and assigned to an agent. A task assigned to a specialized agent (designer, tester, …) keeps that assignee; workflow roles are set to `dev`. Use this when you start working on a task. If the task has incomplete dependencies, the call will fail unless `force` is true. Claims also take an exclusive lock (30 min TTL): pass `agent` to identify yourself — if another agent holds an active lock the call fails unless `force`.',
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
          return errorResponse(`Task ${id} is blocked by ${blockers.join(', ')}`, { blockers })
        }
        try {
          store.lockTask(id, agent ?? 'agent')
        } catch (err) {
          if (!force) return errorResponse((err as Error).message)
          await Promise.resolve()
          store.unlockTask(id, { force: true })
          store.lockTask(id, agent ?? 'agent')
        }
        // A subagent claiming with its own name becomes the assignee; otherwise a
        // task already assigned to a specialized agent keeps it, and workflow
        // roles map to In Progress's canonical assignee (dev).
        const current = store.state.tasks.find((t) => t.id === id)
        const claimer = agent && store.listAgents().some((a) => a.name === agent) ? agent : null
        const assignee = claimer ?? (current && !isWorkflowAssignee(current.assignee) ? current.assignee : 'dev')
        const task = store.updateTask(id, { status: 'In Progress', assignee }, { actor: agent ?? 'agent' })
        return textResponse(task)
      } catch (err) {
        return errorResponse((err as Error).message)
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
        return errorResponse((err as Error).message)
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
        return errorResponse((err as Error).message)
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
        return errorResponse((err as Error).message)
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
      if (!task) return errorResponse(`Task not found: ${id}`)
      const sprint = task.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
      return textResponse(buildTaskSpec(task, sprint, getProjectName(), { brand: store.getBrand(), allTasks: state.tasks, learnings: store.getLearnings(), agent: store.agentForTask(task) }))
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
        return errorResponse((err as Error).message)
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
        return errorResponse((err as Error).message)
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
        return errorResponse((err as Error).message)
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

  // ── specialized agents ───────────────────────────────────────────────

  server.registerTool(
    'agent_list',
    {
      title: 'List specialized agents',
      description:
        'List the specialized agents of this board (`.agentboard/agents/`): name, description, color, tags, tools and model. Each one is also a real Claude Code subagent in `.claude/agents/<name>.md` — launch it with the Agent tool (`subagent_type: <name>`). Defaults: developer, designer, tester, fixer, docs, creative-director, ideator. Use agent_get for the full prompt.',
      inputSchema: z.object({}),
    },
    async () => {
      const agents = getStore().listAgents().map(({ prompt: _prompt, ...meta }) => meta)
      return textResponse(agents.length > 0 ? agents : { message: 'No agent profiles found in .agentboard/agents/. Create one with agent_upsert.' })
    },
  )

  server.registerTool(
    'agent_get',
    {
      title: 'Get specialized agent profile',
      description:
        'Return the full profile of one specialized agent from `.agentboard/agents/<name>.md`, including its prompt. Adopt the returned prompt as your role before working on a task assigned to that agent.',
      inputSchema: z.object({ name: z.string().min(1) }),
    },
    async ({ name }) => {
      try {
        const agent = getStore().getAgent(name)
        return agent ? textResponse(agent) : errorResponse(`Agent not found: ${name} (use agent_list to see the available profiles)`)
      } catch (err) {
        return errorResponse((err as Error).message)
      }
    },
  )

  server.registerTool(
    'agent_upsert',
    {
      title: 'Create or update a specialized agent',
      description:
        'Create a new specialist (e.g. "stripe-expert", "copywriter", "mobile-dev") or update an existing one. It is written to `.agentboard/agents/<name>.md` and immediately generated as a Claude Code subagent in `.claude/agents/<name>.md`, so it can be assigned tasks and launched right away (Claude Code may need a restart to see a brand-new subagent). The prompt should state the role, its mission, its rules and its expected output. Omitted fields keep their current value.',
      inputSchema: z.object({
        name: z.string().regex(ASSIGNEE_SLUG_RE, 'Agent name must be a lowercase slug like "stripe-expert"'),
        description: z.string().min(1).optional().describe('One or two sentences: who this agent is and when to use it.'),
        prompt: z.string().min(1).optional().describe('Markdown system prompt: role, mission, rules, output.'),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
        tags: z.array(z.string()).optional(),
        tools: z.array(z.string()).optional().describe('Claude Code tool allowlist; omit/empty to inherit all tools (MCP included).'),
        model: z.enum(AGENT_MODELS).optional(),
      }),
    },
    async (input) => {
      try {
        const store = getStore()
        const existed = store.listAgents().some((a) => a.name === input.name)
        const agent = store.saveAgent(input)
        return textResponse({ ...agent, created: !existed })
      } catch (err) {
        return errorResponse((err as Error).message)
      }
    },
  )

  server.registerTool(
    'agent_delete',
    {
      title: 'Delete a specialized agent',
      description: 'Delete `.agentboard/agents/<name>.md` and its generated Claude Code subagent. Tasks assigned to it keep the name (agentboard lint will flag them).',
      inputSchema: z.object({ name: z.string().min(1) }),
    },
    async ({ name }) => {
      try {
        getStore().deleteAgent(name)
        return textResponse({ deleted: name })
      } catch (err) {
        return errorResponse((err as Error).message)
      }
    },
  )

  server.registerTool(
    'agent_sync',
    {
      title: 'Sync Claude Code subagents',
      description:
        'Regenerate `.claude/agents/` from `.agentboard/agents/` (idempotent). Hand-written subagents with the same name are never overwritten — they are reported as skipped. Set `installDefaults` to first add any missing default agent.',
      inputSchema: z.object({ installDefaults: z.boolean().optional() }),
    },
    async ({ installDefaults }) => {
      try {
        const store = getStore()
        const installed = installDefaults ? store.installDefaultAgents() : []
        const result = store.syncSubagents()
        if (!result) return textResponse({ installed, message: 'Subagent sync is disabled (subagents: false in .agentboard/config.yaml).' })
        return textResponse({ installed, ...result })
      } catch (err) {
        return errorResponse((err as Error).message)
      }
    },
  )

  // ── sprints ──────────────────────────────────────────────────────────

  server.registerTool(
    'sprint_dispatch',
    {
      title: 'Plan subagent dispatch for a sprint',
      description:
        'Orchestration plan for a sprint (default: the active one; the backlog when none is active). Splits pending tasks into dependency waves — tasks in the same wave are independent and can run in parallel — and names the subagent for each task (its specialized assignee, `developer` for workflow roles). Returns Markdown with launch prompts; call it again after every wave, it is recomputed from the board.',
      inputSchema: z.object({ sprint: z.number().int().positive().optional(), format: z.enum(['markdown', 'json']).optional() }),
    },
    async ({ sprint, format }) => {
      try {
        const store = getStore()
        const plan = planDispatch(store.state, { sprintId: sprint })
        return textResponse(format === 'json' ? plan : buildDispatchPlan(plan, getProjectName()))
      } catch (err) {
        return errorResponse((err as Error).message)
      }
    },
  )

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
        return errorResponse((err as Error).message)
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
        return errorResponse((err as Error).message)
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
        if (!targetId) return errorResponse('No active sprint to close and no sprint id provided.')
        const sprint = store.setSprintStatus(targetId, 'closed', { retro })
        return textResponse(sprint)
      } catch (err) {
        return errorResponse((err as Error).message)
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
        if (!targetId) return errorResponse('No active sprint and no sprint id provided.')
        const sprint = state.sprints.find((s) => s.id === targetId)
        if (!sprint) return errorResponse(`Sprint not found: ${targetId}`)
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
        return errorResponse((err as Error).message)
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
      if (!targetId) return errorResponse('No active sprint and no sprint id provided.')
      const sprint = state.sprints.find((s) => s.id === targetId)
      if (!sprint) return errorResponse(`Sprint not found: ${targetId}`)
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

  server.registerResource(
    'agents',
    'agentboard://agents',
    {
      title: 'Specialized Agents',
      description: 'Specialized agent profiles (roles an AI can adopt) with their prompts',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          text: JSON.stringify(getStore().listAgents(), null, 2),
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
      const spec = task ? buildTaskSpec(task, sprint, getProjectName(), { brand: store.getBrand(), allTasks: state.tasks, learnings: store.getLearnings(), agent: store.agentForTask(task) }) : `Task ${id} not found.`
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
    'run-sprint',
    {
      title: 'Run sprint with subagents',
      description: 'Orchestrate the active sprint: launch one specialized subagent per task, wave by wave, in parallel where dependencies allow.',
      argsSchema: { sprint: z.string().optional().describe('Sprint id (default: the active sprint).') },
    },
    ({ sprint }) => {
      const store = getStore()
      const plan = planDispatch(store.state, { sprintId: sprint ? Number(sprint) : undefined })
      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Run this sprint as the orchestrator. Delegate every task to its subagent exactly as the plan says, launch the tasks of a wave in parallel, verify between waves, and call sprint_dispatch again before each new wave. Stop when nothing is left to dispatch and give me a summary of what is in Review.\n\n${buildDispatchPlan(plan, getProjectName())}`,
            },
          },
        ],
      }
    },
  )

  server.registerPrompt(
    'idea-to-mvp',
    {
      title: 'Idea → MVP',
      description: 'Turn a product idea into a scoped MVP: brand kit, sprint, tasks assigned to specialist subagents with dependencies, then run it.',
      argsSchema: {
        idea: z.string().describe('The product idea, in your own words.'),
        stack: z.string().optional().describe('Preferred tech stack (optional).'),
      },
    },
    ({ idea, stack }) => {
      const store = getStore()
      const agents = store.listAgents()
      const roster = agents.length
        ? agents.map((a) => `- \`${a.name}\` — ${a.description}`).join('\n')
        : '- (no specialized agents yet — run agent_sync with installDefaults: true first)'
      const hasBrand = Boolean(store.getBrand().name)
      const text = `You are the orchestrator turning an idea into a working MVP on the AgentSprint board "${getProjectName()}".

## The idea

${idea}
${stack ? `\n**Preferred stack:** ${stack}\n` : ''}
## Specialists available (Claude Code subagents)

${roster}

## Plan, then build

1. **Shape it (ideator + creative-director).** Launch the \`ideator\` subagent for 3 distinct MVP angles, then the \`creative-director\` to pick one and define the cut: the single core user journey, what is explicitly OUT, and the success check. Ask me only if the idea is genuinely ambiguous.
2. **Brand.** ${hasBrand ? 'A brand kit exists — read it with brand_get and keep to it.' : 'No brand kit yet: write one with brand_update (name, tagline, tone, colors, fonts) that fits the chosen angle.'}
3. **Missing specialists.** If the MVP needs expertise the roster lacks (payments, mobile, data, …), create it with agent_upsert (name, description, prompt with mission/rules/output).
4. **Sprint.** sprint_create with the MVP goal, then sprint_activate.
5. **Tasks.** One task_create_batch call with every task of the MVP (aim for 6–15): each with a verifiable title, 3–6 acceptance criteria, an estimate, \`assignee\` set to the specialist that should build it, \`sprint\` set, and \`dependsOn\` refs. Start with a walking skeleton (project setup + one end-to-end path), then features, then a \`tester\` task and a \`docs\` task (README with how to run it).
6. **Build.** Call sprint_dispatch and follow it: launch every task of a wave in parallel with the Agent tool (\`subagent_type\` = the subagent), verify between waves (tests, typecheck, run the app), send failures to \`fixer\`, and re-dispatch until nothing is left.
7. **Hand over.** Summarize what works, how to run it, what is in Review, and what the next sprint should tackle.

Work in small verifiable steps and keep the board updated — it is the source of truth for the subagents.`
      return { messages: [{ role: 'user', content: { type: 'text', text } }] }
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