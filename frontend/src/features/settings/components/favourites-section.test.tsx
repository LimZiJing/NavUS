// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FavouritesSection } from './favourites-section'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Favourites settings', () => {
  it('removes a stop by its canonical name', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(
      <FavouritesSection
        stops={[{ id: 'COM3', name: 'COM3 (Opp COM2)' }]}
        onRemove={onRemove}
        onClear={() => undefined}
      />,
    )

    const removeButton = screen.getByRole('button', { name: 'Remove COM3 (Opp COM2) from favourites' })
    expect(removeButton.getAttribute('aria-pressed')).toBe('true')
    expect(removeButton.getAttribute('data-size')).toBe('sm')
    await user.click(removeButton)
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('COM3')
    expect(screen.getByRole('status').textContent).toBe('COM3 (Opp COM2) removed from favourites.')
  })

  it('confirms before clearing every saved stop', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(
      <FavouritesSection
        stops={[{ id: 'COM3', name: 'COM3' }]}
        onRemove={() => undefined}
        onClear={onClear}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClear).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('shows the empty state when there are no saved stops', () => {
    render(<FavouritesSection stops={[]} onRemove={() => undefined} onClear={() => undefined} />)

    expect(screen.getByText('Star a stop in Stops to add it to your favourites.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull()
  })
})
