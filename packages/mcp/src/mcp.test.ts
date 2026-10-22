import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ProjectStore } from '@jmrojas06/agentsprint-core'
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

/** Call a tool that must fail: asserts `isError` and returns the parsed `{ error, ... }` body. */
async function callToolError(name: string, args: Record<string, unknown>): Promise<{ error: string; [k: string]: unknown }> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult
  expect(result.isError).toBe(true)
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
    const tasks = (await callTool('task_list', { status: 'To Do' })) as Array<{ id: string }>
    expect(tasks.map((t) => t.id).sort()).toEqual(['TK-1', 'TK-2'])
  })

  it('task_get returns a task by id', async () => {
    const task = (await callTool('task_get', { id: 'TK-1' })) as { title: string }
    expect(task.title).toContain('task spec')
  })

  it('task_create creates a task', async () => {
    const created = (await callTool('task_create', { title: 'MCP task', sprint: 1, assignee: 'scrum-master' })) as { id: string; status: string }
    expect(created.id).toBe('TK-4')
    expect(created.status).toBe('To Do')
  })

  it('template_list returns the sample templates', async () => {
    const templates = (await callTool('template_list', {})) as Array<{ name: string }>
    expect(templates.map((t) => t.name).sort()).toEqual(['bug-report', 'chore', 'feature'])
  })

  it('agent_list returns the default specialized agents', async () => {
    const agents = (await callTool('agent_list', {})) as Array<{ name: string; description: string }>
    expect(agents.map((a) => a.name)).toEqual([
      'code-reviewer',
      'creative-director',
      'designer',
      'developer',
      'docs',
      'fixer',
      'ideator',
      'review-assistant',
      'tester',
      'ui-reviewer',
    ])
    expect(agents.every((a) => a.description.length > 0)).toBe(true)
  })

  it('agent_get returns the full prompt of an agent', async () => {
    const agent = (await callTool('agent_get', { name: 'tester' })) as { name: string; prompt: string }
    expect(agent.name).toBe('tester')
    expect(agent.prompt).toContain('## Mission')

    const missing = await callToolError('agent_get', { name: 'nope' })
    expect(missing.error).toContain('not found')
  })

  it('agent_upsert creates a subagent that sprint_dispatch routes to', async () => {
    const created = (await callTool('agent_upsert', {
      name: 'stripe-expert',
      description: 'Integrates Stripe payments',
      prompt: '## Mission\n\nShip payments.',
      color: '#3b82f6',
    })) as { name: string; created: boolean }
    expect(created).toMatchObject({ name: 'stripe-expert', created: true })
    expect(fs.readFileSync(path.join(dir, '.claude', 'agents', 'stripe-expert.md'), 'utf8')).toContain('Ship payments.')

    const sprint = (await callTool('sprint_create', { goal: 'Payments MVP' })) as { id: number }
    await callTool('sprint_activate', { id: sprint.id })
    const batch = (await callTool('task_create_batch', {
      tasks: [
        { ref: 'checkout', title: 'Checkout session', sprint: sprint.id, assignee: 'stripe-expert', acceptanceCriteria: ['Checkout works'] },
        { ref: 'qa', title: 'Payment tests', sprint: sprint.id, assignee: 'tester', dependsOn: ['checkout'], acceptanceCriteria: ['Tests pass'] },
      ],
    })) as Array<{ ref: string; id: string; dependencies: string[] }>
    expect(batch[1]!.dependencies).toEqual([batch[0]!.id])

    const plan = (await callTool('sprint_dispatch', { format: 'json' })) as { waves: Array<Array<{ id: string; subagent: string }>> }
    expect(plan.waves[0]).toEqual([expect.objectContaining({ id: batch[0]!.id, subagent: 'stripe-expert' })])
    expect(plan.waves[1]).toEqual([expect.objectContaining({ id: batch[1]!.id, subagent: 'tester' })])

    const md = (await client.callTool({ name: 'sprint_dispatch', arguments: {} })) as ToolResult
    expect(md.content[0]?.text).toContain('## Wave 1 — start now')
  })

  it('task_create_batch rejects an invalid plan without writing anything', async () => {
    const before = store.state.tasks.length
    const res = await callToolError('task_create_batch', { tasks: [{ title: 'A', dependsOn: ['missing'] }] })
    expect(res.error).toContain('Unknown dependency')
    expect(store.state.tasks.length).toBe(before)
  })

  it('agent_delete and agent_sync keep .claude/agents in line', async () => {
    await callTool('agent_delete', { name: 'ideator' })
    expect(fs.existsSync(path.join(dir, '.claude', 'agents', 'ideator.md'))).toBe(false)
    const sync = (await callTool('agent_sync', { installDefaults: true })) as { installed: string[]; written: string[] }
    expect(sync.installed).toEqual(['ideator'])
    expect(fs.existsSync(path.join(dir, '.claude', 'agents', 'ideator.md'))).toBe(true)
  })

  it('task_claim with a subagent name assigns the task to it', async () => {
    const created = (await callTool('task_create', { title: 'Generic work' })) as { id: string }
    const claimed = (await callTool('task_claim', { id: created.id, agent: 'developer' })) as { assignee: string }
    expect(claimed.assignee).toBe('developer')
  })

  it('exposes the run-sprint and idea-to-mvp prompts', async () => {
    const run = await client.getPrompt({ name: 'run-sprint', arguments: {} })
    expect((run.messages[0]!.content as { text: string }).text).toContain('Dispatch plan')
    const mvp = await client.getPrompt({ name: 'idea-to-mvp', arguments: { idea: 'A habit tracker for teams' } })
    const text = (mvp.messages[0]!.content as { text: string }).text
    expect(text).toContain('A habit tracker for teams')
    expect(text).toContain('task_create_batch')
    expect(text).toContain('`designer`')
  })

  it('exposes the human-review prompt: queue, assistant, batched questions, decide', async () => {
    const { prompts } = await client.listPrompts()
    expect(prompts.map((p) => p.name)).toContain('human-review')
    const res = await client.getPrompt({ name: 'human-review', arguments: {} })
    const text = (res.messages[0]!.content as { text: string }).text
    for (const needle of ['review_queue', 'review_decide', 'review-assistant', 'AskUserQuestion', 'sprint_close']) expect(text).toContain(needle)
    expect(text).toMatch(/at most 4 questions/)
  })

  it('task_create and task_list accept a specialized agent assignee', async () => {
    const created = (await callTool('task_create', { title: 'Style the hero', assignee: 'designer' })) as { id: string; assignee: string }
    expect(created.assignee).toBe('designer')

    const tasks = (await callTool('task_list', { assignee: 'designer' })) as Array<{ id: string }>
    expect(tasks.map((t) => t.id)).toContain(created.id)
  })

  it('task_claim keeps the specialized agent assignee', async () => {
    const created = (await callTool('task_create', { title: 'Assert the flow', assignee: 'tester' })) as { id: string }
    const claimed = (await callTool('task_claim', { id: created.id })) as { status: string; assignee: string }
    expect(claimed.status).toBe('In Progress')
    expect(claimed.assignee).toBe('tester')
  })

  it('task_spec injects the agent profile for a specialized assignee', async () => {
    const created = (await callTool('task_create', { title: 'Design settings', assignee: 'designer' })) as { id: string }
    // task_spec returns raw Markdown, not JSON
    const result = (await client.callTool({ name: 'task_spec', arguments: { id: created.id } })) as ToolResult
    const spec = result.content[0]?.text ?? ''
    expect(spec).toContain('## Agent profile — designer')
    expect(spec).toContain('- **Assignee:** designer')
  })

  it('task_create accepts a template with vars', async () => {
    const created = (await callTool('task_create', {
      template: 'bug-report',
      vars: { summary: 'Board crashes', title: 'Bug: Board crashes' },
    })) as { title: string; priority: string; tags: string[] }
    expect(created.title).toBe('Bug: Board crashes')
    expect(created.priority).toBe('high')
    expect(created.tags).toEqual(['bug'])
  })

  it('task_create template overrides beat template defaults', async () => {
    const created = (await callTool('task_create', {
      template: 'chore',
      vars: { title: 'Tidy deps' },
      priority: 'medium',
      assignee: 'scrum-master',
    })) as { title: string; priority: string; assignee: string }
    expect(created.title).toBe('Tidy deps')
    expect(created.priority).toBe('medium')
    expect(created.assignee).toBe('scrum-master')
  })

  it('task_claim moves task to In Progress with agent assignee', async () => {
    const task = (await callTool('task_claim', { id: 'TK-1' })) as { status: string; assignee: string }
    expect(task.status).toBe('In Progress')
    expect(task.assignee).toBe('dev')
  })

  it('task_claim blocks tasks with incomplete dependencies unless force is true', async () => {
    const blocked = (await callToolError('task_claim', { id: 'TK-2' })) as { error: string; blockers?: string[] }
    expect(blocked.error).toContain('blocked')
    expect(blocked.blockers).toContain('TK-1')

    const forced = (await callTool('task_claim', { id: 'TK-2', force: true })) as { status: string }
    expect(forced.status).toBe('In Progress')
  })

  it('task_claim takes an exclusive lock: two agents, only one wins', async () => {
    await store.createTask({ title: 'Contested', sprint: 1 })
    const tasks = store.state.tasks.filter((t) => t.title === 'Contested')
    const id = tasks[tasks.length - 1]!.id

    const first = (await callTool('task_claim', { id, agent: 'agent-a' })) as { status: string; lockedBy?: string }
    expect(first.status).toBe('In Progress')

    const second = await callToolError('task_claim', { id, agent: 'agent-b' })
    expect(second.error).toContain('locked by "agent-a"')

    // agent-a re-claiming refreshes its own lock without error
    const heartbeat = (await callTool('task_claim', { id, agent: 'agent-a' })) as { status: string }
    expect(heartbeat.status).toBe('In Progress')

    // force lets agent-b steal the lock
    const stolen = (await callTool('task_claim', { id, agent: 'agent-b', force: true })) as { status: string; lockedBy?: string }
    expect(stolen.status).toBe('In Progress')
    expect(stolen.lockedBy ?? (store.getLock(id) as { lockedBy: string }).lockedBy).toBe('agent-b')
  })

  it('task_release frees the lock for other agents', async () => {
    await store.createTask({ title: 'To release', sprint: 1 })
    const tasks = store.state.tasks.filter((t) => t.title === 'To release')
    const id = tasks[tasks.length - 1]!.id

    await callTool('task_claim', { id, agent: 'agent-a' })
    const wrongAgent = await callToolError('task_release', { id, agent: 'agent-b' })
    expect(wrongAgent.error).toContain('not by')

    const released = (await callTool('task_release', { id })) as { ok?: boolean }
    expect(released.ok).toBe(true)
    expect(store.getLock(id)).toBeNull()

    const reclaimed = (await callTool('task_claim', { id, agent: 'agent-c' })) as { status: string }
    expect(reclaimed.status).toBe('In Progress')
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
    const app = await callTool('learnings_append', { entry: 'Write tests first' })
    expect(app).toEqual({ ok: true, entry: 'Write tests first' })

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
    expect(names).toContain('sprint-plan')
    expect(names).toContain('sprint-retro')

    const promptRes = await client.getPrompt({ name: 'execute-task', arguments: { id: 'TK-1' } })
    expect(promptRes.messages[0]?.content.type).toBe('text')
    expect((promptRes.messages[0]?.content as { text: string }).text).toContain('TK-1')
  })

  it('appends the automatic retro to learnings.md when closing a sprint', async () => {
    await callTool('sprint_close', { id: 1 })
    const learningsPath = path.join(dir, '.agentboard', 'learnings.md')
    expect(fs.existsSync(learningsPath)).toBe(true)
    expect(fs.readFileSync(learningsPath, 'utf8')).toContain('## Sprint 1 retro —')
  })

  it('skips the retro on sprint_close with retro=false', async () => {
    await callTool('sprint_close', { id: 1, retro: false })
    expect(fs.existsSync(path.join(dir, '.agentboard', 'learnings.md'))).toBe(false)
  })

  it('returns a retro report and suggested learnings via sprint_retro', async () => {
    const retro = (await callTool('sprint_retro', { id: 1 })) as {
      report: string
      suggestedLearnings: string[]
    }
    expect(retro.report).toContain('# Sprint 1')
    expect(Array.isArray(retro.suggestedLearnings)).toBe(true)
    expect(retro.suggestedLearnings.length).toBeGreaterThan(0)
  })

  it('sprint-plan prompt includes backlog, velocity, learnings and plan template', async () => {
    await store.createTask({ title: 'Backlog item alpha', status: 'Backlog', estimate: 3, priority: 'high' })
    store.appendLearning('Always ship locks before planning parallel work.')
    const res = await client.getPrompt({
      name: 'sprint-plan',
      arguments: { goal: 'Ship planning', capacity: '8' },
    })
    const text = (res.messages[0]?.content as { text: string }).text ?? ''
    expect(text).toContain('Ship planning')
    expect(text).toContain('Capacity: 8')
    expect(text).toContain('## Available backlog')
    expect(text).toContain('Backlog item alpha')
    expect(text).toContain('Historical velocity')
    expect(text).toContain('Always ship locks')
    expect(text).toContain('| Order | Task | Priority | Estimate | Dependencies | Rationale |')
    expect(text).toContain('task_update')
  })

  it('sprint-plan prompt handles empty history gracefully', async () => {
    const res = await client.getPrompt({ name: 'sprint-plan', arguments: {} })
    const text = (res.messages[0]?.content as { text: string }).text ?? ''
    expect(text).toContain('(not provided — propose one from the backlog)')
    expect(text).toContain('unknown (no closed sprints)')
  })
})

