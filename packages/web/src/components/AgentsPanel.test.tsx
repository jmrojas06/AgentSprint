import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile, DispatchPlan, Task } from '../types'

const apiMock = vi.hoisted(() => ({
  saveAgent: vi.fn(),
  deleteAgent: vi.fn(),
  syncAgents: vi.fn(),
  dispatch: vi.fn(),
}))

vi.mock('../api', () => ({ api: apiMock }))

import { AgentsPanel } from './AgentsPanel'
import { DispatchModal } from './DispatchModal'
import { AgentsContext, AssigneeChip, agentRole } from '../agents'

const designer: AgentProfile = {
  name: 'designer',
  description: 'Designer — UI/UX and accessibility.',
  color: '#a855f7',
  tags: ['design'],
  tools: [],
  disallowedTools: [],
  skills: ['design-taste-frontend'],
  model: 'inherit',
  prompt: '## Mission\n\nShip clear interfaces.',
}

const task = (over: Partial<Task>): Task =>
  ({
    id: 'TK-1',
    title: 'Hero',
    status: 'To Do',
    priority: 'medium',
    assignee: 'designer',
    sprint: 1,
    estimate: 1,
    tags: [],
    dependencies: [],
    description: '',
    acceptanceCriteria: [],
    notes: '',
    activity: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as Task

beforeEach(() => {
  vi.clearAllMocks()
  apiMock.syncAgents.mockResolvedValue({ enabled: true, installed: [], written: [], unchanged: ['designer'], removed: [], skipped: [] })
  apiMock.saveAgent.mockResolvedValue(designer)
})

afterEach(() => cleanup())

describe('agentRole', () => {
  it('takes the clause before the dash', () => {
    expect(agentRole(designer)).toBe('Designer')
    expect(agentRole({ description: 'Payments with Stripe' })).toBe('Payments with Stripe')
  })
})

describe('AssigneeChip', () => {
  it('shows the agent swatch for specialists and a plain chip for roles', () => {
    render(
      <AgentsContext.Provider value={[designer]}>
        <AssigneeChip assignee="designer" />
        <AssigneeChip assignee="dev" />
      </AgentsContext.Provider>,
    )
    expect(screen.getByTestId('agent-chip').textContent).toBe('designer')
    expect(screen.getByText('dev').getAttribute('data-testid')).toBeNull()
  })
})

describe('AgentsPanel', () => {
  it('lists agents with their open task count and expands the prompt', () => {
    render(<AgentsPanel agents={[designer]} tasks={[task({}), task({ id: 'TK-2', status: 'Done' })]} onChanged={vi.fn()} />)
    expect(screen.getByText('designer')).toBeTruthy()
    expect(screen.getByTitle('1 open task(s) assigned')).toBeTruthy()
    fireEvent.click(screen.getByText('designer'))
    expect(screen.getByText(/Ship clear interfaces/)).toBeTruthy()
  })

  it('offers to install the defaults when there are no agents', async () => {
    const onChanged = vi.fn()
    render(<AgentsPanel agents={[]} tasks={[]} onChanged={onChanged} />)
    fireEvent.click(screen.getByText('Install default agents'))
    await waitFor(() => expect(apiMock.syncAgents).toHaveBeenCalledWith(true))
    expect(onChanged).toHaveBeenCalled()
  })

  it('creates a new agent from the form', async () => {
    const onChanged = vi.fn()
    render(<AgentsPanel agents={[designer]} tasks={[]} onChanged={onChanged} />)
    fireEvent.click(screen.getByTitle('Create a specialist agent'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Stripe Expert' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Payments' } })
    fireEvent.click(screen.getByText('Save agent'))
    await waitFor(() => expect(apiMock.saveAgent).toHaveBeenCalled())
    const [name, patch] = apiMock.saveAgent.mock.calls[0]!
    expect(name).toBe('stripe-expert')
    expect(patch).toMatchObject({ description: 'Payments', model: 'inherit' })
    expect(onChanged).toHaveBeenCalled()
  })

  it('rejects a duplicate name without calling the API', () => {
    render(<AgentsPanel agents={[designer]} tasks={[]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Create a specialist agent'))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'designer' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Again' } })
    fireEvent.click(screen.getByText('Save agent'))
    expect(screen.getByRole('alert').textContent).toContain('already exists')
    expect(apiMock.saveAgent).not.toHaveBeenCalled()
  })

  it('reports the sync result', async () => {
    render(<AgentsPanel agents={[designer]} tasks={[]} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByTitle('Regenerate .claude/agents/ from .agentboard/agents/'))
    expect(await screen.findByTestId('agents-notice')).toBeTruthy()
    expect(screen.getByTestId('agents-notice').textContent).toContain('1 up to date')
  })
})

describe('DispatchModal', () => {
  const item = { id: 'TK-1', title: 'Hero', priority: 'high' as const, assignee: 'designer', subagent: 'designer', reviewer: 'ui-reviewer', dependencies: [] }
  const plan: DispatchPlan = {
    sprint: { id: 1, goal: 'MVP', status: 'active', startedAt: null, endedAt: null },
    waves: [[item], [{ ...item, id: 'TK-2', title: 'Copy', subagent: null }]],
    conflicts: [],
    inProgress: [],
    review: [],
    blocked: [],
  }

  it('renders waves with their subagents and opens a task on click', async () => {
    apiMock.dispatch.mockResolvedValue({ plan, markdown: '# Dispatch plan' })
    const onOpenTask = vi.fn()
    render(
      <AgentsContext.Provider value={[designer]}>
        <DispatchModal sprintId={1} onOpenTask={onOpenTask} onClose={vi.fn()} />
      </AgentsContext.Provider>,
    )
    expect(await screen.findByText('Wave 1')).toBeTruthy()
    expect(screen.getByText('Wave 2')).toBeTruthy()
    expect(screen.getByText('general-purpose')).toBeTruthy()
    fireEvent.click(screen.getByText('Hero'))
    expect(onOpenTask).toHaveBeenCalledWith('TK-1')
  })

  it('shows the empty state and disables copy when nothing is pending', async () => {
    apiMock.dispatch.mockResolvedValue({ plan: { ...plan, waves: [] }, markdown: '' })
    render(<DispatchModal onOpenTask={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Nothing to dispatch')).toBeTruthy()
    expect((screen.getByTestId('dispatch-copy') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows API errors', async () => {
    apiMock.dispatch.mockRejectedValue(new Error('Sprint not found: 9'))
    render(<DispatchModal sprintId={9} onOpenTask={vi.fn()} onClose={vi.fn()} />)
    expect((await screen.findByRole('alert')).textContent).toContain('Sprint not found')
  })
})
