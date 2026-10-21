import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, SAMPLE_AGENTS, isReviewAssistant, isReviewerAgent, isValidAgentName, parseAgent, readAgents } from '../src/index.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-agents-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('isValidAgentName', () => {
  it('accepts lowercase slugs', () => {
    expect(isValidAgentName('designer')).toBe(true)
    expect(isValidAgentName('creative-director')).toBe(true)
    expect(isValidAgentName('dev2')).toBe(true)
  })

  it('rejects path traversal and bad shapes', () => {
    expect(isValidAgentName('../secrets')).toBe(false)
    expect(isValidAgentName('a/b')).toBe(false)
    expect(isValidAgentName('Designer')).toBe(false)
    expect(isValidAgentName('9lives')).toBe(false)
    expect(isValidAgentName('')).toBe(false)
    expect(isValidAgentName('has space')).toBe(false)
  })
})

describe('parseAgent', () => {
  it('parses frontmatter and prompt body', () => {
    const agent = parseAgent('---\ndescription: "Does things"\ncolor: "#fff"\ntags:\n  - code\n---\n\nBe minimal.\n', 'developer')
    expect(agent.name).toBe('developer')
    expect(agent.description).toBe('Does things')
    expect(agent.color).toBe('#fff')
    expect(agent.tags).toEqual(['code'])
    expect(agent.prompt).toBe('Be minimal.')
  })

  it('defaults color and tags', () => {
    const agent = parseAgent('---\ndescription: "X"\n---\nBody', 'x')
    expect(agent.color).toBe('')
    expect(agent.tags).toEqual([])
  })

  it('throws when description is missing', () => {
    expect(() => parseAgent('---\ncolor: "#fff"\n---\nBody', 'x')).toThrow()
  })
})

describe('readAgents', () => {
  it('returns an empty list when the agents dir does not exist', () => {
    expect(readAgents(dir)).toEqual([])
  })

  it('reads only valid-named files, sorted by name', () => {
    const agentsDir = path.join(dir, 'agents')
    fs.mkdirSync(agentsDir, { recursive: true })
    fs.writeFileSync(path.join(agentsDir, 'zeta.md'), '---\ndescription: "Z"\n---\nZ body', 'utf8')
    fs.writeFileSync(path.join(agentsDir, 'alpha.md'), '---\ndescription: "A"\n---\nA body', 'utf8')
    fs.writeFileSync(path.join(agentsDir, 'Bad Name.md'), '---\ndescription: "B"\n---\nB body', 'utf8')
    fs.writeFileSync(path.join(agentsDir, 'notes.txt'), 'not markdown', 'utf8')
    expect(readAgents(dir).map((a) => a.name)).toEqual(['alpha', 'zeta'])
  })

  it('skips files with unparseable frontmatter but keeps the rest', () => {
    const agentsDir = path.join(dir, 'agents')
    fs.mkdirSync(agentsDir, { recursive: true })
    fs.writeFileSync(path.join(agentsDir, 'broken.md'), '---\nnope: [unclosed\n---\nBody', 'utf8')
    fs.writeFileSync(path.join(agentsDir, 'good.md'), '---\ndescription: "G"\n---\nG body', 'utf8')
    expect(readAgents(dir).map((a) => a.name)).toEqual(['good'])
  })
})

describe('scaffolded sample agents', () => {
  it('init writes the full default roster', () => {
    ProjectStore.init(dir, { sample: true })
    const names = readAgents(path.join(dir, '.agentboard')).map((a) => a.name)
    expect(names).toEqual([
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
    expect(Object.keys(SAMPLE_AGENTS)).toHaveLength(10)
  })

  it('review-assistant is read-only, briefs the human and is not a review gate', () => {
    const agent = parseAgent(SAMPLE_AGENTS['review-assistant.md']!, 'review-assistant')
    expect(agent.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write', 'NotebookEdit']))
    expect(isReviewerAgent(agent)).toBe(false)
    expect(isReviewAssistant(agent)).toBe(true)
    expect(agent.prompt).toContain('review_queue')
    expect(agent.prompt).toMatch(/brief/i)
    expect(agent.prompt).toMatch(/approve in batch/i)
    expect(agent.prompt).not.toMatch(/call `?review_decide/i)
  })

  it('every sample agent parses and ships a real prompt', () => {
    for (const [file, raw] of Object.entries(SAMPLE_AGENTS)) {
      const agent = parseAgent(raw, file.replace(/\.md$/, ''))
      expect(agent.description.length).toBeGreaterThan(10)
      expect(agent.prompt.length).toBeGreaterThan(100)
      expect(agent.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it("init's AGENTS.md explains the human review in chat", () => {
    ProjectStore.init(dir, { sample: true })
    const md = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8')
    for (const needle of ['human-review', 'review-assistant', 'review_queue', 'review_decide']) expect(md).toContain(needle)
  })

  it('init does not overwrite existing agent files', () => {
    ProjectStore.init(dir, { sample: true })
    const target = path.join(dir, '.agentboard', 'agents', 'developer.md')
    fs.writeFileSync(target, '---\ndescription: "Mine"\n---\nCustom prompt', 'utf8')
    ProjectStore.init(dir, { sample: true })
    expect(fs.readFileSync(target, 'utf8')).toContain('Custom prompt')
  })
})

describe('store agent accessors', () => {
  it('lists and gets agents', () => {
    const store = ProjectStore.init(dir, { sample: true })
    expect(store.listAgents()).toHaveLength(10)
    const designer = store.getAgent('designer')
    expect(designer?.name).toBe('designer')
    expect(designer?.prompt).toContain('Designer')
  })

  it('returns null for a missing agent and throws for an invalid name', () => {
    const store = ProjectStore.init(dir, { sample: true })
    expect(store.getAgent('nobody')).toBeNull()
    expect(() => store.getAgent('../escape')).toThrow(/Invalid agent name/)
    expect(() => store.getAgent('UPPER')).toThrow(/Invalid agent name/)
  })

  it('agentForTask resolves only specialized assignees', () => {
    const store = ProjectStore.init(dir, { sample: true })
    const tasks = store.state.tasks
    expect(store.agentForTask({ assignee: 'dev' })).toBeNull()
    expect(store.agentForTask({ assignee: 'human' })).toBeNull()
    expect(store.agentForTask({ assignee: 'ghost' })).toBeNull()
    expect(store.agentForTask({ assignee: 'designer' })?.name).toBe('designer')
    expect(tasks.length).toBeGreaterThan(0)
  })

  it('keeps a specialized assignee when the status changes', () => {
    const store = ProjectStore.init(dir, { sample: true })
    const task = store.createTask({ title: 'Landing hero', assignee: 'designer' })
    expect(task.assignee).toBe('designer')
    const inProgress = store.updateTask(task.id, { status: 'In Progress' })
    expect(inProgress.assignee).toBe('designer')
    const review = store.updateTask(task.id, { status: 'Review' })
    expect(review.assignee).toBe('designer')
  })

  it('still auto-maps workflow roles on status change', () => {
    const store = ProjectStore.init(dir, { sample: true })
    const task = store.createTask({ title: 'Routine work', assignee: 'scrum-master' })
    const moved = store.updateTask(task.id, { status: 'In Progress' })
    expect(moved.assignee).toBe('dev')
  })
})