describe('MCP error contract', () => {
  it('flags domain errors with isError and a JSON { error } body', async () => {
    expect((await callToolError('task_get', { id: 'TK-999' })).error).toBe('Task not found: TK-999')
    expect((await callToolError('task_spec', { id: 'TK-999' })).error).toBe('Task not found: TK-999')
    expect((await callToolError('task_update', { id: 'TK-999', title: 'x' })).error).toContain('not found')
    expect((await callToolError('sprint_report', { id: 999 })).error).toBe('Sprint not found: 999')
    expect((await callToolError('sprint_close', {})).error).toContain('No active sprint')
    expect((await callToolError('task_create', {})).error).toContain('title or a template')
  })

  it('keeps successful calls unflagged', async () => {
    const result = (await client.callTool({ name: 'task_get', arguments: { id: 'TK-1' } })) as ToolResult
    expect(result.isError).toBeFalsy()
  })
})

describe('MCP with other processes on the same board', () => {
  it('sees tasks and edits made by another process', async () => {
    const other = ProjectStore.open(dir)
    const created = other.createTask({ title: 'made elsewhere' })
    other.updateTask('TK-3', { title: 'renamed elsewhere' })

    expect(((await callTool('task_get', { id: created.id })) as { title: string }).title).toBe('made elsewhere')
    expect(((await callTool('task_get', { id: 'TK-3' })) as { title: string }).title).toBe('renamed elsewhere')

    const mine = (await callTool('task_create', { title: 'made here' })) as { id: string }
    expect(mine.id).not.toBe(created.id)
  })

  it('task_claim fails when another process holds the lock', async () => {
    ProjectStore.open(dir).lockTask('TK-3', 'agent-b')
    const res = await callToolError('task_claim', { id: 'TK-3', agent: 'agent-a' })
    expect(res.error).toContain('locked by "agent-b"')
  })
})

