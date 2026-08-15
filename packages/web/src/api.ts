import type {
  ProjectConfig,
  ProjectState,
  Sprint,
  SprintStatus,
  Task,
  TaskInput,
  TaskStatus,
} from './types'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed: ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  project: () => request<ProjectState>('/api/project'),
  health: () => request<{ ok: boolean }>('/api/health'),

  createTask: (input: TaskInput) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
  updateTask: (id: string, patch: Partial<TaskInput>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  setTaskStatus: (id: string, status: TaskStatus) =>
    request<Task>(`/api/tasks/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  deleteTask: (id: string) => request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),

  createSprint: (goal: string) =>
    request<Sprint>('/api/sprints', { method: 'POST', body: JSON.stringify({ goal }) }),
  updateSprint: (id: number, patch: Partial<{ goal: string; status: SprintStatus }>) =>
    request<Sprint>(`/api/sprints/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  updateConfig: (patch: Partial<ProjectConfig>) =>
    request<ProjectConfig>('/api/config', { method: 'PUT', body: JSON.stringify(patch) }),
}
