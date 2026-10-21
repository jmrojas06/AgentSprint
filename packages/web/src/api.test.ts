import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, getStoredToken, setTokenPrompt } from './api'

const GOOD = 'good-token'

/** A fake server that accepts only `Bearer good-token`. */
function stubServer() {
  const calls: Array<{ url: string; method: string; auth: string | undefined; body: unknown }> = []
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const auth = (init.headers as Record<string, string>)['Authorization']
    calls.push({ url, method: init.method ?? 'GET', auth, body: init.body })
    if (auth !== `Bearer ${GOOD}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    }
    return new Response(JSON.stringify({ id: 'TK-1', status: 'Done' }), { status: 200 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

let unregister: (() => void) | undefined

beforeEach(() => localStorage.clear())
afterEach(() => {
  unregister?.()
  unregister = undefined
  vi.unstubAllGlobals()
})

describe('request() on 401', () => {
  it('opens the token prompt and re-sends the refused request with the new token', async () => {
    const calls = stubServer()
    const prompt = vi.fn(async (attempt: (token: string) => Promise<boolean>) => attempt(GOOD))
    unregister = setTokenPrompt(prompt)

    const task = await api.setTaskStatus('TK-1', 'Done')

    expect(task).toEqual({ id: 'TK-1', status: 'Done' })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ method: 'PATCH', auth: `Bearer ${GOOD}`, body: calls[0]!.body })
    expect(getStoredToken()).toBe(GOOD)
  })

  it('reports a wrong token as rejected and does not store it', async () => {
    const calls = stubServer()
    const results: boolean[] = []
    unregister = setTokenPrompt(async (attempt) => {
      results.push(await attempt('not-the-token'))
      expect(getStoredToken()).toBeNull()
      results.push(await attempt(GOOD))
      return true
    })

    await api.addHandoff({ summary: 'x' })

    expect(results).toEqual([false, true])
    expect(calls.map((c) => c.auth)).toEqual([undefined, 'Bearer not-the-token', `Bearer ${GOOD}`])
    expect(getStoredToken()).toBe(GOOD)
  })

  it('fails with Unauthorized when the prompt is dismissed', async () => {
    stubServer()
    unregister = setTokenPrompt(async () => false)
    await expect(api.saveAgent('designer', {})).rejects.toThrow(/Unauthorized/)
    expect(getStoredToken()).toBeNull()
  })

  it('asks once for concurrent refused requests and retries all of them', async () => {
    const calls = stubServer()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const prompt = vi.fn(async (attempt: (token: string) => Promise<boolean>) => {
      await gate
      return attempt(GOOD)
    })
    unregister = setTokenPrompt(prompt)

    const both = Promise.all([api.project(), api.projects()])
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    release()
    await both

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(calls.filter((c) => c.auth === `Bearer ${GOOD}`)).toHaveLength(2)
  })

  it('one cancel rejects every concurrent refused request with status 401', async () => {
    const calls = stubServer()
    let cancel!: () => void
    const prompt = vi.fn(() => new Promise<boolean>((r) => (cancel = () => r(false))))
    unregister = setTokenPrompt(prompt)

    const all = Promise.allSettled([api.health(), api.projects(), api.project()])
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    cancel()
    const results = await all

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected'])
    for (const r of results) expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 401 })
    expect(calls).toHaveLength(3)
  })
})
