import { useRef, type ReactNode } from 'react'
import { useDialogFocus } from '../hooks/useDialogFocus'

interface Props {
  onClose: () => void
  children: ReactNode
}

/**
 * The side panel (Sprints, Agents, Brand) below 1024px, where there is no room
 * for a third column: a modal sheet from the right edge. Focus moves in on
 * open, stays inside, and returns to the header button on close.
 */
export function SideDrawer({ onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  // Focus lands on the sheet itself so the screen reader announces it; Tab then walks its controls.
  useDialogFocus(ref, onClose, ref)
  return (
    <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
      <div className="scrim-in absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Sprints, agents and brand"
        tabIndex={-1}
        className="drawer-in relative flex h-full w-[min(360px,calc(100vw-2.5rem))] flex-col overflow-y-auto overscroll-contain border-l border-zinc-800 bg-zinc-950 p-3 shadow-2xl shadow-black/40 outline-none"
        data-testid="side-drawer"
      >
        {children}
      </div>
    </div>
  )
}
