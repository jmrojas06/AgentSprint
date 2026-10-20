import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import matter from 'gray-matter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, SUBAGENT_MARKER, claudeAgentsDir, nearestClaudeColor, renderClaudeSubagent, syncClaudeSubagents } from '../src/index.js'
import type { AgentProfile } from '../src/index.js'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-subagents-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const agent = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  name: 'designer',
  description: 'Designer — UI/UX.',
  color: '#a855f7',
  tags: [],
  tools: [],
  disallowedTools: [],
  skills: [],
  model: 'inherit',
  prompt: 'You are the Designer.',
  ...over,
})

describe('nearestClaudeColor', () => {
  it('maps hex colors to Claude Code color names', () => {
    expect(nearestClaudeColor('#22c55e')).toBe('green')
    expect(nearestClaudeColor('#a855f7')).toBe('purple')
    expect(nearestClaudeColor('#06b6d4')).toBe('cyan')
    expect(nearestClaudeColor('#f97316')).toBe('orange')
    expect(nearestClaudeColor('#ec4899')).toBe('pink')
    expect(nearestClaudeColor('#eab308')).toBe('yellow')
  })

  it('returns null for greys and invalid input', () => {
    expect(nearestClaudeColor('#777777')).toBeNull()
    expect(nearestClaudeColor('')).toBeNull()
    expect(nearestClaudeColor('purple')).toBeNull()
  })
})

describe('renderClaudeSubagent', () => {
  it('writes valid Claude Code frontmatter and the board protocol', () => {
    const out = matter(renderClaudeSubagent(agent({ tools: ['Read', 'Edit'], model: 'sonnet' }), 'demo'))
    expect(out.data.name).toBe('designer')
    expect(out.data.description).toContain('Designer — UI/UX.')
    expect(out.data.description).toContain('assigned to "designer"')
    expect(out.data.tools).toBe('Read, Edit')
    expect(out.data.model).toBe('sonnet')
    expect(out.data.color).toBe('purple')
    expect(out.content).toContain(SUBAGENT_MARKER)
    expect(out.content).toContain('You are the Designer.')
    expect(out.content).toContain('task_claim { id, agent: "designer" }')
  })

  it('omits tools and model when inherited', () => {
    const out = matter(renderClaudeSubagent(agent(), 'demo'))
    expect(out.data.tools).toBeUndefined()
    expect(out.data.model).toBeUndefined()
  })
})

describe('syncClaudeSubagents', () => {
  it('writes, then converges (second run changes nothing)', () => {
    const first = syncClaudeSubagents(dir, [agent(), agent({ name: 'tester' })], 'demo')
    expect(first.written.sort()).toEqual(['designer', 'tester'])
    expect(fs.existsSync(path.join(claudeAgentsDir(dir), 'designer.md'))).toBe(true)
    const second = syncClaudeSubagents(dir, [agent(), agent({ name: 'tester' })], 'demo')
    expect(second.written).toEqual([])
    expect(second.unchanged.sort()).toEqual(['designer', 'tester'])
  })

  it('never overwrites a hand-written subagent and never deletes one', () => {
    const own = path.join(claudeAgentsDir(dir), 'designer.md')
    fs.mkdirSync(path.dirname(own), { recursive: true })
    fs.writeFileSync(own, '---\nname: designer\ndescription: mine\n---\nMy own prompt', 'utf8')
    fs.writeFileSync(path.join(claudeAgentsDir(dir), 'reviewer.md'), '---\nname: reviewer\ndescription: mine\n---\nX', 'utf8')
    const result = syncClaudeSubagents(dir, [agent()], 'demo')
    expect(result.skipped.map((s) => s.name)).toEqual(['designer'])
    expect(fs.readFileSync(own, 'utf8')).toContain('My own prompt')
    expect(fs.existsSync(path.join(claudeAgentsDir(dir), 'reviewer.md'))).toBe(true)
  })

  it('removes generated subagents whose profile is gone', () => {
    syncClaudeSubagents(dir, [agent(), agent({ name: 'tester' })], 'demo')
    const result = syncClaudeSubagents(dir, [agent()], 'demo')
    expect(result.removed).toEqual(['tester'])
    expect(fs.existsSync(path.join(claudeAgentsDir(dir), 'tester.md'))).toBe(false)
  })

  it('does not create .claude/ when there is nothing to write', () => {
    syncClaudeSubagents(dir, [], 'demo')
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false)
  })
})

