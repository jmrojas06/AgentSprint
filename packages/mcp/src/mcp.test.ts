import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ProjectStore } from '@agentsprint/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMcpServer } from './index.js'

let dir: string
let store: ProjectStore
let client: Client

type ToolResult = { content: Array<{ type: string; text: string }>; isError?: boolean }

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  if (result.isError) throw new Error(result.content[0]?.text)
  return JSON.parse(result.content[0]?.text ?? 'null')
}



afterEach(async () => {
  if (client) await client.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-'))
  await fs.promises.mkdir(path.join(dir, '.agentboard'), { recursive: true })
  store = await ProjectStore.init(dir, { sample: true })
  const server = await createMcpServer(dir, { store })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(clientTransport)
})

describe('MCP tools', () => {
  it('board_summary returns counts and active sprint', async () => {
    const summary = (await callTool('board_summary', {})) as { activeSprint: { id: number } | null; counts: { total: number } }
    expect(summary.counts.total).toBe(3)
    expect(summary.activeSprint).toBeNull()
  })

  it('task_list filters by status', async () => {
    const tasks = (await callTool('task_list', { status: 'In Progress' })) as Array<{ id: string }>
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.id).toBe('TK-2')
  })

  it('task_get returns a task by id', async () => {
    const task = (await callTool('task_get', { id: 'TK-1' })) as { title: string }
    expect(task.title).toContain('task spec')
  })

  it('task_create creates a task', async () => {
    const created = (await callTool('task_create', { title: 'MCP task', sprint: 1, assignee: 'agent' })) as { id: string; status: string }
    expect(created.id).toBe('TK-4')
    expect(created.status).toBe('To Do')
  })

  it('task_claim moves task to In Progress with agent assignee', async () => {
    const task = (await callTool('task_claim', { id: 'TK-1' })) as { status: string; assignee: string }
    expect(task.status).toBe('In Progress')
    expect(task.assignee).toBe('agent')
  })

  it('task_claim blocks tasks with incomplete dependencies unless force is true', async () => {
    const blocked = (await callTool('task_claim', { id: 'TK-2' })) as { error?: string; blockers?: string[] }
    expect(blocked.error).toContain('blocked')
    expect(blocked.blockers).toContain('TK-1')

    const forced = (await callTool('task_claim', { id: 'TK-2', force: true })) as { status: string }
    expect(forced.status).toBe('In Progress')
  })

  it('task_status rejects unknown status', async () => {
    await expect(callTool('task_status', { id: 'TK-1', status: 'Nope' })).rejects.toThrow()
  })

  it('task_spec produces a spec prompt with dependency statuses', async () => {
    const result = (await client.callTool({ name: 'task_spec', arguments: { id: 'TK-2' } })) as ToolResult
    const spec = result.content[0]?.text ?? ''
    expect(spec).toContain('# TK-2')
    expect(spec).toContain('## Acceptance criteria')
    expect(spec).toContain('## Rules for the agent')
    expect(spec).toContain('Depends on')
    expect(spec).toContain('TK-1')
    expect(spec).toContain('To Do')
  })

  it('sprint_current reports no active sprint', async () => {
    const res = (await callTool('sprint_current', {})) as { activeSprint: null }
    expect(res.activeSprint).toBeNull()
  })

  it('sprint_activate activates a sprint and sprint_current reflects it', async () => {
    await callTool('sprint_activate', { id: 1 })
    const current = (await callTool('sprint_current', {})) as { sprint: { id: number }; stats: { total: number } }
    expect(current.sprint.id).toBe(1)
    expect(current.stats.total).toBe(2)
  })

  it('brand_get reports brand after it is configured', async () => {
    const empty = (await callTool('brand_get', {})) as { message?: string }
    expect(empty.message).toContain('No brand configured')

    store.updateBrand({ name: 'Acme Labs', colors: { primary: '#6366f1' } })
    const brand = (await callTool('brand_get', {})) as { name: string; colors: { primary: string } }
    expect(brand.name).toBe('Acme Labs')
    expect(brand.colors.primary).toBe('#6366f1')
  })

  it('task_spec includes brand guidelines when configured', async () => {
    store.updateBrand({ name: 'Acme Labs', guidelines: 'Always use primary.' })
    const result = (await client.callTool({ name: 'task_spec', arguments: { id: 'TK-1' } })) as ToolResult
    const spec = result.content[0]?.text ?? ''
    expect(spec).toContain('## Brand guidelines')
    expect(spec).toContain('Acme Labs')
  })

  it('learnings_get returns empty when no learnings saved', async () => {
    const res = (await callTool('learnings_get', {})) as { message?: string }
    expect(res.message).toContain('No learnings recorded')
  })

  it('learnings_append and learnings_get round-trip', async () => {
    const app = (await callTool('learnings_append', { entry: 'Write tests first' })) as { ok: boolean }
    expect(app.ok).toBe(true)

    const fetched = (await callTool('learnings_get', {})) as { ok: boolean; content: string }
    expect(fetched.content).toBe('- Write tests first')
  })

  it('task_spec injects learnings when present', async () => {
    store.setLearnings('Avoid circular dependencies.')
    const result = (await client.callTool({ name: 'task_spec', arguments: { id: 'TK-1' } })) as ToolResult
    const spec = result.content[0]?.text ?? ''
    expect(spec).toContain('## Learned principles')
    expect(spec).toContain('Avoid circular dependencies.')
  })

  it('board_summary surfaces parse warnings', async () => {
    const bad = path.join(dir, '.agentboard', 'tasks', 'AS-99.md')
    fs.writeFileSync(bad, '---\ntitle: Bad: YAML\nstatus: To Do\n---\n\nboom\n', 'utf8')
    store.syncFromDisk()

    const summary = (await callTool('board_summary', {})) as { warnings?: string[] }
    expect(summary.warnings?.length).toBeGreaterThan(0)

    fs.rmSync(bad)
  })

  it('sprint_create creates a new sprint', async () => {
    const sprint = (await callTool('sprint_create', { goal: 'Ship new MCP tools' })) as { id: number; goal: string; status: string }
    expect(sprint.id).toBe(2)
    expect(sprint.goal).toBe('Ship new MCP tools')
    expect(sprint.status).toBe('planned')
  })

  it('sprint_close closes the active sprint and sets endedAt', async () => {
    await callTool('sprint_activate', { id: 1 })
    const closed = (await callTool('sprint_close', {})) as { id: number; status: string; endedAt: string }
    expect(closed.id).toBe(1)
    expect(closed.status).toBe('closed')
    expect(closed.endedAt).toBeTruthy()
  })

  it('sprint_report generates markdown summary of the sprint', async () => {
    const result = (await client.callTool({ name: 'sprint_report', arguments: { id: 1 } })) as ToolResult
    const report = result.content[0]?.text ?? ''
    expect(report).toContain('# Sprint 1')
    expect(report).toContain('## Tasks')
    expect(report).toContain('## Retro')
  })

  it('task_delete permanently removes a task', async () => {
    const res = (await callTool('task_delete', { id: 'TK-1' })) as { ok: boolean; deleted: string }
    expect(res.ok).toBe(true)
    expect(res.deleted).toBe('TK-1')
    const getRes = (await client.callTool({ name: 'task_get', arguments: { id: 'TK-1' } })) as ToolResult
    expect(getRes.content[0]?.text).toContain('Task not found: TK-1')
  })

  it('task_checklist updates acceptance criterion status', async () => {
    const updated = (await callTool('task_checklist', { id: 'TK-1', index: 0, completed: true })) as { acceptanceCriteria: string[] }
    expect(updated.acceptanceCriteria[0]).toContain('[x]')

    const toggled = (await callTool('task_checklist', { id: 'TK-1', index: 0 })) as { acceptanceCriteria: string[] }
    expect(toggled.acceptanceCriteria[0]).not.toContain('[x]')
  })

  it('task_note appends a note to the task body', async () => {
    const updated = (await callTool('task_note', { id: 'TK-1', note: 'Checked edge case', author: 'agent' })) as { notes: string }
    expect(updated.notes).toContain('Checked edge case')
    expect(updated.notes).toContain('(agent)')
  })

  it('brand_update updates brand kit fields', async () => {
    const updated = (await callTool('brand_update', {
      name: 'AgentSprint Corp',
      colors: { primary: '#4f46e5' },
      guidelines: 'Clean code and comprehensive tests.',
    })) as { name: string; colors: { primary: string }; guidelines: string }

    expect(updated.name).toBe('AgentSprint Corp')
    expect(updated.colors.primary).toBe('#4f46e5')
    expect(updated.guidelines).toContain('Clean code')
  })

  it('lists and reads MCP resources', async () => {
    const resList = await client.listResources()
    expect(resList.resources.map((r) => r.uri)).toContain('agentboard://tasks')
    expect(resList.resources.map((r) => r.uri)).toContain('agentboard://sprint/current')
    expect(resList.resources.map((r) => r.uri)).toContain('agentboard://brand')

    const taskRes = await client.readResource({ uri: 'agentboard://tasks' })
    const first = taskRes.contents[0]
    expect(first && 'text' in first ? first.text : '').toContain('TK-1')
  })

  it('lists and gets MCP prompts', async () => {
    const promptList = await client.listPrompts()
    const names = promptList.prompts.map((p) => p.name)
    expect(names).toContain('execute-task')
    expect(names).toContain('sprint-planning')
    expect(names).toContain('sprint-retro')

    const promptRes = await client.getPrompt({ name: 'execute-task', arguments: { id: 'TK-1' } })
    expect(promptRes.messages[0]?.content.type).toBe('text')
    expect((promptRes.messages[0]?.content as { text: string }).text).toContain('TK-1')
  })
})
