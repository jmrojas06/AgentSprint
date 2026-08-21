import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, buildBoardMarkdown } from '../src/index.js'

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-export-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('buildBoardMarkdown', () => {
  it('includes header, sprint stats and tasks grouped by status', () => {
    const md = buildBoardMarkdown(store.state, { projectName: 'demo' })
    expect(md).toContain('# demo — Board export')
    expect(md).toContain('## Sprints')
    expect(md).toContain('| 1 |')
    expect(md).toContain('% complete')
    expect(md).toContain('### To Do (')
    expect(md).toContain('### Done (')
    for (const task of store.state.tasks) {
      expect(md).toContain(`**${task.id}** — ${task.title}`)
    }
  })

  it('renders acceptance criteria as checkboxes', () => {
    store.setTaskChecklist('TK-1', { index: 0, completed: true })
    const task = store.state.tasks.find((t) => t.id === 'TK-1')!
    const md = buildBoardMarkdown(store.state)
    const first = task.acceptanceCriteria[0]!.replace(/^\[x\]\s*/i, '')
    expect(md).toContain(`- [x] ${first}`)
  })

  it('filters to a single sprint with --sprint', () => {
    const other = store.createSprint('Next up')
    store.createTask({ title: 'Future work', sprint: other.id })
    const md = buildBoardMarkdown(store.state, { sprintId: other.id })
    expect(md).toContain('Future work')
    expect(md).not.toContain('TK-1')
  })

  it('throws for an unknown sprint id', () => {
    expect(() => buildBoardMarkdown(store.state, { sprintId: 999 })).toThrow('Sprint not found: 999')
  })

  it('includes learnings when provided and a placeholder when missing', () => {
    const learning = 'Always run the full test suite before review.'
    expect(buildBoardMarkdown(store.state, { learnings: learning })).toContain(learning)
    expect(buildBoardMarkdown(store.state)).toContain('_No learnings recorded yet._')
  })
})
