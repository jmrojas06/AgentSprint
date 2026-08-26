import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
import { buildApp } from './index.js'
import { createIndex } from './indexdb.js'
import { recordBurndownSnapshot } from './metrics.js'
import { clearGitCache, GIT_CACHE_TTL_MS } from './routes.js'
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
      assignee: 'scrum-master',
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

  it('records and serves a daily burndown', async () => {
    await api('patch', '/api/sprints/1', { status: 'active' })
    store.syncFromDisk()
    recordBurndownSnapshot(store)
    const { status, json } = await api('get', '/api/sprints/1/burndown')
    expect(status).toBe(200)
    expect(json().sprintId).toBe(1)
    expect(json().total).toBe(2)
    expect(json().points.length).toBeGreaterThan(0)
    expect(json().points[0].remaining).toBe(2)
  })

  it('returns a markdown sprint report', async () => {
    const { status, json } = await api('get', '/api/sprints/1/report')
    expect(status).toBe(200)
    expect(json().report).toContain('# Sprint 1')
    expect(json().report).toContain('## Tasks')
    expect(json().report).toContain('TK-1')
  })

  it('returns board-wide stats', async () => {
    const { json } = await api('get', '/api/stats')
    expect(json().total).toBe(3)
  })

  describe('git-linked commits', () => {
    function git(...args: string[]): string {
      return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
    }

    beforeEach(() => {
      git('init', '-b', 'main')
      git('config', 'user.name', 'Test User')
      git('config', 'user.email', 'test@example.com')
      execFileSync('git', ['-C', dir, 'add', '-A'])
      fs.writeFileSync(path.join(dir, '.txt'), 'x')
      execFileSync('git', ['-C', dir, 'add', '-A'])
      git('commit', '-m', 'feat: implement TK-1 sample task')
    })

    it('lists commits linked to a task id', async () => {
      const { status, json } = await api('get', '/api/tasks/TK-1/commits')
      expect(status).toBe(200)
      expect(json().gitAvailable).toBe(true)
      expect(json().commits).toHaveLength(1)
      expect(json().commits[0]!.message).toContain('TK-1')
      expect(json().commits[0]!.author).toBe('Test User')
      expect(json().commits[0]!.shortHash).toBeTruthy()
    })

    it('404s for unknown tasks and reports no git when absent', async () => {
      expect((await api('get', '/api/tasks/TK-99/commits')).status).toBe(404)
      const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-server-nogit-'))
      try {
        ProjectStore.init(plain, { sample: true })
        const built = await buildApp({ rootDir: plain })
        try {
          const res = await built.app.inject({ method: 'GET', url: '/api/tasks/TK-1/commits' })
          expect(res.statusCode).toBe(200)
          expect(JSON.parse(res.body).gitAvailable).toBe(false)
        } finally {
          await built.close()
        }
      } finally {
        fs.rmSync(plain, { recursive: true, force: true })
      }
    })

    it('serves commit counts for the board', async () => {
      const { status, json } = await api('get', '/api/git/commit-counts')
      expect(status).toBe(200)
      expect(json()['TK-1']).toBeGreaterThanOrEqual(1)
    })
  })

  it('updates task checklist via PATCH /api/tasks/:id/checklist', async () => {
    const res = await api('patch', '/api/tasks/TK-1/checklist', { index: 0, completed: true })
    expect(res.status).toBe(200)
    expect(res.json().acceptanceCriteria[0]).toContain('[x]')

    const res2 = await api('patch', '/api/tasks/TK-1/checklist', { index: 0, completed: false })
    expect(res2.json().acceptanceCriteria[0]).not.toContain('[x]')
  })

  it('returns and updates the brand', async () => {
    const initial = await api('get', '/api/brand')
    expect(initial.json().name).toBe('')

    const updated = await api('put', '/api/brand', {
      name: 'Acme Labs',
      colors: { primary: '#6366f1' },
      guidelines: 'Use the primary color.',
    })
    expect(updated.status).toBe(200)
    expect(updated.json().name).toBe('Acme Labs')

    const spec = await api('get', '/api/tasks/TK-1/spec')
    expect(spec.json().spec).toContain('## Brand guidelines')
    expect(spec.json().spec).toContain('Acme Labs')
  })

  it('gets and sets memory (learnings)', async () => {
    const initial = await api('get', '/api/memory')
    expect(initial.json().content).toBe('')

    const res = await api('put', '/api/memory', { content: 'Rule: write tests first.' })
    expect(res.status).toBe(200)
    expect(res.json().content).toBe('Rule: write tests first.')

    const fetched = await api('get', '/api/memory')
    expect(fetched.json().content).toBe('Rule: write tests first.')

    const appended = await api('post', '/api/memory/append', { entry: 'Use small commits.' })
    expect(appended.json().content).toContain('Use small commits.')
    expect(appended.json().content).toContain('Rule: write tests first.')
  })

  it('injects learnings into task spec', async () => {
    await api('put', '/api/memory', { content: 'Always validate input.' })
    const spec = await api('get', '/api/tasks/TK-1/spec')
    expect(spec.json().spec).toContain('## Learned principles')
    expect(spec.json().spec).toContain('Always validate input.')
  })

  it('returns the activity timeline for a task', async () => {
    await api('patch', '/api/tasks/TK-1/status', { status: 'In Progress' })
    await api('patch', '/api/tasks/TK-1/checklist', { index: 0, completed: true })
    const res = await api('get', '/api/tasks/TK-1/activity')
    expect(res.status).toBe(200)
    const { id, activity } = res.json()
    expect(id).toBe('TK-1')
    const types = activity.map((e: { type: string }) => e.type)
    expect(types[0]).toBe('created')
    expect(types).toContain('status')
    expect(types).toContain('checklist')

    const missing = await api('get', '/api/tasks/NO-99/activity')
    expect(missing.status).toBe(404)
  })

  it('surfaces parse warnings in /api/project', async () => {
    const bad = path.join(dir, '.agentboard', 'tasks', 'AS-99.md')
    fs.writeFileSync(bad, '---\ntitle: Bad: YAML\nstatus: To Do\n---\n\nboom\n', 'utf8')

    const built2 = await buildApp({ rootDir: dir })
    const res = await built2.app.inject({ method: 'GET', url: '/api/project' })
    expect(res.statusCode).toBe(200)
    expect(res.json().warnings.length).toBeGreaterThan(0)
    await built2.close()

    fs.rmSync(bad)
  })

  describe('git commit cache (TTL)', () => {
    function git(...args: string[]): string {
      return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
    }

    beforeEach(() => {
      clearGitCache()
      // ensure repo exists for these tests (some outer afterEach clears dir)
      try {
        git('rev-parse', '--git-dir')
      } catch {
        git('init', '-b', 'main')
        git('config', 'user.name', 'Test User')
        git('config', 'user.email', 'test@example.com')
        fs.writeFileSync(path.join(dir, '.txt'), 'x')
        execFileSync('git', ['-C', dir, 'add', '-A'])
        git('commit', '-m', 'feat: implement TK-1 sample task')
      }
    })

    afterEach(() => {
      vi.useRealTimers()
      clearGitCache()
    })

    it('returns MISS then HIT within TTL for /api/git/commit-counts and MISS again after TTL', async () => {
      vi.useFakeTimers()
      clearGitCache()

      const first = await app.inject({ method: 'GET', url: '/api/git/commit-counts' })
      expect(first.statusCode).toBe(200)
      expect(first.headers['x-cache']).toBe('MISS')

      const second = await app.inject({ method: 'GET', url: '/api/git/commit-counts' })
      expect(second.statusCode).toBe(200)
      expect(second.headers['x-cache']).toBe('HIT')
      expect(second.body).toBe(first.body)

      vi.advanceTimersByTime(GIT_CACHE_TTL_MS + 100)

      const third = await app.inject({ method: 'GET', url: '/api/git/commit-counts' })
      expect(third.statusCode).toBe(200)
      expect(third.headers['x-cache']).toBe('MISS')
    })

    it('caches /api/tasks/:id/commits per pattern and uses distinct keys', async () => {
      vi.useFakeTimers()
      clearGitCache()

      const a1 = await app.inject({ method: 'GET', url: '/api/tasks/TK-1/commits' })
      expect(a1.statusCode).toBe(200)
      expect(a1.headers['x-cache']).toBe('MISS')

      const a2 = await app.inject({ method: 'GET', url: '/api/tasks/TK-1/commits' })
      expect(a2.headers['x-cache']).toBe('HIT')
      expect(a2.body).toBe(a1.body)

      const b1 = await app.inject({ method: 'GET', url: '/api/tasks/TK-1/commits?pattern=%5Efeat%2F%25ID%25' })
      expect(b1.statusCode).toBe(200)
      expect(b1.headers['x-cache']).toBe('MISS')

      const b2 = await app.inject({ method: 'GET', url: '/api/tasks/TK-1/commits?pattern=%5Efeat%2F%25ID%25' })
      expect(b2.headers['x-cache']).toBe('HIT')
      expect(b2.body).toBe(b1.body)

      // default pattern still HIT (different key from custom)
      const a3 = await app.inject({ method: 'GET', url: '/api/tasks/TK-1/commits' })
      expect(a3.headers['x-cache']).toBe('HIT')

      vi.advanceTimersByTime(GIT_CACHE_TTL_MS + 100)

      const a4 = await app.inject({ method: 'GET', url: '/api/tasks/TK-1/commits' })
      expect(a4.headers['x-cache']).toBe('MISS')
    })

    it('exports clearGitCache helper and respects manual invalidation', async () => {
      clearGitCache()
      const r1 = await app.inject({ method: 'GET', url: '/api/git/commit-counts' })
      expect(r1.headers['x-cache']).toBe('MISS')
      const r2 = await app.inject({ method: 'GET', url: '/api/git/commit-counts' })
      expect(r2.headers['x-cache']).toBe('HIT')
      clearGitCache()
      const r3 = await app.inject({ method: 'GET', url: '/api/git/commit-counts' })
      expect(r3.headers['x-cache']).toBe('MISS')
    })
  })
})

