import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { parseFrontmatter, parseTaskBody } from './frontmatter.js'

export const TemplateVars = z.record(z.string())
export type TemplateVars = z.infer<typeof TemplateVars>

const TemplateMeta = z.object({
  title: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assignee: z.enum(['scrum-master', 'dev', 'review', 'perfect']).optional(),
  estimate: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string()).optional(),
})
export type TemplateMeta = z.infer<typeof TemplateMeta>

export interface TaskTemplate extends TemplateMeta {
  name: string
  description: string
  acceptanceCriteria: string[]
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g

/**
 * A template name must be a plain filename without extension: letters,
 * digits, dot, underscore and dash only. Rejects path separators and `..`
 * so a name can never escape `<boardDir>/templates/`.
 */
export function isValidTemplateName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name) && !name.includes('..')
}

/** Replace `{{var}}` placeholders with values from `vars`; unknown placeholders are left intact. */
export function renderString(value: string, vars: TemplateVars): string {
  return value.replace(PLACEHOLDER, (_match, key: string) => vars[key] ?? `{{${key}}}`)
}

/** Parse a raw template markdown file (frontmatter + body) into a structured template. */
export function parseTemplate(raw: string, name: string): TaskTemplate {
  const { data, body } = parseFrontmatter(raw, TemplateMeta)
  const { description, acceptanceCriteria } = parseTaskBody(body)
  return { ...data, name, description, acceptanceCriteria }
}

/** Render every placeholder in a template (title, description, acceptance criteria, tags). */
export function renderTemplate(template: TaskTemplate, vars: TemplateVars = {}): TaskTemplate {
  return {
    ...template,
    title: template.title ? renderString(template.title, vars) : undefined,
    description: renderString(template.description, vars),
    acceptanceCriteria: template.acceptanceCriteria.map((c) => renderString(c, vars)),
    tags: template.tags?.map((t) => renderString(t, vars)),
  }
}

/** Read and parse every `*.md` template in `<boardDir>/templates/` (sorted by filename). */
export function readTemplates(boardDir: string): TaskTemplate[] {
  const dir = path.join(boardDir, 'templates')
  if (!fs.existsSync(dir)) return []
  const out: TaskTemplate[] = []
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    let raw: string
    try {
      raw = fs.readFileSync(path.join(dir, file), 'utf8')
    } catch (err) {
      // A file that vanished between readdir and read is fine to skip;
      // anything else (EACCES, EISDIR, ...) must surface, not be swallowed.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    try {
      out.push(parseTemplate(raw, file.replace(/\.md$/, '')))
    } catch {
      // unparseable frontmatter: skip the file but keep listing the rest
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Sample templates written by `agentboard init`. */
export const SAMPLE_TEMPLATES: Record<string, string> = {
  'feature.md': `---
title: "{{title}}"
priority: "medium"
assignee: "scrum-master"
estimate: 2
tags:
  - feature
---

## Description

{{description}}

## Acceptance criteria

- [ ] Implementation covers the described behavior
- [ ] {{test_criterion}}
- [ ] Documentation or copy updated if user-facing
`,
  'bug-report.md': `---
title: "Bug: {{summary}}"
priority: "high"
assignee: "scrum-master"
estimate: 1
tags:
  - bug
---

## Description

Steps to reproduce:

1. {{repro_step}}

Expected: {{expected}}
Actual: {{actual}}

## Acceptance criteria

- [ ] Root cause identified and explained in the task notes
- [ ] Failing test added that reproduces the bug
- [ ] Fix verified against the reproduction steps without regressions
`,
  'chore.md': `---
title: "{{title}}"
priority: "low"
assignee: "scrum-master"
estimate: 1
tags:
  - chore
---

## Description

{{description}}

## Acceptance criteria

- [ ] Change introduces no behavioral differences
- [ ] Lint and typecheck pass
`,
}
