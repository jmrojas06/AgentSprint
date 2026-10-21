import { useEffect } from 'react'
import { authHeaders } from '../api'

const EVENTS = new Set(['change', 'task', 'task:deleted', 'sprint', 'config'])
const RETRY_MS = 3000

/**
 * Subscribe to server-sent events. Every relevant event triggers `onEvent`,
 * which the caller uses to refetch project state (files are the source of
 * truth; the UI just mirrors them).
 *
 * Read with fetch rather than EventSource so the stream can carry the bearer
 * token (EventSource cannot send headers). Each reconnect reads the stored
 * token again, so a token saved after a 401 takes effect on the next try.
 */
export function useProjectEvents(onEvent: () => void): void {
  useEffect(() => {
    const abort = new AbortController()
    const connect = async () => {
      try {
        const res = await fetch('/api/events', { headers: authHeaders(), signal: abort.signal })
        if (res.ok && res.body) {
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
          let buffer = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += value
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() ?? ''
            for (const block of blocks) {
              const name = /^event: (.*)$/m.exec(block)?.[1]
              if (name && EVENTS.has(name)) onEvent()
            }
          }
        }
      } catch {
        /* network error or unmount; retried below unless aborted */
      }
      if (!abort.signal.aborted) setTimeout(() => void connect(), RETRY_MS)
    }
    void connect()
    return () => abort.abort()
  }, [onEvent])
}