describe('store integration', () => {
  it('init generates one Claude Code subagent per default agent', () => {
    ProjectStore.init(dir, { sample: true })
    const files = fs.readdirSync(claudeAgentsDir(dir)).sort()
    expect(files).toEqual(['code-reviewer.md', 'creative-director.md', 'designer.md', 'developer.md', 'docs.md', 'fixer.md', 'ideator.md', 'tester.md', 'ui-reviewer.md'])
  })

  it('saveAgent creates a profile, exposes it in state and syncs its subagent', () => {
    const store = ProjectStore.init(dir, { sample: true })
    const saved = store.saveAgent({ name: 'stripe-expert', description: 'Payments with Stripe', prompt: 'You integrate Stripe.', color: '#3b82f6' })
    expect(saved.name).toBe('stripe-expert')
    expect(store.state.agents.map((a) => a.name)).toContain('stripe-expert')
    const generated = fs.readFileSync(path.join(claudeAgentsDir(dir), 'stripe-expert.md'), 'utf8')
    expect(generated).toContain('You integrate Stripe.')
    // a reopened store reads it back from disk
    expect(ProjectStore.open(dir).getAgent('stripe-expert')?.description).toBe('Payments with Stripe')
  })

  it('saveAgent keeps unspecified fields of an existing agent', () => {
    const store = ProjectStore.init(dir, { sample: true })
    const before = store.getAgent('tester')!
    const after = store.saveAgent({ name: 'tester', model: 'haiku' })
    expect(after.model).toBe('haiku')
    expect(after.prompt).toBe(before.prompt)
    expect(after.description).toBe(before.description)
  })

  it('saveAgent rejects a new agent without prompt or description', () => {
    const store = ProjectStore.init(dir, { sample: true })
    expect(() => store.saveAgent({ name: 'empty', description: 'X', prompt: '  ' })).toThrow(/prompt is required/)
    expect(() => store.saveAgent({ name: 'nodesc', prompt: 'Body' })).toThrow()
    expect(() => store.saveAgent({ name: '../evil', description: 'X', prompt: 'Y' })).toThrow(/Invalid agent name/)
  })

  it('deleteAgent removes the profile and its generated subagent', () => {
    const store = ProjectStore.init(dir, { sample: true })
    store.deleteAgent('ideator')
    expect(store.state.agents.map((a) => a.name)).not.toContain('ideator')
    expect(fs.existsSync(path.join(claudeAgentsDir(dir), 'ideator.md'))).toBe(false)
    expect(() => store.deleteAgent('ideator')).toThrow(/not found/)
  })

  it('refresh picks up an agent file edited by hand', () => {
    const store = ProjectStore.init(dir, { sample: true })
    fs.writeFileSync(path.join(store.boardDir, 'agents', 'seo.md'), '---\ndescription: "SEO"\n---\nRank things.', 'utf8')
    store.refresh()
    expect(store.listAgents().map((a) => a.name)).toContain('seo')
  })

  it('respects subagents: false in config.yaml', () => {
    const store = ProjectStore.init(dir, { sample: false })
    const config = path.join(store.boardDir, 'config.yaml')
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/^---\n/, '---\nsubagents: false\n'), 'utf8')
    const reopened = ProjectStore.open(dir)
    reopened.installDefaultAgents()
    expect(reopened.syncSubagents()).toBeNull()
    expect(fs.existsSync(path.join(dir, '.claude'))).toBe(false)
  })

  it('installDefaultAgents adds only the missing defaults', () => {
    const store = ProjectStore.init(dir, { sample: false })
    expect(store.installDefaultAgents()).toHaveLength(9)
    store.deleteAgent('docs')
    expect(store.installDefaultAgents()).toEqual(['docs'])
    expect(store.installDefaultAgents()).toEqual([])
  })
})
