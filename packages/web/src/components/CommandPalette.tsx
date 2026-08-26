import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, CornerDownLeft, Search } from 'lucide-react'
import type { Sprint, Task } from '../types'
import { cx, fuzzyScore } from '../ui'

interface Props {
  open: boolean
  tasks: Task[]
  sprints: Sprint[]
  activeSprintId: number | null
  onClose: () => void
  onCreateTask: () => void
  onOpenTask: (task: Task) => void
  onActivateSprint: (id: number) => void
  onClearFilters: () => void
}

interface Item {
  key: string
  label: string
  hint?: string
  group: 'Actions' | 'Tasks' | 'Sprints'
  keywords?: string
  run: () => void
}

const MAX_RESULTS = 12

export function CommandPalette({
  open,
  tasks,
  sprints,
  activeSprintId,
  onClose,
  onCreateTask,
  onOpenTask,
  onActivateSprint,
  onClearFilters,
}: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!open) return
    const prevFocus = document.activeElement as HTMLElement | null
    setQuery('')
    setIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      prevFocus?.focus?.()
    }
  }, [open])

  // The palette is the topmost overlay: swallow Escape in the capture phase so
  // modals underneath (which listen for keydown on window) don't close in
  // cascade and silently discard unsaved edits.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  const items = useMemo<Item[]>(() => {
    if (!open) return []
    const actions: Item[] = [
      { key: 'new-task', label: 'Create new task', group: 'Actions', run: onCreateTask },
      { key: 'clear-filters', label: 'Clear all filters', group: 'Actions', run: onClearFilters },
    ]
    const taskItems: Item[] = tasks.map((t) => ({
      key: `task-${t.id}`,
      label: `${t.id} — ${t.title}`,
      hint: t.status,
      group: 'Tasks',
      run: () => onOpenTask(t),
    }))
    const sprintItems: Item[] = sprints
      .filter((s) => s.id !== activeSprintId && s.status !== 'closed')
      .map((s) => ({
        key: `sprint-${s.id}`,
        label: `Activate sprint ${s.id}`,
        hint: s.goal || undefined,
        keywords: s.goal || undefined,
        group: 'Sprints',
        run: () => onActivateSprint(s.id),
      }))

    const all = [...actions, ...taskItems, ...sprintItems]
    const q = query.trim()
    if (!q) return [...actions, ...taskItems.slice(0, 8), ...sprintItems]
    return all
      .map((item) => ({
        item,
        score: Math.max(fuzzyScore(q, item.label) ?? -1, fuzzyScore(q, item.keywords ?? '') ?? -1),
      }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.item)
  }, [open, query, tasks, sprints, activeSprintId, onCreateTask, onOpenTask, onActivateSprint, onClearFilters])

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [index])

  if (!open) return null

  const runItem = (item: Item | undefined) => {
    if (!item) return
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Escape is handled by the capture-phase window listener above
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.max(0, Math.min(i + 1, items.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runItem(items[index])
    }
  }

  const headerKeys = new Set<string>(
    items.filter((item, i) => i === 0 || items[i - 1]!.group !== item.group).map((item) => item.key),
  )

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[12vh]" onClick={onClose}>
      <div
        data-testid="command-palette"
        onKeyDown={onKeyDown}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setIndex(0)
            }}
            placeholder="Search tasks, run a command…"
            className="w-full bg-transparent py-1 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          <kbd className="rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-500">esc</kbd>
        </div>

        <ul ref={listRef} role="listbox" aria-label="Command palette results" className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-zinc-600">No matching commands or tasks</li>
          )}
          {items.map((item, i) => {
            const header = headerKeys.has(item.key) ? item.group : null
            return (
              <li key={item.key} role="option" aria-selected={i === index}>
                {header && (
                  <div className="mt-1 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-600">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  data-testid="command-item"
                  data-active={i === index}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => runItem(item)}
                  className={cx(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm',
                    i === index ? 'bg-indigo-600/20 text-zinc-100' : 'text-zinc-300',
                  )}
                >
                  {i === index ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                  ) : (
                    <Check className="h-3.5 w-3.5 shrink-0 opacity-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 truncate text-[11px] text-zinc-500">{item.hint}</span>}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
