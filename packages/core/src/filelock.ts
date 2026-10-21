import fs from 'node:fs'
import os from 'node:os'

export const FILE_LOCK_TIMEOUT_MS = 2000
export const FILE_LOCK_RETRY_MS = 25
/** A lock older than this is abandoned: real writes hold it for milliseconds. */
export const FILE_LOCK_STALE_MS = 10_000

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const pidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: the process exists but belongs to another user.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

const readOwner = (raw: string): { pid: number; host: unknown } | null => {
  try {
    const owner = JSON.parse(raw) as { pid?: unknown; host?: unknown }
    return typeof owner?.pid === 'number' ? { pid: owner.pid, host: owner.host } : null
  } catch {
    return null
  }
}

/**
 * A lock is stale when its owner (recorded as `{pid, host, at}`) is a dead
 * process on this host, or when it is far older than any write could take.
 * A lock with no owner yet (created a moment ago, or by an older version) is
 * only judged by age, against the write timeout, so a live lock is never taken.
 */
const isStale = (lockPath: string): boolean => {
  let raw: string
  let ageMs: number
  try {
    raw = fs.readFileSync(lockPath, 'utf8')
    // Absolute: a lock stamped far in the future (clock skew) is as suspect as an old one.
    ageMs = Math.abs(Date.now() - fs.statSync(lockPath).mtimeMs)
  } catch {
    return false // gone already: the caller simply retries the create
  }
  const owner = readOwner(raw)
  if (!owner) return ageMs > FILE_LOCK_TIMEOUT_MS
  if (owner.host === os.hostname() && !pidAlive(owner.pid)) return true
  return ageMs > FILE_LOCK_STALE_MS
}

/**
 * Remove `lockPath` if it is stale. Stealers serialize on a short-lived
 * `.steal.lock` and re-check staleness inside it, so two waiters that both saw
 * the same dead lock cannot end up deleting the lock the first one just took.
 */
const removeIfStale = (file: string, lockPath: string): void => {
  if (!isStale(lockPath)) return
  const stealPath = `${file}.steal.lock`
  let fd: number
  try {
    fd = fs.openSync(stealPath, 'wx')
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
    // Only held for a few syscalls; one this old was left by a killed stealer.
    try {
      if (Date.now() - fs.statSync(stealPath).mtimeMs > FILE_LOCK_STALE_MS) fs.unlinkSync(stealPath)
    } catch {
      /* gone already */
    }
    return
  }
  try {
    if (isStale(lockPath)) fs.unlinkSync(lockPath)
  } catch {
    /* gone already */
  } finally {
    fs.closeSync(fd)
    fs.rmSync(stealPath, { force: true })
  }
}

/**
 * Run `fn` while holding an exclusive advisory lock on `file`.
 *
 * The lock is a `${file}.lock` sidecar created atomically (`wx` flag), so it
 * works across processes on the same machine (CLI + server + MCP writing the
 * same board) and also serializes concurrent callers in-process. The owner's
 * pid, host and time are written into it, so a lock left by a crashed writer
 * (e.g. a SIGKILLed MCP server) is removed and the exclusive create retried.
 * Acquisition retries every `FILE_LOCK_RETRY_MS` until `timeoutMs` elapses,
 * then throws.
 *
 * All AgentSprint persistence APIs are synchronous, so waiting is done with a
 * busy wait (`Atomics.wait`) that blocks the thread without spinning the CPU.
 * The lock is always released in `finally`, including when `fn` throws.
 */
export function withFileLock<T>(
  file: string,
  fn: () => T,
  opts: { timeoutMs?: number } = {},
): T {
  const lockPath = `${file}.lock`
  const timeoutMs = opts.timeoutMs ?? FILE_LOCK_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  let fd: number
  for (;;) {
    try {
      fd = fs.openSync(lockPath, 'wx')
      break
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
      removeIfStale(file, lockPath)
      if (!fs.existsSync(lockPath)) continue
      if (Date.now() >= deadline) {
        throw new Error(`Timed out (${timeoutMs}ms) acquiring write lock ${lockPath}`)
      }
      sleep(FILE_LOCK_RETRY_MS)
    }
  }
  try {
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString() }))
  } catch {
    /* the lock still holds; it is just judged by age if we crash */
  }
  try {
    return fn()
  } finally {
    // A holder suspended past FILE_LOCK_STALE_MS may have lost the lock to a
    // waiter; only remove the sidecar if it is still the file we created.
    try {
      if (fs.statSync(lockPath).ino === fs.fstatSync(fd).ino) fs.unlinkSync(lockPath)
    } catch {
      /* already gone */
    }
    try {
      fs.closeSync(fd)
    } catch {
      /* ignore */
    }
  }
}
