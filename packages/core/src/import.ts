import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

import type { ProjectStore } from './storage.js'
import type { TaskInput } from './types.js'

export interface ParsedTodoItem {
  title: string
  done: boolean
}

/**
 * Parse a TODO.md / NOTES.md style file into task candidates.
 * Supports checkbox bullets (`- [ ]`, `- [x]`) and plain bullets (`-`, `*`, `+`).
 * Headings, code blocks and blank lines are ignored.
 */
export function parseTodoFile(content: string): ParsedTodoItem[] {
  const items: ParsedTodoItem[] = []
  let inCodeBlock = false
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trimEnd()
    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue
    const checkbox = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/)
    if (checkbox) {
      const title = checkbox[2]!.trim()
      if (title) items.push({ title, done: checkbox[1]!.toLowerCase() === 'x' })
      continue
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/)
    if (bullet) {
      const title = bullet[1]!.trim()
      if (title) items.push({ title, done: false })
    }
  }
  return items
}

/** Normalize a title for fuzzy duplicate detection. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = curr
  }
  return prev[b.length]!
}

/** True when two titles refer to the same work (case/punctuation-insensitive). */
export function isSimilarTitle(a: string, b: string): boolean {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  // High edit-similarity counts as a duplicate.
  const maxLen = Math.max(na.length, nb.length)
  if (1 - levenshtein(na, nb) / maxLen >= 0.85) return true
  // One title containing the other (e.g. "write docs" vs "write docs for the cli").
  if (Math.min(na.length, nb.length) >= 5 && (na.includes(nb) || nb.includes(na))) return true
  return false
}

export interface GithubIssue {
  number: number
  title: string
  labels?: Array<{ name: string }> | string[]
  milestone?: { title: string } | null
}

export interface ImportMapping {
  /** Map of GitHub label name → tags added to the imported task. */
  labelTags?: Record<string, string[]>
  /** Map of GitHub milestone title → sprint id to assign. */
  milestoneSprints?: Record<string, number>
  /** Extra tags added to every imported item (defaults to `imported:<source>`). */
  extraTags?: string[]
}

/** Fetch open issues of `owner/repo` using the GitHub CLI (`gh`). Throws when gh is unavailable. */
export async function fetchGithubIssues(ownerRepo: string): Promise<GithubIssue[]> {
  await assertGhAvailable()
  const { stdout } = await execFileAsync(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      ownerRepo,
      '--state',
      'open',
      '--limit',
      '200',
      '--json',
      'number,title,labels,milestone',
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  )
  return JSON.parse(stdout) as GithubIssue[]
}

async function assertGhAvailable(): Promise<void> {
  try {
    await execFileAsync('gh', ['--version'])
  } catch {
    throw new Error('GitHub CLI (`gh`) is not installed or not on PATH. Install it from https://cli.github.com/')
  }
}

/** Convert a parsed TODO file into task inputs tagged with an origin tag. */
export function todosToTaskInputs(items: ParsedTodoItem[], mapping: ImportMapping = {}): TaskInput[] {
  const extraTags = mapping.extraTags ?? ['imported:todo']
  return items.map((item) => ({
    title: item.title,
    status: item.done ? ('Done' as const) : ('To Do' as const),
    sprint: null,
    tags: [...extraTags],
    description: `Imported from TODO file.`,
  }))
}

/** Convert GitHub issues into task inputs applying the configured mappings. */
export function issuesToTaskInputs(issues: GithubIssue[], mapping: ImportMapping = {}): TaskInput[] {
  const extraTags = mapping.extraTags ?? ['imported:github']
  return issues.map((issue) => {
    const labelNames = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name))
    const tags = new Set<string>(extraTags)
    for (const label of labelNames) {
      for (const tag of mapping.labelTags?.[label] ?? []) tags.add(tag)
    }
    const sprint = issue.milestone?.title ? mapping.milestoneSprints?.[issue.milestone.title] : undefined
    return {
      title: issue.title,
      status: 'To Do' as const,
      sprint: sprint ?? null,
      tags: [...tags],
      description: `Imported from GitHub issue #${issue.number}.`,
    }
  })
}

export interface ImportResult {
  created: Array<{ id: string; title: string }>
  skippedDuplicates: Array<{ title: string; matchedWith: string }>
}

/**
 * Create tasks on the board from prepared inputs, skipping any whose title is
 * similar to an existing task or to another item in this batch.
 */
export function importTasks(store: ProjectStore, inputs: TaskInput[], mapping: ImportMapping = {}): ImportResult {
  void mapping
  const result: ImportResult = { created: [], skippedDuplicates: [] }
  const knownTitles = [...store.state.tasks.map((t) => t.title)]
  for (const input of inputs) {
    const match = knownTitles.find((existing) => isSimilarTitle(existing, input.title))
    if (match) {
      result.skippedDuplicates.push({ title: input.title, matchedWith: match })
      continue
    }
    const task = store.createTask(input)
    result.created.push({ id: task.id, title: task.title })
    knownTitles.push(task.title)
  }
  return result
}
