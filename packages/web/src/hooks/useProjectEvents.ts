import { useEffect } from 'react'

/**
 * Subscribe to server-sent events. Every relevant event triggers `onEvent`,
 * which the caller uses to refetch project state (files are the source of
 * truth; the UI just mirrors them).
 */
export function useProjectEvents(onEvent: () => void): void {
  useEffect(() => {
    const es = new EventSource('/api/events')
    const events = ['change', 'task', 'task:deleted', 'sprint', 'config']
    for (const name of events) es.addEventListener(name, onEvent)
    return () => {
      es.close()
    }
  }, [onEvent])
}
