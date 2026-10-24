// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ShuttleArrivalSnapshot } from '../../../domain/transit/arrivals'
import {
  type StopsArrivalLoader,
  type StopsArrivalStopRequest,
  useStopsArrivals,
} from './use-stops-arrivals'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const stops: readonly StopsArrivalStopRequest[] = [
  { stopId: 'STOP-A', stopName: 'Stop A' },
]

const snapshot: ShuttleArrivalSnapshot = {
  observedAt: '2026-09-30T00:00:00.000Z',
  expiresAt: '2026-09-30T00:01:00.000Z',
  stops: { 'STOP-A': {} },
}

const refreshedSnapshot: ShuttleArrivalSnapshot = {
  observedAt: '2026-09-30T00:00:30.000Z',
  expiresAt: '2026-09-30T00:01:30.000Z',
  stops: { 'STOP-A': {} },
}

function Probe({
  client,
  active,
  stops: requestedStops = stops,
}: {
  readonly client: StopsArrivalLoader
  readonly active: boolean
  readonly stops?: readonly StopsArrivalStopRequest[]
}) {
  const state = useStopsArrivals(client, active, requestedStops)
  return (
    <>
      <output data-testid="status">{state.status}</output>
      <output data-testid="snapshot">{state.snapshot?.observedAt ?? 'none'}</output>
    </>
  )
}

