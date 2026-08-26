import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./hooks/useProjectEvents', () => ({ useProjectEvents: vi.fn() }))

vi.mock('./hooks/useReviewNotifications', () => ({
  useReviewNotifications: () => ({
    supported: false,
    enabled: false,
    request: vi.fn(),
    disable: vi.fn(),
    notifyReview: vi.fn(),
  }),
}))

const { boardState } = vi.hoisted(() => ({
  boardState: {
    rootDir: '/board/AgentSprint',
    config: { workflow: { statuses: ['Backlog', 'To Do', 'In Progress', 'Review', 'Done'] } },
    brand: {},
    tasks: [],
    sprints: [],
    activeSprint: null,
  },
}))

vi.mock('./api', async () => ({
  setProject: vi.fn(),
  api: {
    projects: vi.fn().mockResolvedValue([]),
    project: vi.fn().mockResolvedValue(boardState),
    gitCommitCounts: vi.fn().mockResolvedValue({}),
    templates: vi.fn().mockResolvedValue([]),
    setTaskStatus: vi.fn().mockResolvedValue({}),
    updateTask: vi.fn().mockResolvedValue({}),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue({}),
    updateSprint: vi.fn().mockResolvedValue({}),
    createSprint: vi.fn().mockResolvedValue({}),
    updateBrand: vi.fn().mockResolvedValue({}),
  },
}))

import App from './App'

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }) as unknown as MediaQueryList,
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('App keyboard shortcuts', () => {
  it('opens and closes the command palette with Ctrl/Cmd+K', async () => {
    render(<App />)
    // flush the initial board fetch so the app renders past its loading screen
    await act(async () => {})
    expect(screen.queryByTestId('command-palette')).toBeNull()

    // Ctrl+K opens
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(screen.getByTestId('command-palette')).toBeTruthy()

    // Cmd+K toggles closed
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.queryByTestId('command-palette')).toBeNull()
  })
})
