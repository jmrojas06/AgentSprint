import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, buildTaskSpec, computeSprintStats } from '../src/index.js'
let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-spec-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('buildTaskSpec', () => {
  it('produces a complete agent prompt', () => {
    const sprint = store.state.sprints[0] ?? null
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const spec = buildTaskSpec(task, sprint, 'demo')
    expect(spec).toContain('# TK-1')
    expect(spec).toContain('**Project:** demo')
    expect(spec).toContain('**Sprint 1:**')
    expect(spec).toContain('## Mission')
    expect(spec).toContain('## Acceptance criteria')
    expect(spec).toContain('## Rules for the agent')
    expect(spec).toContain('**Status:** To Do')
  })

  it('injects learnings into the spec when provided', () => {
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const learnings = 'Avoid circular deps — they cause deadlocks.'
    const spec = buildTaskSpec(task, null, 'demo', { learnings })
    expect(spec).toContain('## Learned principles')
    expect(spec).toContain(learnings)
  })

  it('leaves automatic sprint retros out of the spec learnings', () => {
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const learnings = '## Sprint 3 retro — 2026-08-21\n\n# Sprint 3\n\n## Tasks\n\n### Backlog (0)\n\n_none_\n\n## Retro\n\n_Pendiente_\n\n## Rules\n\n- One project, one board'
    const spec = buildTaskSpec(task, null, 'demo', { learnings })
    expect(spec).toContain('One project, one board')
    expect(spec).not.toContain('Backlog (0)')
    expect(spec).not.toContain('_none_')
  })

  it('marks checked criteria with [x] in the spec', () => {
    store.setTaskChecklist('TK-1', { index: 0, completed: true })
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const spec = buildTaskSpec(task, null, 'demo')
    expect(spec).toContain('- [x] The task has a clear description')
    expect(spec).not.toContain('- [ ] The task has a clear description')
  })

  it('injects the specialized agent profile when provided', () => {
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const agent = store.getAgent('designer')!
    const spec = buildTaskSpec(task, null, 'demo', { agent })
    expect(spec).toContain('## Agent profile — designer')
    expect(spec).toContain('**Role:**')
    expect(spec).toContain(agent.prompt.split('\n')[0]!)
    expect(spec.indexOf('## Agent profile')).toBeLessThan(spec.indexOf('## Rules for the agent'))
  })

  it('skips the agent section for a null profile', () => {
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const spec = buildTaskSpec(task, null, 'demo', { agent: null })
    expect(spec).not.toContain('## Agent profile')
  })

  it('resolves the agent from the task assignee through the store', () => {
    const task = store.createTask({ title: 'Hero banner', assignee: 'designer' })
    const spec = buildTaskSpec(task, null, 'demo', { agent: store.agentForTask(task) })
    expect(spec).toContain('## Agent profile — designer')
    expect(spec).toContain('- **Assignee:** designer')
  })
})

describe('computeSprintStats', () => {
  it('computes completion for the sample board', () => {
    const stats = computeSprintStats(store.state.tasks, 1)
    expect(stats.total).toBe(2)
    expect(stats.done).toBe(0)
    expect(stats.completionPct).toBe(0)
  })

  it('tracks points done when tasks complete', () => {
    store.setTaskStatus('TK-2', 'Done')
    const stats = computeSprintStats(store.state.tasks, 1)
    expect(stats.done).toBe(1)
    expect(stats.pointsDone).toBe(2)
    expect(stats.completionPct).toBe(50)
  })

  it('aggregates across the whole board when sprintId is null', () => {
    const stats = computeSprintStats(store.state.tasks, null)
    expect(stats.total).toBe(3)
  })
})

