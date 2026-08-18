import fs from 'node:fs'
import path from 'node:path'
import { ProjectStore } from '@agentsprint/core'
import { Broadcast } from './broadcast.js'
import { createIndex, type TaskIndex } from './indexdb.js'
import { createWatcher } from './watcher.js'
import type { FSWatcher } from 'chokidar'

export interface ProjectInfo {
  /** Stable unique id (the directory basename). */
  name: string
  rootDir: string
  /** Display name from config.yaml (falls back to the directory basename). */
  configName: string
}

export interface ProjectHandle {
  info: ProjectInfo
  store: ProjectStore
  index: TaskIndex
  broadcast: Broadcast
  watcher: FSWatcher
  close: () => Promise<void>
}

function readConfigName(rootDir: string, fallback: string): string {
  try {
    const store = ProjectStore.open(rootDir)
    return store.getConfig().name || fallback
  } catch {
    return fallback
  }
}

/**
 * Discovers AgentSprint projects: every directory that contains a `.agentboard/`
 * folder. If `baseDir` itself has one, it is the only project (backwards
 * compatible with the old single-board `serve <dir>`).
 */
export class ProjectManager {
  private readonly handles = new Map<string, ProjectHandle>()
  private readonly names: string[]

  private constructor(handles: ProjectHandle[]) {
    this.names = handles.map((h) => h.info.name)
    for (const h of handles) this.handles.set(h.info.name, h)
  }

  static async discover(baseDir: string, opts?: { autoInit?: boolean }): Promise<ProjectManager> {
    const resolved = path.resolve(baseDir)
    const dirs: string[] = []
    if (fs.existsSync(path.join(resolved, '.agentboard'))) {
      dirs.push(resolved)
    } else {
      for (const entry of fs.readdirSync(resolved, { withFileTypes: true })) {
        if (entry.isDirectory() && fs.existsSync(path.join(resolved, entry.name, '.agentboard'))) {
          dirs.push(path.join(resolved, entry.name))
        }
      }
    }
    if (dirs.length === 0 && opts?.autoInit) {
      ProjectStore.init(resolved, { sample: true })
      dirs.push(resolved)
    }
    if (dirs.length === 0) {
      throw new Error(`No AgentSprint boards found under ${resolved}`)
    }

    const handles: ProjectHandle[] = []
    for (const dir of dirs.sort()) {
      const name = path.basename(dir)
      const store = ProjectStore.open(dir)
      const index = await createIndex()
      index.rebuild(store.state.tasks)
      const broadcast = new Broadcast()
      const watcher = createWatcher(store, () => {
        index.rebuild(store.state.tasks)
        broadcast.send('change', { project: name, at: new Date().toISOString() })
      })
      handles.push({
        info: { name, rootDir: dir, configName: readConfigName(dir, name) },
        store,
        index,
        broadcast,
        watcher,
        close: async () => {
          await watcher.close()
        },
      })
    }
    return new ProjectManager(handles)
  }

  list(): ProjectInfo[] {
    return this.names.map((n) => this.handles.get(n)!.info)
  }

  defaultName(): string {
    return this.names[0]!
  }

  get(name?: string): ProjectHandle {
    if (name && this.handles.has(name)) return this.handles.get(name)!
    return this.handles.get(this.names[0]!)!
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.handles.values()].map((h) => h.close()))
  }
}
