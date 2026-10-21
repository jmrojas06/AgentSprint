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
  getStoredToken: vi.fn().mockReturnValue(null),
  setStoredToken: vi.fn(),
  clearStoredToken: vi.fn(),
  TOKEN_KEY: 'agentsprint-token',
  setProject: vi.fn(),
  setTokenPrompt: vi.fn().mockReturnValue(() => {}),
  api: {
    projects: vi.fn().mockResolvedValue([]),
    health: vi.fn().mockResolvedValue({ ok: true }),
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

describe('App refused mutations', () => {
  it('keeps the board on screen when a move is refused', async () => {
    const { api } = await import('./api')
    const task = {
      id: 'TK-45',
      title: 'Probe',
      description: '',
      status: 'In Progress',
      priority: 'medium',
      assignee: 'developer',
      sprint: null,
      estimate: 1,
      tags: [],
      dependencies: [],
      acceptanceCriteria: [],
    }
    vi.mocked(api.project).mockResolvedValue({ ...boardState, tasks: [task] } as never)
    vi.mocked(api.setTaskStatus).mockRejectedValueOnce(new Error('Unauthorized'))
    window.history.replaceState(null, '', '/?view=kanban')
    try {
      render(<App />)
      await act(async () => {})
      await act(async () => {
        fireEvent.click(screen.getByTitle('Move to Review'))
      })

      expect(screen.queryByText('Could not load the board')).toBeNull()
      expect(screen.getByTestId('view-toggle')).toBeTruthy()
      expect(screen.getByRole('alert').textContent).toMatch(/Unauthorized/)
    } finally {
      vi.mocked(api.project).mockResolvedValue(boardState as never)
      window.history.replaceState(null, '', '/')
    }
  })
})

describe('App token handling', () => {
  it('shows "Enter token" after one Cancel when the project list is refused (--token-all)', async () => {
    const { api } = await import('./api')
    vi.mocked(api.project).mockClear()
    // What request() throws once the user cancels the prompt.
    vi.mocked(api.projects).mockRejectedValueOnce(Object.assign(new Error('Unauthorized'), { status: 401 }))
    render(<App />)
    await act(async () => {})
    expect(screen.getByTestId('token-retry')).toBeTruthy()
    expect(api.project).not.toHaveBeenCalled()
  })

  it('below lg, moves Clear token from the header into the side drawer so the title keeps its room', async () => {
    const { getStoredToken, clearStoredToken } = await import('./api')
    vi.mocked(getStoredToken).mockReturnValueOnce('saved')
    render(<App />)
    await act(async () => {})
    expect(screen.queryByTestId('header-token-clear')).toBeNull()
    fireEvent.click(screen.getByTestId('panel-toggle'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Clear saved token' }))
    })
    expect(clearStoredToken).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Clear saved token' })).toBeNull()
  })
})

describe('App server build', () => {
  it('shows the version and commit in the side panel and the palette, with builtAt as tooltip', async () => {
    const { api } = await import('./api')
    vi.mocked(api.health).mockResolvedValueOnce({ ok: true, version: '0.1.0', commit: 'c4b4338', builtAt: '2026-10-21T20:00:00Z' })
    render(<App />)
    await act(async () => {})
    fireEvent.click(screen.getByTestId('panel-toggle'))
    const inPanel = screen.getByTestId('side-drawer').querySelector('[data-testid=server-build]')
    expect(inPanel?.textContent).toBe('v0.1.0 · c4b4338')
    expect(inPanel?.getAttribute('title')).toMatch(/2026-10-21T20:00:00Z/)

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    const inPalette = screen.getByTestId('command-palette').querySelector('[data-testid=server-build]')
    expect(inPalette?.textContent).toBe('v0.1.0 · c4b4338')
    expect(inPalette?.closest('button')).toBeNull()
  })

  it('shows only the version when the build has no commit', async () => {
    const { api } = await import('./api')
    vi.mocked(api.health).mockResolvedValueOnce({ ok: true, version: '0.1.0', commit: null, builtAt: null })
    render(<App />)
    await act(async () => {})
    fireEvent.click(screen.getByTestId('panel-toggle'))
    const el = screen.getByTestId('server-build')
    expect(el.textContent).toBe('v0.1.0')
    expect(el.hasAttribute('title')).toBe(false)
  })
})

describe('App parse warnings', () => {
  it('shows each full warning with a neutral hint', async () => {
    const { api } = await import('./api')
    const warning = 'TK-9.md — field `assignee`: Invalid enum value. If another AgentSprint wrote this file, this one may be older than it — upgrade or rebuild it.'
    vi.mocked(api.project).mockResolvedValueOnce({ ...boardState, warnings: [warning] } as never)
    render(<App />)
    await act(async () => {})
    expect(screen.getByText(warning)).toBeTruthy()
    expect(screen.getByText('Each file says why it was skipped.')).toBeTruthy()
    expect(screen.queryByText(/quote titles/)).toBeNull()
  })
})
