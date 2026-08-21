import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BurndownChart } from './BurndownChart'
import { api } from '../api'

vi.mock('../api', () => ({
  api: { sprintBurndown: vi.fn() },
}))

const mockedBurndown = vi.mocked(api.sprintBurndown)

afterEach(() => cleanup())

const DATA = {
  sprintId: 1,
  total: 10,
  startedAt: '2026-08-20T00:00:00.000Z',
  points: [
    { date: '2026-08-20', remaining: 10 },
    { date: '2026-08-21', remaining: 7 },
    { date: '2026-08-22', remaining: 3 },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('BurndownChart', () => {
  it('renders the empty state when there are no snapshots yet', async () => {
    mockedBurndown.mockResolvedValue({ sprintId: 1, total: 0, startedAt: null, points: [] })
    render(<BurndownChart sprintId={1} />)
    expect(await screen.findByText(/Snapshots appear as the sprint progresses/i)).toBeTruthy()
  })

  it('renders ideal vs actual lines from mock data', async () => {
    mockedBurndown.mockResolvedValue(DATA)
    const { container } = render(<BurndownChart sprintId={1} />)
    await screen.findByText(/left \/ 10/)
    const chartSvg = container.querySelector('[data-testid="burndown-svg"]')!
    const polylines = chartSvg.querySelectorAll('polyline')
    expect(polylines).toHaveLength(2)
    // actual line has one vertex per snapshot point
    expect(polylines[1]!.getAttribute('points')!.trim().split(/\s+/)).toHaveLength(3)
  })

  it('shows a tooltip on hover with date and remaining points', async () => {
    mockedBurndown.mockResolvedValue(DATA)
    const { container } = render(<BurndownChart sprintId={1} />)
    await screen.findByText(/left \/ 10/)

    expect(screen.queryByTestId('burndown-tooltip')).toBeNull()

    const chartSvg = container.querySelector('[data-testid="burndown-svg"]')!
    const pointGroups = Array.from(chartSvg.querySelectorAll('g')).filter((g) =>
      g.querySelector('rect[fill="transparent"]'),
    )
    fireEvent.mouseEnter(pointGroups[1]!)

    const tooltip = screen.getByTestId('burndown-tooltip')
    expect(tooltip.querySelector('text')?.textContent).toContain('08-21')
    expect(tooltip.querySelector('text')?.textContent).toContain('7')
  })

  it('requests burndown data for the given sprint id', async () => {
    mockedBurndown.mockResolvedValue({ ...DATA, points: [] })
    render(<BurndownChart sprintId={42} />)
    await screen.findByText(/Snapshots appear/i)
    expect(mockedBurndown).toHaveBeenCalledWith(42)
  })
})