describe('session continuity & review gate', () => {
  it('advertises how to resume and hand off in the server instructions', () => {
    expect(client.getInstructions()).toContain('project_context')
    expect(client.getInstructions()).toContain('session_handoff')
  })

  it('project_context returns the Markdown brief and session_handoff feeds it', async () => {
    const before = await client.callTool({ name: 'project_context', arguments: {} }) as ToolResult
    expect(before.content[0]?.text).toContain('# Where we are')
    expect(before.content[0]?.text).not.toContain('Last session handoff')

    const entry = (await callTool('session_handoff', {
      summary: 'Wired the API',
      done: ['TK-1 spec written'],
      next: ['TK-2 plan goals'],
      author: 'claude',
    })) as { author: string; at: string }
    expect(entry.author).toBe('claude')

    const after = await client.callTool({ name: 'project_context', arguments: {} }) as ToolResult
    expect(after.content[0]?.text).toContain('Last session handoff')
    expect(after.content[0]?.text).toContain('Wired the API')
    const journal = (await callTool('session_journal', {})) as Array<{ summary: string }>
    expect(journal[0]?.summary).toBe('Wired the API')
  })

  it('session_handoff rejects an empty handoff', async () => {
    const err = await callToolError('session_handoff', { summary: ' ' })
    expect(err.error).toMatch(/handoff needs/)
  })

  it('task_review records verdicts and sends changes back', async () => {
    store.setTaskStatus('TK-1', 'Review')
    const approved = (await callTool('task_review', { id: 'TK-1', reviewer: 'code-reviewer', verdict: 'approve', summary: 'ok' })) as { status: string; notes: string }
    expect(approved.status).toBe('Review')
    expect(approved.notes).toContain('**Review: approved**')
    const changed = (await callTool('task_review', { id: 'TK-1', reviewer: 'code-reviewer', verdict: 'changes', findings: ['a.ts:1 — broken'] })) as { status: string }
    expect(changed.status).toBe('In Progress')
    const err = await callToolError('task_review', { id: 'TK-1', reviewer: 'code-reviewer', verdict: 'approve' })
    expect(err.error).toMatch(/not "Review"/)
  })

  it('review_queue lists Review tasks and review_decide closes or sends them back as the human', async () => {
    store.setTaskStatus('TK-1', 'Review')
    store.setTaskStatus('TK-2', 'Review')
    // `approve` needs every criterion ticked, not just an approving verdict.
    store.state.tasks.find((t) => t.id === 'TK-1')!.acceptanceCriteria.forEach((_, index) => store.setTaskChecklist('TK-1', { index, completed: true }))
    store.reviewTask('TK-1', { reviewer: 'code-reviewer', verdict: 'approve', summary: 'ok' })
    const queue = (await callTool('review_queue', {})) as Array<{ id: string; recommendation: string; approvedSinceLastChange: boolean; review: { by: string } | null }>
    expect(queue.map((q) => [q.id, q.recommendation, q.approvedSinceLastChange])).toEqual([['TK-1', 'approve', true], ['TK-2', 'look', false]])
    expect(queue[0]?.review?.by).toBe('code-reviewer')
    expect(((await callTool('review_queue', { ids: ['TK-2'] })) as unknown[]).length).toBe(1)

    const done = (await callTool('review_decide', { id: 'TK-1', decision: 'done' })) as { status: string; activity: Array<{ actor: string; type: string; detail: string }>; activityCount: number }
    expect(done.status).toBe('Done')
    expect(done.activity).toContainEqual(expect.objectContaining({ actor: 'user', type: 'status', detail: 'Review → Done' }))
    expect(done.activity.length).toBeLessThanOrEqual(3)
    const back = (await callTool('review_decide', { id: 'TK-2', decision: 'changes', by: 'maria', findings: ['fix it'] })) as { status: string; notes: string }
    expect(back.status).toBe('In Progress')
    expect(back.notes).toContain('(maria) **Review: changes requested**')
    const err = await callToolError('review_decide', { id: 'TK-3', decision: 'done' })
    expect(err.error).toMatch(/not "Review"/)
    expect(store.state.tasks.find((t) => t.id === 'TK-3')?.status).not.toBe('Done')
  })

  it('mutating task tools return a compact task: last 3 activity events plus activityCount', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['task_update', { id: 'TK-1', title: 'Renamed' }],
      ['task_note', { id: 'TK-1', note: 'n1' }],
      ['task_checklist', { id: 'TK-1', index: 0, completed: true }],
      ['task_status', { id: 'TK-1', status: 'Review' }],
      ['task_review', { id: 'TK-1', reviewer: 'code-reviewer', verdict: 'changes', findings: ['a.ts:1 — broken'] }],
      ['task_claim', { id: 'TK-1', agent: 'developer', force: true }],
      ['task_create', { title: 'Compact' }],
    ]
    for (const [name, args] of calls) {
      const res = (await callTool(name, args)) as { id: string; activity: unknown[]; activityCount: number }
      const full = (await callTool('task_get', { id: res.id })) as { activity: unknown[]; activityCount?: number }
      expect(res.activityCount, name).toBe(full.activity.length)
      expect(res.activity, name).toEqual(full.activity.slice(-3))
      expect(full.activityCount).toBeUndefined()
    }
    const full = (await callTool('task_get', { id: 'TK-1' })) as { activity: unknown[] }
    expect(full.activity.length).toBeGreaterThan(3)
    const listed = (await callTool('task_list', { q: 'Renamed' })) as Array<{ activity: unknown[]; activityCount?: number }>
    expect(listed[0]?.activity).toEqual(full.activity)
    expect(listed[0]?.activityCount).toBeUndefined()
  })

  it('agent_upsert stores skills and skill_list reports missing ones', async () => {
    const agent = (await callTool('agent_upsert', { name: 'qa', description: 'QA', prompt: 'Check things.', skills: ['surely-not-installed-skill'], disallowedTools: ['Edit'] })) as { skills: string[]; disallowedTools: string[] }
    expect(agent.skills).toEqual(['surely-not-installed-skill'])
    expect(agent.disallowedTools).toEqual(['Edit'])
    const list = (await callTool('skill_list', {})) as { skills: unknown[]; missing: Array<{ agent: string; skill: string }> }
    expect(Array.isArray(list.skills)).toBe(true)
    expect(list.missing).toContainEqual({ agent: 'qa', skill: 'surely-not-installed-skill' })
  })

  it('the resume prompt embeds the project brief', async () => {
    const prompt = await client.getPrompt({ name: 'resume', arguments: {} })
    const text = (prompt.messages[0]?.content as { text: string }).text
    expect(text).toContain('# Where we are')
    expect(text).toContain('session_handoff')
  })
})
