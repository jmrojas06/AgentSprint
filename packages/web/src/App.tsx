import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bell, BellOff, GitBranch, LayoutGrid, List, Palette, Plus, Search, Square, X } from 'lucide-react'
import type { BoardState, Task, TaskPriority } from './types'
import { TASK_PRIORITIES } from './types'
import { api, setProject } from './api'
import { useProjectEvents } from './hooks/useProjectEvents'
import { useReviewNotifications } from './hooks/useReviewNotifications'
import { Board } from './components/Board'
import { ListView } from './components/ListView'
import { SprintPanel } from './components/SprintPanel'
import { TaskModal } from './components/TaskModal'
import { NewTaskModal } from './components/NewTaskModal'
import { BrandPanel } from './components/BrandPanel'
import { CommandPalette } from './components/CommandPalette'
import { ThemeToggle } from './components/ThemeToggle'
import { cx, computeVelocity, getBlockerTasks, viewFromQuery, type SortBy, type SortDir, type ViewMode } from './ui'

type SprintFilter = 'all' | number
type SideTab = 'sprints' | 'brand'

const VIEW_STORAGE_KEY = 'agentsprint.view'

function initialView(): ViewMode {
  const fromUrl = typeof window !== 'undefined' ? viewFromQuery(window.location.search) : null
  if (fromUrl) return fromUrl
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (saved === 'list' || saved === 'kanban') return saved
  } catch {
    /* storage unavailable */
  }
  return 'kanban'
}

