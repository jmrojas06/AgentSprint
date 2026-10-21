import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
  // Skip controls that are not rendered (display:none); without layout (jsdom) keep them all.
  const rendered = (el: HTMLElement) => el.getClientRects().length > 0
  if (!all.some(rendered)) return all
  return all.filter((el) => rendered(el) || el === document.activeElement)
}

/** Open surfaces, oldest first: only the last one handles Tab and Escape. */
const stack: Array<RefObject<HTMLElement | null>> = []

/**
 * Join the surface stack for Escape only, for a modal that handles its own
 * focus (TaskModal, NewTaskModal). Without it a window-level Escape would
 * close the modal under a token prompt and drop its unsaved edits.
 */
export function useEscapeLayer(onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const layer: RefObject<HTMLElement | null> = { current: null }
    stack.push(layer)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === layer) closeRef.current()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      stack.splice(stack.indexOf(layer), 1)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])
}

/**
 * Focus handling for a modal surface, the same pattern the command palette
 * uses: remember what had focus, move focus inside on open, give it back on
 * close. On top of that it keeps Tab and Shift+Tab inside the surface and
 * closes it on Escape. When surfaces stack (a token prompt over the side
 * drawer), only the top-most one reacts; if what had focus is gone (a button
 * that disabled itself while busy), focus goes back to the surface below.
 *
 * `initialFocus` picks the element that receives focus on open; without it
 * the first focusable element (or the container) gets it.
 *
 * `restoreFocus: false` leaves focus-on-close to the caller, for a surface
 * that already has an owner for it (TaskModal and useReturnFocus): two hooks
 * moving focus on the same close would fight over where it lands.
 */
export function useDialogFocus(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  initialFocus?: RefObject<HTMLElement | null>,
  { restoreFocus = true }: { restoreFocus?: boolean } = {},
) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    stack.push(containerRef)
    const prevFocus = document.activeElement as HTMLElement | null
    const frame = requestAnimationFrame(() => {
      const root = containerRef.current
      if (!root || root.contains(document.activeElement)) return
      const target = initialFocus?.current ?? focusables(root)[0] ?? root
      target.focus()
    })

    const onKeyDown = (e: KeyboardEvent) => {
      const root = containerRef.current
      if (!root || stack[stack.length - 1] !== containerRef) return
      if (e.key === 'Escape') {
        closeRef.current()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables(root)
      if (items.length === 0) {
        e.preventDefault()
        root.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement as HTMLElement | null
      const inside = active ? root.contains(active) : false
      // Focus sits in something rendered after this surface: a layer opened
      // over it that is not on the stack (the command palette). Leave it there.
      if (!inside && active && active !== document.body && root.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING) return
      if (e.shiftKey && (!inside || active === first || active === root)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      stack.splice(stack.indexOf(containerRef), 1)
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      if (!restoreFocus) return
      const lost = !prevFocus || !prevFocus.isConnected || prevFocus === document.body
      ;(lost ? stack[stack.length - 1]?.current : prevFocus)?.focus?.()
    }
    // Mount-only: the surface owns focus for as long as it is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
