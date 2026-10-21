import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, buildDispatchPlan, planDispatch, subagentFor } from '../src/index.js'

let dir: string
let store: ProjectStore
/** Dispatch holds back tasks without acceptance criteria, so fixtures carry one. */
const AC = ['It works']

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-dispatch-'))
  store = ProjectStore.init(dir, { sample: false })
  store.installDefaultAgents()
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('subagentFor', () => {
  const agents = [{ name: 'developer' }, { name: 'designer' }]
  it('uses the specialized assignee when its profile exists', () => {
    expect(subagentFor('designer', agents)).toBe('designer')
  })
  it('sends workflow roles to developer', () => {
    expect(subagentFor('dev', agents)).toBe('developer')
    expect(subagentFor('scrum-master', agents)).toBe('developer')
  })
  it('falls back to general-purpose (null)', () => {
    expect(subagentFor('ghost', agents)).toBeNull()
    expect(subagentFor('dev', [])).toBeNull()
  })
})

describe('planDispatch', () => {
  it('splits a sprint into dependency waves', () => {
    const sprint = store.createSprint('MVP')
    store.setSprintStatus(sprint.id, 'active')
    const [api, ui, tests, docs] = store.createTaskBatch([
      { ref: 'api', title: 'API', sprint: sprint.id, acceptanceCriteria: AC, assignee: 'developer' },
      { ref: 'ui', title: 'UI', sprint: sprint.id, acceptanceCriteria: AC, assignee: 'designer' },
      { ref: 'tests', title: 'Tests', sprint: sprint.id, acceptanceCriteria: AC, assignee: 'tester', dependsOn: ['api', 'ui'] },
      { ref: 'docs', title: 'Docs', sprint: sprint.id, acceptanceCriteria: AC, assignee: 'docs', dependsOn: ['tests'] },
    ])
    const plan = planDispatch(store.state)
    expect(plan.sprint?.id).toBe(sprint.id)
    expect(plan.waves.map((w) => w.map((t) => t.id))).toEqual([[api!.id, ui!.id], [tests!.id], [docs!.id]])
    expect(plan.waves[0]!.map((t) => t.subagent)).toEqual(['developer', 'designer'])
    expect(plan.blocked).toEqual([])
  })

  it('orders a wave by priority', () => {
    const sprint = store.createSprint('S')
    store.setSprintStatus(sprint.id, 'active')
    const low = store.createTask({ title: 'low', sprint: sprint.id, acceptanceCriteria: AC, priority: 'low' })
    const crit = store.createTask({ title: 'crit', sprint: sprint.id, acceptanceCriteria: AC, priority: 'critical' })
    expect(planDispatch(store.state).waves[0]!.map((t) => t.id)).toEqual([crit.id, low.id])
  })

  it('treats done deps as satisfied and in-flight deps as a later wave', () => {
    const sprint = store.createSprint('S')
    store.setSprintStatus(sprint.id, 'active')
    const done = store.createTask({ title: 'done', sprint: sprint.id, status: 'Done' })
    const moving = store.createTask({ title: 'moving', sprint: sprint.id, status: 'In Progress' })
    const a = store.createTask({ title: 'a', sprint: sprint.id, acceptanceCriteria: AC, dependencies: [done.id] })
    const b = store.createTask({ title: 'b', sprint: sprint.id, acceptanceCriteria: AC, dependencies: [moving.id] })
    const plan = planDispatch(store.state)
    expect(plan.waves[0]!.map((t) => t.id)).toEqual([a.id])
    expect(plan.waves[1]!.map((t) => t.id)).toEqual([b.id])
    expect(plan.inProgress.map((t) => t.id)).toEqual([moving.id])
  })

  it('reports tasks that can never start as blocked', () => {
    const sprint = store.createSprint('S')
    store.setSprintStatus(sprint.id, 'active')
    const outside = store.createTask({ title: 'outside', sprint: null })
    const stuck = store.createTask({ title: 'stuck', sprint: sprint.id, acceptanceCriteria: AC, dependencies: [outside.id] })
    const ghost = store.createTask({ title: 'ghost', sprint: sprint.id, acceptanceCriteria: AC, dependencies: ['TK-999'] })
    const plan = planDispatch(store.state)
    expect(plan.waves.flat()).toEqual([])
    const reasons = Object.fromEntries(plan.blocked.map((b) => [b.id, b.reason]))
    expect(reasons[stuck.id]).toMatch(/outside this sprint/)
    expect(reasons[ghost.id]).toMatch(/missing task TK-999/)
  })

  it('blocks pending tasks without acceptance criteria, and their dependents', () => {
    const sprint = store.createSprint('S')
    store.setSprintStatus(sprint.id, 'active')
    const vague = store.createTask({ title: 'vague', sprint: sprint.id })
    const after = store.createTask({ title: 'after', sprint: sprint.id, dependencies: [vague.id], acceptanceCriteria: AC })
    const ready = store.createTask({ title: 'ready', sprint: sprint.id, acceptanceCriteria: AC })
    const plan = planDispatch(store.state)
    expect(plan.waves.flat().map((t) => t.id)).toEqual([ready.id])
    const reasons = Object.fromEntries(plan.blocked.map((b) => [b.id, b.reason]))
    expect(reasons[vague.id]).toBe('no acceptance criteria — add them before dispatching')
    expect(reasons[after.id]).toBe(`waits on blocked ${vague.id}`)
  })

  it('plans the backlog when no sprint is active', () => {
    const t = store.createTask({ title: 'loose', sprint: null, acceptanceCriteria: AC })
    const plan = planDispatch(store.state)
    expect(plan.sprint).toBeNull()
    expect(plan.waves[0]!.map((x) => x.id)).toEqual([t.id])
  })

  it('throws for an unknown sprint id', () => {
    expect(() => planDispatch(store.state, { sprintId: 42 })).toThrow(/Sprint not found/)
  })
})

