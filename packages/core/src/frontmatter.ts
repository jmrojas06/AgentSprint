import matter from 'gray-matter'
import type { z } from 'zod'
import { ActivityEvent } from './types.js'
import type { ActivityEvent as ActivityEventType } from './types.js'

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

/**
 * Activity lines use a machine-readable pipe format:
 *   - <iso-timestamp> | <actor> | <type> | <detail>
 */
const ACTIVITY_LINE = /^-\s*(\S+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.*)$/

/** Parse the `## Activity` section of a task body into structured events, sorted by timestamp. */
export function parseActivity(body: string): ActivityEventType[] {
  const raw = section(body, 'Activity')
  if (!raw) return []
  const events: ActivityEventType[] = []
  const malformed: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = ACTIVITY_LINE.exec(trimmed)
    const parsed = m ? ActivityEvent.safeParse({ at: m[1], actor: m[2], type: m[3], detail: m[4] }) : null
    if (parsed?.success) {
      events.push(parsed.data)
    } else {
      // Never drop malformed lines silently: warn so they are not lost
      // unnoticed when the task is rewritten from structured data.
      malformed.push(trimmed)
    }
  }
  if (malformed.length > 0) {
    console.warn(
      `[agentboard] ${malformed.length} malformed activity line(s) in ## Activity will be lost on rewrite: ${malformed.join(' ; ')}`,
    )
  }
  return sortActivity(events)
}

/** Sort events chronologically by their parsed `at` timestamp (stable for ties). */
function sortActivity(events: ActivityEventType[]): ActivityEventType[] {
  return [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
}

/** Serialize activity events back into `## Activity` section lines. */
export function serializeActivity(events: ActivityEventType[]): string {
  if (events.length === 0) return ''
  const lines = events.map((e) => `- ${e.at} | ${e.actor} | ${e.type} | ${e.detail.replace(/\n/g, ' ')}`)
  return ['## Activity', '', ...lines].join('\n')
}

/** Extract description + acceptance criteria + notes + activity from a markdown task body. */
export function parseTaskBody(body: string): { description: string; acceptanceCriteria: string[]; notes: string; activity: ActivityEventType[] } {
  const description = section(body, 'Description')
  const notes = section(body, 'Notes')
  const activity = parseActivity(body)
  const rawMatches = [...body.matchAll(/^[-*]\s*\[([ xX])\]\s*(.+)$/gm)]
  const criteria = rawMatches.map((m) => {
    const isChecked = m[1]?.toLowerCase() === 'x'
    const text = m[2]?.trim() ?? ''
    return isChecked ? `[x] ${text}` : text
  })
  return { description, acceptanceCriteria: criteria, notes, activity }
}

/** Build a markdown task body from structured fields. */
export function buildTaskBody(description: string, acceptanceCriteria: string[], notes?: string, activity: ActivityEventType[] = []): string {
  const parts: string[] = []
  parts.push('## Description\n')
  parts.push(description.trim() ? description.trim() : '_What needs to be done and why._')
  parts.push('')
  parts.push('## Acceptance criteria\n')
  if (acceptanceCriteria.length === 0) {
    parts.push('- [ ] ')
  } else {
    for (const c of acceptanceCriteria) {
      const trimmed = c.trim()
      if (/^\[[xX]\]\s*/.test(trimmed)) {
        parts.push(`- [x] ${trimmed.replace(/^\[[xX]\]\s*/, '')}`)
      } else if (/^\[\s*\]\s*/.test(trimmed)) {
        parts.push(`- [ ] ${trimmed.replace(/^\[\s*\]\s*/, '')}`)
      } else {
        parts.push(`- [ ] ${trimmed}`)
      }
    }
  }
  if (notes && notes.trim()) {
    parts.push('')
    parts.push('## Notes\n')
    parts.push(notes.trim())
  }
  if (activity.length > 0) {
    parts.push('')
    parts.push(serializeActivity(activity))
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