describe('multi-project', () => {
  function parseMcpRes(body: string): unknown {
    if (body.startsWith('event:')) {
      const data = body
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n')
      return JSON.parse(data)
    }
    return JSON.parse(body)
  }

  async function mcpCall(a: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never, sessionId: string, id: number, method: string, params: Record<string, unknown>) {
    return a.app.inject({
      method: 'POST',
      url: '/mcp',
      payload: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-session-id': sessionId },
    })
  }

  it('discovers projects, scopes routes by ?project= and lets the MCP switch active project', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-multi-'))
    try {
      ProjectStore.init(path.join(base, 'math'), { sample: true })
      ProjectStore.init(path.join(base, 'ai'), { sample: true })
      const built = await buildApp({ rootDir: base, mcp: true })
      const a = built.app

      const list = await a.inject({ method: 'GET', url: '/api/projects' })
      expect(list.statusCode).toBe(200)
      const projects = list.json() as Array<{ name: string; rootDir: string }>
      expect(projects.map((p) => p.name).sort()).toEqual(['ai', 'math'])

      const defaultProject = await a.inject({ method: 'GET', url: '/api/project' })
      expect(defaultProject.json().rootDir).toBe(path.join(base, 'ai'))

      const scoped = await a.inject({ method: 'GET', url: '/api/project?project=math' })
      expect(scoped.json().rootDir).toBe(path.join(base, 'math'))

      const created = await a.inject({
        method: 'POST',
        url: '/api/tasks?project=math',
        payload: { title: 'Only in math', description: 'x', priority: 'medium', assignee: 'scrum-master' },
      })
      expect(created.statusCode).toBe(201)
      const otherProject = await a.inject({ method: 'GET', url: '/api/tasks?project=ai' })
      expect(otherProject.json().some((t: { title: string }) => t.title === 'Only in math')).toBe(false)

      // MCP: initialize a session, switch active project, verify scoping
      const init = await a.inject({
        method: 'POST',
        url: '/mcp',
        payload: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
        }),
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      })
      const sessionId = String(init.headers['mcp-session-id'])
      await mcpCall(built, sessionId, 2, 'notifications/initialized', {}).catch(() => {})

      const listRes = await mcpCall(built, sessionId, 3, 'tools/call', {
        name: 'project_list',
        arguments: {},
      })
      const projList = (parseMcpRes(listRes.body) as { result: { content: Array<{ text: string }> } }).result.content[0]!.text
      const parsed = JSON.parse(projList) as Array<{ name: string }>
      expect(parsed.map((p) => p.name).sort()).toEqual(['ai', 'math'])

      const useRes = await mcpCall(built, sessionId, 4, 'tools/call', {
        name: 'project_use',
        arguments: { name: 'math' },
      })
      expect((parseMcpRes(useRes.body) as { result: { content: Array<{ text: string }> } }).result.content[0]!.text).toContain('math')

      const currentRes = await mcpCall(built, sessionId, 5, 'tools/call', {
        name: 'project_current',
        arguments: {},
      })
      expect((parseMcpRes(currentRes.body) as { result: { content: Array<{ text: string }> } }).result.content[0]!.text).toContain('"name": "math"')

      const badUse = await mcpCall(built, sessionId, 6, 'tools/call', {
        name: 'project_use',
        arguments: { name: 'nope' },
      })
      expect((parseMcpRes(badUse.body) as { result: { content: Array<{ text: string }> }       }).result.content[0]!.text).toContain('Unknown project')

      const tasksRes = await mcpCall(built, sessionId, 7, 'tools/call', {
        name: 'task_list',
        arguments: {},
      })
      const tasksText = (parseMcpRes(tasksRes.body) as { result: { content: Array<{ text: string }> } }).result.content[0]!.text
      expect(tasksText).toContain('Only in math')

      await built.close()
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})