describe('buildDispatchPlan', () => {
  it('renders waves with subagents and launch prompts', () => {
    const sprint = store.createSprint('Ship it')
    store.setSprintStatus(sprint.id, 'active')
    const [ui] = store.createTaskBatch([
      { ref: 'ui', title: 'Landing UI', sprint: sprint.id, acceptanceCriteria: AC, assignee: 'designer' },
      { title: 'Copy', sprint: sprint.id, acceptanceCriteria: AC, assignee: 'ghost-writer', dependsOn: ['ui'] },
    ])
    const md = buildDispatchPlan(planDispatch(store.state), 'demo')
    expect(md).toContain('# Dispatch plan — demo')
    expect(md).toContain(`Sprint ${sprint.id} — Ship it`)
    expect(md).toContain('## Wave 1 — start now (1 task)')
    expect(md).toContain('## Wave 2 — once wave 1 is done (1 task)')
    expect(md).toContain(`**${ui!.id} → \`designer\`:** Work on AgentSprint task ${ui!.id}`)
    expect(md).toContain('`general-purpose`')
    expect(md).toContain('## Between waves')
  })

  it('says when there is nothing to dispatch', () => {
    const md = buildDispatchPlan(planDispatch(store.state), 'demo')
    expect(md).toContain('Nothing to dispatch')
    expect(md).not.toContain('## Between waves')
  })
})

describe('createTaskBatch', () => {
  it('resolves refs and existing ids into dependencies', () => {
    const existing = store.createTask({ title: 'existing' })
    const [a, b] = store.createTaskBatch([
      { ref: 'a', title: 'A' },
      { ref: 'b', title: 'B', dependsOn: ['a', existing.id] },
    ])
    expect(b!.dependencies.sort()).toEqual([a!.id, existing.id].sort())
  })

  it('creates dependencies first even when listed later', () => {
    const [child, parent] = store.createTaskBatch([
      { ref: 'child', title: 'Child', dependsOn: ['parent'] },
      { ref: 'parent', title: 'Parent' },
    ])
    expect(child!.dependencies).toEqual([parent!.id])
    expect(Number(parent!.id.split('-')[1])).toBeLessThan(Number(child!.id.split('-')[1]))
  })

  it('validates the whole batch before writing anything', () => {
    const before = store.state.tasks.length
    expect(() => store.createTaskBatch([{ title: 'ok' }, { title: 'bad', dependsOn: ['nope'] }])).toThrow(/Unknown dependency "nope"/)
    expect(() => store.createTaskBatch([{ ref: 'x', title: 'x' }, { ref: 'x', title: 'y' }])).toThrow(/Duplicate ref/)
    expect(() => store.createTaskBatch([{ title: ' ' }])).toThrow(/title is required/)
    expect(() =>
      store.createTaskBatch([
        { ref: 'a', title: 'a', dependsOn: ['b'] },
        { ref: 'b', title: 'b', dependsOn: ['a'] },
      ]),
    ).toThrow(/cycle/)
    expect(() => store.createTaskBatch([])).toThrow(/empty/)
    expect(store.state.tasks.length).toBe(before)
  })
})
