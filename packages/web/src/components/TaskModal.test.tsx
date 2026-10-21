import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import type { Task } from '../types'

const apiMock = vi.hoisted(() => ({
  getTaskCommits: vi.fn(),
  getTaskSpec: vi.fn(),
  setTaskChecklist: vi.fn(),
  setTaskStatus: vi.fn(),
  reviewTask: vi.fn(),
}))
vi.mock('../api', () => ({ api: apiMock }))

import { TaskModal, writeErrorMessage } from './TaskModal'
import { useDialogFocus } from '../hooks/useDialogFocus'

const task = (over: Partial<Task> = {}): Task =>
  ({
    id: 'TK-7',
    title: 'Review gate UI',
    status: 'Review',
    priority: 'high',
    assignee: 'designer',
    sprint: 1,
    estimate: 3,
    tags: [],
    dependencies: [],
    description: '',
    acceptanceCriteria: [],
    notes: '- [2026-10-21T10:00:00Z] (ui-reviewer) **Review: approved** — Checked at 375px and 1440px in both themes',
    activity: [{ at: '2026-10-21T10:00:00Z', actor: 'ui-reviewer', type: 'review', detail: 'approved' }],
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-21T10:00:00Z',
    ...over,
  }) as Task

const renderModal = (t: Task, onReviewed = vi.fn()) => {
  render(<TaskModal task={t} allTasks={[t]} sprints={[]} statuses={['To Do', 'In Progress', 'Review', 'Done']} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} onReviewed={onReviewed} />)
  return onReviewed
}

