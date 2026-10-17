import { describe, expect, it } from 'vitest'
import type { LoadedTransitData } from '../../src/app/contracts/data'
import type { WalkingMatrixConnection, WalkingMatrixRequest } from '../../../backend/src/pathfinding/walking/walking-contracts'
import type { Path } from '../../../backend/src/pathfinding/path'
import type { PathWalkingConnection } from '../../../backend/src/pathfinding/search/search-path-candidates'
import { createLiveBusWaitingTimeProvider } from '../../../backend/src/pathfinding/pipeline/apply-bus-waits'
import type { ShuttleArrivalSnapshot } from '../../src/domain/transit/arrivals'
import type { ShuttleTimingRecord } from '@navus/shared/transit/timing'
import type { PathfindingBenchmarkCase } from './contract'
import { validatePathfindingBenchmarkOutcome } from './outcome'

const fixedNowMs = Date.parse('2026-10-01T00:00:00.000Z')
const fixedNow = new Date(fixedNowMs).toISOString()
const stopCoordinates = {
  A: [103.77, 1.29],
  B: [103.771, 1.291],
  C: [103.772, 1.292],
  D: [103.773, 1.293],
} as const
const origin = { kind: 'stop', id: 'A' } as const
const destination = { kind: 'stop', id: 'B' } as const

const timingRecords: readonly ShuttleTimingRecord[] = [
  {
    routeId: 'R1', fromStopId: 'A', toStopId: 'B', status: 'estimated',
    rideSeconds: 80, rideSecondsLowerBound: 60, rideSecondsUpperBound: 100,
    waitingSeconds: null, source: 'test', method: 'test', methodVersion: 'test-v1',
    observedAt: null, geometryVerifiedAt: '2026-10-01', unavailableReason: null,
  },
  {
    routeId: 'R2', fromStopId: 'C', toStopId: 'D', status: 'estimated',
    rideSeconds: 90, rideSecondsLowerBound: 70, rideSecondsUpperBound: 110,
    waitingSeconds: null, source: 'test', method: 'test', methodVersion: 'test-v1',
    observedAt: null, geometryVerifiedAt: '2026-10-01', unavailableReason: null,
  },
]

const transit = {
  index: {
    stopById: new Map(Object.entries(stopCoordinates).map(([id, [longitude, latitude]]) => [
      id,
      { id, longitude, latitude },
    ])),
    stops: Object.entries(stopCoordinates).map(([id, [longitude, latitude]]) => ({ id, longitude, latitude })),
    routeById: new Map([
      ['R1', { id: 'R1', stopIds: ['A', 'B'] }],
      ['R2', { id: 'R2', stopIds: ['C', 'D'] }],
    ]),
  },
  shuttleTiming: { records: timingRecords },
} as unknown as LoadedTransitData

const venues = {
  V: { roomName: 'Venue V', location: { x: 103.769, y: 1.289 } },
  W: { roomName: 'Venue W', location: { x: 103.773, y: 1.293 } },
}

function createSnapshot(stops: ShuttleArrivalSnapshot['stops']): ShuttleArrivalSnapshot {
  return {
    observedAt: fixedNow,
    expiresAt: new Date(fixedNowMs + 3_600_000).toISOString(),
    stops,
  }
}

const defaultSnapshot = createSnapshot({
  A: { R1: { nextArrivalSeconds: 10, upcomingArrivalSeconds: [10], headwaySeconds: null } },
  C: { R2: { nextArrivalSeconds: 250, upcomingArrivalSeconds: [250], headwaySeconds: null } },
})

const offlineWalk: PathWalkingConnection = {
  from: origin,
  to: destination,
  durationSeconds: 50,
  distanceMeters: 40,
  geometry: { type: 'LineString', coordinates: [stopCoordinates.A, stopCoordinates.B] },
}

