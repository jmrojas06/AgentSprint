import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { TaskInput, TaskStatus } from '@jmrojas06/agentsprint-core'
import { buildDispatchPlan, buildIdeaToMvpPrompt, buildSprintReport, buildTaskSpec, computeSprintStats, discoverSkills, findTaskRefs, missingSkills, planDispatch, snapshotProject, taskCommitCounts } from '@jmrojas06/agentsprint-core'
import type { ReviewVerdict } from '@jmrojas06/agentsprint-core'
import type { ProjectManager } from './projects.js'
import { readBurndown } from './metrics.js'
import { BUILD_INFO } from './build.js'

// ── git cache ────────────────────────────────────────────────────────────
// In-memory per-process cache with TTL for git-heavy endpoints.
// TTL: `gitCacheTtlMs` server option, else AGENTBOARD_GIT_CACHE_TTL_MS,
// else 10s; 0 disables caching. Commits are created outside the board via
// git, so after TTL expiry the next request re-executes `git log`.
// Observability: every response carries `X-Cache: HIT | MISS`.
// Key = repo path + suffix (counts vs refs) + optional pattern/task id.
export const GIT_CACHE_TTL_MS = 10_000

type CacheEntry<T> = { value: T; expiresAt: number }
const gitCache = new Map<string, CacheEntry<unknown>>()

/** Manual invalidation: called by the board watcher on every board change. */
export function clearGitCache(): void {
  gitCache.clear()
}

function getCached<T>(key: string): T | undefined {
  const entry = gitCache.get(key) as CacheEntry<T> | undefined
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    gitCache.delete(key)
    return undefined
  }
  return entry.value
}

function setCached<T>(key: string, value: T, ttlMs: number): void {
  const now = Date.now()
  // Drop expired entries so distinct ?pattern= keys cannot grow the map forever.
  for (const [k, entry] of gitCache) if (entry.expiresAt <= now) gitCache.delete(k)
  gitCache.set(key, { value, expiresAt: now + ttlMs })
}

function sendError(reply: FastifyReply, status: number, message: string): void {
  reply.code(status).send({ error: message })
}

function projectName(req: FastifyRequest): string | undefined {
  const q = (req.query as Record<string, string> | undefined)?.project
  return q || undefined
}

