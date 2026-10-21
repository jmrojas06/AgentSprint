import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildIdeaCli, shellQuote } from './ideaPrompt'

describe('idea-to-mvp CLI variant', () => {
  it('starts claude with the whole prompt as one shell-quoted argument', () => {
    expect(buildIdeaCli('Build a habit tracker')).toBe(`claude 'Build a habit tracker'`)
    expect(buildIdeaCli("Don't forget milk")).toBe(`claude 'Don'\\''t forget milk'`)
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
  })

  it('produces nothing until there is a prompt', () => {
    expect(buildIdeaCli('')).toBe('')
  })

  it('reaches claude as exactly the prompt: quotes, $, backticks and newlines intact', () => {
    const prompt = 'A shared "shopping" list\nfor flatmates who don\'t talk: $5 `stripe` & $HOME'
    const argv = execFileSync('bash', ['-c', `claude() { printf '%s|' "$#" "$@"; }; ${buildIdeaCli(prompt)}`]).toString()
    expect(argv).toBe(`1|${prompt}|`)
  })
})
