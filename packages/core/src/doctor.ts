import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { lintProject } from './lint.js'
import { FILE_LOCK_STALE_MS } from './filelock.js'
import { SUBAGENT_SCHEMA, claudeAgentsDir, subagentSchema } from './subagents.js'

export type DoctorLevel = 'ok' | 'warn' | 'error'

export interface DoctorCheck {
  name: string
  level: DoctorLevel
  message: string
  /** Command or action that fixes the problem. */
  fix?: string
}

export interface DoctorResult {
  checks: DoctorCheck[]
  /** False when at least one check is an error; warnings do not fail. */
  ok: boolean
}

export interface DoctorOptions {
  /** Server base URLs whose `/api/health` is checked (default http://127.0.0.1:4310). */
  urls?: string[]
  /** The running CLI's entry file; a `packages/cli/dist/index.js` inside a checkout enables the build and commit checks. */
  cliEntry?: string
  /** Current user id for the ownership check; null skips it (default: process.getuid()). */
  uid?: number | null
  /** Runs git and returns trimmed stdout, or null on failure. */
  git?: (args: string[], cwd: string) => Promise<string | null>
  /** GETs a URL and returns the parsed JSON body; throws when unreachable or not 2xx. */
  fetchJson?: (url: string) => Promise<unknown>
}

export const DEFAULT_DOCTOR_URL = 'http://127.0.0.1:4310'

const execFileAsync = promisify(execFile)

const defaultGit = async (args: string[], cwd: string): Promise<string | null> => {
  try {
    return (await execFileAsync('git', args, { cwd })).stdout.trim() || null
  } catch {
    return null
  }
}

const defaultFetchJson = async (url: string): Promise<unknown> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Every path under `dir` (recursive), or [] when it does not exist. */
const walk = (dir: string): string[] =>
  fs.existsSync(dir) ? (fs.readdirSync(dir, { recursive: true }) as string[]).map((p) => path.join(dir, p)) : []

function checkBoard(root: string): DoctorCheck {
  const { issues } = lintProject(root)
  const errors = issues.filter((i) => i.severity === 'error').length
  const warnings = issues.length - errors
  if (issues.length === 0) return { name: 'board', level: 'ok', message: 'lint is clean' }
  return {
    name: 'board',
    level: errors ? 'error' : 'warn',
    message: `${errors} error(s), ${warnings} warning(s)`,
    fix: issues.some((i) => i.code === 'NO_BOARD') ? 'agentboard init' : 'agentboard lint',
  }
}

