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
  let source = `\\b${escapeRegExp(id)}\\b`
  if (pattern != null && pattern !== '') {
    if (pattern.length > MAX_PATTERN_LENGTH) {
      throw new Error(
        `Invalid pattern: exceeds the maximum length of ${MAX_PATTERN_LENGTH} characters (got ${pattern.length}).`,
      )
    }
    if (!SAFE_PATTERN_CHARS.test(pattern)) {
      throw new Error(
        'Invalid pattern: contains unsupported characters (quantifiers such as * + ? {} are not allowed to prevent ReDoS).',
      )
    }
    source = pattern.replaceAll('%ID%', escapeRegExp(id))
  }
  try {
    return new RegExp(source)
  } catch {
    throw new Error(`Invalid pattern: "${pattern}" is not a valid regular expression.`)
  }
}

/** Maximum length accepted for user-supplied patterns. */
export const MAX_PATTERN_LENGTH = 200

/**
 * Characters allowed in user-supplied patterns. Quantifiers (`* + ? { }`) are
 * deliberately excluded so catastrophic-backtracking patterns such as
 * `(a+)+$` cannot be expressed at all.
 */
const SAFE_PATTERN_CHARS = /^[A-Za-z0-9 _./:^$|()%[\]\\-]*$/

const RECORD_SEPARATOR = '\x1f'

/** Cap on scanned commits per `git log` call, keeping stdout well under maxBuffer. */
const LOG_COMMIT_LIMIT = 10_000

async function runGit(rootDir: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', rootDir, ...args], {
    maxBuffer: 16 * 1024 * 1024,
  })
  return stdout
}

function warnGitFailure(context: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err)
  console.warn(`[gitLinks] ${context} failed: ${message}`)
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
      // Records end with a NUL (%x00) so multi-line bodies (%b) cannot break
      // the record splitting.
      ['log', '--all', `--max-count=${LOG_COMMIT_LIMIT}`, `--pretty=format:%H${RECORD_SEPARATOR}%h${RECORD_SEPARATOR}%an${RECORD_SEPARATOR}%cI${RECORD_SEPARATOR}%s${RECORD_SEPARATOR}%b%x00`],
    )
  } catch (err) {
    warnGitFailure(`git log scan for ${id}`, err)
    return []
  }
  const commits: GitCommit[] = []
  for (const record of out.split('\0')) {
    if (!record.trim()) continue
    const [hash, shortHash, author, date, subject = '', ...bodyParts] = record.split(RECORD_SEPARATOR)
    const body = bodyParts.join(RECORD_SEPARATOR)
    if (!hash || !subject) continue
    // Match against subject and body so references made only in the body are found too.
    if (!re.test(body ? `${subject}\n${body}` : subject)) continue
    commits.push({ hash: hash!, shortHash: shortHash ?? hash!.slice(0, 7), author: author ?? '', date: date ?? '', message: subject })
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
  } catch (err) {
    warnGitFailure('git branch scan', err)
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
  _opts: GitLinkOptions = {},
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  if (taskIds.length === 0 || !fs.existsSync(path.join(rootDir, '.git'))) return counts
  const known = new Set(taskIds)
  let out: string
  try {
    // Each record ends with a NUL (%x00) so multi-line bodies (%b) cannot
    // break the record splitting.
    out = await runGit(
      rootDir,
      ['log', '--all', `--max-count=${LOG_COMMIT_LIMIT}`, `--pretty=format:%H${RECORD_SEPARATOR}%s${RECORD_SEPARATOR}%b%x00`],
    )
  } catch (err) {
    warnGitFailure('git log commit-count scan', err)
    return counts
  }
  for (const record of out.split('\0')) {
    if (!record.trim()) continue
    const [, subject = '', body = ''] = record.split(RECORD_SEPARATOR)
    for (const match of `${subject}\n${body}`.matchAll(/\b[A-Z]{2}-[0-9]+\b/g)) {
      const id = match[0]
      if (known.has(id)) counts[id] = (counts[id] ?? 0) + 1
    }
  }
  return counts
}
