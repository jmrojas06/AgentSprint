import { useCallback, useEffect, useState } from 'react'
import type { Task } from '../types'

const STORAGE_KEY = 'agentsprint.notifications'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStored(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

interface UseReviewNotificationsResult {
  /** False when the browser has no Notification API (silent fallback). */
  supported: boolean
  /** True when the user opted in AND permission was granted. */
  enabled: boolean
  /** Ask for permission and opt in. No-op (returns false) when unsupported. */
  request: () => Promise<boolean>
  /** Turn notifications off without revoking permission. */
  disable: () => void
  /** Show a "ready for review" notification; click focuses the board and opens the task. */
  notifyReview: (task: Task, onOpen: (task: Task) => void) => void
}

/**
 * Browser desktop notifications for tasks moving to Review.
 * Strictly opt-in: never requests permission automatically, only when the
 * user clicks the toggle. Degrades silently when unsupported.
 */
export function useReviewNotifications(): UseReviewNotificationsResult {
  const [supported] = useState<boolean>(() => typeof window !== 'undefined' && 'Notification' in window)
  const [granted, setGranted] = useState<boolean>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission === 'granted' : false,
  )
  const [optedIn, setOptedIn] = useState<boolean>(readStored)

  const enabled = supported && granted && optedIn

  const request = useCallback(async () => {
    if (!supported) return false
    try {
      const result = await Notification.requestPermission()
      const isGranted = result === 'granted'
      setGranted(isGranted)
      setOptedIn(isGranted)
      writeStored(isGranted)
      return isGranted
    } catch {
      return false
    }
  }, [supported])

  const disable = useCallback(() => {
    setOptedIn(false)
    writeStored(false)
  }, [])

  const notifyReview = useCallback(
    (task: Task, onOpen: (task: Task) => void) => {
      if (!enabled) return
      try {
        const notification = new Notification(`${task.id} ready for review`, {
          body: task.title,
          tag: `agentsprint-review-${task.id}`,
        })
        notification.onclick = () => {
          window.focus()
          onOpen(task)
          notification.close()
        }
      } catch {
        /* some environments throw on construction — stay silent */
      }
    },
    [enabled],
  )

  // Keep `enabled` honest if permission is revoked while opted-in.
  useEffect(() => {
    if (!supported) return
    const id = setInterval(() => {
      const stillGranted = Notification.permission === 'granted'
      setGranted((prev) => (prev === stillGranted ? prev : stillGranted))
    }, 60_000)
    return () => clearInterval(id)
  }, [supported])

  return { supported, enabled, request, disable, notifyReview }
}
