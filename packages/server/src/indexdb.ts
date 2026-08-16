import type { Task } from '@agentsprint/core'
import { createRequire } from 'node:module'

// esbuild/tsup rewrites static `import 'node:sqlite'` to `import 'sqlite'`,
// which breaks at runtime; `require('node:sqlite')` is left untouched.
const requireBuiltin = createRequire(import.meta.url)

export interface SearchOptions {
  status?: string
  sprint?: string
  assignee?: string
}

export interface TaskIndex {
  rebuild(tasks: Task[]): void
  upsert(task: Task): void
  remove(id: string): void
  search(q?: string, opts?: SearchOptions): Task[]
}

function matches(task: Task, q: string, opts: SearchOptions): boolean {
  if (opts.status && task.status !== opts.status) return false
  if (opts.assignee && task.assignee !== opts.assignee) return false
  if (opts.sprint) {
    const n = Number(opts.sprint)
    if (task.sprint !== n) return false
  }
  if (q) {
    const needle = q.toLowerCase()
    const hay = `${task.id} ${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase()
    return hay.includes(needle)
  }
  return true
}

function memoryIndex(): TaskIndex {
  let tasks: Task[] = []
  return {
    rebuild(list: Task[]) {
      tasks = list
    },
    upsert(task: Task) {
      tasks = tasks.filter((t) => t.id !== task.id).concat(task)
    },
    remove(id: string) {
      tasks = tasks.filter((t) => t.id !== id)
    },
    search(q = '', opts = {}) {
      return tasks.filter((t) => matches(t, q, opts))
    },
  }
}

/**
 * SQLite-backed index built on Node's built-in `node:sqlite` module
 * (zero native dependencies). Falls back to in-memory if unavailable.
 */
function sqliteIndex(dbPath: string, DatabaseSync: typeof import('node:sqlite')['DatabaseSync']): TaskIndex {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      sprint INTEGER,
      assignee TEXT,
      tags TEXT,
      json TEXT NOT NULL
    );
  `)

  const upsert = (task: Task) => {
    db.prepare(
      `INSERT INTO tasks (id, title, status, sprint, assignee, tags, json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, status = excluded.status, sprint = excluded.sprint,
         assignee = excluded.assignee, tags = excluded.tags, json = excluded.json`,
    ).run(task.id, task.title, task.status, task.sprint, task.assignee, JSON.stringify(task.tags), JSON.stringify(task))
  }

  const searchStmt = db.prepare(
    `SELECT json FROM tasks WHERE (?1 = '' OR title LIKE ?1 OR id LIKE ?1)
     AND (?2 IS NULL OR status = ?2)
     AND (?3 IS NULL OR sprint = ?3)
     AND (?4 IS NULL OR assignee = ?4)
     ORDER BY rowid DESC`,
  )

  return {
    rebuild(tasks: Task[]) {
      db.exec('DELETE FROM tasks')
      for (const t of tasks) upsert(t)
    },
    upsert,
    remove(id: string) {
      db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
    },
    search(q = '', opts = {}): Task[] {
      const rows = searchStmt.all(
        `%${q}%`,
        opts.status ?? null,
        opts.sprint != null ? Number(opts.sprint) : null,
        opts.assignee ?? null,
      ) as Array<{ json: string }>
      return rows.map((r) => JSON.parse(r.json) as Task)
    },
  }
}

/** Create the search index. Uses SQLite when available, in-memory otherwise. */
export async function createIndex(dbPath?: string): Promise<TaskIndex> {
  try {
    const { DatabaseSync } = requireBuiltin('node:sqlite') as typeof import('node:sqlite')
    return sqliteIndex(dbPath ?? ':memory:', DatabaseSync)
  } catch {
    return memoryIndex()
  }
}
