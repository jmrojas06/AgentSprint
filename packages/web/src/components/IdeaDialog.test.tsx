import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildIdeaToMvpPrompt } from '@jmrojas06/agentsprint-core'
import type { ProjectContext, Task } from '../types'

const apiMock = vi.hoisted(() => ({ context: vi.fn(), addHandoff: vi.fn(), setTaskStatus: vi.fn(), reviewTask: vi.fn(), ideaPrompt: vi.fn() }))
vi.mock('../api', () => ({ api: apiMock }))

// The server renders the prompt with the shared core builder (POST /api/prompts/idea-to-mvp).
beforeEach(() => {
  apiMock.ideaPrompt.mockImplementation(async (input: { idea: string; stack?: string; scope?: string }) => ({
    text: buildIdeaToMvpPrompt({ ...input, projectName: 'Groceries', agents: [], hasBrand: false }),
  }))
})

import { IdeaDialog } from './IdeaDialog'
import { CommandPalette } from './CommandPalette'
import { Overview } from './Overview'
import { useEscapeLayer } from '../hooks/useDialogFocus'

const task = (id: string, over: Partial<Task> = {}): Task =>
  ({
    id,
    title: `Task ${id}`,
    status: 'To Do',
    priority: 'medium',
    assignee: 'developer',
    sprint: 1,
    estimate: 2,
    tags: [],
    dependencies: [],
    description: '',
    acceptanceCriteria: [],
    notes: '',
    activity: [],
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    ...over,
  }) as Task

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

const frame = () =>
  act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })

async function openDialog(props: Partial<Parameters<typeof IdeaDialog>[0]> = {}) {
  const trigger = document.createElement('button')
  trigger.textContent = 'Start from an idea'
  document.body.appendChild(trigger)
  trigger.focus()
  const onClose = vi.fn()
  const onOpenTask = vi.fn()
  const utils = render(<IdeaDialog tasks={[]} onClose={onClose} onOpenTask={onOpenTask} {...props} />)
  await frame()
  return { ...utils, trigger, onClose, onOpenTask }
}

