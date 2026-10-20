import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Bell, BellOff, Bot, Compass, LayoutGrid, List, Palette, PanelRightClose, PanelRightOpen, Play, Plus, Search, Square, X } from 'lucide-react'
import type { BoardState, Task, TaskPriority } from './types'
import { TASK_PRIORITIES } from './types'
import { api, clearStoredToken, getStoredToken, setProject, setStoredToken } from './api'
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
import { AgentsPanel } from './components/AgentsPanel'
import { DispatchModal } from './components/DispatchModal'
import { Overview } from './components/Overview'
import { AgentsContext, AssigneeOptions } from './agents'
import { cx, computeVelocity, getBlockerTasks, isViewMode, type SortBy, type SortDir, type ViewMode } from './ui'

type SprintFilter = 'all' | number
type SideTab = 'sprints' | 'agents' | 'brand'

const VIEW_STORAGE_KEY = 'agentsprint.view'
const PANEL_STORAGE_KEY = 'agentsprint.panel'

function initialPanel(): boolean {
  try {
    return localStorage.getItem(PANEL_STORAGE_KEY) !== 'closed'
  } catch {
    return true
  }
}

const VIEWS: Array<{ id: ViewMode; label: string; icon: typeof Compass; hint: string }> = [
  { id: 'overview', label: 'Overview', icon: Compass, hint: 'Where the project is and what comes next' },
  { id: 'kanban', label: 'Board', icon: LayoutGrid, hint: 'Kanban board' },
  { id: 'list', label: 'List', icon: List, hint: 'Sortable list' },
]

/** URL first (`?view=`), then the last view used, then the overview. */
function initialView(): ViewMode {
  const fromUrl = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('view') : null
  if (isViewMode(fromUrl)) return fromUrl
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY)
    if (isViewMode(saved)) return saved
  } catch {
    /* storage unavailable */
  }
  return 'overview'
}

