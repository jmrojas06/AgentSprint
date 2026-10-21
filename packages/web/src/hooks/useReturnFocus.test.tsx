import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useReturnFocus } from './useReturnFocus'

function Surface({ id }: { id: string }) {
  useReturnFocus(id)
  return <input aria-label="Inside the surface" />
}

/** A list of task rows with its heading, a main region, and the surface opened from one row. */
function Page({ rows, open, list = true }: { rows: string[]; open: string | null; list?: boolean }) {
  return (
    <>
      <section>
        <h2 tabIndex={-1} data-task-list-heading="review">
          Waiting for review
        </h2>
        {rows.length > 0 && (
          <ul data-task-list={list ? 'review' : undefined}>
            {rows.map((id) => (
              <li key={id}>
                <button type="button" data-task-id={id}>
                  {id}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <main tabIndex={-1}>Board</main>
      {open && <Surface id={open} />}
    </>
  )
}

const row = (id: string) => screen.getByRole('button', { name: id })

/** Open the surface from a row, then move focus into it, as a user would. */
function openFrom(id: string, rows: string[], list = true) {
  const utils = render(<Page rows={rows} open={null} list={list} />)
  row(id).focus()
  utils.rerender(<Page rows={rows} open={id} list={list} />)
  screen.getByLabelText('Inside the surface').focus()
  return utils
}

afterEach(() => cleanup())

describe('useReturnFocus', () => {
  it('gives focus back to the row that opened the surface', () => {
    const { rerender } = openFrom('TK-2', ['TK-1', 'TK-2', 'TK-3'])
    rerender(<Page rows={['TK-1', 'TK-2', 'TK-3']} open={null} />)
    expect(document.activeElement).toBe(row('TK-2'))
  })

  it('moves to the next row when the task left the list (a review decision)', () => {
    const { rerender } = openFrom('TK-2', ['TK-1', 'TK-2', 'TK-3'])
    rerender(<Page rows={['TK-1', 'TK-3']} open={null} />)
    expect(document.activeElement).toBe(row('TK-3'))
  })

  it('takes the previous row when the task was the last one', () => {
    const { rerender } = openFrom('TK-3', ['TK-1', 'TK-2', 'TK-3'])
    rerender(<Page rows={['TK-1', 'TK-2']} open={null} />)
    expect(document.activeElement).toBe(row('TK-2'))
  })

  it('follows the row when the list re-renders after the surface closed', async () => {
    const { rerender } = openFrom('TK-2', ['TK-1', 'TK-2', 'TK-3'])
    rerender(<Page rows={['TK-1', 'TK-2', 'TK-3']} open={null} />)
    expect(document.activeElement).toBe(row('TK-2'))
    // The Overview snapshot reloads a moment later and drops the row.
    rerender(<Page rows={['TK-1', 'TK-3']} open={null} />)
    await waitFor(() => expect(document.activeElement).toBe(row('TK-3')))
  })

  it('falls back to the list heading when the list is now empty', () => {
    const { rerender } = openFrom('TK-2', ['TK-2'])
    rerender(<Page rows={[]} open={null} />)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Waiting for review' }))
  })

  it('falls back to the main region when nothing it knew is left', () => {
    const { rerender } = openFrom('TK-2', ['TK-2'], false)
    rerender(<Page rows={[]} open={null} list={false} />)
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })
})