describe('IdeaDialog text', () => {
  it('asks the server for the full prompt as the user types and shows it with its CLI variant', async () => {
    await openDialog()
    fireEvent.change(screen.getByTestId('idea-input'), { target: { value: 'A shared shopping list\nfor flatmates' } })
    fireEvent.change(screen.getByTestId('idea-stack'), { target: { value: 'Vite + React' } })
    fireEvent.change(screen.getByTestId('idea-scope'), { target: { value: 'one list' } })
    await waitFor(() => expect(screen.getByTestId('idea-command').textContent).toContain('**Scope:** one list'))
    expect(apiMock.ideaPrompt).toHaveBeenLastCalledWith({ idea: 'A shared shopping list\nfor flatmates', stack: 'Vite + React', scope: 'one list' })
    const prompt = screen.getByTestId('idea-command').textContent!
    expect(prompt).toContain('## The idea\n\nA shared shopping list\nfor flatmates\n')
    expect(prompt).toContain('**Preferred stack:** Vite + React')
    expect(prompt).not.toContain('/mcp__agentsprint__idea-to-mvp')
    expect(screen.getByTestId('idea-cli').textContent).toBe(`claude '${prompt}'`)
  })

  it('copies the full prompt with the whole idea verbatim: several words, quotes and newlines', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await openDialog()
    expect((screen.getByTestId('idea-copy') as HTMLButtonElement).disabled).toBe(true)
    const idea = 'A shared "shopping" list\nfor flatmates who don\'t talk: $5 `stripe`'
    fireEvent.change(screen.getByTestId('idea-input'), { target: { value: idea } })
    await act(async () => fireEvent.click(screen.getByTestId('idea-copy')))
    const copied = writeText.mock.lastCall![0] as string
    expect(copied).toContain(`## The idea\n\n${idea}\n`)
    expect(copied).toContain('task_create_batch')
    expect(screen.getByTestId('idea-copy').textContent).toContain('Copied')
    await act(async () => fireEvent.click(screen.getByTestId('idea-copy-cli')))
    expect(writeText).toHaveBeenLastCalledWith(`claude '${copied.replace(/'/g, `'\\''`)}'`)
    writeText.mockClear()
    await act(async () => fireEvent.keyDown(screen.getByTestId('idea-input'), { key: 'Enter', ctrlKey: true }))
    expect(writeText).toHaveBeenCalledWith(copied)
  })

  it('says so when the prompt cannot be built', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    apiMock.ideaPrompt.mockRejectedValue(new Error('Request failed: 500'))
    await openDialog()
    fireEvent.change(screen.getByTestId('idea-input'), { target: { value: 'Habit tracker' } })
    await act(async () => fireEvent.click(screen.getByTestId('idea-copy')))
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('Request failed: 500')
  })

  it('shows "Building" before the first prompt, and hides a stale prompt behind an error', async () => {
    await openDialog()
    fireEvent.change(screen.getByTestId('idea-input'), { target: { value: 'Habit tracker' } })
    // Debounce pending: the idea is written, so no "write the idea" hint.
    expect(screen.getByTestId('idea-command').textContent).toContain('Building the prompt…')
    await waitFor(() => expect(screen.getByTestId('idea-command').textContent).toContain('Habit tracker'))
    // Now the server fails for a different idea: the old prompt must not stay as if it were current.
    apiMock.ideaPrompt.mockRejectedValue(new Error('Request failed: 500'))
    fireEvent.change(screen.getByTestId('idea-input'), { target: { value: 'Recipe box' } })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Request failed: 500'))
    expect(screen.getByTestId('idea-command').textContent).not.toContain('Habit tracker')
    expect(screen.getByTestId('idea-command').textContent).toContain('see the message above')
    // The message comes before the prompts in reading order.
    expect(screen.getByRole('alert').compareDocumentPosition(screen.getByTestId('idea-command')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('says what happens next and links the docs', async () => {
    await openDialog()
    const dialog = screen.getByRole('dialog', { name: 'Start from an idea' })
    expect(dialog.textContent).toContain('paste it into Claude Code as a message')
    expect(dialog.textContent).toContain('plan of linked tasks that appears on this board live')
    const link = screen.getByRole('link', { name: /How it works/ }) as HTMLAnchorElement
    expect(link.href).toContain('docs/agents.md#idea--mvp')
    expect(link.target).toBe('_blank')
  })

  it('lists the tasks that appear on the board while it is open', async () => {
    const { rerender, onClose, onOpenTask } = await openDialog({ tasks: [task('TK-1')] })
    expect(screen.getByTestId('idea-created').textContent).toBe('')
    rerender(<IdeaDialog tasks={[task('TK-1'), task('TK-2', { title: 'Walking skeleton' }), task('TK-3')]} onClose={onClose} onOpenTask={onOpenTask} />)
    const created = screen.getByTestId('idea-created')
    expect(created.textContent).toContain('2 new tasks')
    expect(created.textContent).toContain('Walking skeleton')
    expect(created.textContent).not.toContain('TK-1')
    fireEvent.click(screen.getByText('Walking skeleton'))
    expect(onOpenTask).toHaveBeenCalledWith('TK-2')
  })
})

describe('IdeaDialog focus', () => {
  it('puts focus in the idea field and keeps Tab inside', async () => {
    await openDialog()
    const dialog = screen.getByTestId('idea-dialog')
    expect(document.activeElement).toBe(screen.getByTestId('idea-input'))
    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape and gives focus back to the trigger', async () => {
    const { trigger, onClose, unmount } = await openDialog()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    unmount()
    expect(document.activeElement).toBe(trigger)
  })

  it('leaves Escape to a surface stacked on top of it', async () => {
    const onClose = vi.fn()
    const onTopClose = vi.fn()
    function OnTop() {
      useEscapeLayer(onTopClose)
      return null
    }
    const { rerender } = render(<IdeaDialog tasks={[]} onClose={onClose} onOpenTask={vi.fn()} />)
    await frame()
    rerender(
      <>
        <IdeaDialog tasks={[]} onClose={onClose} onOpenTask={vi.fn()} />
        <OnTop />
      </>,
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onTopClose).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Idea entry points', () => {
  it('is a command in the palette', () => {
    const onStartIdea = vi.fn()
    const onClose = vi.fn()
    render(
      <CommandPalette
        open
        tasks={[]}
        sprints={[]}
        activeSprintId={null}
        onClose={onClose}
        onCreateTask={vi.fn()}
        onOpenTask={vi.fn()}
        onActivateSprint={vi.fn()}
        onClearFilters={vi.fn()}
        onStartIdea={onStartIdea}
      />,
    )
    fireEvent.click(screen.getByText('Start from an idea'))
    expect(onClose).toHaveBeenCalled()
    expect(onStartIdea).toHaveBeenCalled()
  })

  const context = (over: Partial<ProjectContext['snapshot']>): ProjectContext => ({
    markdown: '',
    journal: [],
    snapshot: {
      sprint: { id: 1, goal: 'Ship', status: 'active', startedAt: null, endedAt: null },
      stats: { sprintId: 1, total: 1, backlog: 0, todo: 0, inProgress: 0, review: 0, done: 1, pointsTotal: 2, pointsDone: 2, completionPct: 100 },
      inProgress: [],
      review: [],
      next: [],
      blocked: [],
      recentlyDone: [],
      lastHandoff: null,
      ...over,
    } as ProjectContext['snapshot'],
  })

  it('is offered by the Overview when no sprint is active', async () => {
    apiMock.context.mockResolvedValue(context({ sprint: null, stats: null, next: [task('TK-9')] } as Partial<ProjectContext['snapshot']>))
    const onStartIdea = vi.fn()
    render(<Overview version={1} onOpenTask={vi.fn()} onStartIdea={onStartIdea} />)
    fireEvent.click(await screen.findByTestId('overview-start-idea'))
    expect(onStartIdea).toHaveBeenCalled()
    expect(screen.getByTestId('overview-idea').textContent).toContain('Turn an idea into a sprint')
  })

  it('is offered by the Overview when nothing is pending in the active sprint', async () => {
    apiMock.context.mockResolvedValue(context({}))
    render(<Overview version={1} onOpenTask={vi.fn()} onStartIdea={vi.fn()} />)
    expect((await screen.findByTestId('overview-idea')).textContent).toContain('Nothing left to start')
  })

  it('stays out of the way while the active sprint has work', async () => {
    apiMock.context.mockResolvedValue(context({ next: [task('TK-4')] }))
    render(<Overview version={1} onOpenTask={vi.fn()} onStartIdea={vi.fn()} />)
    await screen.findByTestId('overview')
    expect(screen.queryByTestId('overview-idea')).toBeNull()
  })
})
