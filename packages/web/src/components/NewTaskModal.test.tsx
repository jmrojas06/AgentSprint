import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import type { TaskTemplate } from '../types'

const templatesMock = vi.hoisted(() => vi.fn())

vi.mock('../api', () => ({
  api: {
    templates: templatesMock,
  },
}))

import { NewTaskModal } from './NewTaskModal'

const TEMPLATES: TaskTemplate[] = [
  {
    name: 'bug-report',
    description: 'Report a bug',
    acceptanceCriteria: ['Root cause identified'],
    priority: 'high',
    assignee: 'review',
    estimate: 1,
    tags: ['bug'],
  },
]

function setup() {
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(<NewTaskModal sprints={[]} onCreate={onCreate} onClose={onClose} />)
  return { onCreate, onClose }
}

beforeEach(() => {
  templatesMock.mockResolvedValue(TEMPLATES)
})

afterEach(() => {
  cleanup()
})

async function selectTemplate(name: string) {
  // wait until templates are loaded (template options only render then)
  await screen.findByRole('option', { name })
  const templateSelect = screen.getAllByRole('combobox')[0]!
  fireEvent.change(templateSelect, { target: { value: name } })
}

describe('NewTaskModal template selection', () => {
  it('applies template defaults to untouched priority and assignee', async () => {
    const { onCreate } = setup()
    await selectTemplate('bug-report')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ template: 'bug-report', priority: 'high', assignee: 'review' })
  })

  it('does not clobber a manually chosen priority', async () => {
    const { onCreate } = setup()
    fireEvent.click(screen.getByTitle('Low'))
    await selectTemplate('bug-report')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ priority: 'low' })
  })

  it('does not clobber a manually chosen assignee', async () => {
    const { onCreate } = setup()
    const assigneeSelect = screen.getAllByRole('combobox')[1]!
    fireEvent.change(assigneeSelect, { target: { value: 'dev' } })
    await selectTemplate('bug-report')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(onCreate.mock.calls[0]![0]).toMatchObject({ assignee: 'dev' })
  })

  it('allows creating with an empty title when a template is selected', async () => {
    const { onCreate } = setup()
    await selectTemplate('bug-report')
    const create = screen.getByRole('button', { name: /create/i }) as HTMLButtonElement
    expect(create.disabled).toBe(false)
    fireEvent.click(create)
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: '', template: 'bug-report', vars: {} }))
  })

  it('sends typed titles as template vars', async () => {
    const { onCreate } = setup()
    fireEvent.change(screen.getByPlaceholderText(/what should be done/i), { target: { value: 'Bug: login' } })
    await selectTemplate('bug-report')
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ vars: { title: 'Bug: login' } }))
  })
})

describe('NewTaskModal when the board refuses the create', () => {
  it('shows an inline message after a dismissed token prompt and keeps what was typed', async () => {
    const onCreate = vi.fn().mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    const onClose = vi.fn()
    render(<NewTaskModal sprints={[]} onCreate={onCreate} onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText(/what should be done/i), { target: { value: 'Write the release notes' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    const alert = await screen.findByTestId('create-error')
    expect(alert.getAttribute('role')).toBe('alert')
    expect(alert.textContent).toBe('Not created: the board needs a token. What you typed is still here.')
    expect((screen.getByPlaceholderText(/what should be done/i) as HTMLInputElement).value).toBe('Write the release notes')
    expect(onClose).not.toHaveBeenCalled()
    onCreate.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    await waitFor(() => expect(screen.queryByTestId('create-error')).toBeNull())
    expect(onCreate).toHaveBeenCalledTimes(2)
  })
})

/** The "New task" button and the modal it opens, as in the app header. */
function Header({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        New task
      </button>
      {open && (
        <NewTaskModal
          sprints={[]}
          onCreate={vi.fn()}
          onClose={() => {
            onClose?.()
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? window, { key: 'Tab', shiftKey: shift })

describe('NewTaskModal is a real dialog', () => {
  it('is a modal dialog named by its heading, with focus on the title field', async () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'New task' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' })))
  })

  it('labels every field and the icon-only priority buttons', async () => {
    setup()
    await screen.findByRole('option', { name: 'bug-report' })
    expect(screen.getByRole('combobox', { name: 'Template' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Sprint' })).toBeTruthy()
    const priority = screen.getByRole('group', { name: 'Priority' })
    expect(priority.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe('Medium')
  })

  it('keeps Tab and Shift+Tab inside', async () => {
    setup()
    const title = screen.getByRole('textbox', { name: 'Title' })
    await waitFor(() => expect(document.activeElement).toBe(title))
    const close = screen.getByRole('button', { name: 'Close' })
    // Create is disabled while the title is empty, so Cancel is the last stop.
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    tab()
    expect(document.activeElement).toBe(close)
    tab(true)
    expect(document.activeElement).toBe(cancel)
  })

  it('closes on Escape and gives focus back to the button that opened it', async () => {
    const onClose = vi.fn()
    render(<Header onClose={onClose} />)
    const opener = screen.getByRole('button', { name: 'New task' })
    opener.focus()
    fireEvent.click(opener)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title' })))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})
