import { useEffect } from 'react'

/*
 * Markup contract (Board columns, ListView, Overview lists):
 *   data-task-id="TK-7"            the card or row that opens a task
 *   data-task-list="<key>"         the list it lives in
 *   data-task-list-heading="<key>" that list's heading (tabIndex -1), for when the list is empty
 * Lists and cards are looked up by these values every time, so a list that
 * re-rendered (or remounted) is found again.
 */

interface Origin {
  taskId: string
  opener: HTMLElement | null
  list: string | null
  /** Task ids of the list at open time, in order, to pick a neighbour when the task left it. */
  order: string[]
}

const byData = (attr: string, value: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`)).find((el) => el.getAttribute(attr) === value) ?? null

const idsIn = (list: HTMLElement) =>
  Array.from(list.querySelectorAll<HTMLElement>('[data-task-id]')).map((el) => el.dataset.taskId!)

function capture(taskId: string): Origin {
  const active = document.activeElement
  const opener = active instanceof HTMLElement && active !== document.body ? active : null
  const listEl = (opener ?? byData('data-task-id', taskId))?.closest<HTMLElement>('[data-task-list]') ?? null
  return { taskId, opener, list: listEl?.dataset.taskList ?? null, order: listEl ? idsIn(listEl) : [] }
}

/**
 * Where focus goes once the task surface closed: the opener; else the task
 * re-rendered in the same list; else its neighbour in that list (the task
 * left it: Mark done, Request changes, a new status); else the task wherever
 * it is now; else the list heading; else the main region.
 */
function resolve(o: Origin): HTMLElement | null {
  if (o.opener?.isConnected) return o.opener
  const list = o.list ? byData('data-task-list', o.list) : null
  if (list) {
    const same = byData('data-task-id', o.taskId, list)
    if (same) return same
    const at = o.order.indexOf(o.taskId)
    const neighbours = at < 0 ? o.order : [...o.order.slice(at + 1), ...o.order.slice(0, at).reverse()]
    for (const id of neighbours) {
      const el = byData('data-task-id', id, list)
      if (el) return el
    }
  }
  return (
    byData('data-task-id', o.taskId) ??
    (o.list ? byData('data-task-list-heading', o.list) : null) ??
    document.querySelector<HTMLElement>('main')
  )
}

/** How long focus keeps following its target while the board settles after a close. */
const FOLLOW_MS = 3000

function restore(o: Origin) {
  let target = resolve(o)
  target?.focus()
  // The board, or the Overview snapshot after it, can re-render after the
  // surface is gone and drop the element that just got focus (the row of a
  // task that left Review). Follow it until the user moves focus themselves.
  const observer = new MutationObserver(() => {
    if (target?.isConnected) return
    const active = document.activeElement
    if (active && active !== document.body) return stop()
    target = resolve(o)
    target?.focus()
  })
  const timer = setTimeout(() => stop(), FOLLOW_MS)
  function stop() {
    observer.disconnect()
    clearTimeout(timer)
  }
  observer.observe(document.body, { childList: true, subtree: true })
}

/**
 * Focus-on-close for a task surface (TaskModal, whose useDialogFocus runs with
 * `restoreFocus: false` so this is the only owner): remembers what opened it
 * and, however it closes, gives focus back there or to the closest thing that
 * still exists.
 */
export function useReturnFocus(taskId: string) {
  useEffect(() => {
    const origin = capture(taskId)
    return () => restore(origin)
  }, [taskId])
}
