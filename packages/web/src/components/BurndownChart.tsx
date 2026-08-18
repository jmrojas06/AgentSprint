import { useEffect, useState } from 'react'
import { TrendingDown } from 'lucide-react'
import type { Burndown } from '../types'
import { api } from '../api'

export function BurndownChart({ sprintId }: { sprintId: number }) {
  const [data, setData] = useState<Burndown | null>(null)

  useEffect(() => {
    api.sprintBurndown(sprintId).then(setData).catch(() => setData(null))
  }, [sprintId])

  if (!data || data.points.length < 1) {
    return (
      <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2 text-[11px] text-zinc-500">
        <p className="flex items-center gap-1.5 text-zinc-400">
          <TrendingDown className="h-3 w-3" /> Burndown
        </p>
        <p className="mt-1">Snapshots appear as the sprint progresses.</p>
      </div>
    )
  }

  const W = 260
  const H = 90
  const pad = 10
  const total = Math.max(data.total, ...data.points.map((p) => p.remaining), 1)
  const n = data.points.length
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(n - 1, 1)
  const y = (v: number) => pad + (H - pad * 2) * (1 - v / total)

  const ideal = (i: number) => total * (1 - i / Math.max(n - 1, 1))
  const idealPts = n > 1 ? `${x(0)},${y(total)} ${x(n - 1)},${y(0)}` : ''
  const actualPts = data.points.map((p, i) => `${x(i)},${y(p.remaining)}`).join(' ')

  return (
    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/50 p-2">
      <p className="flex items-center justify-between text-[11px] text-zinc-400">
        <span className="flex items-center gap-1.5">
          <TrendingDown className="h-3 w-3" /> Burndown
        </span>
        <span className="font-mono text-zinc-500">
          {data.points[n - 1]!.remaining} left / {data.total}
        </span>
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full">
        {idealPts && <polyline points={idealPts} fill="none" className="stroke-zinc-700" strokeWidth="1" strokeDasharray="3 3" />}
        {actualPts && <polyline points={actualPts} fill="none" className="stroke-indigo-400" strokeWidth="2" />}
        {data.points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.remaining)} r="2.5" className="fill-indigo-400" />
        ))}
      </svg>
    </div>
  )
}