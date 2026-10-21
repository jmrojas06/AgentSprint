import { useRef } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDialogFocus, useEscapeLayer } from './useDialogFocus'

afterEach(() => cleanup())

function Modal({ onClose }: { onClose: () => void }) {
  useEscapeLayer(onClose)
  return <div>modal</div>
}

function Prompt({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)
  return (
    <div ref={ref}>
      <input aria-label="token" />
    </div>
  )
}

describe('useEscapeLayer', () => {
  it('lets only the top surface close on Escape, wherever focus is', () => {
    const closeModal = vi.fn()
    const closePrompt = vi.fn()
    const { rerender } = render(
      <>
        <Modal onClose={closeModal} />
        <Prompt onClose={closePrompt} />
      </>,
    )
    // Focus on the page body (e.g. after clicking the backdrop), as in the bug.
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closePrompt).toHaveBeenCalledTimes(1)
    expect(closeModal).not.toHaveBeenCalled()

    // Once the prompt is gone the modal is on top again.
    rerender(<Modal onClose={closeModal} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeModal).toHaveBeenCalledTimes(1)
  })
})
