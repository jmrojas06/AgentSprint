import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, ClipboardCopy, Play, ShieldCheck, X } from 'lucide-react'
import type { DispatchItem, DispatchPlan } from '../types'
import { api } from '../api'
import { AssigneeChip } from '../agents'
import { useDialogFocus } from '../hooks/useDialogFocus'
import { cx, priorityDot } from '../ui'

interface Props {
  sprintId?: number
  onOpenTask: (id: string) => void
  onClose: () => void
}

/** Same framing as the MCP `run-sprint` prompt, so a paste behaves like the prompt. */
const ORCHESTRATOR_INTRO =
  'Run this sprint as the orchestrator. Delegate every task to its subagent exactly as the plan says, launch the tasks of a wave in parallel, verify between waves, and call sprint_dispatch again before each new wave. Stop when nothing is left to dispatch and give me a summary of what is in Review.'

function waveLabel(waves: DispatchItem[][], i: number): string {
  if (i === 0) return 'Start now'
  return waves.slice(0, i).every((w) => w.length === 0) ? 'After the in-progress tasks' : `After wave ${i}`
}

export function DispatchModal({ sprintId, onOpenTask, onClose }: Props) {
  const [data, setData] = useState<{ plan: DispatchPlan; markdown: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Focus moves to Close on open, Tab stays inside, Escape closes, and focus
  // returns to the Run sprint button (same pattern as the command palette).
  useDialogFocus(dialogRef, onClose, closeRef)

  useEffect(() => {
    let cancelled = false
    api
      .dispatch(sprintId)
      .then((d) => !cancelled && setData(d))
      .catch((e: Error) => !cancelled && setError(e.message))
    return () => {
      cancelled = true
    }
  }, [sprintId])

  const copy = async () => {
    if (!data) return
    try {
      await navigator.clipboard.writeText(`${ORCHESTRATOR_INTRO}\n\n${data.markdown}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Clipboard unavailable: select the plan text and copy it manually.')
    }
  }

  const plan = data?.plan
  const pending = plan ? plan.waves.reduce((n, w) => n + w.length, 0) : 0

  const gated = plan ? plan.review.filter((it) => it.reviewer) : []

  const row = (it: DispatchItem, extra?: string) => (
    <TaskLine
      key={it.id}
      id={it.id}
      title={it.title}
      onOpen={onOpenTask}
      lead={<span className={cx('h-1.5 w-1.5 rounded-full', priorityDot[it.priority])} />}
      extra={extra}
      chip={
        it.subagent ? (
          <AssigneeChip assignee={it.subagent} className="shrink-0" />
        ) : (
          <span className="shrink-0 rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400" title="No specialist matches: use the default agent">
            general-purpose
          </span>
        )
      }
      reviewer={it.reviewer}
    />
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none"
        data-testid="dispatch-modal"
      >
        <div className="flex items-start gap-3 border-b border-zinc-800 p-4">
          <Play className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
          <div className="min-w-0">
            <h2 id="dispatch-title" className="text-sm font-semibold text-zinc-100">
              Run sprint with subagents
            </h2>
            <p className="mt-0.5 truncate text-xs text-zinc-500">
              {plan ? (plan.sprint ? `Sprint ${plan.sprint.id}: ${plan.sprint.goal || 'no goal'}` : 'Backlog (no active sprint)') : 'Planning waves…'}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="-m-1 ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {error && (
            <p role="alert" className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          {!data && !error && (
            <div className="space-y-2" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded-md bg-zinc-800/70" />
              ))}
            </div>
          )}

          {plan && pending === 0 && gated.length === 0 && (
            <div className="rounded-md border border-dashed border-zinc-700 p-4 text-center">
              <p className="text-sm text-zinc-200">Nothing to dispatch</p>
              <p className="mt-1 text-xs text-zinc-500">
                {plan.inProgress.length + plan.review.length > 0
                  ? 'Every remaining task is in progress or waiting for review.'
                  : 'Add To Do tasks to this sprint and assign them to a specialist.'}
              </p>
            </div>
          )}

          {plan?.waves.map((wave, i) =>
            wave.length === 0 ? null : (
              <section key={i} aria-label={`Wave ${i + 1}`}>
                <h3 className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs font-semibold text-zinc-200">
                  Wave {i + 1}
                  <span className="font-normal text-zinc-500">
                    {waveLabel(plan.waves, i)}
                    {wave.length > 1 ? `, ${wave.length} tasks in parallel` : ''}
                  </span>
                </h3>
                <ul className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-1">{wave.map((it) => row(it))}</ul>
              </section>
            ),
          )}

          {plan && plan.inProgress.length > 0 && (
            <section aria-label="In progress">
              <h3 className="mb-1 text-xs font-semibold text-zinc-200">In progress</h3>
              <ul className="rounded-lg border border-zinc-800 p-1">
                {plan.inProgress.map((it) => row(it, it.lockedBy ? `locked by ${it.lockedBy}` : 'no active lock'))}
              </ul>
            </section>
          )}

          {plan && plan.blocked.length > 0 && (
            <section aria-label="Blocked">
              <h3 className="mb-1 text-xs font-semibold text-red-300">Blocked</h3>
              <ul className="rounded-lg border border-red-900/40 p-1">{plan.blocked.map((it) => row(it, it.reason))}</ul>
            </section>
          )}

          {gated.length > 0 && (
            <section aria-label="Review gate">
              <h3 className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs font-semibold text-zinc-200">
                Review gate
                <span className="font-normal text-zinc-500">reviewer subagents check these before you do</span>
              </h3>
              <ul className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-1">
                {gated.map((it) => (
                  <TaskLine
                    key={it.id}
                    id={it.id}
                    title={it.title}
                    onOpen={onOpenTask}
                    lead={<ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />}
                    chip={<AssigneeChip assignee={it.reviewer!} className="shrink-0" />}
                  />
                ))}
              </ul>
            </section>
          )}
          {plan && plan.review.length > gated.length && (
            <p className="text-[11px] text-zinc-500">
              Waiting for your review without a gate: {plan.review.filter((t) => !t.reviewer).map((t) => t.id).join(', ')}.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 p-4">
          <p className="hidden min-w-0 flex-1 text-[11px] leading-snug text-zinc-500 sm:block">
            Paste into Claude Code, or run <code className="rounded bg-zinc-800 px-1 text-zinc-300">/mcp__agentsprint__run-sprint</code> there.
          </p>
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!data || (pending === 0 && gated.length === 0)}
            className="flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
            data-testid="dispatch-copy"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy orchestrator prompt'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * One task in the plan. From sm up it is a single line (id, title, chips);
 * below sm the chips drop to a second line so the title keeps the width.
 */
function TaskLine({
  id,
  title,
  onOpen,
  lead,
  chip,
  extra,
  reviewer,
}: {
  id: string
  title: string
  onOpen: (id: string) => void
  lead: ReactNode
  chip: ReactNode
  extra?: string
  reviewer?: string | null
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(id)}
        className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-zinc-800/70 sm:items-center"
      >
        <span className="flex h-4 w-3.5 shrink-0 items-center justify-center">{lead}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[11px] text-zinc-500 sm:w-14" translate="no">{id}</span>
            <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs text-zinc-200 sm:line-clamp-1">{title}</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0 sm:flex-nowrap">
            {extra && <span className="text-[11px] text-zinc-500">{extra}</span>}
            {chip}
            {reviewer && (
              <span className="hidden shrink-0 items-center gap-1 text-[10px] text-zinc-500 md:flex" title={`Then checked by ${reviewer}`}>
                <ShieldCheck className="h-3 w-3" />
                {reviewer}
              </span>
            )}
          </span>
        </span>
      </button>
    </li>
  )
}
