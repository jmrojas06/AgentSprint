import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  api: {
    dispatch: vi.fn().mockResolvedValue({
      plan: {
        sprint: { id: 1, goal: 'Ship it' },
        waves: [[{ id: 'TK-1', title: 'A very long task title that should not be cut after ten characters', priority: 'high', subagent: 'designer', reviewer: 'ui-reviewer' }]],
        inProgress: [],
        blocked: [],
        review: [],
      },
      markdown: '# plan',
    }),
  },
}))

import { DispatchModal } from './DispatchModal'

afterEach(() => cleanup())

async function openModal(onClose = vi.fn()) {
  const trigger = document.createElement('button')
  trigger.textContent = 'Run sprint'
  document.body.appendChild(trigger)
  trigger.focus()
  const utils = render(<DispatchModal sprintId={1} onOpenTask={vi.fn()} onClose={onClose} />)
  // let the plan load and the focus frame run
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
  return { ...utils, trigger, onClose }
}

describe('DispatchModal focus', () => {
  it('moves focus into the dialog on open', async () => {
    await openModal()
    expect(screen.getByTestId('dispatch-modal').contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
  })

  it('keeps Tab inside the dialog', async () => {
    await openModal()
    const dialog = screen.getByTestId('dispatch-modal')
    const copy = screen.getByTestId('dispatch-copy')
    copy.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close')
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(copy)
  })

  it('closes on Escape and gives focus back to the trigger', async () => {
    const { trigger, onClose, unmount } = await openModal()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
