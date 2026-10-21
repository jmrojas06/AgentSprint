import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, getStoredToken } from '../api'
import { TokenPrompt } from './TokenPrompt'
import { SideDrawer } from './SideDrawer'

const GOOD = 'test-token-123'

let calls: Array<{ method: string; auth: string | undefined }>

beforeEach(() => {
  localStorage.clear()
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit = {}) => {
      const auth = (init.headers as Record<string, string>)['Authorization']
      calls.push({ method: init.method ?? 'GET', auth })
      if (auth !== `Bearer ${GOOD}`) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      return new Response(JSON.stringify({ id: 'TK-45', status: 'Review' }), { status: 200 })
    }),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function submit(token: string) {
  fireEvent.change(screen.getByLabelText('Bearer token'), { target: { value: token } })
  fireEvent.click(screen.getByTestId('token-save'))
}

describe('TokenPrompt', () => {
  it('is hidden until a request is refused', () => {
    render(<TokenPrompt />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('401 -> prompt -> wrong token stays open with an error -> right token retries the request', async () => {
    const onAccepted = vi.fn()
    render(<TokenPrompt onAccepted={onAccepted} />)

    let result: unknown
    let settled = false
    act(() => {
      void api.setTaskStatus('TK-45', 'Review').then((r) => {
        result = r
        settled = true
      })
    })

    const input = await screen.findByLabelText('Bearer token')
    expect(screen.getByRole('dialog')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(input))

    submit('not-the-token')
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringMatching(/rejected/i))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(getStoredToken()).toBeNull()
    expect(settled).toBe(false)

    submit(GOOD)
    await waitFor(() => expect(settled).toBe(true))
    expect(result).toEqual({ id: 'TK-45', status: 'Review' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(getStoredToken()).toBe(GOOD)
    expect(onAccepted).toHaveBeenCalledTimes(1)
    expect(calls).toEqual([
      { method: 'PATCH', auth: undefined },
      { method: 'PATCH', auth: 'Bearer not-the-token' },
      { method: 'PATCH', auth: `Bearer ${GOOD}` },
    ])
  })

  it('Cancel closes the prompt and the refused request fails', async () => {
    render(<TokenPrompt />)
    let error: Error | undefined
    act(() => {
      void api.addHandoff({ summary: 'x' }).catch((e: Error) => (error = e))
    })
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(error?.message).toMatch(/Unauthorized/))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('owns Tab and Escape when opened over the side drawer, then gives focus back', async () => {
    const closeDrawer = vi.fn()
    render(
      <>
        <SideDrawer onClose={closeDrawer}>
          <button>Sync</button>
        </SideDrawer>
        <TokenPrompt />
      </>,
    )
    const sync = screen.getByRole('button', { name: 'Sync' })
    sync.focus()
    act(() => {
      void api.syncAgents().catch(() => {})
    })
    const input = await screen.findByLabelText('Bearer token')
    const prompt = screen.getByTestId('token-prompt')

    // Tab from the prompt's last control wraps to its first, not into the drawer below.
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(prompt.contains(document.activeElement)).toBe(true)

    // Escape closes only the prompt; focus returns to the control that was focused.
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('token-prompt')).toBeNull())
    expect(closeDrawer).not.toHaveBeenCalled()
    expect(screen.getByTestId('side-drawer')).toBeTruthy()
    expect(document.activeElement).toBe(sync)
  })

  it('returns focus to the drawer when the control that opened the prompt lost it (disabled while busy)', async () => {
    render(
      <>
        <SideDrawer onClose={vi.fn()}>
          <button disabled>Sync</button>
        </SideDrawer>
        <TokenPrompt />
      </>,
    )
    const drawer = screen.getByTestId('side-drawer')
    await waitFor(() => expect(document.activeElement).toBe(drawer))
    ;(document.activeElement as HTMLElement).blur() // what a button disabling itself does
    act(() => {
      void api.syncAgents().catch(() => {})
    })
    const input = await screen.findByLabelText('Bearer token')
    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('token-prompt')).toBeNull())
    expect(document.activeElement).toBe(drawer)
  })

  it('keeps Escape from also closing a modal underneath that listens on window (TaskModal)', async () => {
    const modalEscape = vi.fn()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && modalEscape()
    window.addEventListener('keydown', onKey)
    try {
      render(<TokenPrompt />)
      act(() => {
        void api.updateTask('TK-1', { title: 'x' }).catch(() => {})
      })
      const input = await screen.findByLabelText('Bearer token')
      fireEvent.keyDown(input, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByTestId('token-prompt')).toBeNull())
      expect(modalEscape).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onKey)
    }
  })
})
