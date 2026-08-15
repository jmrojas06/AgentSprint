import matter from 'gray-matter'
import type { z } from 'zod'

type DeepNormalized<T> = T extends Date ? string : T extends object ? { [K in keyof T]: DeepNormalized<T[K]> } : T

/**
 * gray-matter / js-yaml parses ISO timestamps into Date objects by default.
 * We always store timestamps as ISO strings, so convert them back.
 */
function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalizeDates)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeDates(v)
    }
    return out
  }
  return value
}

/** Parse a frontmatter-marked-down file into `data` + `body`. */
export function parseFrontmatter<T extends z.ZodTypeAny>(
  content: string,
  schema: T,
): { data: DeepNormalized<z.infer<T>>; body: string } {
  const { data, content: body } = matter(content)
  return { data: schema.parse(normalizeDates(data)) as DeepNormalized<z.infer<T>>, body }
}

/** Serialize `data` as YAML frontmatter on top of `body`. */
export function serializeFrontmatter(data: Record<string, unknown>, body: string): string {
  return matter.stringify(body, data)
}

/** Extract description + acceptance criteria from a markdown task body. */
export function parseTaskBody(body: string): { description: string; acceptanceCriteria: string[] } {
  const description = section(body, 'Description')
  const criteria = [...body.matchAll(/^[-*]\s*\[(?:x| )\]\s*(.+)$/gm)].map((m) => m[1]?.trim() ?? '')
  return { description, acceptanceCriteria: criteria }
}

/** Build a markdown task body from structured fields. */
export function buildTaskBody(description: string, acceptanceCriteria: string[]): string {
  const parts: string[] = []
  parts.push('## Description\n')
  parts.push(description.trim() ? description.trim() : '_What needs to be done and why._')
  parts.push('')
  parts.push('## Acceptance criteria\n')
  if (acceptanceCriteria.length === 0) {
    parts.push('- [ ] ')
  } else {
    parts.push(...acceptanceCriteria.map((c) => `- [ ] ${c}`))
  }
  return parts.join('\n')
}

function section(body: string, title: string): string {
  const heading = `## ${title}`
  const lines = body.split('\n')
  const start = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase())
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end).join('\n').trim()
}