export default function App() {
  const [project, setProjectState] = useState<BoardState | null>(null)
  const [projects, setProjects] = useState<Array<{ name: string; rootDir: string; configName: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('')
  const [assigneeFilter, setAssigneeFilter] = useState<'scrum-master' | 'dev' | 'review' | 'perfect' | ''>('')
  const [tagFilter, setTagFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('estimate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [view, setViewState] = useState<ViewMode>(initialView)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sideTab, setSideTab] = useState<SideTab>('sprints')
  const [warningsDismissed, setWarningsDismissed] = useState(false)
  const [commitCounts, setCommitCounts] = useState<Record<string, number>>({})
  const {
    supported: notificationsSupported,
    enabled: notificationsEnabled,
    request: requestNotifications,
    disable: disableNotifications,
    notifyReview,
  } = useReviewNotifications()

  // Track the previous status of every task to detect Review transitions.
  const prevStatuses = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!project) return
    const prev = prevStatuses.current
    prevStatuses.current = new Map(project.tasks.map((t) => [t.id, t.status]))
    if (!prev || !notificationsEnabled) return
    for (const task of project.tasks) {
      const before = prev.get(task.id)
      if (task.status === 'Review' && before && before !== 'Review') {
        notifyReview(task, (t) => setEditing(project.tasks.find((x) => x.id === t.id) ?? t))
      }
    }
  }, [project, notificationsEnabled, notifyReview])

  const reload = useCallback(async () => {
    try {
      const [state] = await Promise.all([api.project(), api.gitCommitCounts().then(setCommitCounts).catch(() => {})])
      setProjectState(state)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.projects()
        setProjects(list)
        if (list.length > 0) setProject(list[0]!.name)
      } catch {
        /* single-project server or offline; api.project() reports the error */
      }
      await reload()
    })()
  }, [reload])

  useEffect(() => {
    setWarningsDismissed(false)
  }, [project?.rootDir])

  useProjectEvents(reload)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const clearFilters = useCallback(() => {
    setPriorityFilter('')
    setAssigneeFilter('')
    setTagFilter('')
    setQuery('')
    setSprintFilter('all')
  }, [])

  const setView = useCallback((next: ViewMode) => {
    setViewState(next)
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next)
    } catch {
      /* storage unavailable */
    }
    const url = new URL(window.location.href)
    if (next === 'list') url.searchParams.set('view', 'list')
    else url.searchParams.delete('view')
    window.history.replaceState(null, '', url)
  }, [])

  const switchProject = useCallback(
    async (name: string) => {
      setProject(name)
      await reload()
    },
    [reload],
  )

  const tasks = useMemo(() => {
    if (!project) return []
    const q = query.trim().toLowerCase()
    return project.tasks.filter((t) => {
      if (sprintFilter !== 'all' && t.sprint !== sprintFilter) return false
      if (priorityFilter && t.priority !== priorityFilter) return false
      if (assigneeFilter && t.assignee !== assigneeFilter) return false
      if (tagFilter && !t.tags.some((tag) => tag.toLowerCase().includes(tagFilter.toLowerCase()))) return false
      if (!q) return true
      return `${t.id} ${t.title} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(q)
    })
  }, [project, query, sprintFilter, priorityFilter, assigneeFilter, tagFilter])

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

  const velocity = useMemo(
    () => (project ? computeVelocity(project.sprints, project.tasks) : null),
    [project],
  )

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
      if (next === 'In Progress' && task.dependencies.length > 0) {
        const blockers = getBlockerTasks(task, project.tasks)
        if (blockers.length > 0) {
          const depIds = blockers.map((b) => b.id).join(', ')
          if (!confirm(`"${task.title}" is blocked by ${depIds}. Move to In Progress anyway?`)) {
            return
          }
        }
      }
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

           {projects.length > 1 && (
            <select
              value={projects.find((p) => project.rootDir === p.rootDir)?.name ?? ''}
              onChange={(e) => switchProject(e.target.value)}
              className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 outline-none focus:border-indigo-500"
              title="Switch project"
            >
              {projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.configName || p.name}
                </option>
              ))}
            </select>
          )}

          <div className="ml-2 flex flex-wrap items-center gap-1.5">
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              title="Filter by priority"
            >
              <option value="">All priorities</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value as 'scrum-master' | 'dev' | 'review' | 'perfect' | '')}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              title="Filter by assignee"
            >
              <option value="">All assignees</option>
              <option value="scrum-master">Scrum Master</option>
              <option value="dev">Development</option>
              <option value="review">Review</option>
              <option value="perfect">Perfect Review</option>
            </select>

            <input
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Tag…"
              className="w-20 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-indigo-500"
              title="Filter by tag"
            />

            {(priorityFilter || assigneeFilter || tagFilter || query || sprintFilter !== 'all') && (
              <button
                onClick={clearFilters}
                className="rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-300 hover:border-zinc-600 hover:text-zinc-100"
                title="Clear all filters"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tasks…  ⌘K"
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

            <div
              className="flex overflow-hidden rounded-md border border-zinc-700 bg-zinc-900"
              role="group"
              aria-label="Board view"
              data-testid="view-toggle"
            >
              <button
                onClick={() => setView('kanban')}
                aria-pressed={view === 'kanban'}
                title="Kanban view"
                className={cx(
                  'px-2 py-1.5 text-zinc-400 hover:text-zinc-200',
                  view === 'kanban' && 'bg-zinc-800 text-indigo-400',
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
                title="List view"
                className={cx(
                  'border-l border-zinc-700 px-2 py-1.5 text-zinc-400 hover:text-zinc-200',
                  view === 'list' && 'bg-zinc-800 text-indigo-400',
                )}
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
            >
              <Plus className="h-3.5 w-3.5" /> New task
            </button>

            {notificationsSupported && (
              <button
                onClick={() => (notificationsEnabled ? disableNotifications() : void requestNotifications())}
                aria-pressed={notificationsEnabled}
                title={notificationsEnabled ? 'Notifications on — click to disable' : 'Enable review notifications'}
                data-testid="notify-toggle"
                className={cx(
                  'rounded-md border border-zinc-700 p-1.5 hover:text-zinc-100',
                  notificationsEnabled ? 'text-indigo-400' : 'text-zinc-400',
                )}
              >
                {notificationsEnabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              </button>
            )}

            <ThemeToggle />
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
          <span className="ml-auto font-mono">
            {tasks.length}/{project.tasks.length} tasks visible
            {(priorityFilter || assigneeFilter || tagFilter || query || sprintFilter !== 'all') && ' (filtered)'}
          </span>
        </div>

        {project.warnings && project.warnings.length > 0 && !warningsDismissed && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-600/50 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {project.warnings.length} file{project.warnings.length === 1 ? '' : 's'} not parseable
              </p>
              <ul className="mt-1 space-y-0.5 break-words">
                {project.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p className="mt-1 text-amber-400/80">Fix the YAML frontmatter — e.g. quote titles containing &quot;: &quot;.</p>
            </div>
            <button
              onClick={() => setWarningsDismissed(true)}
              className="shrink-0 rounded p-0.5 text-amber-400/70 hover:text-amber-200"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </header>

      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[1fr_280px]">
        <div className="overflow-x-auto">
          {view === 'kanban' ? (
            <Board
              statuses={statuses}
              tasks={tasks}
              allTasks={project.tasks}
              commitCounts={commitCounts}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortBy={setSortBy}
              onSortDir={setSortDir}
              onOpen={setEditing}
              onMove={moveTask}
            />
          ) : (
            <ListView
              tasks={tasks}
              sortBy={sortBy}
              sortDir={sortDir}
              onSortBy={setSortBy}
              onSortDir={setSortDir}
              onOpen={setEditing}
            />
          )}
        </div>
        <div className="hidden overflow-y-auto lg:block">
          <div className="mb-2 flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/60 p-1">
            <button
              onClick={() => setSideTab('sprints')}
              className={cx(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                sideTab === 'sprints' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Square className="h-3 w-3" /> Sprints
            </button>
            <button
              onClick={() => setSideTab('brand')}
              className={cx(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                sideTab === 'brand' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Palette className="h-3 w-3" /> Brand
            </button>
          </div>
          {sideTab === 'sprints' ? (
            <SprintPanel
              sprints={project.sprints}
              activeSprintId={project.activeSprint?.id ?? null}
              tasksBySprint={tasksBySprint}
              doneBySprint={doneBySprint}
              velocity={velocity}
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
          ) : (
            <BrandPanel
              brand={project.brand}
              onSave={async (patch) => {
                await api.updateBrand(patch)
                await reload()
              }}
            />
          )}
        </div>
      </div>

      {editing && (
        <TaskModal
          task={editing}
          allTasks={project.tasks}
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

      <CommandPalette
        open={paletteOpen}
        tasks={project.tasks}
        sprints={project.sprints}
        activeSprintId={project.activeSprint?.id ?? null}
        onClose={() => setPaletteOpen(false)}
        onCreateTask={() => setCreating(true)}
        onOpenTask={(task) => {
          const fresh = project.tasks.find((t) => t.id === task.id) ?? task
          setEditing(fresh)
        }}
        onActivateSprint={async (id) => {
          await api.updateSprint(id, { status: 'active' })
          await reload()
        }}
        onClearFilters={clearFilters}
      />
    </div>
  )
}
