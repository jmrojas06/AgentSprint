import { useEffect, useState } from 'react'
import { TrendingDown } from 'lucide-react'
import type { Burndown } from '../types'
import { api } from '../api'

export function BurndownChart({ sprintId }: { sprintId: number }) {
  const [data, setData] = useState<Burndown | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)

  useEffect(() => {
    api.sprintBurndown(sprintId).then(setData).catch(() => setData(null))
    return () => setHovered(null)
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

  const idealPts = n > 1 ? `${x(0)},${y(total)} ${x(n - 1)},${y(0)}` : ''
  const actualPts = data.points.map((p, i) => `${x(i)},${y(p.remaining)}`).join(' ')

  const tipRight = hovered != null && x(hovered) > W / 2
  const tipX = hovered != null ? x(hovered) + (tipRight ? -8 : 8) : 0
  const tipAnchor = tipRight ? 'end' : 'start'

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
      <svg data-testid="burndown-svg" viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" onMouseLeave={() => setHovered(null)}>
        {idealPts && (
          <>
            <polyline points={idealPts} fill="none" className="stroke-zinc-700" strokeWidth="1" strokeDasharray="3 3" />
            {/* invisible wide hit area so the ideal line is explainable on hover of any point */}
            <title>ideal</title>
          </>
        )}
        {actualPts && <polyline points={actualPts} fill="none" className="stroke-indigo-400" strokeWidth="2" />}
        {data.points.map((p, i) => (
          <g key={p.date} onMouseEnter={() => setHovered(i)}>
            <circle cx={x(i)} cy={y(p.remaining)} r={hovered === i ? 4 : 2.5} className="fill-indigo-400" />
            <rect x={x(i) - 6} y={0} width="12" height={H} fill="transparent" />
            <title>{`${p.date}: ${p.remaining} pts left`}</title>
          </g>
        ))}
        {hovered != null && (
          <g pointerEvents="none" data-testid="burndown-tooltip">
            <rect
              x={tipX + (tipRight ? -66 : 0)}
              y={Math.max(y(data.points[hovered]!.remaining) - 22, 1)}
              width="66"
              height="18"
              rx="3"
              className="fill-zinc-800 stroke-zinc-700"
              strokeWidth="0.5"
            />
            <text
              x={tipX}
              y={Math.max(y(data.points[hovered]!.remaining) - 22, 1) + 12}
              textAnchor={tipAnchor}
              className="fill-zinc-200"
              fontSize="7"
              fontFamily="monospace"
            >
              {data.points[hovered]!.date.slice(5)} · {data.points[hovered]!.remaining}/{total}
            </text>
          </g>
        )}
      </svg>
      <p className="mt-0.5 flex items-center gap-3 text-[10px] text-zinc-500">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-indigo-400" /> actual
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 border-t border-dashed border-zinc-600" /> ideal
        </span>
      </p>
    </div>
  )
}