function createCase(
  expected: PathfindingBenchmarkCase['expected'],
  durationBoundsSeconds?: PathfindingBenchmarkCase['durationBoundsSeconds'],
  options: {
    origin?: PathfindingBenchmarkCase['origin']
    destination?: PathfindingBenchmarkCase['destination']
    snapshot?: ShuttleArrivalSnapshot
    walkingConnections?: readonly PathWalkingConnection[]
    timingRecords?: readonly ShuttleTimingRecord[]
  } = {},
): PathfindingBenchmarkCase {
  const caseOrigin = options.origin ?? origin
  const caseDestination = options.destination ?? destination
  const snapshot = options.snapshot ?? defaultSnapshot
  const records = options.timingRecords ?? timingRecords
  return {
    id: 'fixture',
    label: 'fixture',
    origin: caseOrigin,
    destination: caseDestination,
    arrivalSeconds: 10,
    arrivalSnapshot: snapshot,
    transit: {
      ...transit,
      shuttleTiming: { records },
    } as LoadedTransitData,
    expected,
    ...(durationBoundsSeconds ? { durationBoundsSeconds } : {}),
    searchInput: {
      walkingConnections: options.walkingConnections ?? [offlineWalk],
      getShuttleWaitingSeconds: createLiveBusWaitingTimeProvider(snapshot, fixedNowMs),
    } as PathfindingBenchmarkCase['searchInput'],
  }
}

function createWalkPath(
  connection: PathWalkingConnection = offlineWalk,
): Path {
  return {
    origin: connection.from,
    destination: connection.to,
    legs: [{ mode: 'walking', ...connection }],
    totalDurationSeconds: connection.durationSeconds,
    totalDistanceMeters: connection.distanceMeters,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }
}

function createBusPath(waitingSeconds = 10, rideSeconds = 80): Path {
  const durationSeconds = waitingSeconds + rideSeconds
  return {
    origin,
    destination,
    legs: [{
      mode: 'shuttle',
      from: origin,
      to: destination,
      routeId: 'R1',
      boardingStopId: 'A',
      alightingStopId: 'B',
      waitingSeconds,
      rideSeconds,
      durationSeconds,
      distanceMeters: 1200,
      geometry: { type: 'LineString', coordinates: [stopCoordinates.A, stopCoordinates.B] },
    }],
    totalDurationSeconds: durationSeconds,
    totalDistanceMeters: 1200,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }
}

function validate(
  path: Path,
  benchmarkCase: PathfindingBenchmarkCase,
  evidence: Parameters<typeof validatePathfindingBenchmarkOutcome>[4],
) {
  return validatePathfindingBenchmarkOutcome({ kind: 'path', path }, benchmarkCase, transit, venues, evidence)
}