function checkBoardFiles(boardDir: string, uid: number | null): DoctorCheck | null {
  if (!fs.existsSync(boardDir)) return null
  const now = Date.now()
  const paths = [boardDir, ...walk(boardDir)]
  const foreign: string[] = []
  const orphans: string[] = []
  for (const p of paths) {
    const stat = statOrNull(p, fs.lstatSync)
    if (!stat) continue // removed while we looked (a lock released mid-scan)
    if (uid != null && stat.uid !== uid) foreign.push(p)
    // Lock sidecars and atomic-write temp files live for milliseconds; old ones were left by a crash.
    if (/\.(lock|tmp)$/.test(p) && now - stat.mtimeMs > FILE_LOCK_STALE_MS) orphans.push(p)
  }
  const rel = (list: string[]): string => list.map((p) => path.relative(path.dirname(boardDir), p) || p).join(', ')
  if (foreign.length) {
    return {
      name: 'board files',
      level: 'error',
      message: `${foreign.length} path(s) owned by another user (e.g. written by a container as root): ${rel(foreign.slice(0, 3))}${foreign.length > 3 ? ', …' : ''}`,
      fix: `sudo chown -R ${uid} '${boardDir.replace(/'/g, `'\\''`)}'`,
    }
  }
  if (orphans.length) {
    return {
      name: 'board files',
      level: 'warn',
      message: `orphaned lock/temp file(s): ${rel(orphans)}`,
      fix: 'delete them once no AgentSprint process is writing',
    }
  }
  return { name: 'board files', level: 'ok', message: 'no orphaned locks, every file is yours' }
}

/** The AgentSprint checkout the CLI runs from (`<root>/packages/cli/dist/index.js`), or null for an installed package. */
function checkoutRoot(cliEntry: string): string | null {
  const root = path.resolve(path.dirname(cliEntry), '..', '..', '..')
  return fs.existsSync(path.join(root, 'packages', 'cli', 'src')) ? root : null
}

/** stat that returns null for a path deleted between listing and stat (a rebuild wiping dist, a released lock). */
function statOrNull(p: string, stat: (p: string) => fs.Stats = fs.statSync): fs.Stats | null {
  try {
    return stat(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

const newest = (files: string[]): number => Math.max(0, ...files.map((f) => statOrNull(f)?.mtimeMs ?? 0))

function checkBuild(checkout: string | null): DoctorCheck {
  if (!checkout) return { name: 'build', level: 'ok', message: 'CLI runs from an installed package (not a checkout)' }
  const packagesDir = path.join(checkout, 'packages')
  const stale = fs.readdirSync(packagesDir).filter((pkg) => {
    const src = walk(path.join(packagesDir, pkg, 'src')).filter((f) => !/\.test\.tsx?$/.test(f) && statOrNull(f)?.isFile())
    if (src.length === 0) return false
    return newest(src) > newest(walk(path.join(packagesDir, pkg, 'dist')))
  })
  if (stale.length === 0) return { name: 'build', level: 'ok', message: `every dist in ${packagesDir} is up to date` }
  return { name: 'build', level: 'warn', message: `src newer than dist in: ${stale.join(', ')}`, fix: 'pnpm build' }
}

async function checkServer(
  base: string,
  head: string | null,
  fetchJson: NonNullable<DoctorOptions['fetchJson']>,
): Promise<DoctorCheck> {
  const name = `server ${base}`
  let health: { version?: unknown; commit?: unknown }
  try {
    health = ((await fetchJson(`${base}/api/health`)) ?? {}) as typeof health
  } catch (err) {
    return { name, level: 'warn', message: `not reachable (${(err as Error).message})` }
  }
  const version = typeof health.version === 'string' ? `v${health.version} ` : ''
  if (typeof health.commit !== 'string' || !health.commit) {
    return { name, level: 'warn', message: `${version}reports no commit — built before build stamping`, fix: 'pnpm docker:up' }
  }
  const dirty = health.commit.endsWith('-dirty')
  const hash = health.commit.replace(/-dirty$/, '')
  const built = `${version}built from ${hash}${dirty ? ' (modified tree)' : ''}`
  if (!head) return { name, level: 'ok', message: built }
  const same = hash.startsWith(head) || head.startsWith(hash)
  if (same && !dirty) return { name, level: 'ok', message: `${built}, matches HEAD` }
  return { name, level: 'warn', message: `${built}, HEAD is ${head}`, fix: 'pnpm docker:up' }
}

function checkMcp(root: string): DoctorCheck {
  const file = path.join(root, '.mcp.json')
  if (!fs.existsSync(file)) {
    return { name: 'mcp', level: 'warn', message: 'no .mcp.json in the project', fix: `agentboard connect ${root}` }
  }
  let config: unknown
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    return { name: 'mcp', level: 'error', message: `.mcp.json is not valid JSON (${(err as Error).message})` }
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    return { name: 'mcp', level: 'error', message: '.mcp.json must be an object with "mcpServers"', fix: `agentboard connect ${root}` }
  }
  const entry = (config as { mcpServers?: Record<string, { command?: unknown; args?: unknown; url?: unknown } | undefined> }).mcpServers?.agentsprint
  if (!entry) return { name: 'mcp', level: 'warn', message: 'no "agentsprint" server in .mcp.json', fix: `agentboard connect ${root}` }
  if (typeof entry.url === 'string') return { name: 'mcp', level: 'ok', message: `agentsprint → ${entry.url}` }
  const parts = [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])].filter((p): p is string => typeof p === 'string')
  // Executables and scripts given as paths must exist; bare names (npx, agentboard) are resolved by the shell.
  const missing = parts.filter((p) => (path.isAbsolute(p) || /\.[cm]?js$/.test(p)) && !fs.existsSync(path.resolve(root, p)))
  if (missing.length) {
    return { name: 'mcp', level: 'error', message: `agentsprint points at missing file(s): ${missing.join(', ')}`, fix: `pnpm build, or agentboard connect ${root}` }
  }
  return { name: 'mcp', level: 'ok', message: `agentsprint → ${parts.join(' ')}` }
}

function checkSubagents(root: string): DoctorCheck | null {
  const dir = claudeAgentsDir(root)
  if (!fs.existsSync(dir)) return null
  const newer = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && (subagentSchema(fs.readFileSync(path.join(dir, f), 'utf8')) ?? 0) > SUBAGENT_SCHEMA)
  if (newer.length === 0) return { name: 'subagents', level: 'ok', message: `no generated subagent is newer than schema ${SUBAGENT_SCHEMA}` }
  return {
    name: 'subagents',
    level: 'warn',
    message: `this AgentSprint (subagent schema ${SUBAGENT_SCHEMA}) is older than the one that generated your subagents — upgrade it: ${newer.join(', ')}`,
    fix: 'upgrade AgentSprint (pnpm build, pnpm docker:up, or a newer @jmrojas06/agentsprint-cli)',
  }
}

/**
 * Check the environment an AgentSprint board runs in: board integrity and
 * stray files, whether a source checkout's dist is behind its src, which
 * commit each server was built from versus HEAD, and the project's MCP entry.
 */
export async function runDoctor(dir: string, opts: DoctorOptions = {}): Promise<DoctorResult> {
  const root = path.resolve(dir)
  const git = opts.git ?? defaultGit
  const fetchJson = opts.fetchJson ?? defaultFetchJson
  const uid = opts.uid !== undefined ? opts.uid : (process.getuid?.() ?? null)
  const checkout = opts.cliEntry ? checkoutRoot(opts.cliEntry) : null
  const head = checkout ? await git(['rev-parse', '--short', 'HEAD'], checkout) : null
  const urls = (opts.urls ?? [DEFAULT_DOCTOR_URL]).map((u) => u.replace(/\/+$/, ''))

  const checks: DoctorCheck[] = [checkBoard(root)]
  const files = checkBoardFiles(path.join(root, '.agentboard'), uid)
  if (files) checks.push(files)
  checks.push(checkBuild(checkout))
  checks.push(...(await Promise.all(urls.map((u) => checkServer(u, head, fetchJson)))))
  checks.push(checkMcp(root))
  const subagents = checkSubagents(root)
  if (subagents) checks.push(subagents)
  return { checks, ok: checks.every((c) => c.level !== 'error') }
}
