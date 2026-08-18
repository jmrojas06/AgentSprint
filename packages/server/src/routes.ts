import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { TaskInput, TaskStatus } from '@agentsprint/core'
import { buildTaskSpec, computeSprintStats } from '@agentsprint/core'
import type { ProjectHandle, ProjectManager } from './projects.js'

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
    const spec = buildTaskSpec(task, sprint, state.config.name, state.brand)
    return reply.send({ id, spec })
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

  // ── sprints ──────────────────────────────────────────────────────────

  app.get('/api/sprints', async (req) => projects.get(projectName(req)).store.state.sprints)

  app.get('/api/sprints/:id/stats', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const store = projects.get(projectName(req)).store
    if (!store.state.sprints.some((s) => s.id === id)) return sendError(reply, 404, `Sprint not found: ${id}`)
    return reply.send(computeSprintStats(store.state.tasks, id))
  })

  app.get('/api/stats', async (req) => {
    const store = projects.get(projectName(req)).store
    return computeSprintStats(store.state.tasks, null)
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

  // ── events (SSE) ─────────────────────────────────────────────────────

  app.get('/api/events', async (req, reply) => {
    projects.get(projectName(req)).broadcast.subscribe(reply)
  })
}