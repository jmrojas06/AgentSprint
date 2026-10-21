import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import matter from 'gray-matter'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, READ_ONLY_BLOCKED_TOOLS, SUBAGENT_MARKER, SUBAGENT_SCHEMA, claudeAgentsDir, nearestClaudeColor, renderClaudeSubagent, syncClaudeSubagents } from '../src/index.js'
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

  it('falls back to the agentboard task CLI, never to hand edits, without the MCP tools', () => {
    const builder = renderClaudeSubagent(agent(), 'demo')
    expect(builder).toContain('agentboard task claim . <id> --agent designer')
    expect(builder).toContain('agentboard task status . <id> Review --agent designer')
    expect(builder).toMatch(/never edit the frontmatter or the `## Activity` section by hand/i)
    expect(builder).not.toContain('edit `.agentboard/tasks/<id>.md` directly')
    const reviewer = renderClaudeSubagent(agent({ name: 'code-reviewer', tags: ['reviewer'] }), 'demo')
    expect(reviewer).toContain('agentboard task review . <id> --agent code-reviewer --verdict')
    expect(reviewer).toMatch(/never edit the frontmatter or the `## Activity` section by hand/i)
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

  it('stamps the protocol schema into the marker', () => {
    expect(SUBAGENT_SCHEMA).toBeGreaterThanOrEqual(1)
    expect(renderClaudeSubagent(agent(), 'demo')).toContain(`${SUBAGENT_MARKER} schema=${SUBAGENT_SCHEMA}`)
  })

  it('changes in the generated text come with a schema bump', () => {
    // Render one agent of each kind; if this fingerprint changes, the generator's
    // output changed: bump SUBAGENT_SCHEMA (so older servers stop overwriting the
    // new files) and record the new fingerprint for the new schema here.
    const kinds = [agent(), agent({ name: 'code-reviewer', tags: ['reviewer'] }), agent({ name: 'review-assistant', tags: ['human-review'] })]
    const rendered = kinds.map((a) => renderClaudeSubagent(a, 'demo')).join('\n---\n')
    const fingerprint = createHash('sha256').update(rendered).digest('hex').slice(0, 16)
    const FINGERPRINTS: Record<number, string> = { 2: '81a6c71fb6f87f01' }
    expect({ schema: SUBAGENT_SCHEMA, fingerprint }).toEqual({ schema: SUBAGENT_SCHEMA, fingerprint: FINGERPRINTS[SUBAGENT_SCHEMA] })
  })

  it('an older generator never degrades a file from a newer schema, nor removes it', () => {
    syncClaudeSubagents(dir, [agent(), agent({ name: 'tester' })], 'demo')
    const newer = (name: string): string => {
      const file = path.join(claudeAgentsDir(dir), `${name}.md`)
      const content = fs.readFileSync(file, 'utf8').replace(`schema=${SUBAGENT_SCHEMA}`, `schema=${SUBAGENT_SCHEMA + 1}`) + 'newer protocol\n'
      fs.writeFileSync(file, content, 'utf8')
      return content
    }
    const designer = newer('designer')
    const tester = newer('tester')
    const result = syncClaudeSubagents(dir, [agent()], 'demo')
    expect(result.written).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.skipped.map((s) => s.name).sort()).toEqual(['designer', 'tester'])
    expect(result.skipped[0]!.reason).toMatch(/newer generator/)
    expect(fs.readFileSync(path.join(claudeAgentsDir(dir), 'designer.md'), 'utf8')).toBe(designer)
    expect(fs.readFileSync(path.join(claudeAgentsDir(dir), 'tester.md'), 'utf8')).toBe(tester)
  })

  it('treats a generated file without a schema as schema 0 and updates it', () => {
    const file = path.join(claudeAgentsDir(dir), 'designer.md')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `---\nname: designer\n---\n<!-- ${SUBAGENT_MARKER} — edit .agentboard/agents/designer.md instead; this file is regenerated. -->\nOld protocol: edit .agentboard/tasks/<id>.md directly`, 'utf8')
    const result = syncClaudeSubagents(dir, [agent()], 'demo')
    expect(result.written).toEqual(['designer'])
    expect(fs.readFileSync(file, 'utf8')).toBe(renderClaudeSubagent(agent(), 'demo'))
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
    expect(files).toEqual(['code-reviewer.md', 'creative-director.md', 'designer.md', 'developer.md', 'docs.md', 'fixer.md', 'ideator.md', 'review-assistant.md', 'tester.md', 'ui-reviewer.md'])
  })

  it('syncs review-assistant as a read-only briefing subagent that never touches the board', () => {
    ProjectStore.init(dir, { sample: true })
    const out = matter(fs.readFileSync(path.join(claudeAgentsDir(dir), 'review-assistant.md'), 'utf8'))
    // Read-only by tools, not only by instructions: no file edits and no board-changing MCP tool.
    const blocked = String(out.data.disallowedTools).split(', ')
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'mcp__agentsprint__task_claim', 'mcp__agentsprint__task_status', 'mcp__agentsprint__review_decide', 'mcp__agentsprint__sprint_close']) {
      expect(blocked).toContain(tool)
    }
    expect(out.data.description).toContain('human-review')
    expect(out.content).toContain('review_queue')
    expect(out.content).toContain('agentboard review . --json')
    expect(out.content).not.toContain('task_claim')
    expect(out.content).not.toContain('agentboard task status')
  })

  it('keeps a human-review agent read-only even when its profile on disk forgot the board tools', () => {
    // e.g. a profile written before the tool list existed, or edited by hand
    const old = { name: 'review-assistant', description: 'Briefs the human.', prompt: 'Brief.', color: '#f43f5e', tags: ['human-review'], tools: [], disallowedTools: ['Edit'], skills: [], model: 'inherit' } as unknown as AgentProfile
    const blocked = String(matter(renderClaudeSubagent(old, 'demo')).data.disallowedTools).split(', ')
    expect(blocked).toEqual(expect.arrayContaining([...READ_ONLY_BLOCKED_TOOLS]))
    expect(blocked.filter((t) => t === 'Edit')).toHaveLength(1)
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
    expect(store.installDefaultAgents()).toHaveLength(10)
    store.deleteAgent('docs')
    expect(store.installDefaultAgents()).toEqual(['docs'])
    expect(store.installDefaultAgents()).toEqual([])
  })
})
