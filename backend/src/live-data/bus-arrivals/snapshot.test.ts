import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createBusArrivalSnapshotStore,
  refreshBusArrivalSnapshot,
  type BusArrivalStop,
  type BusArrivalStopResult,
} from './snapshot.ts'

const stops: readonly BusArrivalStop[] = [
  { stopId: 'STOP-A', stopName: 'Stop A' },
  { stopId: 'STOP-B', stopName: 'Stop B' },
  { stopId: 'STOP-C', stopName: 'Stop C' },
]

function resultFor(_stopId: string, observedAt = '2026-10-10T10:00:00.000Z'): BusArrivalStopResult {
  return {
    observedAt,
    expiresAt: '2026-10-10T10:00:30.000Z',
    routes: {
      D1: {
        nextArrivalSeconds: 120,
        upcomingArrivalSeconds: [120, 480],
        headwaySeconds: { min: 360, max: 360, median: 360 },
      },
    },
  }
}

const previousSnapshot = {
  observedAt: '2026-10-10T09:59:30.000Z',
  expiresAt: '2026-10-10T10:00:00.000Z',
  snapshotVersion: 'previous',
  refreshedAt: '2026-10-10T09:59:30.000Z',
  nextRefreshAt: '2026-10-10T10:00:00.000Z',
  stops: Object.fromEntries(stops.map((stop) => [stop.stopId, resultFor(stop.stopId).routes])),
  stopObservations: Object.fromEntries(stops.map((stop) => [stop.stopId, {
    observedAt: '2026-10-10T09:59:30.000Z',
    expiresAt: '2026-10-10T10:00:00.000Z',
  }])),
} as const

describe('refreshBusArrivalSnapshot', () => {
  it('waits for a complete first generation before publishing any stops', async () => {
    const result = await refreshBusArrivalSnapshot(stops, async (stop) => {
      if (stop.stopId === 'STOP-B') throw new Error('NUS unavailable')
      return resultFor(stop.stopId)
    }, {
      snapshotVersion: 'first',
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
    })

    assert.equal(result.published, false)
    assert.equal(result.snapshot, null)
    assert.equal(result.successfulStopIds.length, stops.length - 1)
    assert.equal(result.failures.length, 1)
  })
  it('publishes every canonical stop after bounded requests settle', async () => {
    let active = 0
    let maximumActive = 0
    const result = await refreshBusArrivalSnapshot(stops, async (stop) => {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await Promise.resolve()
      active -= 1
      return resultFor(stop.stopId)
    }, {
      snapshotVersion: 'next',
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
      now: () => Date.parse('2026-10-10T10:00:01.000Z'),
    })

    assert.equal(maximumActive, 2)
    assert.equal(result.published, true)
    assert.deepEqual(Object.keys(result.snapshot?.stops ?? {}), ['STOP-A', 'STOP-B', 'STOP-C'])
    assert.equal(result.snapshot?.nextRefreshAt, '2026-10-10T10:00:31.000Z')
  })

  it('retains a failed stop value and its original observation time', async () => {
    const result = await refreshBusArrivalSnapshot(stops, async (stop) => {
      if (stop.stopId === 'STOP-B') throw new Error('NUS unavailable')
      return resultFor(stop.stopId, '2026-10-10T10:00:01.000Z')
    }, {
      previousSnapshot,
      snapshotVersion: 'next',
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
    })

    assert.equal(result.published, true)
    assert.deepEqual(result.snapshot?.stops['STOP-B'], previousSnapshot.stops['STOP-B'])
    assert.deepEqual(result.snapshot?.stopObservations?.['STOP-B'], previousSnapshot.stopObservations['STOP-B'])
  })

  it('retains the last good generation when every provider request fails', async () => {
    const result = await refreshBusArrivalSnapshot(stops, async () => {
      throw new Error('NUS unavailable')
    }, {
      previousSnapshot,
      snapshotVersion: 'next',
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
    })

    assert.equal(result.published, false)
    assert.equal(result.snapshot, previousSnapshot)
    assert.equal(result.failures.length, stops.length)
  })

  it('lists a failed stop with no previous data as unavailable', async () => {
    const keptStops = stops.filter((stop) => stop.stopId !== 'STOP-C')
    const previousWithoutStopC = {
      ...previousSnapshot,
      stops: Object.fromEntries(keptStops.map((stop) => [stop.stopId, previousSnapshot.stops[stop.stopId]])),
      stopObservations: Object.fromEntries(keptStops.map((stop) => [stop.stopId, previousSnapshot.stopObservations[stop.stopId]])),
    }
    const result = await refreshBusArrivalSnapshot(stops, async (stop) => {
      if (stop.stopId === 'STOP-C') throw new Error('NUS unavailable')
      return resultFor(stop.stopId, '2026-10-10T10:00:01.000Z')
    }, {
      previousSnapshot: previousWithoutStopC,
      snapshotVersion: 'next',
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
    })

    assert.equal(result.published, true)
    assert.deepEqual(result.snapshot?.unavailableStopIds, ['STOP-C'])
    assert.deepEqual(result.snapshot?.stops['STOP-C'], {})
    assert.equal(result.snapshot?.stopObservations?.['STOP-C'], undefined)
  })

  it('lists a failed stop that keeps previous data as unavailable', async () => {
    const result = await refreshBusArrivalSnapshot(stops, async (stop) => {
      if (stop.stopId === 'STOP-B') throw new Error('NUS unavailable')
      return resultFor(stop.stopId, '2026-10-10T10:00:01.000Z')
    }, {
      previousSnapshot,
      snapshotVersion: 'next',
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
    })

    assert.equal(result.published, true)
    assert.deepEqual(result.snapshot?.unavailableStopIds, ['STOP-B'])
    assert.equal(result.snapshot?.stops['STOP-B'], previousSnapshot.stops['STOP-B'])
  })

  it('keeps listing a stop that stays unavailable across passes', async () => {
    const result = await refreshBusArrivalSnapshot(stops, async (stop) => {
      if (stop.stopId === 'STOP-C') throw new Error('NUS unavailable')
      return resultFor(stop.stopId, '2026-10-10T10:00:01.000Z')
    }, {
      previousSnapshot: {
        ...previousSnapshot,
        stops: { ...previousSnapshot.stops, 'STOP-C': {} },
        unavailableStopIds: ['STOP-C'],
      },
      snapshotVersion: 'next',
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
    })

    assert.deepEqual(result.snapshot?.unavailableStopIds, ['STOP-C'])
  })
})

