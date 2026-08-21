import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, isSimilarTitle, importTasks, issuesToTaskInputs, normalizeTitle, parseTodoFile, todosToTaskInputs } from '../src/index.js'
import type { GithubIssue } from '../src/index.js'

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-import-'))
  store = ProjectStore.init(dir, { sample: false })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('parseTodoFile', () => {
  it('parses checkboxes and plain bullets from a fixture file', () => {
    const fixture = [
      '# TODO',
      '',
      '- [ ] ship the thing',
      '- [x] write tests',
      '* [X] uppercase check counts as done',
      '+ plain plus bullet',
      '* asterisk bullet',
      '',
      '## Later',
      '- another plain bullet',
    ].join('\n')
    const items = parseTodoFile(fixture)
    expect(items).toHaveLength(6)
    expect(items[0]).toEqual({ title: 'ship the thing', done: false })
    expect(items[1]).toEqual({ title: 'write tests', done: true })
    expect(items[2]).toEqual({ title: 'uppercase check counts as done', done: true })
    expect(items[3]!.done).toBe(false)
  })

  it('ignores headings, code blocks and blank bullets', () => {
    const fixture = [
      '# Title line',
      '```',
      '- not a bullet inside code',
      '```',
      '- real bullet',
      '-',
      '-   ',
    ].join('\n')
    const items = parseTodoFile(fixture)
    expect(items).toEqual([{ title: 'real bullet', done: false }])
  })

  it('reads fixtures from disk like the CLI does', () => {
    const file = path.join(dir, 'TODO.md')
    fs.writeFileSync(file, '- [ ] first\n- second\n', 'utf8')
    const items = parseTodoFile(fs.readFileSync(file, 'utf8'))
    expect(items).toHaveLength(2)
  })
})

describe('duplicate detection', () => {
  it('normalizes case and punctuation', () => {
    expect(normalizeTitle('Fix: Login bug!')).toBe('fix login bug')
  })

  it('detects similar titles but not unrelated ones', () => {
    expect(isSimilarTitle('Fix login bug on Safari', 'fix login bug on safari!')).toBe(true)
    expect(isSimilarTitle('Fix login bug on Safari', 'Fix login bug on Safari browser')).toBe(true)
    expect(isSimilarTitle('Fix login bug', 'fix: Login Bug!!')).toBe(true)
    expect(isSimilarTitle('Fix login bug on Safari', 'Deploy to production')).toBe(false)
    expect(isSimilarTitle('Add dark mode toggle', 'Rename config keys')).toBe(false)
  })
})

describe('todosToTaskInputs', () => {
  it('tags imported tasks with an origin tag', () => {
    const inputs = todosToTaskInputs(parseTodoFile('- [ ] a\n- [x] b\n'))
    expect(inputs).toHaveLength(2)
    expect(inputs[0]!.tags).toContain('imported:todo')
    expect(inputs[1]!.status).toBe('Done')
  })
})

describe('issuesToTaskInputs', () => {
  it('maps labels to tags and milestones to sprints', () => {
    const issues: GithubIssue[] = [
      { number: 1, title: 'Crash on save', labels: [{ name: 'bug' }, { name: 'p1' }], milestone: { title: 'v1.0' } },
      { number: 2, title: 'Dark mode', labels: [], milestone: null },
    ]
    const inputs = issuesToTaskInputs(issues, {
      labelTags: { bug: ['bug'], p1: ['high'] },
      milestoneSprints: { 'v1.0': 3 },
    })
    expect(inputs[0]!.sprint).toBe(3)
    expect(inputs[0]!.tags).toEqual(expect.arrayContaining(['imported:github', 'bug', 'high']))
    expect(inputs[1]!.sprint).toBeNull()
    expect(inputs[1]!.description).toContain('#2')
  })
})

describe('importTasks', () => {
  it('creates tasks, tags them and reports created/skipped counts', () => {
    store.createTask({ id: 'TK-1', title: 'Write docs', sprint: null, createdAt: new Date().toISOString() })
    const inputs = todosToTaskInputs([
      ...parseTodoFile('- Write docs for the CLI\n- Add search feature'),
    ])
    const result = importTasks(store, inputs)
    // 'Write docs for the CLI' contains existing 'Write docs' → skipped
    expect(result.created).toHaveLength(1)
    expect(result.skippedDuplicates).toHaveLength(1)
    expect(result.skippedDuplicates[0]!.matchedWith).toBe('Write docs')
    expect(store.state.tasks.some((t) => t.title === 'Add search feature' && t.tags.includes('imported:todo'))).toBe(true)

    // importing again skips everything as duplicates (board + batch aware)
    const again = importTasks(store, inputs)
    expect(again.created).toHaveLength(0)
    expect(again.skippedDuplicates).toHaveLength(2)
  })

  it('does not create anything when every item is a duplicate', () => {
    store.createTask({ id: 'TK-1', title: 'Ship release notes', sprint: null, createdAt: new Date().toISOString() })
    const before = store.state.tasks.length
    const result = importTasks(store, todosToTaskInputs(parseTodoFile('- ship release notes')))
    expect(result.created).toHaveLength(0)
    expect(store.state.tasks).toHaveLength(before)
  })
})
