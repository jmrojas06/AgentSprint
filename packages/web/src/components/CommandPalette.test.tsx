import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Sprint, Task } from '../types'
import { CommandPalette } from './CommandPalette'

afterEach(() => cleanup())

const TASKS = [
  makeTask('TK-1', 'Command palette'),
  makeTask('TK-2', 'Export board'),
  makeTask('TK-3', 'Dark theme toggle'),
]

function makeTask(id: string, title: string): Task {
  return {
    id,
    title,
    status: 'To Do',
    sprint: null,
    priority: 'medium',
    assignee: 'human',
    estimate: 2,
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

const SPRINTS: Sprint[] = [
  { id: 1, goal: 'First sprint', status: 'closed' },
  { id: 2, goal: 'UX polish', status: 'active' },
  { id: 3, goal: 'Next work', status: 'planned' },
] as Sprint[]

interface Handlers {
  onClose?: ReturnType<typeof vi.fn>
  onCreateTask?: ReturnType<typeof vi.fn>
  onOpenTask?: ReturnType<typeof vi.fn>
  onActivateSprint?: ReturnType<typeof vi.fn>
  onClearFilters?: ReturnType<typeof vi.fn>
}

function renderPalette(props: { open?: boolean; activeSprintId?: number | null; query?: never } & Handlers = {}) {
  const handlers = {
    onClose: props.onClose ?? vi.fn(),
    onCreateTask: props.onCreateTask ?? vi.fn(),
    onOpenTask: props.onOpenTask ?? vi.fn(),
    onActivateSprint: props.onActivateSprint ?? vi.fn(),
    onClearFilters: props.onClearFilters ?? vi.fn(),
  }
  const utils = render(
    <CommandPalette
      open={props.open ?? true}
      tasks={TASKS}
      sprints={SPRINTS}
      activeSprintId={props.activeSprintId ?? 2}
      onClose={handlers.onClose}
      onCreateTask={handlers.onCreateTask}
      onOpenTask={handlers.onOpenTask}
      onActivateSprint={handlers.onActivateSprint}
      onClearFilters={handlers.onClearFilters}
    />,
  )
  return { ...utils, ...handlers }
}

function items() {
  return screen.getAllByTestId('command-item')
}

function type(query: string) {
  fireEvent.change(screen.getByPlaceholderText(/search tasks/i), { target: { value: query } })
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    renderPalette({ open: false })
    expect(screen.queryByTestId('command-palette')).toBeNull()
  })

  it('renders actions and task list when open', () => {
    renderPalette()
    expect(screen.getByText('Create new task')).toBeTruthy()
    expect(screen.getByText('Clear all filters')).toBeTruthy()
    expect(screen.getByText('TK-1 — Command palette')).toBeTruthy()
    expect(items().length).toBeGreaterThan(4)
  })

  it('fuzzy-filters tasks by id and title as you type', () => {
    renderPalette()
    type('tk-2')
    const visible = items().map((el) => el.textContent)
    expect(visible).toHaveLength(1)
    expect(visible[0]).toContain('TK-2')
    type('palette')
    expect(items().map((el) => el.textContent)[0]).toContain('TK-1')
    type('zzz-no-match')
    expect(screen.getByText(/no matching/i)).toBeTruthy()
  })

  it('navigates with arrow keys and runs the selected item with Enter', () => {
    const onOpenTask = vi.fn()
    renderPalette({ onOpenTask })
    const input = screen.getByPlaceholderText(/search tasks/i)

    // initial selection is the first action
    expect(items()[0]!.getAttribute('data-active')).toBe('true')

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(items()[1]!.getAttribute('data-active')).toBe('true')

    // ArrowUp goes back
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(items()[0]!.getAttribute('data-active')).toBe('true')

    // Enter runs "Create new task"
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('Create new task').closest('[data-active="true"]')).toBeTruthy()

    // jump to a task via search + Enter
    type('export')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'TK-2' }))
  })

  it('closes on Escape without running anything', () => {
    const onClose = vi.fn()
    const onCreateTask = vi.fn()
    renderPalette({ onClose, onCreateTask })
    const input = screen.getByPlaceholderText(/search tasks/i)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCreateTask).not.toHaveBeenCalled()
  })

  it('runs create-task and clear-filters actions on click', () => {
    const onCreateTask = vi.fn()
    const onClearFilters = vi.fn()
    renderPalette({ onCreateTask, onClearFilters })
    fireEvent.click(screen.getByText('Create new task'))
    fireEvent.click(screen.getByText('Clear all filters'))
    expect(onCreateTask).toHaveBeenCalledTimes(1)
    expect(onClearFilters).toHaveBeenCalledTimes(1)
  })

  it('offers activating non-active sprints and calls back', () => {
    const onActivateSprint = vi.fn()
    renderPalette({ onActivateSprint })
    const labels = items().map((el) => el.textContent!)
    expect(labels.some((l) => l.includes('Activate sprint 3'))).toBe(true)
    expect(labels.some((l) => l.includes('Activate sprint 2'))).toBe(false)

    fireEvent.click(screen.getByText('Activate sprint 3'))
    expect(onActivateSprint).toHaveBeenCalledWith(3)
  })

  it('clicking a task result opens that task and closes the palette', () => {
    const onOpenTask = vi.fn()
    const onClose = vi.fn()
    renderPalette({ onOpenTask, onClose })
    fireEvent.click(screen.getByText('TK-3 — Dark theme toggle'))
    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: 'TK-3' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