describe('validatePathfindingBenchmarkOutcome', () => {
  it('accepts offline walking metrics prepared for the benchmark case', () => {
    const benchmarkCase = createCase({ outcome: 'path', shuttleBoardings: 0, modes: ['walking'] })
    const result = validate(createWalkPath(), benchmarkCase, { mode: 'offline' })

    expect(result.valid).toBe(true)
    expect(result.result).toMatchObject({
      kind: 'path',
      modes: ['walking'],
      shuttleBoardings: 0,
      totalDurationSeconds: 50,
    })
  })

  it('accepts merged walking legs whose metrics sum from prepared connections', () => {
    const venueOrigin = { kind: 'venue', id: 'V' } as const
    const venueDestination = { kind: 'venue', id: 'W' } as const
    const firstConnection: PathWalkingConnection = {
      from: venueOrigin,
      to: origin,
      durationSeconds: 40,
      distanceMeters: 30,
      geometry: { type: 'LineString', coordinates: [[103.769, 1.289], stopCoordinates.A] },
    }
    const secondConnection: PathWalkingConnection = {
      from: origin,
      to: venueDestination,
      durationSeconds: 60,
      distanceMeters: 50,
      geometry: { type: 'LineString', coordinates: [stopCoordinates.A, [103.773, 1.293]] },
    }
    const merged: PathWalkingConnection = {
      from: venueOrigin,
      to: venueDestination,
      durationSeconds: 100,
      distanceMeters: 80,
      geometry: {
        type: 'LineString',
        coordinates: [[103.769, 1.289], stopCoordinates.A, [103.773, 1.293]],
      },
    }
    const benchmarkCase = createCase({ outcome: 'path', modes: ['walking'] }, undefined, {
      origin: venueOrigin,
      destination: venueDestination,
      walkingConnections: [firstConnection, secondConnection],
    })

    expect(validate(createWalkPath(merged), benchmarkCase, { mode: 'offline' }).valid).toBe(true)
  })

  it('rejects tampered offline walking duration and distance', () => {
    const path = createWalkPath({ ...offlineWalk, durationSeconds: 51, distanceMeters: 41 })
    const result = validate(path, createCase({ outcome: 'path' }), { mode: 'offline' })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('walking leg 1 durationSeconds does not match benchmark evidence')
    expect(result.errors).toContain('walking leg 1 distanceMeters does not match benchmark evidence')
  })

  it('rejects and reports Valhalla request attempts in offline mode', () => {
    const result = validate(
      createWalkPath(),
      createCase({ outcome: 'path' }),
      { mode: 'offline', valhallaRequestCounts: { matrix: 1, route: 0 } },
    )

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('offline benchmark made 1 Valhalla matrix and 0 route requests')
    expect(result.result).toMatchObject({ valhallaRequests: { matrix: 1, route: 0 } })
  })

  it('checks local endpoint walking metrics against captured Valhalla matrix output', () => {
    const venueOrigin = { kind: 'venue', id: 'V' } as const
    const connection: PathWalkingConnection = {
      from: venueOrigin,
      to: destination,
      durationSeconds: 15,
      distanceMeters: 20,
      geometry: { type: 'LineString', coordinates: [[103.769, 1.289], stopCoordinates.B] },
    }
    const benchmarkCase = createCase({ outcome: 'path', modes: ['walking'] }, undefined, {
      origin: venueOrigin,
      walkingConnections: [connection],
    })
    const request: WalkingMatrixRequest = {
      sources: [{ longitude: 103.769, latitude: 1.289 }],
      targets: [{ longitude: stopCoordinates.B[0], latitude: stopCoordinates.B[1] }],
    }
    const matrixConnection: WalkingMatrixConnection = {
      fromIndex: 0,
      toIndex: 0,
      durationSeconds: 15,
      distanceMeters: 20,
    }
    const path = createWalkPath(connection)
    const result = validate(path, benchmarkCase, {
      mode: 'local',
      matrixRequests: [{ request, connections: [matrixConnection] }],
      valhallaRequestCounts: { matrix: 1, route: 2 },
    })

    expect(result.valid).toBe(true)
    expect(result.result).toMatchObject({ valhallaRequests: { matrix: 1, route: 2 } })
  })

  it('checks local stop-to-stop walking metrics against the canonical walking graph', () => {
    const graphConnection = { fromKey: 'stop:A', toKey: 'stop:B', durationSeconds: 50, distanceMeters: 40 }
    const path = createWalkPath()
    const result = validate(path, createCase({ outcome: 'path' }), {
      mode: 'local',
      walkingStopGraph: { connections: [graphConnection] } as never,
    })

    expect(result.valid).toBe(true)
  })

  it('rejects walking metrics that disagree with a local matrix result', () => {
    const venueOrigin = { kind: 'venue', id: 'V' } as const
    const connection: PathWalkingConnection = {
      from: venueOrigin,
      to: destination,
      durationSeconds: 15,
      distanceMeters: 20,
      geometry: { type: 'LineString', coordinates: [[103.769, 1.289], stopCoordinates.B] },
    }
    const benchmarkCase = createCase({ outcome: 'path' }, undefined, {
      origin: venueOrigin,
      walkingConnections: [connection],
    })
    const result = validate(createWalkPath({ ...connection, durationSeconds: 16, distanceMeters: 21 }), benchmarkCase, {
      mode: 'local',
      matrixRequests: [{
        request: {
          sources: [{ longitude: 103.769, latitude: 1.289 }],
          targets: [{ longitude: stopCoordinates.B[0], latitude: stopCoordinates.B[1] }],
        },
        connections: [{ fromIndex: 0, toIndex: 0, durationSeconds: 15, distanceMeters: 20 }],
      }],
    })

    expect(result.errors).toContain('walking leg 1 durationSeconds does not match benchmark evidence')
    expect(result.errors).toContain('walking leg 1 distanceMeters does not match benchmark evidence')
  })

  it('rejects shuttle wait and ride values that do not match case timing', () => {
    const benchmarkCase = createCase({ outcome: 'path', shuttleBoardings: 1, modes: ['shuttle'] })
    const tamperedWait = createBusPath(9, 80)
    const tamperedRide = createBusPath(10, 81)

    expect(validate(tamperedWait, benchmarkCase, { mode: 'offline' }).errors)
      .toContain('shuttle leg 1 waitingSeconds does not match benchmark timing')
    expect(validate(tamperedRide, benchmarkCase, { mode: 'offline' }).errors)
      .toContain('shuttle leg 1 rideSeconds does not match case timing')
  })

  it('accepts a headway-derived wait from the case snapshot', () => {
    const snapshot = createSnapshot({
      A: { R1: {
        nextArrivalSeconds: 0,
        upcomingArrivalSeconds: [],
        headwaySeconds: { min: 120, median: 120, max: 120 },
      } },
    })
    const benchmarkCase = createCase({ outcome: 'path', shuttleBoardings: 1, modes: ['shuttle'] }, undefined, { snapshot })
    const result = validate(createBusPath(60, 80), benchmarkCase, { mode: 'offline' })

    expect(result.valid).toBe(true)
  })

  it('accepts a transfer when each wait reflects elapsed path time', () => {
    const transferOrigin = { kind: 'stop', id: 'A' } as const
    const transferDestination = { kind: 'stop', id: 'D' } as const
    const transferWalk: PathWalkingConnection = {
      from: { kind: 'stop', id: 'B' },
      to: { kind: 'stop', id: 'C' },
      durationSeconds: 30,
      distanceMeters: 10,
      geometry: { type: 'LineString', coordinates: [stopCoordinates.B, stopCoordinates.C] },
    }
    const benchmarkCase = createCase({
      outcome: 'path',
      shuttleBoardings: 2,
      modes: ['shuttle', 'walking', 'shuttle'],
    }, undefined, {
      origin: transferOrigin,
      destination: transferDestination,
      walkingConnections: [transferWalk],
    })
    const path: Path = {
      origin: transferOrigin,
      destination: transferDestination,
      legs: [
        createBusPath(10, 80).legs[0],
        { mode: 'walking', ...transferWalk },
        {
          mode: 'shuttle',
          from: { kind: 'stop', id: 'C' },
          to: transferDestination,
          routeId: 'R2',
          boardingStopId: 'C',
          alightingStopId: 'D',
          waitingSeconds: 130,
          rideSeconds: 90,
          durationSeconds: 220,
          distanceMeters: 900,
          geometry: { type: 'LineString', coordinates: [stopCoordinates.C, stopCoordinates.D] },
        },
      ],
      totalDurationSeconds: 340,
      totalDistanceMeters: 2110,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }
    const result = validate(path, benchmarkCase, { mode: 'offline' })

    expect(result.valid).toBe(true)
  })

  it('rejects Path totals that do not equal the leg totals', () => {
    const path = { ...createWalkPath(), totalDurationSeconds: 51 }
    const result = validate(path, createCase({ outcome: 'path' }), { mode: 'offline' })

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('path totalDurationSeconds must equal the sum of its leg durations')
  })

  it('rejects geometry that does not meet the Path endpoints', () => {
    const path = {
      ...createWalkPath(),
      legs: [{
        ...createWalkPath().legs[0],
        geometry: { type: 'LineString', coordinates: [[103.78, 1.3], stopCoordinates.B] },
      }],
    } as unknown as Path
    const result = validate(path, createCase({ outcome: 'path' }), { mode: 'offline' })

    expect(result.errors).toContain('leg 1 geometry does not start near its from endpoint')
  })

  it('checks exact route selection for tie cases only when expected', () => {
    const result = validate(
      createBusPath(),
      createCase({ outcome: 'path', shuttleBoardings: 1, modes: ['shuttle'], routeIds: ['R2'] }),
      { mode: 'offline' },
    )

    expect(result.errors).toContain('expected routes R2; got R1')
  })

  it('enforces an optional Path duration bound', () => {
    const result = validate(
      createWalkPath(),
      createCase({ outcome: 'path' }, { max: 40 }),
      { mode: 'offline' },
    )

    expect(result.errors).toContain('path totalDurationSeconds exceeds the maximum 40')
  })

  it('accepts an explicit no-route result only when the case expects one', () => {
    const expectedNoRoute = validatePathfindingBenchmarkOutcome(
      { kind: 'no-route', reason: 'No complete path.' },
      createCase({ outcome: 'no-route' }),
      transit,
      venues,
      { mode: 'offline' },
    )
    const unexpectedNoRoute = validatePathfindingBenchmarkOutcome(
      { kind: 'no-route', reason: 'No complete path.' },
      createCase({ outcome: 'path' }),
      transit,
      venues,
      { mode: 'offline' },
    )

    expect(expectedNoRoute.valid).toBe(true)
    expect(unexpectedNoRoute.errors).toContain('expected path; got no-route')
  })
})
