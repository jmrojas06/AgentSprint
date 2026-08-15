import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore } from '@agentsprint/core'
import { buildApp } from './index.js'
import type { FastifyInstance } from 'fastify'

let dir: string
let app: FastifyInstance
let store: ProjectStore
let close: () => Promise<void>

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-server-'))
  store = ProjectStore.init(dir, { sample: true })
  const built = await buildApp({ rootDir: dir })
  app = built.app
  close = built.close
})

afterEach(async () => {
  await close()
  fs.rmSync(dir, { recursive: true, force: true })
})

async function api(method: 'get' | 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    ...(body !== undefined
      ? { payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
  return { status: res.statusCode, json: () => (res.body ? JSON.parse(res.body) : null) }
}

describe('server API', () => {
  it('serves project state', async () => {
    const { status, json } = await api('get', '/api/project')
    expect(status).toBe(200)
    const state = json()
    expect(state.tasks).toHaveLength(3)
    expect(state.sprints).toHaveLength(1)
  })

  it('creates and fetches tasks', async () => {
    const { status, json } = await api('post', '/api/tasks', {
      title: 'From API',
      sprint: 1,
      priority: 'high',
      assignee: 'agent',
    })
    expect(status).toBe(201)
    const task = json()
    expect(task.id).toBe('TK-4')

    const list = await api('get', '/api/tasks?status=To%20Do')
    expect(list.json().some((t: { title: string }) => t.title === 'From API')).toBe(true)
  })

  it('updates status', async () => {
    const res = await api('patch', '/api/tasks/TK-1/status', { status: 'Review' })
    expect(res.status).toBe(200)
    expect(res.json().status).toBe('Review')
  })

  it('searches by q', async () => {
    const { json } = await api('get', '/api/tasks?q=sprint+goals')
    const tasks = json() as Array<{ id: string }>
    expect(tasks.some((t) => t.id === 'TK-2')).toBe(true)
  })

  it('rejects bad sprint on create', async () => {
    const { status } = await api('post', '/api/tasks', { title: 'Bad', sprint: 99 })
    expect(status).toBe(400)
  })

  it('creates and activates a sprint', async () => {
    const created = await api('post', '/api/sprints', { goal: 'Second' })
    expect(created.status).toBe(201)
    const id = created.json().id
    const activated = await api('patch', `/api/sprints/${id}`, { status: 'active' })
    expect(activated.json().status).toBe('active')
    const state = await api('get', '/api/project')
    expect(state.json().activeSprint?.id).toBe(id)
  })

  it('deletes tasks', async () => {
    const del = await api('delete', '/api/tasks/TK-3')
    expect(del.status).toBe(204)
    const state = await api('get', '/api/project')
    expect(state.json().tasks).toHaveLength(2)
  })

  it('returns a task spec', async () => {
    const { status, json } = await api('get', '/api/tasks/TK-1/spec')
    expect(status).toBe(200)
    expect(json().spec).toContain('# TK-1')
    expect(json().spec).toContain('## Acceptance criteria')
  })

  it('returns sprint stats', async () => {
    const { status, json } = await api('get', '/api/sprints/1/stats')
    expect(status).toBe(200)
    expect(json().total).toBe(2)
    expect(json().completionPct).toBe(0)
  })

  it('returns board-wide stats', async () => {
    const { json } = await api('get', '/api/stats')
    expect(json().total).toBe(3)
  })
})