describe('MCP over HTTP', () => {
  function parseMcpRes(body: string): unknown {
    if (body.startsWith('event:')) {
      const data = body
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n')
      return JSON.parse(data)
    }
    return JSON.parse(body)
  }

  it('serves initialize and tools/list at /mcp', async () => {
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-mcp-http-'))
    try {
      ProjectStore.init(dir2, { sample: true })
      const built = await buildApp({ rootDir: dir2, mcp: true })
      const a = built.app
      const accept = { accept: 'application/json, text/event-stream' }

      const init = await a.inject({
        method: 'POST',
        url: '/mcp',
        payload: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0.0' } },
        }),
        headers: { 'content-type': 'application/json', ...accept },
      })
      expect(init.statusCode).toBe(200)
      expect((parseMcpRes(init.body) as { result: { capabilities: { tools: unknown } } }).result.capabilities.tools).toBeDefined()
      const sessionId = init.headers['mcp-session-id']
      expect(sessionId).toBeTruthy()

      const notify = await a.inject({
        method: 'POST',
        url: '/mcp',
        payload: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        headers: { 'content-type': 'application/json', ...accept, 'mcp-session-id': sessionId! },
      })
      expect(notify.statusCode).toBe(202)

      const list = await a.inject({
        method: 'POST',
        url: '/mcp',
        payload: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        headers: { 'content-type': 'application/json', ...accept, 'mcp-session-id': sessionId! },
      })
      expect(list.statusCode).toBe(200)
      const tools = (parseMcpRes(list.body) as { result: { tools: Array<{ name: string }> } }).result.tools
      expect(tools.length).toBe(28)
      const names = tools.map((t) => t.name)
      expect(names).toContain('project_list')
      expect(names).toContain('export_board')
      expect(names).toContain('task_release')
      expect(names).toContain('template_list')
      expect(names).toContain('project_current')
      expect(names).toContain('project_use')
      expect(names).toContain('sprint_create')
      expect(names).toContain('sprint_close')
      expect(names).toContain('sprint_report')
      expect(names).toContain('task_delete')
      expect(names).toContain('task_checklist')
      expect(names).toContain('task_note')
      expect(names).toContain('brand_update')
      expect(names).toContain('learnings_get')
      expect(names).toContain('learnings_append')

      await built.close()
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true })
    }
  })
})

describe('createIndex', () => {
  it('uses a real SQLite file (regression: tsup used to rewrite node:sqlite)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-index-'))
    const dbPath = path.join(dir, 'search.db')
    try {
      const task: import('@jmrojas06/agentsprint-core').Task = {
        id: 'TK-42',
        title: 'Hello from the index',
        status: 'To Do',
        sprint: 1,
        priority: 'medium',
assignee: 'scrum-master',
        estimate: 0,
        tags: [],
        dependencies: [],
        acceptanceCriteria: [],
        description: '',
        notes: '',
        activity: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
      const index = await createIndex(dbPath)
      index.rebuild([task])
      expect(index.search('hello').length).toBe(1)
      expect(index.search('nope').length).toBe(0)
      await new Promise((r) => setTimeout(r, 50))
      expect(fs.existsSync(dbPath)).toBe(true)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
