import type {
  ActivityEvent,
  BoardState,
  Brand,
  Burndown,
  GitCommit,
  ProjectConfig,
  ProjectInfo,
  Sprint,
  SprintStatus,
  Task,
  TaskInput,
  TaskStatus,
  TaskTemplate,
} from './types'

let activeProject: string | undefined

/** localStorage key for the optional bearer token (see docs/api.md#authentication). */
export const TOKEN_KEY = 'agentsprint-token'

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}
export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* storage unavailable */
  }
}
export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable */
  }
}

/** Set the project every subsequent request is scoped to. */
export function setProject(name: string): void {
  activeProject = name
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const withProject = activeProject
    ? url + (url.includes('?') ? '&' : '?') + `project=${encodeURIComponent(activeProject)}`
    : url
  const token = getStoredToken()
  const baseHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) baseHeaders['Authorization'] = `Bearer ${token}`
  const mergedHeaders: Record<string, string> = { ...baseHeaders, ...(init?.headers as Record<string, string> | undefined) }
  const res = await fetch(withProject, {
    ...init,
    headers: mergedHeaders,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    if (res.status === 401) {
      // Clear hint for any HTTP client (web, CLI, MCP) that the server requires a token.
      // Web UI shows a prompt; CLI/MCP should surface this hint to the user.
      throw new Error(body?.error ?? 'Unauthorized — this board requires a token. Set it via localStorage key agentsprint-token (web) or start the server with --token / AGENTBOARD_TOKEN and retry with Authorization: Bearer <token>.')
    }
    throw new Error(body?.error ?? `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  project: () => request<BoardState>('/api/project'),
  projects: () => request<ProjectInfo[]>('/api/projects'),
  health: () => request<{ ok: boolean }>('/api/health'),

  createTask: (input: TaskInput & { template?: string; vars?: Record<string, string> }) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
  templates: () => request<TaskTemplate[]>('/api/templates'),
  updateTask: (id: string, patch: Partial<TaskInput>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  setTaskStatus: (id: string, status: TaskStatus) =>
    request<Task>(`/api/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  setTaskChecklist: (id: string, patch: { index?: number; text?: string; completed?: boolean }) =>
    request<Task>(`/api/tasks/${id}/checklist`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
  getTaskSpec: (id: string) => request<{ id: string; spec: string }>(`/api/tasks/${id}/spec`),
  getTaskActivity: (id: string) => request<{ id: string; activity: ActivityEvent[] }>(`/api/tasks/${id}/activity`),
  getTaskCommits: (id: string, pattern?: string) =>
    request<{ id: string; gitAvailable: boolean; commits: GitCommit[]; branches: string[] }>(
      `/api/tasks/${id}/commits${pattern ? `?pattern=${encodeURIComponent(pattern)}` : ''}`,
    ),
  gitCommitCounts: () => request<Record<string, number>>('/api/git/commit-counts'),

  createSprint: (goal: string) =>
    request<Sprint>('/api/sprints', { method: 'POST', body: JSON.stringify({ goal }) }),
  updateSprint: (id: number, patch: Partial<{ goal: string; status: SprintStatus }>) =>
    request<Sprint>(`/api/sprints/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  sprintBurndown: (id: number) => request<Burndown>(`/api/sprints/${id}/burndown`),
  sprintReport: (id: number) => request<{ report: string }>(`/api/sprints/${id}/report`),

  updateConfig: (patch: Partial<ProjectConfig>) =>
    request<ProjectConfig>('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),

  getBrand: () => request<Brand>('/api/brand'),
  updateBrand: (patch: Partial<Brand>) =>
    request<Brand>('/api/brand', { method: 'PUT', body: JSON.stringify(patch) }),
}