export default function App() {
  const [project, setProjectState] = useState<BoardState | null>(null)
  const [projects, setProjects] = useState<Array<{ name: string; rootDir: string; configName: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('estimate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [view, setViewState] = useState<ViewMode>(initialView)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sideTab, setSideTab] = useState<SideTab>('sprints')
  const [panelOpen, setPanelOpen] = useState(initialPanel)
  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      try {
        localStorage.setItem(PANEL_STORAGE_KEY, open ? 'closed' : 'open')
      } catch {
        /* storage unavailable */
      }
      return !open
    })
  }, [])
  const [warningsDismissed, setWarningsDismissed] = useState(false)
  const [commitCounts, setCommitCounts] = useState<Record<string, number>>({})
  const [needsAuth, setNeedsAuth] = useState(false)
  const [tokenDraft, setTokenDraft] = useState(() => getStoredToken() ?? '')
  const [hasStoredToken, setHasStoredToken] = useState(() => Boolean(getStoredToken()))
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
      setNeedsAuth(false)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.includes('Unauthorized') || msg.includes('401')) {
        setNeedsAuth(true)
      }
      setError(msg)
    }
  }, [])

  const saveToken = useCallback(async () => {
    const t = tokenDraft.trim()
    if (!t) return
    setStoredToken(t)
    setHasStoredToken(true)
    setNeedsAuth(false)
    await reload()
  }, [tokenDraft, reload])

  const clearToken = useCallback(async () => {
    clearStoredToken()
    setHasStoredToken(false)
    setTokenDraft('')
    setNeedsAuth(false)
    await reload()
  }, [reload])

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
    if (next === 'overview') url.searchParams.delete('view')
    else url.searchParams.set('view', next)
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
    const isAuthError = error.includes('Unauthorized') || error.includes('401')
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-900/60 bg-red-950/30 p-4 text-sm text-red-300">
          <p className="font-semibold">Could not load the board</p>
          <p className="mt-1">{error}</p>
          {isAuthError && (
            <div className="mt-3 rounded border border-zinc-700 bg-zinc-900 p-3 text-xs text-zinc-200">
              <p className="font-medium text-zinc-100">Token required</p>
              <p className="mt-1 text-zinc-400">This board is protected. Enter the bearer token to continue.</p>
              <div className="mt-2 flex gap-2">
                <input
                  type="password"
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void saveToken()}
                  placeholder="Bearer token"
                  className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                  data-testid="token-input"
                />
                <button
                  onClick={() => void saveToken()}
                  className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                  data-testid="token-save"
                >
                  Save
                </button>
              </div>
              {hasStoredToken && (
                <button
                  onClick={() => void clearToken()}
                  className="mt-2 text-[11px] text-zinc-400 underline hover:text-zinc-200"
                  data-testid="token-clear"
                >
                  Clear saved token
                </button>
              )}
              <p className="mt-2 text-[11px] text-zinc-500">
                Saved in localStorage key <code className="rounded bg-black/40 px-1">agentsprint-token</code>. Server: <code className="rounded bg-black/40 px-1">--token &lt;secret&gt;</code> or <code className="rounded bg-black/40 px-1">AGENTBOARD_TOKEN</code>.
              </p>
            </div>
          )}
          <p className="mt-2 text-xs text-red-400/70">
            Make sure a server is running: <code className="rounded bg-zinc-800 px-1">agentboard serve</code>
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
    <AgentsContext.Provider value={project.agents ?? []}>
    <div className="flex h-full flex-col">
      <header className="border-b border-zinc-800 bg-zinc-950 px-4">
        <div className="flex h-14 items-center gap-3">
          <img src="/logo.svg" alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
          <div className="flex min-w-0 items-baseline gap-2">
            <h1 className="truncate text-sm font-semibold tracking-tight text-zinc-50" title={project.rootDir}>
              {project.config.name || 'AgentSprint'}
            </h1>
            {projects.length > 1 ? (
              <select
                value={projects.find((p) => project.rootDir === p.rootDir)?.name ?? ''}
                onChange={(e) => switchProject(e.target.value)}
                className="max-w-[10rem] truncate rounded-md border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-xs text-zinc-300 outline-none focus:border-indigo-500"
                title="Switch project"
                aria-label="Switch project"
              >
                {projects.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.configName || p.name}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          <nav className="ml-2 flex items-center gap-0.5 rounded-lg bg-zinc-900 p-0.5" role="group" aria-label="Board view" data-testid="view-toggle">
            {VIEWS.map((v) => {
              const Icon = v.icon
              const active = view === v.id
              return (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  aria-pressed={active}
                  title={v.hint}
                  className={cx(
                    'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors',
                    active ? 'bg-zinc-800 text-zinc-50 shadow-sm shadow-black/20' : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Icon className={cx('h-3.5 w-3.5', active && 'text-indigo-400')} />
                  <span className="hidden sm:inline">{v.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setPaletteOpen(true)}
              className="hidden items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 py-1.5 pl-2 pr-1.5 text-xs text-zinc-500 hover:border-zinc-700 hover:text-zinc-300 md:flex"
              title="Command palette"
            >
              <Search className="h-3.5 w-3.5" /> Jump to
              <kbd className="rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-400">⌘K</kbd>
            </button>
            <button
              onClick={() => setDispatching(true)}
              title="Plan which subagent builds which task, wave by wave"
              data-testid="run-sprint"
              aria-label="Run sprint"
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 hover:border-zinc-700 hover:text-zinc-50 active:translate-y-px"
            >
              <Play className="h-3.5 w-3.5 text-indigo-400" />
              <span className="hidden lg:inline">Run sprint</span>
            </button>
            <button
              onClick={() => setCreating(true)}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 active:translate-y-px"
            >
              <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">New task</span>
            </button>
            {notificationsSupported && (
              <button
                onClick={() => (notificationsEnabled ? disableNotifications() : void requestNotifications())}
                aria-pressed={notificationsEnabled}
                aria-label={notificationsEnabled ? 'Disable review notifications' : 'Enable review notifications'}
                title={notificationsEnabled ? 'Notifications on. Click to disable' : 'Enable review notifications'}
                data-testid="notify-toggle"
                className={cx(
                  'rounded-md p-1.5 hover:bg-zinc-900 hover:text-zinc-100',
                  notificationsEnabled ? 'text-indigo-400' : 'text-zinc-500',
                )}
              >
                {notificationsEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              </button>
            )}
            {hasStoredToken && (
              <button
                onClick={() => void clearToken()}
                title="Clear saved bearer token (agentsprint-token)"
                data-testid="header-token-clear"
                className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"
              >
                Clear token
              </button>
            )}
            <button
              onClick={togglePanel}
              aria-pressed={panelOpen}
              aria-label={panelOpen ? 'Hide side panel' : 'Show side panel'}
              title={panelOpen ? 'Hide sprints, agents and brand' : 'Show sprints, agents and brand'}
              className="hidden rounded-md p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100 lg:block"
            >
              {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </button>
            <ThemeToggle />
          </div>
        </div>

        {view !== 'overview' && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-800/70 py-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter tasks…"
                aria-label="Filter tasks by text"
                name="task-filter"
                autoComplete="off"
                className="w-40 rounded-md border border-zinc-800 bg-zinc-900 py-1 pl-7 pr-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-indigo-500 sm:w-52"
              />
            </div>
            <select
              value={sprintFilter === 'all' ? '' : sprintFilter}
              onChange={(e) => setSprintFilter(e.target.value === '' ? 'all' : Number(e.target.value))}
              aria-label="Filter by sprint"
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
            >
              <option value="">All sprints</option>
              {project.sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  Sprint {s.id}
                  {s.status === 'active' ? ' (active)' : ''}
                </option>
              ))}
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as TaskPriority | '')}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              title="Filter by priority"
              aria-label="Filter by priority"
            >
              <option value="">Any priority</option>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={assigneeFilter}
              onChange={(e) => setAssigneeFilter(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none focus:border-indigo-500"
              title="Filter by assignee"
              aria-label="Filter by assignee"
            >
              <option value="">Anyone</option>
              <AssigneeOptions agents={project.agents ?? []} current={assigneeFilter || undefined} />
            </select>
            <input
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Tag…"
              name="tag-filter"
              autoComplete="off"
              className="w-20 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 outline-none placeholder:text-zinc-500 focus:border-indigo-500"
              title="Filter by tag"
              aria-label="Filter by tag"
            />
            {(priorityFilter || assigneeFilter || tagFilter || query || sprintFilter !== 'all') && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
                title="Clear all filters"
              >
                <X className="h-3 w-3" /> Clear
              </button>
            )}
            <span className="tabular ml-auto text-[11px] text-zinc-500">
              {tasks.length === project.tasks.length ? `${tasks.length} tasks` : `${tasks.length} of ${project.tasks.length} tasks`}
            </span>
          </div>
        )}

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

        {needsAuth && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-indigo-600/50 bg-indigo-950/30 px-3 py-2 text-xs text-indigo-200">
            <span className="font-medium">Token required</span>
            <input
              type="password"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void saveToken()}
              placeholder="Bearer token"
              className="min-w-[180px] flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
              data-testid="banner-token-input"
            />
            <button
              onClick={() => void saveToken()}
              className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500"
              data-testid="banner-token-save"
            >
              Save token
            </button>
            {hasStoredToken && (
              <button
                onClick={() => void clearToken()}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                data-testid="banner-token-clear"
              >
                Clear saved token
              </button>
            )}
            <span className="text-[11px] text-zinc-400">Saved as <code className="rounded bg-black/40 px-1">agentsprint-token</code></span>
          </div>
        )}
        {((project.warnings && project.warnings.length > 0 && !warningsDismissed) || needsAuth) && <div className="h-2" />}
      </header>

      <div className={cx('grid flex-1 grid-cols-1 gap-4 overflow-hidden p-4', panelOpen && 'lg:grid-cols-[minmax(0,1fr)_300px]')}>
        <div className={cx(view === 'overview' ? 'overflow-y-auto' : 'overflow-x-auto')}>
          {view === 'overview' ? (
            <Overview
              version={project}
              onOpenTask={(id) => {
                const task = project.tasks.find((t) => t.id === id)
                if (task) setEditing(task)
              }}
            />
          ) : view === 'kanban' ? (
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
        <div className={cx('hidden overflow-y-auto', panelOpen && 'lg:block')}>
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
              onClick={() => setSideTab('agents')}
              data-testid="tab-agents"
              className={cx(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium',
                sideTab === 'agents' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Bot className="h-3 w-3" /> Agents
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
          ) : sideTab === 'agents' ? (
            <AgentsPanel agents={project.agents ?? []} tasks={project.tasks} onChanged={reload} />
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

      {dispatching && (
        <DispatchModal
          sprintId={project.activeSprint?.id}
          onClose={() => setDispatching(false)}
          onOpenTask={(id) => {
            const task = project.tasks.find((t) => t.id === id)
            if (!task) return
            setDispatching(false)
            setEditing(task)
          }}
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
        onRunSprint={() => setDispatching(true)}
      />
    </div>
    </AgentsContext.Provider>
  )
}
