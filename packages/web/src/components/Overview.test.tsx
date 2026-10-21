import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectContext, Task } from '../types'

const apiMock = vi.hoisted(() => ({ context: vi.fn(), addHandoff: vi.fn(), setTaskStatus: vi.fn(), reviewTask: vi.fn() }))
vi.mock('../api', () => ({ api: apiMock }))

import { Overview } from './Overview'

const task = (over: Partial<Task>): Task =>
  ({
    id: 'TK-1',
    title: 'Build the API',
    status: 'In Progress',
    priority: 'high',
    assignee: 'developer',
    sprint: 1,
    estimate: 3,
    tags: [],
    dependencies: [],
    description: '',
    acceptanceCriteria: ['[x] one', 'two'],
    notes: '- [2026-10-20T10:00:00Z] (developer) skeleton ready',
    activity: [],
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    ...over,
  }) as Task

const context = (over: Partial<ProjectContext['snapshot']> = {}, journal: ProjectContext['journal'] = []): ProjectContext => ({
  markdown: '# Where we are',
  journal,
  snapshot: {
    sprint: { id: 1, goal: 'Ship the MVP', status: 'active', startedAt: null, endedAt: null },
    stats: { sprintId: 1, total: 4, backlog: 0, todo: 1, inProgress: 1, review: 1, done: 1, pointsTotal: 8, pointsDone: 2, completionPct: 25 },
    inProgress: [task({})],
    review: [task({ id: 'TK-2', title: 'Design', status: 'Review', activity: [{ at: '1', actor: 'ui-reviewer', type: 'review', detail: 'approved' }] })],
    next: [task({ id: 'TK-3', title: 'Tests', status: 'To Do' })],
    blocked: [],
    recentlyDone: [],
    lastHandoff: null,
    ...over,
  },
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Overview', () => {
  it('shows sprint progress, work in flight, review verdicts and the next task', async () => {
    apiMock.context.mockResolvedValue(context())
    const onOpen = vi.fn()
    render(<Overview version={1} onOpenTask={onOpen} />)
    expect(await screen.findByText('Ship the MVP')).toBeTruthy()
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('skeleton ready')).toBeTruthy()
    expect(screen.getByTestId('review-badge').textContent).toContain('Approved')
    fireEvent.click(screen.getByText('Tests'))
    expect(onOpen).toHaveBeenCalledWith('TK-3')
    expect(screen.getByText(/No handoff yet/)).toBeTruthy()
  })

  it('renders the last handoff and earlier sessions', async () => {
    apiMock.context.mockResolvedValue(
      context({}, [
        { at: '2026-10-20T12:00:00Z', author: 'claude', summary: 'Finished the API', done: [], next: ['Start TK-3'], blockers: ['CI is red'] },
        { at: '2026-10-19T12:00:00Z', author: 'ana', summary: 'Kickoff', done: [], next: [], blockers: [] },
      ]),
    )
    render(<Overview version={1} onOpenTask={vi.fn()} />)
    const card = await screen.findByTestId('last-handoff')
    expect(card.textContent).toContain('Finished the API')
    expect(card.textContent).toContain('Start TK-3')
    expect(card.textContent).toContain('CI is red')
    expect(screen.getByText(/Earlier sessions/)).toBeTruthy()
  })

  it('writes a handoff from the form and reloads the brief', async () => {
    apiMock.context.mockResolvedValue(context({ sprint: null, stats: null }))
    apiMock.addHandoff.mockResolvedValue({})
    render(<Overview version={1} onOpenTask={vi.fn()} />)
    expect(await screen.findByText('No active sprint')).toBeTruthy()
    fireEvent.click(screen.getByTestId('write-handoff'))
    fireEvent.change(screen.getByLabelText('What happened this session'), { target: { value: 'Planned sprint 2' } })
    fireEvent.change(screen.getByLabelText('Next steps'), { target: { value: '- TK-4 first\nTK-5 then' } })
    fireEvent.click(screen.getByText('Save handoff'))
    await waitFor(() => expect(apiMock.addHandoff).toHaveBeenCalled())
    expect(apiMock.addHandoff.mock.calls[0]![0]).toMatchObject({ summary: 'Planned sprint 2', next: ['TK-4 first', 'TK-5 then'] })
    await waitFor(() => expect(apiMock.context).toHaveBeenCalledTimes(2))
  })

  it('reports a failed load', async () => {
    apiMock.context.mockRejectedValue(new Error('boom'))
    render(<Overview version={1} onOpenTask={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('boom')
  })

  describe('human review decisions', () => {
    const approved = (at = '2026-10-21T10:00:00Z') => ({ at, actor: 'ui-reviewer', type: 'review', detail: 'approved' }) as const
    const inReview = (id: string, activity: Task['activity']) => task({ id, title: `Work ${id}`, status: 'Review', activity })

    it('marks a task in review done from its row without opening it', async () => {
      apiMock.context.mockResolvedValueOnce(context()).mockResolvedValue(context({ review: [] }))
      apiMock.setTaskStatus.mockResolvedValue({})
      const onOpen = vi.fn()
      render(<Overview version={1} onOpenTask={onOpen} />)
      const button = await screen.findByRole('button', { name: 'Mark done: TK-2' })
      fireEvent.click(button)
      await waitFor(() => expect(apiMock.setTaskStatus).toHaveBeenCalledWith('TK-2', 'Done'))
      await waitFor(() => expect(apiMock.context).toHaveBeenCalledTimes(2))
      expect(screen.getByTestId('review-message').textContent).toBe('TK-2 moved to Done.')
      expect(screen.getByText('No work is waiting for review.')).toBeTruthy()
      expect(onOpen).not.toHaveBeenCalled()
    })

    it('reports a refused move inline', async () => {
      apiMock.context.mockResolvedValue(context())
      apiMock.setTaskStatus.mockRejectedValue(new Error('locked by developer'))
      render(<Overview version={1} onOpenTask={vi.fn()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Mark done: TK-2' }))
      await waitFor(() => expect(screen.getByTestId('review-message').textContent).toBe('Could not move TK-2: locked by developer'))
    })

    it('requests changes with at least one finding, as the user reviewer', async () => {
      apiMock.context.mockResolvedValue(context())
      apiMock.reviewTask.mockResolvedValue(task({ id: 'TK-2', status: 'In Progress' }))
      render(<Overview version={1} onOpenTask={vi.fn()} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Request changes: TK-2' }))
      const dialog = await screen.findByRole('dialog', { name: 'Request changes' })
      fireEvent.click(screen.getByTestId('request-changes-submit'))
      expect((await screen.findByRole('alert')).textContent).toContain('at least one finding')
      expect(apiMock.reviewTask).not.toHaveBeenCalled()
      fireEvent.change(screen.getByLabelText('Findings'), { target: { value: '- Empty state has no action\n\nFocus is lost on close' } })
      fireEvent.change(screen.getByLabelText(/Summary/), { target: { value: 'Two gaps' } })
      expect(dialog.textContent).toContain('2 findings')
      fireEvent.click(screen.getByTestId('request-changes-submit'))
      await waitFor(() =>
        expect(apiMock.reviewTask).toHaveBeenCalledWith('TK-2', {
          verdict: 'changes',
          reviewer: 'user',
          summary: 'Two gaps',
          findings: ['Empty state has no action', 'Focus is lost on close'],
        }),
      )
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(screen.getByTestId('review-message').textContent).toBe('TK-2 went back to In Progress with your findings.')
      expect(apiMock.context).toHaveBeenCalledTimes(2)
    })

    it('closes only the current approvals after confirming, and the count follows', async () => {
      const review = [
        inReview('TK-2', [approved()]),
        inReview('TK-4', [approved(), { at: '2026-10-21T11:00:00Z', actor: 'developer', type: 'update', detail: 'updated description' }]),
        inReview('TK-5', []),
        inReview('TK-6', [approved()]),
      ]
      apiMock.context
        .mockResolvedValueOnce(context({ review }))
        .mockResolvedValue(context({ review: [review[1]!, review[2]!] }))
      apiMock.setTaskStatus.mockResolvedValue({})
      render(<Overview version={1} onOpenTask={vi.fn()} />)
      const open = await screen.findByTestId('close-approved')
      expect(open.textContent).toBe('Close approved (2)')
      fireEvent.click(open)
      const dialog = await screen.findByRole('dialog', { name: 'Close 2 approved tasks?' })
      expect(dialog.textContent).toContain('Work TK-2')
      expect(dialog.textContent).toContain('Work TK-6')
      expect(dialog.textContent).not.toContain('Work TK-4')
      expect(apiMock.setTaskStatus).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('close-approved-confirm'))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(apiMock.setTaskStatus.mock.calls).toEqual([
        ['TK-2', 'Done'],
        ['TK-6', 'Done'],
      ])
      expect(screen.getByTestId('review-message').textContent).toBe('2 tasks moved to Done.')
      expect(screen.queryByTestId('close-approved')).toBeNull()
    })

    it('keeps the tasks that failed to close for a retry', async () => {
      apiMock.context.mockResolvedValue(context({ review: [inReview('TK-2', [approved()]), inReview('TK-6', [approved()])] }))
      apiMock.setTaskStatus.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('locked by tester'))
      render(<Overview version={1} onOpenTask={vi.fn()} />)
      fireEvent.click(await screen.findByTestId('close-approved'))
      fireEvent.click(await screen.findByTestId('close-approved-confirm'))
      const dialog = await screen.findByRole('dialog', { name: '1 task could not be closed' })
      expect(dialog.textContent).toContain('locked by tester')
      expect(dialog.textContent).not.toContain('Work TK-2')
      expect(screen.getByTestId('close-approved-confirm').textContent).toBe('Retry 1')
      // A warning in the title, not the green all-done mark.
      expect(dialog.querySelector('[data-testid="close-approved-warning"]')).not.toBeNull()
    })

    it('after a partial failure keeps focus on Retry inside the open dialog and says what happened', async () => {
      apiMock.context.mockResolvedValue(context({ review: [inReview('TK-2', [approved()]), inReview('TK-6', [approved()])] }))
      apiMock.setTaskStatus.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('locked by tester'))
      render(<Overview version={1} onOpenTask={vi.fn()} />)
      fireEvent.click(await screen.findByTestId('close-approved'))
      // Even a brief jump to the heading behind the scrim loses the user's place.
      let headingFocused = false
      screen.getByRole('heading', { name: 'Waiting for review' }).addEventListener('focus', () => (headingFocused = true))
      fireEvent.click(await screen.findByTestId('close-approved-confirm'))
      await screen.findByRole('dialog', { name: '1 task could not be closed' })
      const retry = screen.getByTestId('close-approved-confirm')
      await waitFor(() => expect(document.activeElement).toBe(retry))
      // Give a stray heading refocus (requestAnimationFrame) time to fire: it must not.
      await new Promise((r) => setTimeout(r, 60))
      expect(document.activeElement).toBe(retry)
      expect(headingFocused).toBe(false)
      expect(screen.getByTestId('close-approved-result').textContent).toBe('1 moved to Done, 1 could not be closed. TK-6: locked by tester')
    })
  })
})
