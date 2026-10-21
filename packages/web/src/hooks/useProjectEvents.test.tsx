import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOKEN_KEY } from '../api'
import { useProjectEvents } from './useProjectEvents'

/** An open SSE body, like the server's (it never ends on its own). */
function sseResponse(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useProjectEvents', () => {
  it('sends the stored bearer token and refreshes on board events only', async () => {
    localStorage.setItem(TOKEN_KEY, 'tok')
    const fetchMock = vi.fn(async () =>
      sseResponse('retry: 3000\n\nevent: task\ndata: {"id":"TK-1"}\n\n: ping\n\nevent: memory\ndata: {}\n\nevent: config\ndata: {}\n\n'),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onEvent = vi.fn()

    renderHook(() => useProjectEvents(onEvent))

    await waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenCalledWith('/api/events', expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }))
  })

  it('reconnects after a refused stream, picking up a token saved meanwhile', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"error":"Unauthorized"}', { status: 401 }))
      .mockResolvedValue(sseResponse('event: sprint\ndata: {}\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    const onEvent = vi.fn()

    renderHook(() => useProjectEvents(onEvent))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    localStorage.setItem(TOKEN_KEY, 'saved-later')
    await vi.advanceTimersByTimeAsync(3000)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ headers: { Authorization: 'Bearer saved-later' } })
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('stops streaming on unmount', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined
        return sseResponse('')
      }),
    )
    const { unmount } = renderHook(() => useProjectEvents(vi.fn()))
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal!.aborted).toBe(true)
  })
})