export async function registerApi(app: FastifyInstance, projects: ProjectManager, gitCacheTtlMs = GIT_CACHE_TTL_MS): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, ...BUILD_INFO }))

  app.get('/api/projects', async () => projects.list())

  app.get('/api/project', async (req, reply) => {
    const { store, index } = projects.get(projectName(req))
    index.rebuild(store.state.tasks)
    return reply.send({ ...store.state, warnings: [...store.lastWarnings] })
  })

  // ── tasks ────────────────────────────────────────────────────────────

  app.get('/api/tasks', async (req, reply) => {
    const q = (req.query as Record<string, string>).q ?? ''
    const status = (req.query as Record<string, string>).status
    const sprint = (req.query as Record<string, string>).sprint
    const assignee = (req.query as Record<string, string>).assignee
    return reply.send(projects.get(projectName(req)).index.search(q, { status, sprint, assignee }))
  })

  app.post('/api/tasks', async (req, reply) => {
    const { template, vars, ...input } = (req.body ?? {}) as TaskInput & {
      template?: string
      vars?: Record<string, string>
    }
    const h = projects.get(projectName(req))
    try {
      const task = template
        ? h.store.createTaskFromTemplate(template, { vars, overrides: input })
        : h.store.createTask(input)
      h.index.upsert(task)
      h.broadcast.send('task', task)
      return reply.code(201).send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.get('/api/templates', async (req) => projects.get(projectName(req)).store.listTemplates())

  app.post('/api/tasks/batch', async (req, reply) => {
    const { tasks } = (req.body ?? {}) as { tasks?: Array<TaskInput & { ref?: string; dependsOn?: string[] }> }
    if (!Array.isArray(tasks)) return sendError(reply, 400, 'Body must be { tasks: [...] }')
    const h = projects.get(projectName(req))
    try {
      const created = h.store.createTaskBatch(tasks)
      for (const task of created) h.index.upsert(task)
      h.broadcast.send('change', { project: h.info.name, at: new Date().toISOString() })
      return reply.code(201).send(created)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── specialized agents ───────────────────────────────────────────────

  app.get('/api/agents', async (req) => projects.get(projectName(req)).store.listAgents())

  app.put('/api/agents/:name', async (req, reply) => {
    const name = (req.params as { name: string }).name
    const h = projects.get(projectName(req))
    try {
      const agent = h.store.saveAgent({ ...((req.body ?? {}) as object), name })
      h.broadcast.send('change', { project: h.info.name, at: new Date().toISOString() })
      return reply.send(agent)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.delete('/api/agents/:name', async (req, reply) => {
    const name = (req.params as { name: string }).name
    const h = projects.get(projectName(req))
    try {
      h.store.deleteAgent(name)
      h.broadcast.send('change', { project: h.info.name, at: new Date().toISOString() })
      return reply.code(204).send()
    } catch (err) {
      const message = (err as Error).message
      return sendError(reply, /not found/i.test(message) ? 404 : 400, message)
    }
  })

  app.post('/api/agents/sync', async (req, reply) => {
    const { installDefaults } = (req.body ?? {}) as { installDefaults?: boolean }
    const h = projects.get(projectName(req))
    try {
      const installed = installDefaults ? h.store.installDefaultAgents() : []
      const result = h.store.syncSubagents()
      return reply.send({ installed, enabled: result !== null, ...(result ?? {}) })
    } catch (err) {
      return sendError(reply, 500, (err as Error).message)
    }
  })

  app.get('/api/skills', async (req) => {
    const { store } = projects.get(projectName(req))
    const skills = discoverSkills(store.rootDir)
    return { skills, missing: missingSkills(store.listAgents(), skills) }
  })

  app.get('/api/dispatch', async (req, reply) => {
    const raw = (req.query as Record<string, string>).sprint
    const sprintId = raw ? Number(raw) : undefined
    if (raw && (!Number.isInteger(sprintId) || sprintId! <= 0)) return sendError(reply, 400, 'sprint must be a positive integer')
    const { store } = projects.get(projectName(req))
    try {
      const plan = planDispatch(store.state, { sprintId })
      return reply.send({ plan, markdown: buildDispatchPlan(plan, store.getConfig().name) })
    } catch (err) {
      return sendError(reply, 404, (err as Error).message)
    }
  })

  app.get('/api/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const task = projects.get(projectName(req)).store.state.tasks.find((t) => t.id === id)
    if (!task) return sendError(reply, 404, `Task not found: ${id}`)
    return reply.send(task)
  })

  app.get('/api/tasks/:id/activity', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const task = projects.get(projectName(req)).store.state.tasks.find((t) => t.id === id)
    if (!task) return sendError(reply, 404, `Task not found: ${id}`)
    return reply.send({ id, activity: task.activity })
  })

  app.get('/api/tasks/:id/spec', async (req, reply) => {    const id = (req.params as { id: string }).id
    const h = projects.get(projectName(req))
    const state = h.store.state
    const task = state.tasks.find((t) => t.id === id)
    if (!task) return sendError(reply, 404, `Task not found: ${id}`)
    const sprint = task.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
    const spec = buildTaskSpec(task, sprint, state.config.name, { brand: state.brand, allTasks: state.tasks, learnings: h.store.getLearnings(), agent: h.store.agentForTask(task) })
    return reply.send({ id, spec })
  })

  app.get('/api/tasks/:id/commits', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const h = projects.get(projectName(req))
    if (!h.store.state.tasks.some((t) => t.id === id)) return sendError(reply, 404, `Task not found: ${id}`)
    const pattern = (req.query as Record<string, string> | undefined)?.pattern
    try {
      const cacheKey = `${h.store.rootDir}::refs:${id}:${pattern ?? ''}`
      const cached = getCached<import('@jmrojas06/agentsprint-core').TaskGitRefs>(cacheKey)
      if (cached) {
        reply.header('X-Cache', 'HIT')
        return reply.send({ id, ...cached })
      }
      const refs = await findTaskRefs(h.store.rootDir, id, pattern ? { pattern } : {})
      setCached(cacheKey, refs, gitCacheTtlMs)
      reply.header('X-Cache', 'MISS')
      return reply.send({ id, ...refs })
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.put('/api/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const patch = req.body as Partial<TaskInput>
    const h = projects.get(projectName(req))
    try {
      const task = h.store.updateTask(id, patch)
      h.index.upsert(task)
      h.broadcast.send('task', task)
      return reply.send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.patch('/api/tasks/:id/status', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const { status } = req.body as { status: TaskStatus }
    const h = projects.get(projectName(req))
    try {
      const task = h.store.setTaskStatus(id, status)
      h.index.upsert(task)
      h.broadcast.send('task', task)
      return reply.send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.delete('/api/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const h = projects.get(projectName(req))
    try {
      h.store.deleteTask(id)
      h.index.remove(id)
      h.broadcast.send('task:deleted', { id })
      return reply.code(204).send()
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.patch('/api/tasks/:id/checklist', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const { index, text, completed } = req.body as { index?: number; text?: string; completed?: boolean }
    const h = projects.get(projectName(req))
    try {
      const task = h.store.setTaskChecklist(id, { index, text, completed })
      h.index.upsert(task)
      h.broadcast.send('task', task)
      return reply.send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── sprints ──────────────────────────────────────────────────────────

  app.get('/api/sprints', async (req) => projects.get(projectName(req)).store.state.sprints)

  app.get('/api/sprints/:id/stats', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const store = projects.get(projectName(req)).store
    if (!store.state.sprints.some((s) => s.id === id)) return sendError(reply, 404, `Sprint not found: ${id}`)
    return reply.send(computeSprintStats(store.state.tasks, id))
  })

  app.get('/api/sprints/:id/burndown', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const store = projects.get(projectName(req)).store
    if (!store.state.sprints.some((s) => s.id === id)) return sendError(reply, 404, `Sprint not found: ${id}`)
    const total = store.state.tasks.filter((t) => t.sprint === id).length
    const { startedAt, points } = readBurndown(store, id)
    return reply.send({ sprintId: id, total, startedAt, points })
  })

  app.get('/api/sprints/:id/report', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const store = projects.get(projectName(req)).store
    const state = store.state
    const sprint = state.sprints.find((s) => s.id === id)
    if (!sprint) return sendError(reply, 404, `Sprint not found: ${id}`)
    const report = buildSprintReport(sprint, state.tasks, state.config.workflow.statuses)
    return reply.send({ report })
  })

  app.get('/api/stats', async (req) => {
    const store = projects.get(projectName(req)).store
    return computeSprintStats(store.state.tasks, null)
  })

  // ── git links ────────────────────────────────────────────────────────

  app.get('/api/git/commit-counts', async (req, reply) => {
    const h = projects.get(projectName(req))
    const cacheKey = `${h.store.rootDir}::commit-counts`
    const cached = getCached<Record<string, number>>(cacheKey)
    if (cached) {
      reply.header('X-Cache', 'HIT')
      return reply.send(cached)
    }
    const ids = h.store.state.tasks.map((t) => t.id)
    const counts = await taskCommitCounts(h.store.rootDir, ids)
    setCached(cacheKey, counts, gitCacheTtlMs)
    reply.header('X-Cache', 'MISS')
    return reply.send(counts)
  })

  app.post('/api/sprints', async (req, reply) => {
    const { goal } = (req.body ?? {}) as { goal?: string }
    const h = projects.get(projectName(req))
    const sprint = h.store.createSprint(goal ?? '')
    h.broadcast.send('sprint', sprint)
    return reply.code(201).send(sprint)
  })

  app.patch('/api/sprints/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const body = (req.body ?? {}) as { goal?: string; status?: 'planned' | 'active' | 'closed'; retro?: boolean }
    const h = projects.get(projectName(req))
    try {
      if (body.status) h.store.setSprintStatus(id, body.status, { retro: body.retro })
      if (body.goal != null) h.store.updateSprint(id, { goal: body.goal })
      const sprint = h.store.state.sprints.find((s) => s.id === id)
      if (!sprint) return sendError(reply, 404, `Sprint not found: ${id}`)
      h.broadcast.send('sprint', sprint)
      return reply.send(sprint)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── config ───────────────────────────────────────────────────────────

  app.get('/api/config', async (req) => projects.get(projectName(req)).store.getConfig())

  app.put('/api/config', async (req, reply) => {
    const h = projects.get(projectName(req))
    try {
      const config = h.store.updateConfig(req.body as never)
      h.broadcast.send('config', config)
      return reply.send(config)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── brand ────────────────────────────────────────────────────────────

  app.get('/api/brand', async (req) => projects.get(projectName(req)).store.getBrand())

  app.put('/api/brand', async (req, reply) => {
    const h = projects.get(projectName(req))
    try {
      const brand = h.store.updateBrand(req.body as never)
      h.broadcast.send('brand', brand)
      return reply.send(brand)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── session continuity ───────────────────────────────────────────────

  app.get('/api/context', async (req) => {
    const { store } = projects.get(projectName(req))
    const state = store.state
    const journal = store.getJournal()
    return {
      markdown: store.buildContext(),
      snapshot: snapshotProject({ tasks: state.tasks, activeSprint: state.activeSprint, journal }),
      journal: journal.slice(-10).reverse(),
    }
  })

  app.post('/api/journal', async (req, reply) => {
    const h = projects.get(projectName(req))
    try {
      const entry = h.store.appendJournal((req.body ?? {}) as Parameters<typeof h.store.appendJournal>[0])
      h.broadcast.send('change', { project: h.info.name, at: new Date().toISOString() })
      return reply.code(201).send(entry)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.post('/api/tasks/:id/review', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const body = (req.body ?? {}) as { reviewer?: string; verdict?: ReviewVerdict; summary?: string; findings?: string[] }
    if (body.verdict !== 'approve' && body.verdict !== 'changes') return sendError(reply, 400, 'verdict must be "approve" or "changes"')
    const h = projects.get(projectName(req))
    try {
      const task = h.store.reviewTask(id, { reviewer: body.reviewer?.trim() || 'user', verdict: body.verdict, summary: body.summary, findings: body.findings })
      h.index.upsert(task)
      h.broadcast.send('task', task)
      return reply.send(task)
    } catch (err) {
      const message = (err as Error).message
      return sendError(reply, /not found/i.test(message) ? 404 : 400, message)
    }
  })

  // Same text as the MCP `idea-to-mvp` prompt, to paste into Claude Code as a message.
  app.post('/api/prompts/idea-to-mvp', async (req, reply) => {
    const { idea, stack, scope } = (req.body ?? {}) as { idea?: unknown; stack?: unknown; scope?: unknown }
    if (typeof idea !== 'string' || !idea.trim()) return sendError(reply, 400, 'idea is required')
    if (stack != null && typeof stack !== 'string') return sendError(reply, 400, 'stack must be a string')
    if (scope != null && typeof scope !== 'string') return sendError(reply, 400, 'scope must be a string')
    const { store } = projects.get(projectName(req))
    const text = buildIdeaToMvpPrompt({ idea, stack: stack ?? undefined, scope: scope ?? undefined, projectName: store.getConfig().name || '', agents: store.listAgents(), hasBrand: Boolean(store.getBrand().name) })
    return reply.send({ text })
  })

  // ── memory (learnings) ───────────────────────────────────────────────────

  app.get('/api/memory', async (req) => {
    const { store } = projects.get(projectName(req))
    return { content: store.getLearnings() }
  })

  app.put('/api/memory', async (req, reply) => {
    const h = projects.get(projectName(req))
    const { content } = req.body as { content: string }
    h.store.setLearnings(content)
    h.broadcast.send('memory', { content })
    return reply.send({ content })
  })

  app.post('/api/memory/append', async (req, reply) => {
    const h = projects.get(projectName(req))
    const { entry } = req.body as { entry: string }
    const content = h.store.appendLearning(entry)
    h.broadcast.send('memory', { content })
    return reply.send({ content })
  })

  // ── events (SSE) ─────────────────────────────────────────────────────

  app.get('/api/events', async (req, reply) => {
    projects.get(projectName(req)).broadcast.subscribe(reply)
  })
}