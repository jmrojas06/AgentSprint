import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitBranch, Plus, Search } from 'lucide-react'
import type { ProjectState, Task } from './types'
import { api } from './api'
import { useProjectEvents } from './hooks/useProjectEvents'
import { Board } from './components/Board'
import { SprintPanel } from './components/SprintPanel'
import { TaskModal } from './components/TaskModal'
import { NewTaskModal } from './components/NewTaskModal'
import { cx } from './ui'

type SprintFilter = 'all' | number

export default function App() {
  const [project, setProject] = useState<ProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>('all')
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    try {
      setProject(await api.project())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  useProjectEvents(reload)

  const tasks = useMemo(() => {
    if (!project) return []
    const q = query.trim().toLowerCase()
    return project.tasks.filter((t) => {
      if (sprintFilter !== 'all' && t.sprint !== sprintFilter) return false
      if (!q) return true
      return `${t.id} ${t.title} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(q)
    })
  }, [project, query, sprintFilter])

  const tasksBySprint = useMemo(() => {
    const map = new Map<number, number>()
    for (const t of project?.tasks ?? []) {
      if (t.sprint != null) map.set(t.sprint, (map.get(t.sprint) ?? 0) + 1)
    }
    return map
  }, [project])

  const doneBySprint = useMemo(() => {
    const map = new Map<number, number>()
    for (const t of project?.tasks ?? []) {
      if (t.sprint != null && t.status === 'Done') map.set(t.sprint, (map.get(t.sprint) ?? 0) + 1)
    }
    return map
  }, [project])

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          <p className="font-semibold">Could not load the board</p>
          <p className="mt-1">{error}</p>
          <p className="mt-2 text-xs text-red-400/70">
            Make sure a server is running: <code className="rounded bg-black/40 px-1">agentboard serve</code>
          </p>
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        <span className="animate-pulse">Loading board…</span>
      </div>
    )
  }

  const statuses = project.config.workflow.statuses

  const moveTask = async (task: Task, next: string) => {
    try {
      await api.setTaskStatus(task.id, next as Task['status'])
      await reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const saveTask = async (id: string, patch: Partial<Task>) => {
    await api.updateTask(id, patch)
    setEditing(null)
    await reload()
  }

  const deleteTask = async (id: string) => {
    await api.deleteTask(id)
    setEditing(null)
    await reload()
  }

  const createTask = async (input: Parameters<typeof api.createTask>[0]) => {
    await api.createTask(input)
    setCreating(false)
    await reload()
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950/80 px-4 py-3">
        <div className="flex items-center gap-3">
          <GitBranch className="h-5 w-5 text-indigo-400" />
          <h1 className="text-sm font-bold text-zinc-100">AgentSprint</h1>
          <span className="hidden max-w-[24rem] truncate rounded bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-400 sm:block">
            {project.rootDir}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tasks…"
                className="w-44 rounded-md border border-zinc-700 bg-zinc-900 py-1.5 pl-7 pr-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-indigo-500 sm:w-56"
              />
            </div>

            <select
              value={sprintFilter === 'all' ? '' : sprintFilter}
              onChange={(e) => setSprintFilter(e.target.value === '' ? 'all' : Number(e.target.value))}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-indigo-500"
            >
              <option value="">All sprints</option>
              {project.sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  Sprint {s.id}
                </option>
              ))}
            </select>

            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" /> New task
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className={cx('h-1.5 w-1.5 rounded-full', project.activeSprint ? 'bg-emerald-500' : 'bg-zinc-600')} />
          {project.activeSprint ? (
            <span>
              Active sprint <span className="font-mono text-zinc-300">S{project.activeSprint.id}</span> —{' '}
              {project.activeSprint.goal || 'no goal'}
            </span>
          ) : (
            <span>No active sprint — activate one to start planning</span>
          )}
          <span className="ml-auto font-mono">{project.tasks.length} tasks</span>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1fr_280px]">
        <div className="overflow-x-auto">
          <Board statuses={statuses} tasks={tasks} onOpen={setEditing} onMove={moveTask} />
        </div>
        <div className="hidden overflow-y-auto lg:block">
          <SprintPanel
            sprints={project.sprints}
            activeSprintId={project.activeSprint?.id ?? null}
            tasksBySprint={tasksBySprint}
            doneBySprint={doneBySprint}
            onActivate={async (id) => {
              await api.updateSprint(id, { status: 'active' })
              await reload()
            }}
            onClose={async (id) => {
              await api.updateSprint(id, { status: 'closed' })
              await reload()
            }}
            onCreate={async (goal) => {
              await api.createSprint(goal)
              await reload()
            }}
          />
        </div>
      </div>

      {editing && (
        <TaskModal
          task={editing}
          sprints={project.sprints}
          statuses={statuses}
          onSave={saveTask}
          onDelete={deleteTask}
          onClose={() => setEditing(null)}
        />
      )}

      {creating && (
        <NewTaskModal sprints={project.sprints} onCreate={createTask} onClose={() => setCreating(false)} />
      )}
    </div>
  )
}