beforeEach(() => {
  apiMock.getTaskCommits.mockResolvedValue({ id: 'TK-7', gitAvailable: true, commits: [], branches: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TaskModal review decisions', () => {
  it('shows the latest verdict: who, when and the summary', () => {
    renderModal(task())
    const panel = screen.getByTestId('review-panel')
    expect(panel.textContent).toContain('Approved')
    expect(screen.getByTestId('review-verdict-meta').textContent).toContain('ui-reviewer')
    expect(panel.querySelector('time')?.getAttribute('dateTime')).toBe('2026-10-21T10:00:00Z')
    expect(panel.textContent).toContain('Checked at 375px and 1440px in both themes')
  })

  it('has no review panel outside Review', () => {
    renderModal(task({ status: 'In Progress' }))
    expect(screen.queryByTestId('review-panel')).toBeNull()
  })

  it('marks the task done', async () => {
    const done = task({ status: 'Done' })
    apiMock.setTaskStatus.mockResolvedValue(done)
    const onReviewed = renderModal(task())
    fireEvent.click(screen.getByTestId('mark-done'))
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith(done))
    expect(apiMock.setTaskStatus).toHaveBeenCalledWith('TK-7', 'Done')
  })

  it('requests changes with findings from a dialog over the modal', async () => {
    const back = task({ status: 'In Progress' })
    apiMock.reviewTask.mockResolvedValue(back)
    const onReviewed = renderModal(task())
    fireEvent.click(screen.getByTestId('request-changes'))
    await screen.findByRole('dialog', { name: 'Request changes' })
    fireEvent.change(screen.getByLabelText('Findings'), { target: { value: 'Contrast of the hint is 4.2:1' } })
    fireEvent.click(screen.getByTestId('request-changes-submit'))
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith(back))
    expect(apiMock.reviewTask).toHaveBeenCalledWith('TK-7', { verdict: 'changes', reviewer: 'user', summary: undefined, findings: ['Contrast of the hint is 4.2:1'] })
  })

  it('Escape closes the request-changes dialog first, not the modal under it', async () => {
    const onClose = vi.fn()
    const t = task()
    render(<TaskModal task={t} allTasks={[t]} sprints={[]} statuses={['Review', 'Done']} onSave={vi.fn()} onDelete={vi.fn()} onClose={onClose} />)
    fireEvent.click(screen.getByTestId('request-changes'))
    await screen.findByRole('dialog', { name: 'Request changes' })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Request changes' })).toBeNull())
    // The modal under it is still there, a dialog of its own.
    expect(screen.getByRole('dialog', { name: 'TK-7: Review gate UI' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the decisions locked while there are unsaved edits', () => {
    renderModal(task())
    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Renamed' } })
    expect((screen.getByTestId('mark-done') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('request-changes') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Save or cancel your edits first.')).toBeTruthy()
  })

  it('says when a task in Review has no verdict yet, and shows a move error', async () => {
    apiMock.setTaskStatus.mockRejectedValue(new Error('locked by developer'))
    renderModal(task({ activity: [], notes: '' }))
    expect(screen.getByTestId('review-panel').textContent).toContain('No review verdict yet')
    fireEvent.click(screen.getByTestId('mark-done'))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not move TK-7: locked by developer')
  })
})

const unauthorized = () => Object.assign(new Error('Unauthorized'), { status: 401 })

describe('TaskModal writes the board refused', () => {
  it('a save rejected after the token prompt was dismissed shows an inline message and keeps the edits', async () => {
    const t = task({ status: 'To Do' })
    const onSave = vi.fn().mockRejectedValue(unauthorized())
    const onClose = vi.fn()
    render(<TaskModal task={t} allTasks={[t]} sprints={[]} statuses={['To Do', 'Done']} onSave={onSave} onDelete={vi.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('Task title'), { target: { value: 'Renamed while offline' } })
    fireEvent.click(screen.getByTestId('save-task'))
    const alert = await screen.findByTestId('save-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toBe('Not saved: the board needs a token. Your edits are still here.')
    expect((screen.getByPlaceholderText('Task title') as HTMLInputElement).value).toBe('Renamed while offline')
    expect(onClose).not.toHaveBeenCalled()
    // Save again sends the same edits (and would ask for the token again).
    onSave.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByTestId('save-task'))
    await waitFor(() => expect(screen.queryByTestId('save-error')).toBeNull())
    expect(onSave).toHaveBeenLastCalledWith('TK-7', expect.objectContaining({ title: 'Renamed while offline' }))
  })

  it('a refused delete says so instead of failing silently', async () => {
    const t = task({ status: 'To Do' })
    render(<TaskModal task={t} allTasks={[t]} sprints={[]} statuses={['To Do']} onSave={vi.fn()} onDelete={vi.fn().mockRejectedValue(unauthorized())} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect((await screen.findByRole('alert')).textContent).toBe('Not deleted: the board needs a token.')
  })

  it('words other failures from the error itself', () => {
    expect(writeErrorMessage(Object.assign(new Error('TK-7 is locked by developer.'), { status: 409 }), 'Not saved')).toBe('Not saved: TK-7 is locked by developer.')
    expect(writeErrorMessage(new TypeError('Failed to fetch'), 'Not saved')).toBe('Not saved: could not reach the server.')
  })
})

/** A card that opens the modal; a save moves it to another column (a new element), like a reload would. */
function Board({ onSave }: { onSave?: () => Promise<void> }) {
  const t = task({ status: 'To Do' })
  const [open, setOpen] = useState(false)
  const [column, setColumn] = useState('To Do')
  return (
    <>
      <section aria-label={column}>
        <button key={column} type="button" data-task-id="TK-7" onClick={() => setOpen(true)}>
          TK-7 in {column}
        </button>
      </section>
      {open && (
        <TaskModal
          task={t}
          allTasks={[t]}
          sprints={[]}
          statuses={['To Do', 'Done']}
          onSave={async () => {
            await onSave?.()
            setColumn('Done')
            await Promise.resolve()
            setOpen(false)
          }}
          onDelete={vi.fn()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

const openFromCard = () => {
  const card = screen.getByRole('button', { name: 'TK-7 in To Do' })
  card.focus()
  fireEvent.click(card)
  return card
}

describe('TaskModal gives focus back to what opened it', () => {
  it('on Escape, after focus moved into the modal', () => {
    render(<Board />)
    const card = openFromCard()
    screen.getByPlaceholderText('Task title').focus()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByPlaceholderText('Task title')).toBeNull()
    expect(document.activeElement).toBe(card)
  })

  it('on the close button, after focus moved into the modal', () => {
    render(<Board />)
    const card = openFromCard()
    screen.getByPlaceholderText('Task title').focus()
    fireEvent.click(screen.getByRole('button', { name: 'Close task' }))
    expect(document.activeElement).toBe(card)
  })

  it('on save, to the card re-rendered in its new column', async () => {
    render(<Board />)
    openFromCard()
    const title = screen.getByPlaceholderText('Task title')
    title.focus()
    fireEvent.change(title, { target: { value: 'Shipped' } })
    fireEvent.click(screen.getByTestId('save-task'))
    await waitFor(() => expect(screen.queryByPlaceholderText('Task title')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'TK-7 in Done' }))
  })
})

/** A layer over the modal that joins the surface stack, like the token prompt. */
function Prompt({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLFormElement>(null)
  useDialogFocus(ref, onClose)
  return (
    <form ref={ref} role="dialog" aria-modal="true" aria-label="Token required">
      <input aria-label="Token" />
      <button type="button">Save token</button>
    </form>
  )
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? window, { key: 'Tab', shiftKey: shift })

describe('TaskModal is a real dialog', () => {
  it('is a named modal dialog and moves focus to the title when it opens', async () => {
    renderModal(task({ status: 'To Do' }))
    const dialog = screen.getByRole('dialog', { name: 'TK-7: Review gate UI' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task title' })))
  })

  it('keeps Tab and Shift+Tab inside', async () => {
    renderModal(task({ status: 'To Do' }))
    const title = screen.getByRole('textbox', { name: 'Task title' })
    await waitFor(() => expect(document.activeElement).toBe(title))
    // Save is disabled until something changes, so Cancel is the last stop.
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    tab()
    expect(document.activeElement).toBe(title)
    tab(true)
    expect(document.activeElement).toBe(cancel)
  })

  it('pulls focus back in when it is on the board behind', async () => {
    render(
      <>
        <button type="button">Card behind</button>
        <TaskModal task={task({ status: 'To Do' })} allTasks={[]} sprints={[]} statuses={['To Do']} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />
      </>,
    )
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task title' })))
    screen.getByRole('button', { name: 'Card behind' }).focus()
    tab()
    expect(screen.getByRole('dialog', { name: 'TK-7: Review gate UI' }).contains(document.activeElement)).toBe(true)
  })

  it('leaves focus alone in a layer opened over it that is not on the stack (the command palette)', async () => {
    render(
      <>
        <TaskModal task={task({ status: 'To Do' })} allTasks={[]} sprints={[]} statuses={['To Do']} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} />
        <input aria-label="Search tasks" />
      </>,
    )
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task title' })))
    const search = screen.getByRole('textbox', { name: 'Search tasks' })
    search.focus()
    const event = tab()
    expect(event).toBe(true) // not prevented: the browser moves focus as usual
    expect(document.activeElement).toBe(search)
  })

  it('under a token prompt, Escape and Tab belong to the prompt; the modal keeps its edits', async () => {
    const onClose = vi.fn()
    const t = task({ status: 'To Do' })
    function Page() {
      const [prompt, setPrompt] = useState(true)
      return (
        <>
          <TaskModal task={t} allTasks={[t]} sprints={[]} statuses={['To Do']} onSave={vi.fn()} onDelete={vi.fn()} onClose={onClose} />
          {prompt && <Prompt onClose={() => setPrompt(false)} />}
        </>
      )
    }
    render(<Page />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Unsaved title' } })
    const token = screen.getByRole('textbox', { name: 'Token' })
    await waitFor(() => expect(document.activeElement).toBe(token))
    screen.getByRole('button', { name: 'Save token' }).focus()
    tab()
    expect(document.activeElement).toBe(token)
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Token required' })).toBeNull())
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByRole('textbox', { name: 'Task title' }) as HTMLInputElement).value).toBe('Unsaved title')
  })

  it('a refused save keeps the dialog open, with focus inside it', async () => {
    const t = task({ status: 'To Do' })
    const onClose = vi.fn()
    render(<TaskModal task={t} allTasks={[t]} sprints={[]} statuses={['To Do']} onSave={vi.fn().mockRejectedValue(unauthorized())} onDelete={vi.fn()} onClose={onClose} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Renamed' } })
    const save = screen.getByTestId('save-task')
    save.focus()
    fireEvent.click(save)
    await screen.findByTestId('save-error')
    expect(screen.getByRole('dialog', { name: 'TK-7: Review gate UI' }).contains(document.activeElement)).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('has one owner for focus on close: the card, even when focus was trapped inside', async () => {
    render(<Board />)
    const card = openFromCard()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Task title' })))
    tab(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(card)
    // Nothing moves it afterwards (a second restore in a frame would).
    await new Promise((r) => setTimeout(r, 40))
    expect(document.activeElement).toBe(card)
  })
})
