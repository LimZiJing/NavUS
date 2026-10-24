import { describe, expect, it } from 'vitest'
import {
  createLiveBusWaitingTimeProvider,
  createTestBusWaitingTimeProvider,
  MAX_BUS_WAIT_SECONDS,
  TEST_SHUTTLE_WAIT_SECONDS,
} from './apply-bus-waits.ts'

const snapshot = {
  observedAt: '2026-09-23T13:48:26.000Z',
  expiresAt: '2026-09-23T14:10:26.000Z',
  stops: {
    PGP: {
      D2: {
        nextArrivalSeconds: 264,
        upcomingArrivalSeconds: [264, 624, 982],
        headwaySeconds: { min: 358, max: 480, median: 419 },
      },
    },
  },
  stopObservations: {
    PGP: {
      observedAt: '2026-09-23T13:48:26.000Z',
      expiresAt: '2026-09-23T14:10:26.000Z',
    },
  },
} as const

const record = {
  routeId: 'D2',
  fromStopId: 'PGP',
  toStopId: 'UTOWN',
} as never

describe('createLiveShuttleWaitingTimeProvider', () => {
  it('uses the next arrival for the first boarding', () => {
    const waiting = createLiveBusWaitingTimeProvider(snapshot, Date.parse(snapshot.observedAt))

    expect(waiting(record, {
      routeId: 'D2',
      boardingStopId: 'PGP',
      elapsedSeconds: 0,
    })).toBe(264)
  })

  it('includes time walking to the stop and uses half headway after arrivals pass', () => {
    const waiting = createLiveBusWaitingTimeProvider(snapshot, Date.parse(snapshot.observedAt))

    expect(waiting(record, {
      routeId: 'D2',
      boardingStopId: 'PGP',
      elapsedSeconds: 300,
    })).toBe(324)
    expect(waiting(record, {
      routeId: 'D2',
      boardingStopId: 'PGP',
      elapsedSeconds: 1_100,
    })).toBe(210)
  })

  it('rejects an expired stop snapshot', () => {
    const waiting = createLiveBusWaitingTimeProvider(snapshot, Date.parse('2026-09-23T14:11:00.000Z'))

    expect(waiting(record, {
      routeId: 'D2',
      boardingStopId: 'PGP',
      elapsedSeconds: 0,
    })).toBeNull()
  })

  it('rejects a stale stop snapshot before its provider expiry', () => {
    const waiting = createLiveBusWaitingTimeProvider(
      snapshot,
      Date.parse('2026-09-23T13:49:12.000Z'),
    )

    expect(waiting(record, {
      routeId: 'D2',
      boardingStopId: 'PGP',
      elapsedSeconds: 0,
    })).toBeNull()
  })

  it('uses the boarding stop observation time for a mixed snapshot', () => {
    const mixedSnapshot = {
      ...snapshot,
      stopObservations: {
        PGP: {
          observedAt: '2026-09-23T13:48:26.000Z',
          expiresAt: '2026-09-23T14:10:26.000Z',
        },
        'KR-MRT': {
          observedAt: '2026-09-23T13:49:26.000Z',
          expiresAt: '2026-09-23T14:10:26.000Z',
        },
      },
      stops: {
        ...snapshot.stops,
        'KR-MRT': {
          D2: {
            nextArrivalSeconds: 60,
            upcomingArrivalSeconds: [60],
            headwaySeconds: null,
          },
        },
      },
    } as const
    const waiting = createLiveBusWaitingTimeProvider(
      mixedSnapshot,
      Date.parse('2026-09-23T13:49:26.000Z'),
    )

    expect(waiting(record, {
      routeId: 'D2',
      boardingStopId: 'KR-MRT',
      elapsedSeconds: 0,
    })).toBe(60)
  })

  it('returns no live wait for a stop reported unavailable, even with a route and snapshot time', () => {
    const krMrtRoute = {
      D2: {
        nextArrivalSeconds: 60,
        upcomingArrivalSeconds: [60],
        headwaySeconds: null,
      },
    }
    const liveSnapshot = { ...snapshot, stops: { ...snapshot.stops, 'KR-MRT': krMrtRoute } }
    const unavailableSnapshot = { ...liveSnapshot, unavailableStopIds: ['KR-MRT'] } as const
    const nowMs = Date.parse(snapshot.observedAt)

    expect(createLiveBusWaitingTimeProvider(liveSnapshot, nowMs)(record, {
      routeId: 'D2',
      boardingStopId: 'KR-MRT',
      elapsedSeconds: 0,
    })).toBe(60)
    expect(createLiveBusWaitingTimeProvider(unavailableSnapshot, nowMs)(record, {
      routeId: 'D2',
      boardingStopId: 'KR-MRT',
      elapsedSeconds: 0,
    })).toBeNull()
  })

  it('waits five minutes at each test boarding and checks service at that boarding instant', () => {
    const wait = createTestBusWaitingTimeProvider(Date.parse('2026-09-23T14:50:00Z'), {
      A1: [{ routeId: 'A1', firstTime: '07:15', lastTime: '23:00', dayType: 'Mon-Fri', dates: [] }],
      B1: [{ routeId: 'B1', firstTime: '07:15', lastTime: '23:00', dayType: 'Mon-Fri', dates: [] }],
    })
    const record = {} as Parameters<typeof wait>[0]
    expect(wait(record, { routeId: 'A1', boardingStopId: 'STOP-A', elapsedSeconds: 0 })).toBe(300)
    expect(wait(record, { routeId: 'B1', boardingStopId: 'STOP-B', elapsedSeconds: 240 })).toBe(300)
    expect(wait(record, { routeId: 'B1', boardingStopId: 'STOP-B', elapsedSeconds: 600 })).toBeNull()
  })

  it('keeps the test-time wait well below the maximum bus wait', () => {
    expect(TEST_SHUTTLE_WAIT_SECONDS).toBeLessThan(MAX_BUS_WAIT_SECONDS)
  })
})
