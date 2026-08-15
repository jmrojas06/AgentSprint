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

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-mcp-'))
  store = ProjectStore.init(dir, { sample: true })

  const server = createMcpServer(dir)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: 'test', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
})

afterEach(async () => {
  await client.close()
  fs.rmSync(dir, { recursive: true, force: true })
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

  it('task_status rejects unknown status', async () => {
    await expect(callTool('task_status', { id: 'TK-1', status: 'Nope' })).rejects.toThrow()
  })

  it('task_spec produces a spec prompt', async () => {
    const result = (await client.callTool({ name: 'task_spec', arguments: { id: 'TK-1' } })) as ToolResult
    const spec = result.content[0]?.text ?? ''
    expect(spec).toContain('# TK-1')
    expect(spec).toContain('## Acceptance criteria')
    expect(spec).toContain('## Rules for the agent')
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
})
