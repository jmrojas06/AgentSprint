import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  message: string
}

export interface TaskGitRefs {
  gitAvailable: boolean
  commits: GitCommit[]
  branches: string[]
}

export interface GitLinkOptions {
  /**
   * Custom match pattern. Use `%ID%` as a placeholder for the task id,
   * e.g. `feat/%ID%|%ID%:`. Defaults to a word-boundary match on the id.
   */
  pattern?: string
  /** Max commits returned (default 50). */
  max?: number
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Build the regex used to detect references to `id` in commit messages / branch names. */
export function taskRefPattern(id: string, pattern?: string): RegExp {
  const source = pattern
    ? pattern.replaceAll('%ID%', escapeRegExp(id))
    : `\\b${escapeRegExp(id)}\\b`
  return new RegExp(source)
}

const RECORD_SEPARATOR = '\x1f'

async function runGit(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', rootDir, ...args], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

/**
 * Scan `git log` across all refs for commits whose message references `id`.
 * Returns an empty list (with `gitAvailable: false`) when the directory is not
 * a git repository or git is unavailable.
 */
export async function findTaskCommits(rootDir: string, id: string, opts: GitLinkOptions = {}): Promise<GitCommit[]> {
  if (!fs.existsSync(path.join(rootDir, '.git'))) return []
  const max = opts.max ?? 50
  const re = taskRefPattern(id, opts.pattern)
  let out: string
  try {
    out = await runGit(
      rootDir,
      ['log', '--all', `--pretty=format:%H${RECORD_SEPARATOR}%h${RECORD_SEPARATOR}%an${RECORD_SEPARATOR}%cI${RECORD_SEPARATOR}%s`],
    )
  } catch {
    return []
  }
  const commits: GitCommit[] = []
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [hash, shortHash, author, date, ...rest] = line.split(RECORD_SEPARATOR)
    const message = rest.join(RECORD_SEPARATOR)
    if (!hash || !message) continue
    if (!re.test(message)) continue
    commits.push({ hash: hash!, shortHash: shortHash ?? hash!.slice(0, 7), author: author ?? '', date: date ?? '', message })
    if (commits.length >= max) break
  }
  return commits.sort((a, b) => b.date.localeCompare(a.date))
}

/** List local and remote branch names whose name references `id` (e.g. `feat/TK-15`). */
export async function findTaskBranches(rootDir: string, id: string, opts: GitLinkOptions = {}): Promise<string[]> {
  if (!fs.existsSync(path.join(rootDir, '.git'))) return []
  const re = taskRefPattern(id, opts.pattern)
  let out: string
  try {
    out = await runGit(rootDir, ['branch', '--all', '--format=%(refname:short)'])
  } catch {
    return []
  }
  return out
    .split('\n')
    .map((b) => b.trim())
    .filter((b) => b && !b.endsWith('/HEAD') && re.test(b))
}

/** Convenience wrapper returning commits + branches linked to a task. */
export async function findTaskRefs(rootDir: string, id: string, opts: GitLinkOptions = {}): Promise<TaskGitRefs> {
  const gitAvailable =
    fs.existsSync(path.join(rootDir, '.git')) &&
    (await runGit(rootDir, ['rev-parse', '--git-dir'])
      .then(() => true)
      .catch(() => false))
  if (!gitAvailable) return { gitAvailable: false, commits: [], branches: [] }
  const [commits, branches] = await Promise.all([findTaskCommits(rootDir, id, opts), findTaskBranches(rootDir, id, opts)])
  return { gitAvailable: true, commits, branches }
}

/**
 * Count commits referencing each known task id with a single `git log` scan.
 * Only ids present in `taskIds` are reported; ids referenced in git but absent
 * from the board are ignored.
 */
export async function taskCommitCounts(
  rootDir: string,
  taskIds: readonly string[],
  opts: GitLinkOptions = {},
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  if (taskIds.length === 0 || !fs.existsSync(path.join(rootDir, '.git'))) return counts
  const known = new Set(taskIds)
  let out: string
  try {
    out = await runGit(
      rootDir,
      ['log', '--all', `--pretty=format:%H${RECORD_SEPARATOR}%s${RECORD_SEPARATOR}%b`],
    )
  } catch {
    return counts
  }
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    const [, subject = '', body = ''] = line.split(RECORD_SEPARATOR)
    for (const match of `${subject}\n${body}`.matchAll(/\b[A-Z]{2}-[0-9]+\b/g)) {
      const id = match[0]
      if (known.has(id)) counts[id] = (counts[id] ?? 0) + 1
    }
  }
  return counts
}
