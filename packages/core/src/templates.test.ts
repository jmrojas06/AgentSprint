import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectStore, parseTemplate, readTemplates, renderString, renderTemplate } from '../src/index.js'

const RAW_TEMPLATE = `---
title: "{{title}}"
priority: "high"
assignee: "scrum-master"
estimate: 3
tags:
  - bug
---

## Description

Repro: {{repro_step}}

## Acceptance criteria

- [ ] Root cause of {{component}} identified
- [ ] Regression test added
`

let dir: string
let store: ProjectStore

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-templates-'))
  store = ProjectStore.init(dir, { sample: true })
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('renderString', () => {
  it('replaces known variables', () => {
    expect(renderString('Fix {{thing}} now', { thing: 'login' })).toBe('Fix login now')
  })

  it('leaves unknown placeholders intact', () => {
    expect(renderString('Hello {{name}} and {{other}}', { name: 'Ada' })).toBe('Hello Ada and {{other}}')
  })

  it('tolerates whitespace inside braces', () => {
    expect(renderString('{{ title }}', { title: 'X' })).toBe('X')
  })
})

describe('parseTemplate', () => {
  it('parses frontmatter and body sections', () => {
    const tpl = parseTemplate(RAW_TEMPLATE, 'bug-report')
    expect(tpl.name).toBe('bug-report')
    expect(tpl.title).toBe('{{title}}')
    expect(tpl.priority).toBe('high')
    expect(tpl.assignee).toBe('scrum-master')
    expect(tpl.estimate).toBe(3)
    expect(tpl.tags).toEqual(['bug'])
    expect(tpl.description).toContain('{{repro_step}}')
    expect(tpl.acceptanceCriteria).toEqual([
      'Root cause of {{component}} identified',
      'Regression test added',
    ])
  })
})

describe('renderTemplate', () => {
  it('renders title, description and criteria with vars', () => {
    const tpl = parseTemplate(RAW_TEMPLATE, 'bug-report')
    const out = renderTemplate(tpl, { title: 'Login fails', repro_step: 'open /login', component: 'auth' })
    expect(out.title).toBe('Login fails')
    expect(out.description).toContain('open /login')
    expect(out.acceptanceCriteria[0]).toBe('Root cause of auth identified')
  })

  it('keeps placeholders when vars are missing', () => {
    const tpl = parseTemplate(RAW_TEMPLATE, 'bug-report')
    const out = renderTemplate(tpl, {})
    expect(out.title).toBe('{{title}}')
    expect(out.acceptanceCriteria[0]).toContain('{{component}}')
  })
})

describe('ProjectStore templates integration', () => {
  it('init generates the sample templates (feature, bug-report, chore)', () => {
    const names = store.listTemplates().map((t) => t.name)
    expect(names).toEqual(['bug-report', 'chore', 'feature'])
  })

  it('getTemplate returns null for unknown templates', () => {
    expect(store.getTemplate('nope')).toBeNull()
  })

  it('createTaskFromTemplate renders vars and applies defaults + overrides', () => {
    const task = store.createTaskFromTemplate('bug-report', {
      vars: { summary: 'Board crashes', title: 'Bug: Board crashes' },
      overrides: { sprint: null },
    })
    expect(task.id).toMatch(/^TK-\d+$/)
    expect(task.title).toBe('Bug: Board crashes')
    expect(task.priority).toBe('high')
    expect(task.assignee).toBe('scrum-master')
    expect(task.estimate).toBe(1)
    expect(task.tags).toEqual(['bug'])
    expect(task.acceptanceCriteria.some((c) => c.includes('{{'))).toBe(false)
    // persisted to disk with rendered content
    const raw = fs.readFileSync(path.join(dir, '.agentboard/tasks', `${task.id}.md`), 'utf8')
    expect(raw).toContain('Bug: Board crashes')
  })

  it('createTaskFromTemplate throws for unknown templates', () => {
    expect(() => store.createTaskFromTemplate('nope')).toThrow(/Template not found/)
  })

  it('readTemplates ignores unparseable files', () => {
    fs.writeFileSync(path.join(dir, '.agentboard/templates/broken.md'), '---\nestimate: 9999\n---\n\nbody\n')
    const templates = readTemplates(path.join(dir, '.agentboard'))
    expect(templates.map((t) => t.name)).toEqual(['bug-report', 'chore', 'feature'])
  })

  it('lists no templates when the directory is missing', () => {
    const empty = ProjectStore.init(fs.mkdtempSync(path.join(os.tmpdir(), 'agentboard-notpl-')), { sample: false })
    expect(empty.listTemplates()).toEqual([])
  })
})
