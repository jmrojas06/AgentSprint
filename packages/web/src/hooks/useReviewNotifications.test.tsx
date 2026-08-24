import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../types'
import { useReviewNotifications } from './useReviewNotifications'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
})

function makeTask(id: string): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'Review',
    sprint: null,
    priority: 'medium',
    assignee: 'scrum-master',
    estimate: 1,
    tags: [],
    dependencies: [],
    acceptanceCriteria: [],
    description: '',
    notes: '',
    activity: [],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  }
}

let constructed: Array<{ title: string; options: NotificationOptions; instance: FakeNotification }> = []

class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async () => FakeNotification.permission)
  close = vi.fn()
  onclick: (() => void) | null = null
  title: string
  options: NotificationOptions
  constructor(title: string, options?: NotificationOptions) {
    this.title = title
    this.options = options ?? {}
    constructed.push({ title, options: this.options, instance: this })
  }
}

function Harness({ task }: { task: Task }) {
  const { supported, enabled, request, disable, notifyReview } = useReviewNotifications()
  return (
    <div>
      <span data-testid="supported">{String(supported)}</span>
      <span data-testid="enabled">{String(enabled)}</span>
      <button onClick={() => void request()} data-testid="request">
        request
      </button>
      <button onClick={() => disable()} data-testid="disable">
        disable
      </button>
      <button onClick={() => notifyReview(task, vi.fn())} data-testid="notify">
        notify
      </button>
    </div>
  )
}

describe('useReviewNotifications', () => {
  beforeEach(() => {
    constructed = []
    vi.stubGlobal('Notification', FakeNotification as unknown as typeof Notification)
    FakeNotification.permission = 'default'
    ;(FakeNotification.requestPermission as ReturnType<typeof vi.fn>).mockClear()
  })

  it('reports support and starts disabled by default', () => {
    render(<Harness task={makeTask('TK-1')} />)
    expect(screen.getByTestId('supported').textContent).toBe('true')
    expect(screen.getByTestId('enabled').textContent).toBe('false')
  })

  it('enables after explicit opt-in when permission is granted', async () => {
    FakeNotification.permission = 'granted'
    render(<Harness task={makeTask('TK-1')} />)
    fireEvent.click(screen.getByTestId('request'))
    await waitFor(() => expect(screen.getByTestId('enabled').textContent).toBe('true'))
    expect(localStorage.getItem('agentsprint.notifications')).toBe('1')
  })

  it('does not enable when permission is denied', async () => {
    FakeNotification.permission = 'denied'
    render(<Harness task={makeTask('TK-1')} />)
    fireEvent.click(screen.getByTestId('request'))
    await waitFor(() => expect((FakeNotification.requestPermission as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1))
    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(localStorage.getItem('agentsprint.notifications')).not.toBe('1')
  })

  it('persists opt-in across mounts', async () => {
    localStorage.setItem('agentsprint.notifications', '1')
    FakeNotification.permission = 'granted'
    render(<Harness task={makeTask('TK-1')} />)
    expect(screen.getByTestId('enabled').textContent).toBe('true')
  })

  it('disables without revoking permission', async () => {
    FakeNotification.permission = 'granted'
    localStorage.setItem('agentsprint.notifications', '1')
    render(<Harness task={makeTask('TK-1')} />)
    expect(screen.getByTestId('enabled').textContent).toBe('true')
    fireEvent.click(screen.getByTestId('disable'))
    expect(screen.getByTestId('enabled').textContent).toBe('false')
    expect(localStorage.getItem('agentsprint.notifications')).toBe('0')
  })

  it('creates a notification only when enabled and focuses the task on click', async () => {
    FakeNotification.permission = 'granted'
    const onOpen = vi.fn()
    function NotifyHarness() {
      const { supported, enabled, request, disable, notifyReview } = useReviewNotifications()
      return (
        <div>
          <span data-testid="enabled">{String(enabled)}</span>
          <span>{String(supported)}</span>
          <button onClick={() => void request()} data-testid="request" />
          <button onClick={() => disable()} data-testid="disable" />
          <button onClick={() => notifyReview(makeTask('TK-9'), onOpen)} data-testid="notify" />
        </div>
      )
    }
    render(<NotifyHarness />)
    fireEvent.click(screen.getByTestId('request'))
    await waitFor(() => expect(screen.getByTestId('enabled').textContent).toBe('true'))

    fireEvent.click(screen.getByTestId('notify'))
    expect(constructed).toHaveLength(1)
    expect(constructed[0]!.title).toBe('TK-9 ready for review')
    expect(constructed[0]!.options.body).toBe('Task TK-9')

    constructed[0]!.instance.onclick!()
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'TK-9' }))
    expect(constructed[0]!.instance.close).toHaveBeenCalled()

    // Disabled → no new notification
    fireEvent.click(screen.getByTestId('disable'))
    fireEvent.click(screen.getByTestId('notify'))
    expect(constructed).toHaveLength(1)
  })

  it('degrades silently when Notification is unsupported', () => {
    Reflect.deleteProperty(window as unknown as object, 'Notification')
    render(<Harness task={makeTask('TK-1')} />)
    expect(screen.getByTestId('supported').textContent).toBe('false')
    expect(screen.getByTestId('enabled').textContent).toBe('false')
  })
})
