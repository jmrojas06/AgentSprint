import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
