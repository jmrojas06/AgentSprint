import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, buildTaskBody, parseTaskBody } from '../src/index.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-body-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('task body round-trip', () => {
  it('a task without criteria reloads with no criteria (no phantom "## Activity")', () => {
    const store = ProjectStore.init(dir, { sample: false })
    const task = store.createTask({ title: 'No criteria' })
    const reloaded = ProjectStore.open(dir).state.tasks.find((t) => t.id === task.id)!
    expect(reloaded.acceptanceCriteria).toEqual([])
    expect(reloaded.activity).toHaveLength(1)
  })

  it('checkboxes in the description or notes are not acceptance criteria', () => {
    const store = ProjectStore.init(dir, { sample: false })
    const task = store.createTask({
      title: 'Checklist in description',
      description: 'Steps:\n- [ ] not a criterion\n- [x] neither',
      acceptanceCriteria: ['real one'],
    })
    store.appendTaskNote(task.id, 'progress', 'agent')
    const reloaded = ProjectStore.open(dir).state.tasks.find((t) => t.id === task.id)!
    expect(reloaded.acceptanceCriteria).toEqual(['real one'])
    expect(reloaded.description).toContain('- [ ] not a criterion')
  })

  it('stays stable across repeated rewrites', () => {
    const store = ProjectStore.init(dir, { sample: false })
    const task = store.createTask({ title: 'Stable' })
    for (let i = 0; i < 3; i++) {
      ProjectStore.open(dir).updateTask(task.id, { estimate: i })
    }
    expect(ProjectStore.open(dir).state.tasks.find((t) => t.id === task.id)!.acceptanceCriteria).toEqual([])
  })

  it('bodies without an "Acceptance criteria" heading still yield their checkboxes', () => {
    const { acceptanceCriteria } = parseTaskBody('Intro\n\n- [ ] first\n- [x] second\n')
    expect(acceptanceCriteria).toEqual(['first', '[x] second'])
  })

  it('the empty placeholder checkbox never captures the next line', () => {
    const body = buildTaskBody('desc', [], '', [{ at: '2026-01-01T00:00:00.000Z', actor: 'user', type: 'created', detail: 'x' }])
    expect(parseTaskBody(body).acceptanceCriteria).toEqual([])
  })
})
