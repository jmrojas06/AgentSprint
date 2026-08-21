import fs from 'node:fs'
import path from 'node:path'
import type { ProjectStore } from '@jmrojas06/agentsprint-core'

export interface BurndownPoint {
  date: string
  remaining: number
}

/**
 * Append one daily burndown snapshot for the active sprint (a point per day,
 * deduped). Stored as `.agentboard/metrics/sprint-<id>.json` so the history
 * survives restarts — files are the source of truth.
 */
export function recordBurndownSnapshot(store: ProjectStore): void {
  const sprint = store.state.activeSprint
  if (!sprint) return
  const metricsDir = path.join(store.boardDir, 'metrics')
  fs.mkdirSync(metricsDir, { recursive: true })
  const file = path.join(metricsDir, `sprint-${sprint.id}.json`)

  let points: BurndownPoint[] = []
  if (fs.existsSync(file)) {
    try {
      points = (JSON.parse(fs.readFileSync(file, 'utf8')) as { points?: BurndownPoint[] }).points ?? []
    } catch {
      points = []
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  if (points.some((p) => p.date === today)) return

  const remaining = store.state.tasks.filter((t) => t.sprint === sprint.id && t.status !== 'Done').length
  points.push({ date: today, remaining })
  fs.writeFileSync(file, JSON.stringify({ sprintId: sprint.id, startedAt: sprint.startedAt, points }, null, 2))
}

export function readBurndown(store: ProjectStore, sprintId: number): { sprintId: number; startedAt: string | null; points: BurndownPoint[] } {
  const file = path.join(store.boardDir, 'metrics', `sprint-${sprintId}.json`)
  if (!fs.existsSync(file)) return { sprintId, startedAt: null, points: [] }
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      sprintId: number
      startedAt: string | null
      points: BurndownPoint[]
    }
    return { sprintId, startedAt: data.startedAt ?? null, points: data.points ?? [] }
  } catch {
    return { sprintId, startedAt: null, points: [] }
  }
}