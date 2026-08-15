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
