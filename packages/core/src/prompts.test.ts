import { describe, expect, it } from 'vitest'
import { buildIdeaToMvpPrompt } from './prompts.js'

const base = { projectName: 'Groceries', agents: [{ name: 'designer', description: 'UI and UX' }], hasBrand: false }

describe('buildIdeaToMvpPrompt', () => {
  it('keeps the whole idea verbatim: several words, quotes and newlines', () => {
    const idea = 'A shared "shopping" list for flatmates\nthat don\'t talk: $5 `stripe`'
    const text = buildIdeaToMvpPrompt({ ...base, idea })
    expect(text).toContain(`## The idea\n\n${idea}\n`)
  })

  it('names the board, lists the roster and drives the orchestration', () => {
    const text = buildIdeaToMvpPrompt({ ...base, idea: 'A habit tracker' })
    expect(text).toContain('on the AgentSprint board "Groceries"')
    expect(text).toContain('- `designer` — UI and UX')
    expect(text).toContain('task_create_batch')
    expect(text).toContain('No brand kit yet')
    expect(text).not.toContain('**Preferred stack:**')
    expect(text).not.toContain('**Scope:**')
  })

  it('adds the stack and the scope when given', () => {
    const text = buildIdeaToMvpPrompt({ ...base, idea: 'A habit tracker', stack: 'Vite + React', scope: 'one habit, no login' })
    expect(text).toContain('**Preferred stack:** Vite + React')
    expect(text).toContain('**Scope:** one habit, no login')
  })

  it('points at the brand kit when there is one, and at agent_sync when there are no agents', () => {
    const text = buildIdeaToMvpPrompt({ ...base, idea: 'x', agents: [], hasBrand: true })
    expect(text).toContain('A brand kit exists')
    expect(text).toContain('run agent_sync with installDefaults: true first')
  })
})
