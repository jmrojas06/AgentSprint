import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { TaskInput, TaskStatus } from '@agentsprint/core'
import { buildSprintReport, buildTaskSpec, computeSprintStats, findTaskRefs, taskCommitCounts } from '@agentsprint/core'
import type { ProjectHandle, ProjectManager } from './projects.js'
import { readBurndown } from './metrics.js'

function sendError(reply: FastifyReply, status: number, message: string): void {
  reply.code(status).send({ error: message })
}

function projectName(req: FastifyRequest): string | undefined {
  const q = (req.query as Record<string, string> | undefined)?.project
  return q || undefined
}

export async function registerApi(app: FastifyInstance, projects: ProjectManager): Promise<void> {
  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))

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
    const input = req.body as TaskInput
    const h = projects.get(projectName(req))
    try {
      const task = h.store.createTask(input)
      h.index.upsert(task)
      h.broadcast.send('task', task)
      return reply.code(201).send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.get('/api/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const task = projects.get(projectName(req)).store.state.tasks.find((t) => t.id === id)
    if (!task) return sendError(reply, 404, `Task not found: ${id}`)
    return reply.send(task)
  })

  app.get('/api/tasks/:id/spec', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const h = projects.get(projectName(req))
    const state = h.store.state
    const task = state.tasks.find((t) => t.id === id)
    if (!task) return sendError(reply, 404, `Task not found: ${id}`)
    const sprint = task.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
    const spec = buildTaskSpec(task, sprint, state.config.name, { brand: state.brand, allTasks: state.tasks, learnings: h.store.getLearnings() })
    return reply.send({ id, spec })
  })

  app.get('/api/tasks/:id/commits', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const h = projects.get(projectName(req))
    if (!h.store.state.tasks.some((t) => t.id === id)) return sendError(reply, 404, `Task not found: ${id}`)
    const pattern = (req.query as Record<string, string> | undefined)?.pattern
    const refs = await findTaskRefs(h.store.rootDir, id, pattern ? { pattern } : {})
    return reply.send({ id, ...refs })
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

  app.get('/api/git/commit-counts', async (req) => {
    const h = projects.get(projectName(req))
    const ids = h.store.state.tasks.map((t) => t.id)
    return taskCommitCounts(h.store.rootDir, ids)
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
    const body = (req.body ?? {}) as { goal?: string; status?: 'planned' | 'active' | 'closed' }
    const h = projects.get(projectName(req))
    try {
      if (body.status) h.store.setSprintStatus(id, body.status)
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