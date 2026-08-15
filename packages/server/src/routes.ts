import type { FastifyInstance, FastifyReply } from 'fastify'
import type { ProjectStore, TaskInput, TaskStatus } from '@agentsprint/core'
import { buildTaskSpec, computeSprintStats } from '@agentsprint/core'
import type { Broadcast } from './broadcast.js'
import type { TaskIndex } from './indexdb.js'

export interface ApiDeps {
  store: ProjectStore
  index: TaskIndex
  broadcast: Broadcast
}

function sendError(reply: FastifyReply, status: number, message: string): void {
  reply.code(status).send({ error: message })
}

export async function registerApi(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { store, index, broadcast } = deps

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }))

  app.get('/api/project', async (_req, reply) => {
    const state = store.state
    index.rebuild(state.tasks)
    return reply.send(state)
  })

  // ── tasks ────────────────────────────────────────────────────────────

  app.get('/api/tasks', async (req, reply) => {
    const q = (req.query as Record<string, string>).q ?? ''
    const status = (req.query as Record<string, string>).status
    const sprint = (req.query as Record<string, string>).sprint
    const assignee = (req.query as Record<string, string>).assignee
    return reply.send(index.search(q, { status, sprint, assignee }))
  })

  app.post('/api/tasks', async (req, reply) => {
    const input = req.body as TaskInput
    try {
      const task = store.createTask(input)
      index.upsert(task)
      broadcast.send('task', task)
      return reply.code(201).send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.get('/api/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const task = store.state.tasks.find((t) => t.id === id)
    if (!task) return sendError(reply, 404, `Task not found: ${id}`)
    return reply.send(task)
  })

  app.get('/api/tasks/:id/spec', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const state = store.state
    const task = state.tasks.find((t) => t.id === id)
    if (!task) return sendError(reply, 404, `Task not found: ${id}`)
    const sprint = task.sprint != null ? state.sprints.find((s) => s.id === task.sprint) ?? null : null
    const spec = buildTaskSpec(task, sprint, state.config.name)
    return reply.send({ id, spec })
  })

  app.put('/api/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const patch = req.body as Partial<TaskInput>
    try {
      const task = store.updateTask(id, patch)
      index.upsert(task)
      broadcast.send('task', task)
      return reply.send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.patch('/api/tasks/:id/status', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const { status } = req.body as { status: TaskStatus }
    try {
      const task = store.setTaskStatus(id, status)
      index.upsert(task)
      broadcast.send('task', task)
      return reply.send(task)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  app.delete('/api/tasks/:id', async (req, reply) => {
    const id = (req.params as { id: string }).id
    try {
      store.deleteTask(id)
      index.remove(id)
      broadcast.send('task:deleted', { id })
      return reply.code(204).send()
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── sprints ──────────────────────────────────────────────────────────

  app.get('/api/sprints', async () => store.state.sprints)

  app.get('/api/sprints/:id/stats', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!store.state.sprints.some((s) => s.id === id)) return sendError(reply, 404, `Sprint not found: ${id}`)
    return reply.send(computeSprintStats(store.state.tasks, id))
  })

  app.get('/api/stats', async () => computeSprintStats(store.state.tasks, null))

  app.post('/api/sprints', async (req, reply) => {
    const { goal } = (req.body ?? {}) as { goal?: string }
    const sprint = store.createSprint(goal ?? '')
    broadcast.send('sprint', sprint)
    return reply.code(201).send(sprint)
  })

  app.patch('/api/sprints/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const body = (req.body ?? {}) as { goal?: string; status?: 'planned' | 'active' | 'closed' }
    try {
      if (body.status) store.setSprintStatus(id, body.status)
      if (body.goal != null) store.updateSprint(id, { goal: body.goal })
      const sprint = store.state.sprints.find((s) => s.id === id)
      if (!sprint) return sendError(reply, 404, `Sprint not found: ${id}`)
      broadcast.send('sprint', sprint)
      return reply.send(sprint)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── config ───────────────────────────────────────────────────────────

  app.get('/api/config', async () => store.getConfig())

  app.put('/api/config', async (req, reply) => {
    try {
      const config = store.updateConfig(req.body as never)
      broadcast.send('config', config)
      return reply.send(config)
    } catch (err) {
      return sendError(reply, 400, (err as Error).message)
    }
  })

  // ── events (SSE) ─────────────────────────────────────────────────────

  app.get('/api/events', async (_req, reply) => {
    broadcast.subscribe(reply)
  })
}
