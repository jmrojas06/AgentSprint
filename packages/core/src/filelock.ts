import fs from 'node:fs'

export const FILE_LOCK_TIMEOUT_MS = 2000
export const FILE_LOCK_RETRY_MS = 25

/**
 * Run `fn` while holding an exclusive advisory lock on `file`.
 *
 * The lock is a `${file}.lock` sidecar created atomically (`wx` flag), so it
 * works across processes on the same machine (CLI + server + MCP writing the
 * same board) and also serializes concurrent callers in-process. Acquisition
 * retries every `FILE_LOCK_RETRY_MS` until `timeoutMs` elapses, then throws.
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
      if (Date.now() >= deadline) {
        throw new Error(`Timed out (${timeoutMs}ms) acquiring write lock ${lockPath}`)
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, FILE_LOCK_RETRY_MS)
    }
  }
  try {
    return fn()
  } finally {
    try {
      fs.closeSync(fd)
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(lockPath)
    } catch {
      /* already gone */
    }
  }
}