describe('createBusArrivalSnapshotStore', () => {
  it('starts the next refresh 30 seconds after the previous cycle started', async (context) => {
    context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.parse('2026-10-10T10:00:00.000Z') })
    let loadCount = 0
    const firstCycleResolvers: Array<(value: BusArrivalStopResult) => void> = []
    const store = createBusArrivalSnapshotStore({
      stops,
      refreshIntervalMs: 30_000,
      maxConcurrency: 3,
      loadStop: (stop) => {
        loadCount += 1
        if (loadCount <= stops.length) {
          return new Promise<BusArrivalStopResult>((resolve) => firstCycleResolvers.push(resolve))
        }
        return Promise.resolve(resultFor(stop.stopId))
      },
    })

    store.start()
    const firstCycle = store.refreshNow()
    assert.equal(loadCount, stops.length)

    context.mock.timers.tick(12_000)
    for (const resolve of firstCycleResolvers) resolve(resultFor('first-cycle'))
    await firstCycle
    assert.equal(store.getSnapshot()?.nextRefreshAt, '2026-10-10T10:00:30.000Z')
    assert.equal(store.getSnapshot()?.expiresAt, '2026-10-10T10:00:42.000Z')

    context.mock.timers.tick(17_999)
    assert.equal(loadCount, stops.length)
    context.mock.timers.tick(1)
    assert.equal(loadCount, stops.length * 2)

    await store.stop()
  })

  it('shares one in-flight refresh and never exposes a partial generation', async () => {
    let releaseSlowStop: (value: BusArrivalStopResult) => void = () => undefined
    const store = createBusArrivalSnapshotStore({
      stops,
      refreshIntervalMs: 30_000,
      maxConcurrency: 3,
      loadStop: async (stop) => {
        if (stop.stopId === 'STOP-C') {
          return new Promise<BusArrivalStopResult>((resolveResult) => {
            releaseSlowStop = resolveResult
          })
        }
        return resultFor(stop.stopId)
      },
    })

    const first = store.refreshNow()
    const second = store.refreshNow()
    assert.equal(first, second)
    await Promise.resolve()
    assert.equal(store.getSnapshot(), null)

    releaseSlowStop(resultFor('STOP-C'))
    await first
    assert.deepEqual(Object.keys(store.getSnapshot()?.stops ?? {}), ['STOP-A', 'STOP-B', 'STOP-C'])
  })
  it('starts a refresh immediately and aborts in-flight work on stop', async () => {
    let started = 0
    let aborted = false
    const store = createBusArrivalSnapshotStore({
      stops,
      refreshIntervalMs: 30_000,
      maxConcurrency: 2,
      loadStop: (_stop, signal) => {
        started += 1
        return new Promise<BusArrivalStopResult>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      },
    })

    store.start()
    await Promise.resolve()
    assert.ok(started > 0)
    await store.stop()
    assert.equal(aborted, true)
    assert.equal(store.getSnapshot(), null)
  })
})