describe('useStopsArrivals', () => {
  it('loads immediately and refreshes active Stops at the 30-second interval', async () => {
    vi.useFakeTimers()
    const client: StopsArrivalLoader = vi.fn(async () => snapshot)

    render(<Probe client={client} active />)
    await act(async () => undefined)
    expect(client).toHaveBeenCalledOnce()
    expect(screen.getByTestId('status').textContent).toBe('ready')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(client).toHaveBeenCalledTimes(2)
  })

  it('does not reload when the same stop request is recreated', async () => {
    const client: StopsArrivalLoader = vi.fn(async () => snapshot)
    const { rerender } = render(<Probe client={client} active stops={[...stops]} />)
    await act(async () => undefined)

    rerender(<Probe client={client} active stops={[...stops]} />)
    await act(async () => undefined)

    expect(client).toHaveBeenCalledOnce()
  })

  it('does not reload when the same stop requests are reordered', async () => {
    const client: StopsArrivalLoader = vi.fn(async () => snapshot)
    const firstOrder = [
      { stopId: 'STOP-A', stopName: 'Stop A' },
      { stopId: 'STOP-B', stopName: 'Stop B' },
    ]
    const secondOrder = [...firstOrder].reverse()
    const { rerender } = render(<Probe client={client} active stops={firstOrder} />)
    await act(async () => undefined)

    rerender(<Probe client={client} active stops={secondOrder} />)
    await act(async () => undefined)

    expect(client).toHaveBeenCalledOnce()
  })

  it('keeps the previous snapshot visible while a refresh is in flight', async () => {
    vi.useFakeTimers()
    let resolveRefresh: (value: ShuttleArrivalSnapshot) => void = () => undefined
    const client: StopsArrivalLoader = vi.fn()
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve
      }))

    render(<Probe client={client} active />)
    await act(async () => undefined)
    expect(screen.getByTestId('snapshot').textContent).toBe(snapshot.observedAt)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('refreshing')
    expect(screen.getByTestId('snapshot').textContent).toBe(snapshot.observedAt)

    resolveRefresh(refreshedSnapshot)
    await act(async () => undefined)
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(screen.getByTestId('snapshot').textContent).toBe(refreshedSnapshot.observedAt)
  })

  it('keeps the previous snapshot visible when a refresh fails', async () => {
    vi.useFakeTimers()
    const client: StopsArrivalLoader = vi.fn()
      .mockResolvedValueOnce(snapshot)
      .mockRejectedValueOnce(new Error('provider unavailable'))

    render(<Probe client={client} active />)
    await act(async () => undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(screen.getByTestId('status').textContent).toBe('error')
    expect(screen.getByTestId('snapshot').textContent).toBe(snapshot.observedAt)
  })

  it('debounces rapid stop-set changes and loads the latest set', async () => {
    vi.useFakeTimers()
    const nextStops = [{ stopId: 'STOP-B', stopName: 'Stop B' }]
    const latestStops = [{ stopId: 'STOP-C', stopName: 'Stop C' }]
    const client = vi.fn<StopsArrivalLoader>(async () => snapshot)
    const { rerender } = render(<Probe client={client} active />)
    await act(async () => undefined)

    rerender(<Probe client={client} active stops={nextStops} />)
    rerender(<Probe client={client} active stops={latestStops} />)
    expect(client).toHaveBeenCalledOnce()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(149)
    })
    expect(client).toHaveBeenCalledOnce()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(client).toHaveBeenCalledTimes(2)
    expect(client.mock.calls[1]?.[0]).toEqual(latestStops)
  })

  it('does not expose the previous snapshot while the requested stop set changes', async () => {
    vi.useFakeTimers()
    const nextStops = [{ stopId: 'STOP-B', stopName: 'Stop B' }]
    const client = vi.fn<StopsArrivalLoader>()
      .mockResolvedValueOnce(snapshot)
      .mockImplementationOnce(() => new Promise(() => undefined))
    const { rerender } = render(<Probe client={client} active />)
    await act(async () => undefined)

    rerender(<Probe client={client} active stops={nextStops} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })

    expect(screen.getByTestId('snapshot').textContent).toBe('none')
  })

  it('does not replace a current snapshot with an older generation', async () => {
    vi.useFakeTimers()
    const currentSnapshot = {
      ...snapshot,
      observedAt: '2026-09-30T00:00:10.000Z',
      snapshotVersion: '2026-09-30T00:00:10.000Z-2',
    }
    const olderSnapshot = {
      ...snapshot,
      observedAt: '2026-09-30T00:00:09.000Z',
      snapshotVersion: '2026-09-30T00:00:09.000Z-1',
    }
    const client: StopsArrivalLoader = vi.fn()
      .mockResolvedValueOnce(currentSnapshot)
      .mockResolvedValueOnce(olderSnapshot)

    render(<Probe client={client} active />)
    await act(async () => undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(screen.getByTestId('snapshot').textContent).toBe(currentSnapshot.observedAt)
  })

  it('does not request before it has been active', async () => {
    vi.useFakeTimers()
    const client: StopsArrivalLoader = vi.fn(async () => snapshot)

    const { rerender } = render(<Probe client={client} active={false} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(client).not.toHaveBeenCalled()

    rerender(<Probe client={client} active />)
    await act(async () => undefined)
    expect(client).toHaveBeenCalledOnce()
  })

  it('keeps refreshing the last stop set in the background after becoming inactive', async () => {
    vi.useFakeTimers()
    const client: StopsArrivalLoader = vi.fn(async () => snapshot)
    const otherStops = [{ stopId: 'STOP-B', stopName: 'Stop B' }]

    const { rerender } = render(<Probe client={client} active />)
    await act(async () => undefined)
    expect(client).toHaveBeenCalledOnce()

    rerender(<Probe client={client} active={false} stops={otherStops} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })

    expect(client).toHaveBeenCalledTimes(2)
    expect(vi.mocked(client).mock.calls[1]?.[0]).toEqual(stops)
    expect(screen.getByTestId('snapshot').textContent).toBe(snapshot.observedAt)

    rerender(<Probe client={client} active />)
    await act(async () => undefined)
    expect(client).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('status').textContent).toBe('ready')
  })

  it('publishes an error state when the arrivals interface fails', async () => {
    const client: StopsArrivalLoader = vi.fn(async () => {
        throw new Error('provider unavailable')
      })

    render(<Probe client={client} active />)
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('error'))
  })
})
