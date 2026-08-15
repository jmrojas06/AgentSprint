import type { ProjectStore } from '@agentsprint/core'
import chokidar, { type FSWatcher } from 'chokidar'

/**
 * Watch `.agentboard/` for external edits (human or agent editing files
 * directly, git operations, etc.) and re-sync the in-memory store.
 */
export function createWatcher(store: ProjectStore, onChange: () => void): FSWatcher {
  const watcher = chokidar.watch(store.boardDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 30 },
  })

  let timer: NodeJS.Timeout | null = null
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      store.syncFromDisk()
      onChange()
    }, 150)
  }

  watcher.on('add', schedule)
  watcher.on('change', schedule)
  watcher.on('unlink', schedule)
  watcher.on('error', (err: unknown) => {
    console.error(`[agentboard] watcher error: ${err instanceof Error ? err.message : String(err)}`)
  })

  return watcher
}
