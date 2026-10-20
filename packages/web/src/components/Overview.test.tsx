import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectContext, Task } from '../types'

const apiMock = vi.hoisted(() => ({ context: vi.fn(), addHandoff: vi.fn() }))
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
})
