import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../types'
import { ListView } from './ListView'

afterEach(() => cleanup())

function makeTask(overrides: Partial<Task> & { id: string; title: string }): Task {
  return {
    status: 'To Do',
    sprint: null,
    priority: 'medium',
    assignee: 'scrum-master',
    estimate: 2,
    tags: [],
    dependencies: [],
    acceptanceCriteria: [],
    description: '',
    notes: '',
    activity: [],
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  }
}

const TASKS: Task[] = [
  makeTask({ id: 'TK-2', title: 'Export board', priority: 'high', sprint: 1, updatedAt: '2026-08-20T00:00:00.000Z' }),
  makeTask({
    id: 'TK-1',
    title: 'Command palette',
    assignee: 'dev',
    acceptanceCriteria: ['[x] one', 'two', '[x] three'],
  }),
  makeTask({ id: 'TK-3', title: 'Dark theme toggle', status: 'Done' }),
]

interface Handlers {
  onSortBy?: ReturnType<typeof vi.fn>
  onSortDir?: ReturnType<typeof vi.fn>
  onOpen?: ReturnType<typeof vi.fn>
}

function renderList(props: { tasks?: Task[]; sortBy?: Parameters<typeof ListView>[0]['sortBy']; sortDir?: 'asc' | 'desc' } & Handlers = {}) {
  const handlers = {
    onSortBy: props.onSortBy ?? vi.fn(),
    onSortDir: props.onSortDir ?? vi.fn(),
    onOpen: props.onOpen ?? vi.fn(),
  }
  const utils = render(
    <ListView
      tasks={props.tasks ?? TASKS}
      sortBy={props.sortBy ?? 'id'}
      sortDir={props.sortDir ?? 'asc'}
      onSortBy={handlers.onSortBy}
      onSortDir={handlers.onSortDir}
      onOpen={handlers.onOpen}
    />,
  )
  return { ...utils, ...handlers }
}

describe('ListView', () => {
  it('renders a row per task with all columns', () => {
    renderList()
    const rows = screen.getAllByTestId('list-row')
    expect(rows).toHaveLength(TASKS.length)
    const first = rows[0]!
    expect(within(first).getByText('TK-1')).toBeTruthy()
    expect(within(first).getByText('Command palette')).toBeTruthy()
    expect(within(first).getByText('dev')).toBeTruthy()
    expect(within(first).getByText((_, el) => el?.textContent === '2/3' && el.tagName === 'TD')).toBeTruthy()
  })

  it('sorts by the active column and direction', () => {
    const { rerender } = renderList({ sortBy: 'id', sortDir: 'asc' })
    let ids = screen.getAllByTestId('list-row').map((r) => within(r).getByText(/TK-\d/).textContent)
    expect(ids).toEqual(['TK-1', 'TK-2', 'TK-3'])

    rerender(
      <ListView
        tasks={TASKS}
        sortBy="id"
        sortDir="desc"
        onSortBy={vi.fn()}
        onSortDir={vi.fn()}
        onOpen={vi.fn()}
      />,
    )
    ids = screen.getAllByTestId('list-row').map((r) => within(r).getByText(/TK-\d/).textContent)
    expect(ids).toEqual(['TK-3', 'TK-2', 'TK-1'])
  })

  it('marks the sorted header and toggles direction on click of the same column', () => {
    const onSortDir = vi.fn()
    const { container } = renderList({ sortBy: 'id', sortDir: 'asc', onSortDir })
    const idHeader = screen.getByRole('button', { name: /ID/i })
    expect(idHeader.className).toContain('text-indigo-400')
    fireEvent.click(idHeader)
    expect(onSortDir).toHaveBeenCalledWith('desc')
    void container
  })

  it('requests a new column (desc) when clicking an unsorted column', () => {
    const onSortBy = vi.fn()
    const onSortDir = vi.fn()
    renderList({ sortBy: 'id', onSortBy, onSortDir })
    fireEvent.click(screen.getByRole('button', { name: /^priority/i }))
    expect(onSortBy).toHaveBeenCalledWith('priority')
    expect(onSortDir).toHaveBeenCalledWith('desc')
  })

  it('opens the task when clicking a row', () => {
    const onOpen = vi.fn()
    renderList({ onOpen })
    fireEvent.click(screen.getAllByTestId('list-row')[1]!)
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'TK-2' }))
  })

  it('shows an empty state when no tasks match filters', () => {
    renderList({ tasks: [] })
    expect(screen.getByTestId('list-empty')).toBeTruthy()
    expect(screen.queryAllByTestId('list-row')).toHaveLength(0)
  })

  it('respects whatever filtered task list it receives', () => {
    renderList({ tasks: TASKS.filter((t) => t.assignee === 'scrum-master') })
    expect(screen.getAllByTestId('list-row')).toHaveLength(2)
  })
})
