import { describe, expect, it, vi } from 'vitest'
import { createShuttleArrivalClient, ShuttleArrivalFetchError } from './client'

function responseFor(stopId: string): Response {
  return new Response(JSON.stringify({
    observedAt: '2026-09-23T13:48:26+08:00',
    expiresAt: '2026-09-23T13:49:26+08:00',
    snapshotVersion: '2026-09-23T13:48:26.000Z-1',
    refreshedAt: '2026-09-23T13:48:26+08:00',
    nextRefreshAt: '2026-09-23T13:49:26+08:00',
    stops: {
      [stopId]: {
        D2: {
          nextArrivalSeconds: 264,
          upcomingArrivalSeconds: [264, 624],
          headwaySeconds: { min: 360, max: 360, median: 360 },
        },
      },
    },
    stopObservations: {
      [stopId]: {
        observedAt: '2026-09-23T13:48:26+08:00',
        expiresAt: '2026-09-23T13:49:26+08:00',
      },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

const nowMs = Date.parse('2026-09-23T13:48:30+08:00')

describe('createShuttleArrivalClient', () => {
  it('requests uncached stops in one batch', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: '2026-09-23T13:48:26+08:00',
      expiresAt: '2026-09-23T13:49:26+08:00',
      stops: {
        PGP: { D2: { nextArrivalSeconds: 264, upcomingArrivalSeconds: [264], headwaySeconds: null } },
        'KR-MRT': { A1: { nextArrivalSeconds: 120, upcomingArrivalSeconds: [120], headwaySeconds: null } },
      },
    }), { status: 200 }))
    const client = createShuttleArrivalClient({ fetcher, now: () => nowMs })
    const signal = new AbortController().signal

    const result = await client.getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
      { stopId: 'KR-MRT', stopName: 'Kent Ridge MRT' },
    ], signal)

    expect(fetcher).toHaveBeenCalledOnce()
    const requestUrl = new URL(String(fetcher.mock.calls[0][0]), 'http://localhost')
    expect(JSON.parse(requestUrl.searchParams.get('stops') ?? '')).toEqual(['PGP', 'KR-MRT'])
    expect(Object.keys(result.stops)).toEqual(['PGP', 'KR-MRT'])
  })

  it('requests arrivals from the configured API origin', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => responseFor('PGP'))
    const client = createShuttleArrivalClient({
      apiOrigin: 'https://api.example.test',
      fetcher,
      now: () => nowMs,
    })

    await client.getArrivals([{ stopId: 'PGP', stopName: 'PGP' }], new AbortController().signal)

    const requestUrl = new URL(String(fetcher.mock.calls[0]?.[0]))
    expect(requestUrl.origin).toBe('https://api.example.test')
    expect(requestUrl.pathname).toBe('/api/shuttle-arrivals')
    expect(JSON.parse(requestUrl.searchParams.get('stops') ?? '')).toEqual(['PGP'])
  })
  it('requests more than 16 stops in one snapshot read', async () => {
    const stops = Array.from({ length: 17 }, (_, index) => ({
      stopId: `STOP-${index}`,
      stopName: `Stop ${index}`,
    }))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: '2026-09-23T13:48:26+08:00',
      expiresAt: '2026-09-23T13:49:26+08:00',
      snapshotVersion: '2026-09-23T13:48:26.000Z-1',
      stops: Object.fromEntries(stops.map(({ stopId }) => [stopId, {}])),
    }), { status: 200 }))

    const result = await createShuttleArrivalClient({ fetcher, now: () => nowMs }).getArrivals(
      stops,
      new AbortController().signal,
    )

    expect(fetcher).toHaveBeenCalledOnce()
    expect(Object.keys(result.stops)).toHaveLength(17)
  })

  it('requests 33 stops without exceeding the API URL limit', async () => {
    const stops = Array.from({ length: 33 }, (_, index) => ({
      stopId: `STOP-${String(index).padStart(2, '0')}`,
      stopName: `Campus stop ${index} with a longer display name`,
    }))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: '2026-09-23T13:48:26+08:00',
      expiresAt: '2026-09-23T13:49:26+08:00',
      stops: Object.fromEntries(stops.map(({ stopId }, index) => [
        stopId,
        index === 0
          ? { A1: { nextArrivalSeconds: 120, upcomingArrivalSeconds: [120], headwaySeconds: null } }
          : {},
      ])),
    }), { status: 200 }))

    const result = await createShuttleArrivalClient({ fetcher, now: () => nowMs }).getArrivals(
      stops,
      new AbortController().signal,
    )

    expect(fetcher).toHaveBeenCalledOnce()
    const requestUrl = new URL(String(fetcher.mock.calls[0][0]), 'http://localhost')
    expect(JSON.parse(requestUrl.searchParams.get('stops') ?? '')).toEqual(stops.map(({ stopId }) => stopId))
    expect(`${requestUrl.pathname}${requestUrl.search}`.length).toBeLessThanOrEqual(2048)
    expect(result.stops['STOP-00']?.A1.nextArrivalSeconds).toBe(120)
    expect(Object.keys(result.stops)).toHaveLength(33)
  })

  it('reuses cached stop data and shares an in-progress request', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => responseFor('PGP'))
    const client = createShuttleArrivalClient({ fetcher, now: () => nowMs })
    const stop = { stopId: 'PGP', stopName: 'PGP' }
    const signal = new AbortController().signal

    const [first, second] = await Promise.all([
      client.getArrivals([stop], signal),
      client.getArrivals([stop], signal),
    ])
    await client.getArrivals([stop], signal)

    expect(fetcher).toHaveBeenCalledOnce()
    expect(first.stops.PGP.D2.nextArrivalSeconds).toBe(264)
    expect(second.stops.PGP.D2.nextArrivalSeconds).toBe(264)
  })

  it('expires the default browser cache after 30 seconds', async () => {
    let now = nowMs
    const fetcher = vi.fn<typeof fetch>(async () => responseFor('PGP'))
    const client = createShuttleArrivalClient({ fetcher, now: () => now })
    const stop = { stopId: 'PGP', stopName: 'PGP' }
    const signal = new AbortController().signal

    await client.getArrivals([stop], signal)
    now += 29_999
    await client.getArrivals([stop], signal)
    expect(fetcher).toHaveBeenCalledOnce()

    now += 1
    await client.getArrivals([stop], signal)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('reports a fetch failure instead of treating it as no bus data', async () => {
    let now = 0
    const fetcher = vi.fn<typeof fetch>(async () => responseFor('PGP'))
    const client = createShuttleArrivalClient({
      fetcher,
      now: () => now,
      cacheTtlMs: 10,
    })
    const stop = { stopId: 'PGP', stopName: 'PGP' }
    const signal = new AbortController().signal

    await client.getArrivals([stop], signal)
    now = 11
    fetcher.mockRejectedValueOnce(new Error('API unavailable'))

    await expect(client.getArrivals([stop], signal)).rejects.toBeInstanceOf(ShuttleArrivalFetchError)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('returns an empty valid snapshot when the provider has no bus arrivals', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: '2026-09-23T13:48:26+08:00',
      expiresAt: '2026-09-23T13:49:26+08:00',
      stops: { PGP: {} },
    }), { status: 200 }))

    const result = await createShuttleArrivalClient({ fetcher, now: () => nowMs }).getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
    ], new AbortController().signal)

    expect(result.stops).toEqual({ PGP: {} })
  })

  it('normalizes arrival ordering and drops invalid headways', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: '2026-09-23T13:48:26+08:00',
      expiresAt: '2026-09-23T13:49:26+08:00',
      stops: {
        PGP: {
          D2: {
            nextArrivalSeconds: 600,
            upcomingArrivalSeconds: [600, 300, 300],
            headwaySeconds: { min: 0, max: 0, median: 0 },
          },
        },
      },
    }), { status: 200 }))

    const result = await createShuttleArrivalClient({ fetcher, now: () => nowMs }).getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
    ], new AbortController().signal)

    expect(result.stops.PGP.D2).toEqual({
      nextArrivalSeconds: 300,
      upcomingArrivalSeconds: [300, 600],
      headwaySeconds: null,
    })
  })

  it('rejects invalid snapshot timestamps', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: 'not-a-date',
      expiresAt: '2026-09-23T13:49:26+08:00',
      stops: {},
    }), { status: 200 }))

    await expect(createShuttleArrivalClient({ fetcher }).getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
    ], new AbortController().signal)).rejects.toBeInstanceOf(ShuttleArrivalFetchError)
  })

  it('keeps each stop observation and provider expiry when combining cached stops', async () => {
    let now = nowMs
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const requestedStopIds = JSON.parse(
        new URL(String(input), 'http://localhost').searchParams.get('stops') ?? '[]',
      ) as string[]
      const stops = Object.fromEntries(requestedStopIds.map((stopId) => [stopId, {}]))
      const stopObservations = Object.fromEntries(requestedStopIds.map((stopId) => [stopId, {
        observedAt: stopId === 'PGP' ? '2026-09-23T13:48:26+08:00' : '2026-09-23T13:49:26+08:00',
        expiresAt: stopId === 'PGP' ? '2026-09-23T13:49:26+08:00' : '2026-09-23T13:50:26+08:00',
      }]))
      return new Response(JSON.stringify({
        observedAt: '2026-09-23T13:48:26+08:00',
        expiresAt: '2026-09-23T13:50:26+08:00',
        snapshotVersion: '2026-09-23T13:48:26.000Z-1',
        refreshedAt: '2026-09-23T13:48:26+08:00',
        stops,
        stopObservations,
      }), { status: 200 })
    })
    const client = createShuttleArrivalClient({ fetcher, now: () => now, cacheTtlMs: 60_000 })

    await client.getArrivals([{ stopId: 'PGP', stopName: 'PGP' }], new AbortController().signal)
    now += 1_000
    const result = await client.getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
      { stopId: 'KR-MRT', stopName: 'Kent Ridge MRT' },
    ], new AbortController().signal)

    expect(result.stopObservations).toEqual({
      PGP: {
        observedAt: '2026-09-23T13:48:26+08:00',
        expiresAt: '2026-09-23T13:49:26+08:00',
      },
      'KR-MRT': {
        observedAt: '2026-09-23T13:49:26+08:00',
        expiresAt: '2026-09-23T13:50:26+08:00',
      },
    })
  })

  it('keeps unavailable stop ids scoped to the requested stops when combining cached stops', async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const requestedStopIds = JSON.parse(
        new URL(String(input), 'http://localhost').searchParams.get('stops') ?? '[]',
      ) as string[]
      return new Response(JSON.stringify({
        observedAt: '2026-09-23T13:48:26+08:00',
        expiresAt: '2026-09-23T13:49:26+08:00',
        snapshotVersion: '2026-09-23T13:48:26.000Z-1',
        refreshedAt: '2026-09-23T13:48:26+08:00',
        stops: Object.fromEntries(requestedStopIds.map((stopId) => [stopId, {}])),
        unavailableStopIds: requestedStopIds.filter((stopId) => stopId !== 'PGP'),
      }), { status: 200 })
    })
    const client = createShuttleArrivalClient({ fetcher, now: () => nowMs, cacheTtlMs: 60_000 })

    const first = await client.getArrivals([{ stopId: 'PGP', stopName: 'PGP' }], new AbortController().signal)
    const second = await client.getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
      { stopId: 'KR-MRT', stopName: 'Kent Ridge MRT' },
    ], new AbortController().signal)
    const third = await client.getArrivals([{ stopId: 'KR-MRT', stopName: 'Kent Ridge MRT' }], new AbortController().signal)

    expect(first.unavailableStopIds).toEqual([])
    expect(second.unavailableStopIds).toEqual(['KR-MRT'])
    expect(third.unavailableStopIds).toEqual(['KR-MRT'])
  })

  it('rejects an invalid unavailableStopIds list', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: '2026-09-23T13:48:26+08:00',
      expiresAt: '2026-09-23T13:49:26+08:00',
      stops: {},
      unavailableStopIds: [1],
    }), { status: 200 }))

    await expect(createShuttleArrivalClient({ fetcher }).getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
    ], new AbortController().signal)).rejects.toBeInstanceOf(ShuttleArrivalFetchError)
  })

  it('keeps the current generation when a later response is older', async () => {
    let now = nowMs
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        observedAt: '2026-09-23T13:48:40+08:00',
        expiresAt: '2026-09-23T13:49:40+08:00',
        snapshotVersion: '2026-09-23T13:48:40.000Z-2',
        stops: { PGP: { D2: {
          nextArrivalSeconds: 120,
          upcomingArrivalSeconds: [120],
          headwaySeconds: null,
        } } },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        observedAt: '2026-09-23T13:48:30+08:00',
        expiresAt: '2026-09-23T13:49:30+08:00',
        snapshotVersion: '2026-09-23T13:48:30.000Z-1',
        stops: { PGP: { D2: {
          nextArrivalSeconds: 600,
          upcomingArrivalSeconds: [600],
          headwaySeconds: null,
        } } },
      }), { status: 200 }))
    const client = createShuttleArrivalClient({ fetcher, now: () => now, cacheTtlMs: 1 })
    const stop = { stopId: 'PGP', stopName: 'PGP' }

    const first = await client.getArrivals([stop], new AbortController().signal)
    now += 2
    const second = await client.getArrivals([stop], new AbortController().signal)

    expect(first.snapshotVersion).toBe('2026-09-23T13:48:40.000Z-2')
    expect(second.snapshotVersion).toBe(first.snapshotVersion)
    expect(second.stops.PGP.D2.nextArrivalSeconds).toBe(120)
  })

  it('rejects a provider snapshot that is already expired', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      observedAt: '2026-09-23T13:48:26+08:00',
      expiresAt: '2026-09-23T13:48:29+08:00',
      stops: { PGP: {} },
    }), { status: 200 }))

    await expect(createShuttleArrivalClient({ fetcher, now: () => nowMs }).getArrivals([
      { stopId: 'PGP', stopName: 'PGP' },
    ], new AbortController().signal)).rejects.toBeInstanceOf(ShuttleArrivalFetchError)
  })
})
