import { describe, expect, it, vi } from 'vitest'
import { createTransitIndex } from '@navus/shared/transit/index'
import { validateTransitNetwork } from '@navus/shared/transit/model'
import { validateBusRouteGeometry } from '@navus/shared/transit/geometry'
import { generateShuttleTimingData } from '@navus/shared/transit/timing'
import { createFindPathsTestService, type TestTransitData } from './find-paths.test-support.ts'
import { createCurrentLocationTripEndpoint } from './endpoints.ts'

function createTransitData(): TestTransitData {
  const network = validateTransitNetwork({
    version: 1,
    metadata: {
      source: 'test',
      routeStopOrder: 'test',
      routeGeometry: 'test',
      verifiedAt: '2026-09-22',
      routeOrderSource: 'test',
      coordinateSource: 'test',
    },
    routes: [{ id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-B'] }],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: ['A1'] },
    ],
  })
  const geometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'A1', name: 'A1', color: '#123456' },
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] },
    }],
  })
  const index = createTransitIndex(network)
  return {
    network: index.network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(index.network, geometry, '2026-09-22'),
  }
}

function createParallelRouteTransitData(): TestTransitData {
  const network = validateTransitNetwork({
    version: 1,
    metadata: {
      source: 'test',
      routeStopOrder: 'test',
      routeGeometry: 'test',
      verifiedAt: '2026-09-22',
      routeOrderSource: 'test',
      coordinateSource: 'test',
    },
    routes: [
      { id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-B'] },
      { id: 'B1', name: 'B1', color: '#234567', stopIds: ['STOP-A', 'STOP-B'] },
    ],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1', 'B1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: ['A1', 'B1'] },
    ],
  })
  const geometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { routeId: 'A1', name: 'A1', color: '#123456' }, geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] } },
      { type: 'Feature', properties: { routeId: 'B1', name: 'B1', color: '#234567' }, geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] } },
    ],
  })
  const index = createTransitIndex(network)
  return {
    network: index.network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(index.network, geometry, '2026-09-22'),
  }
}

function createAlternativeTransitData(): TestTransitData {
  const network = validateTransitNetwork({
    version: 1,
    metadata: {
      source: 'test',
      routeStopOrder: 'test',
      routeGeometry: 'test',
      verifiedAt: '2026-09-22',
      routeOrderSource: 'test',
      coordinateSource: 'test',
    },
    routes: [
      { id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-B'] },
      { id: 'B1', name: 'B1', color: '#234567', stopIds: ['STOP-C', 'STOP-D'] },
    ],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: ['A1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1, longitude: 103.01, services: ['B1'] },
      { id: 'STOP-D', longName: 'Stop D', shortName: 'D', latitude: 1, longitude: 103.011, services: ['B1'] },
    ],
  })
  const geometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { routeId: 'A1', name: 'A1', color: '#123456' }, geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] } },
      { type: 'Feature', properties: { routeId: 'B1', name: 'B1', color: '#234567' }, geometry: { type: 'LineString', coordinates: [[103.01, 1], [103.011, 1]] } },
    ],
  })
  return {
    network: createTransitIndex(network).network,
    geometry,
    index: createTransitIndex(network),
    shuttleTiming: generateShuttleTimingData(network, geometry, '2026-09-22'),
  }
}

function createFourStopTransitData(): TestTransitData {
  const stopIds = ['STOP-A', 'STOP-B', 'STOP-C', 'STOP-D']
  const network = validateTransitNetwork({
    version: 1,
    metadata: {
      source: 'test',
      routeStopOrder: 'test',
      routeGeometry: 'test',
      verifiedAt: '2026-09-22',
      routeOrderSource: 'test',
      coordinateSource: 'test',
    },
    routes: [{ id: 'A1', name: 'A1', color: '#123456', stopIds }],
    stops: stopIds.map((id, index) => ({
      id,
      longName: `Stop ${id.slice(-1)}`,
      shortName: id.slice(-1),
      latitude: 1,
      longitude: 103 + index * 0.001,
      services: ['A1'],
    })),
  })
  const geometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'A1', name: 'A1', color: '#123456' },
      geometry: {
        type: 'LineString',
        coordinates: stopIds.map((_, index) => [103 + index * 0.001, 1]),
      },
    }],
  })
  const index = createTransitIndex(network)
  return {
    network: index.network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(index.network, geometry, '2026-09-22'),
  }
}

function createAlternativeRouteEngine() {
  return {
    matrixWalking: vi.fn(async () => [
      { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 0, toIndex: 4, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 5, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 0, toIndex: 1, distanceMeters: 1_000, durationSeconds: 1_000 },
    ]),
    routeWalking: vi.fn(async ({ origin, destination }) => ({
      distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
      durationSeconds: 100,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [origin.longitude, origin.latitude] as const,
          [destination.longitude, destination.latitude] as const,
        ],
      },
    })),
  }
}

describe('findPaths', () => {
  it('plans a walking Path from the frozen Current location coordinate', async () => {
    const transit = createTransitData()
    const currentLocation = createCurrentLocationTripEndpoint({
      longitude: 103.78,
      latitude: 1.29,
    })!
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 250, durationSeconds: 180 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 250,
        durationSeconds: 180,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const result = await createFindPathsTestService(routeEngine)({
      tripRequest: {
        origin: currentLocation,
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        DESTINATION: { roomName: 'Destination', location: { x: 103.79, y: 1.295 } },
      },
      transit,
      signal: new AbortController().signal,
    })
    const path = result?.candidates[0]?.path ?? null

    expect(path).toMatchObject({
      origin: currentLocation,
      destination: { kind: 'venue', id: 'DESTINATION' },
      legs: [{
        mode: 'walking',
        from: currentLocation,
        to: { kind: 'venue', id: 'DESTINATION' },
        geometry: { coordinates: [[103.78, 1.29], [103.79, 1.295]] },
      }],
    })
    expect(routeEngine.routeWalking).toHaveBeenCalledWith(expect.objectContaining({
      origin: { longitude: 103.78, latitude: 1.29 },
    }), expect.any(AbortSignal))
  })

  it('uses the five shortest reachable venue connectors even when each exceeds five minutes', async () => {
    const transit = createFourStopTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 2, distanceMeters: 600, durationSeconds: 600 },
        { fromIndex: 0, toIndex: 3, distanceMeters: 700, durationSeconds: 700 },
        { fromIndex: 0, toIndex: 4, distanceMeters: 800, durationSeconds: 800 },
        { fromIndex: 0, toIndex: 5, distanceMeters: 900, durationSeconds: 900 },
        { fromIndex: 2, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 200, durationSeconds: 200 },
        { fromIndex: 4, toIndex: 1, distanceMeters: 300, durationSeconds: 300 },
        { fromIndex: 5, toIndex: 1, distanceMeters: 400, durationSeconds: 400 },
        { fromIndex: 0, toIndex: 1, distanceMeters: 10_000, durationSeconds: 10_000 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {
          'STOP-A': { A1: { nextArrivalSeconds: 1_000, upcomingArrivalSeconds: [1_000], headwaySeconds: null } },
          'STOP-B': { A1: { nextArrivalSeconds: 1_000, upcomingArrivalSeconds: [1_000], headwaySeconds: null } },
        },
      })),
    }

    const result = await createFindPathsTestService(routeEngine, shuttleArrivalClient)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.005, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })

    expect(shuttleArrivalClient.getArrivals).toHaveBeenCalledWith(
      [
        { stopId: 'STOP-A', stopName: 'Stop A' },
        { stopId: 'STOP-B', stopName: 'Stop B' },
        { stopId: 'STOP-C', stopName: 'Stop C' },
      ],
      expect.any(AbortSignal),
    )
    const path = result?.candidates[0]?.path ?? null
    expect(path?.legs.some((leg) => leg.mode === 'shuttle')).toBe(true)
    expect(path?.legs[0]).toMatchObject({ mode: 'walking', durationSeconds: 600 })
    expect(path?.legs.find((leg) => leg.mode === 'shuttle')).toMatchObject({ waitingSeconds: 400 })
    expect(result?.candidates.length).toBeGreaterThan(1)
    expect(result?.candidates.every((candidate) => (
      candidate.path.legs.every((leg) => leg.mode !== 'walking' || leg.geometry.coordinates.length >= 2)
    ))).toBe(true)
  })

  it('converts walking matrix results and route geometry into a shuttle Path', async () => {
    const transit = createTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 500, durationSeconds: 500 },
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const service = createFindPathsTestService(routeEngine)

    const path = (await service({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking', 'shuttle', 'walking'])
    expect(path?.legs[1]).toMatchObject({ routeId: 'A1', waitingSeconds: 0 })
    expect(routeEngine.matrixWalking).toHaveBeenCalledOnce()
    expect(routeEngine.routeWalking).toHaveBeenCalledTimes(3)
  })

  it('shares walking geometry requests across the scored candidate pool', async () => {
    const transit = createParallelRouteTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 1_000, durationSeconds: 1_000 },
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const result = await createFindPathsTestService(routeEngine)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })

    expect(result?.candidates.filter(({ path }) => path.legs.some((leg) => leg.mode === 'shuttle'))
      .map(({ path }) => path.legs.filter((leg) => leg.mode === 'shuttle').map((leg) => (
        leg.mode === 'shuttle' ? leg.routeId : ''
      )))).toEqual([['A1'], ['B1']])
    expect(result?.candidates.some(({ path }) => path.legs.every((leg) => leg.mode === 'walking'))).toBe(true)
    expect(routeEngine.routeWalking).toHaveBeenCalledTimes(3)
    expect(result?.metrics.geometryRouteRequests).toBe(3)
    expect(result?.metrics.geometryRouteCacheHits).toBe(2)
  })

  it('skips bus candidates with incomplete routed geometry and falls back to a complete walking Path', async () => {
    const transit = createParallelRouteTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 1_000, durationSeconds: 1_000 },
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: origin.longitude < 103 && destination.longitude === 103
            ? [[origin.longitude, origin.latitude] as const]
            : [
              [origin.longitude, origin.latitude] as const,
              [destination.longitude, destination.latitude] as const,
            ],
        },
      })),
    }
    const result = await createFindPathsTestService(routeEngine)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })

    expect(result?.candidates).toHaveLength(1)
    expect(result?.candidates[0]?.path.legs.every((leg) => leg.mode === 'walking')).toBe(true)
    expect(result?.candidates.every((candidate) => candidate.path.legs.every((leg) => (
      leg.geometry.coordinates.length >= 2
    )))).toBe(true)
    expect(result?.metrics.geometryCandidateChecks).toBe(3)
    expect(result?.metrics.geometryRouteCacheHits).toBe(2)
  })

  it('uses the walking connection provider instead of the full matrix', async () => {
    const transit = createTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => {
        throw new Error('The full walking matrix should not be requested')
      }),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const walkingConnectionProvider = {
      getWalkingConnections: vi.fn(async () => [
        {
          fromKey: 'venue:ORIGIN',
          toKey: 'stop:STOP-A',
          distanceMeters: 100,
          durationSeconds: 100,
        },
        {
          fromKey: 'stop:STOP-B',
          toKey: 'venue:DESTINATION',
          distanceMeters: 100,
          durationSeconds: 100,
        },
        {
          fromKey: 'venue:ORIGIN',
          toKey: 'venue:DESTINATION',
          distanceMeters: 10_000,
          durationSeconds: 10_000,
        },
      ]),
    }
    const service = createFindPathsTestService(
      routeEngine,
      undefined,
      undefined,
      Date.now,
      walkingConnectionProvider,
    )

    const path = (await service({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking', 'shuttle', 'walking'])
    expect(walkingConnectionProvider.getWalkingConnections).toHaveBeenCalledOnce()
    expect(routeEngine.matrixWalking).not.toHaveBeenCalled()
  })

  it('keeps a selected stop fixed when considering one-bus options', async () => {
    const transit = createAlternativeTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => []),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const walkingConnectionProvider = {
      getWalkingConnections: vi.fn(async () => [
        { fromKey: 'stop:STOP-A', toKey: 'stop:STOP-C', distanceMeters: 20, durationSeconds: 20 },
        { fromKey: 'stop:STOP-B', toKey: 'venue:DESTINATION', distanceMeters: 100, durationSeconds: 100 },
        { fromKey: 'stop:STOP-D', toKey: 'venue:DESTINATION', distanceMeters: 100, durationSeconds: 100 },
        { fromKey: 'stop:STOP-A', toKey: 'venue:DESTINATION', distanceMeters: 5_000, durationSeconds: 5_000 },
      ]),
    }
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 120,
              upcomingArrivalSeconds: [120],
              headwaySeconds: null,
            },
          },
        },
      })),
    }

    const result = await createFindPathsTestService(
      routeEngine,
      shuttleArrivalClient,
      undefined,
      Date.now,
      walkingConnectionProvider,
    )({
      tripRequest: {
        origin: { kind: 'stop', id: 'STOP-A' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        DESTINATION: { roomName: 'Destination', location: { x: 103.012, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })
    const path = result?.candidates[0]?.path ?? null

    expect(shuttleArrivalClient.getArrivals).toHaveBeenCalledWith(
      [{ stopId: 'STOP-A', stopName: 'Stop A' }],
      expect.any(AbortSignal),
    )
    expect(path?.legs.find((leg) => leg.mode === 'shuttle')).toMatchObject({
      routeId: 'A1',
      boardingStopId: 'STOP-A',
      alightingStopId: 'STOP-B',
    })
  })

  it('enriches a same-route final walk to a selected destination stop while keeping the origin stop fixed', async () => {
    const transit = createFourStopTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => []),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const walkingConnectionProvider = {
      getWalkingConnections: vi.fn(async () => [
        { fromKey: 'stop:STOP-C', toKey: 'stop:STOP-D', distanceMeters: 100, durationSeconds: 100 },
        { fromKey: 'stop:STOP-D', toKey: 'stop:STOP-C', distanceMeters: 100, durationSeconds: 100 },
        { fromKey: 'stop:STOP-A', toKey: 'stop:STOP-D', distanceMeters: 5_000, durationSeconds: 5_000 },
      ]),
    }

    const result = await createFindPathsTestService(
      routeEngine,
      undefined,
      undefined,
      Date.now,
      walkingConnectionProvider,
    )({
      tripRequest: {
        origin: { kind: 'stop', id: 'STOP-A' },
        destination: { kind: 'stop', id: 'STOP-D' },
      },
      venues: {},
      transit,
      signal: new AbortController().signal,
    })

    expect(result?.candidates.some(({ path: candidate }) => {
      const firstLeg = candidate.legs[0]
      const finalLeg = candidate.legs.at(-1)

      return firstLeg?.mode === 'shuttle' &&
        firstLeg.boardingStopId === 'STOP-A' &&
        finalLeg?.mode === 'walking' &&
        finalLeg.from.kind === 'stop' &&
        finalLeg.from.id === 'STOP-C' &&
        finalLeg.to.kind === 'stop' &&
        finalLeg.to.id === 'STOP-D'
    })).toBe(true)
    expect(routeEngine.routeWalking).toHaveBeenCalledWith(
      {
        origin: { longitude: 103.002, latitude: 1 },
        destination: { longitude: 103.003, latitude: 1 },
      },
      expect.any(AbortSignal),
    )
  })

  it('falls back to an exact-stop Path when destination egress geometry is invalid', async () => {
    const transit = createFourStopTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => []),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: origin.longitude === 103.002 && destination.longitude === 103.003
          ? { type: 'LineString' as const, coordinates: [[103.002, 1] as const] }
          : {
              type: 'LineString' as const,
              coordinates: [
                [origin.longitude, origin.latitude] as const,
                [destination.longitude, destination.latitude] as const,
              ],
            },
      })),
    }
    const walkingConnectionProvider = {
      getWalkingConnections: vi.fn(async () => [
        { fromKey: 'stop:STOP-C', toKey: 'stop:STOP-D', distanceMeters: 100, durationSeconds: 100 },
        { fromKey: 'stop:STOP-A', toKey: 'stop:STOP-D', distanceMeters: 5_000, durationSeconds: 5_000 },
      ]),
    }

    const path = (await createFindPathsTestService(
      routeEngine,
      undefined,
      undefined,
      Date.now,
      walkingConnectionProvider,
    )({
      tripRequest: {
        origin: { kind: 'stop', id: 'STOP-A' },
        destination: { kind: 'stop', id: 'STOP-D' },
      },
      venues: {},
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(routeEngine.routeWalking).toHaveBeenCalledWith(
      {
        origin: { longitude: 103.002, latitude: 1 },
        destination: { longitude: 103.003, latitude: 1 },
      },
      expect.any(AbortSignal),
    )
    expect(path?.legs.map((leg) => leg.mode)).toEqual(['shuttle'])
    expect(path?.legs[0]).toMatchObject({
      routeId: 'A1',
      boardingStopId: 'STOP-A',
      alightingStopId: 'STOP-D',
    })
  })

  it('does not hide aborted walking requests as no-route results', async () => {
    const transit = createTransitData()
    const controller = new AbortController()
    const routeEngine = {
      matrixWalking: vi.fn(async () => {
        controller.abort()
        return []
      }),
      routeWalking: vi.fn(),
    }

    await expect(createFindPathsTestService(routeEngine)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('uses live arrival data for the boarding wait', async () => {
    const transit = createTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 500, durationSeconds: 500 },
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 120,
              upcomingArrivalSeconds: [120, 480],
              headwaySeconds: { min: 360, max: 360, median: 360 },
            },
          },
        },
      })),
    }
    const path = (await createFindPathsTestService(routeEngine, shuttleArrivalClient)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(shuttleArrivalClient.getArrivals).toHaveBeenCalledWith(
      [
        { stopId: 'STOP-A', stopName: 'Stop A' },
      ],
      expect.any(AbortSignal),
    )
    expect(path?.legs[1]).toMatchObject({ waitingSeconds: 20 })
  })

  it('allows waiting before service starts when boarding occurs during service', async () => {
    const transit = createTransitData()
    const nowMs = Date.parse('2026-09-23T22:30:00.000Z')
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 10_000, durationSeconds: 10_000 },
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 3_600_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 3_000,
              upcomingArrivalSeconds: [3_000],
              headwaySeconds: null,
            },
          },
        },
      })),
    }
    const shuttleServiceHoursClient = {
      getServiceWindows: vi.fn(async () => ({
        A1: [{ routeId: 'A1', firstTime: '07:15', lastTime: '23:00', dayType: 'Mon-Fri', dates: [] }],
      })),
    }

    const path = (await createFindPathsTestService(
      routeEngine,
      shuttleArrivalClient,
      shuttleServiceHoursClient,
      () => nowMs,
    )({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(path?.legs.some((leg) => leg.mode === 'shuttle')).toBe(true)
    expect(path?.legs.find((leg) => leg.mode === 'shuttle')).toMatchObject({
      waitingSeconds: 2_900,
    })
  })

  it('rejects boarding after service ends even when reaching the stop during service', async () => {
    const transit = createTransitData()
    const nowMs = Date.parse('2026-09-23T23:18:00.000Z')
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 10_000, durationSeconds: 10_000 },
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 3_600_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 180,
              upcomingArrivalSeconds: [180],
              headwaySeconds: null,
            },
          },
        },
      })),
    }
    const shuttleServiceHoursClient = {
      getServiceWindows: vi.fn(async () => ({
        A1: [{ routeId: 'A1', firstTime: '07:15', lastTime: '07:20', dayType: 'Mon-Fri', dates: [] }],
      })),
    }

    const path = (await createFindPathsTestService(
      routeEngine,
      shuttleArrivalClient,
      shuttleServiceHoursClient,
      () => nowMs,
    )({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(path?.legs.some((leg) => leg.mode === 'shuttle')).toBe(false)
    expect(path?.legs).toHaveLength(1)
    expect(path?.legs[0].mode).toBe('walking')
  })

  it('requests live arrivals only for nearby boarding stops', async () => {
    const transit = createTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 0, toIndex: 3, distanceMeters: 500, durationSeconds: 500 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 0, toIndex: 1, distanceMeters: 1_000, durationSeconds: 1_000 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 120,
              upcomingArrivalSeconds: [120],
              headwaySeconds: null,
            },
          },
        },
      })),
    }

    await createFindPathsTestService(routeEngine, shuttleArrivalClient)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })

    expect(shuttleArrivalClient.getArrivals).toHaveBeenCalledWith(
      [{ stopId: 'STOP-A', stopName: 'Stop A' }],
      expect.any(AbortSignal),
    )
  })

  it('lets a better-timed alternative replace the static winner', async () => {
    const transit = createAlternativeTransitData()
    const routeEngine = createAlternativeRouteEngine()
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 600,
              upcomingArrivalSeconds: [600],
              headwaySeconds: null,
            },
          },
          'STOP-C': {
            B1: {
              nextArrivalSeconds: 200,
              upcomingArrivalSeconds: [200],
              headwaySeconds: null,
            },
          },
        },
      })),
    }

    const path = (await createFindPathsTestService(routeEngine, shuttleArrivalClient)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.012, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(shuttleArrivalClient.getArrivals).toHaveBeenCalledWith(
      [
        { stopId: 'STOP-A', stopName: 'Stop A' },
        { stopId: 'STOP-C', stopName: 'Stop C' },
      ],
      expect.any(AbortSignal),
    )
    expect(path?.legs.some((leg) => leg.mode === 'shuttle' && leg.routeId === 'B1')).toBe(true)
  })

  it('uses a different-route transfer when no single route reaches the destination', async () => {
    const transit = createAlternativeTransitData()
    const routeEngine = createAlternativeRouteEngine()
    routeEngine.matrixWalking.mockResolvedValue([
      { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 3, toIndex: 4, distanceMeters: 50, durationSeconds: 50 },
      { fromIndex: 5, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 0, toIndex: 1, distanceMeters: 1_000, durationSeconds: 1_000 },
    ])

    const result = await createFindPathsTestService(routeEngine)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.012, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })

    const transferCandidate = result?.candidates.find(({ path: candidatePath }) => (
      candidatePath.legs.filter((leg) => leg.mode === 'shuttle')
        .map((leg) => leg.routeId).join(',') === 'A1,B1'
    ))
    expect(transferCandidate?.path.legs.map((leg) => leg.mode)).toEqual([
      'walking', 'shuttle', 'walking', 'shuttle', 'walking',
    ])
  })

  it('uses live arrivals and service windows for transfer-only shuttle candidates', async () => {
    const transit = createAlternativeTransitData()
    const routeEngine = createAlternativeRouteEngine()
    routeEngine.matrixWalking.mockResolvedValue([
      { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 3, toIndex: 4, distanceMeters: 50, durationSeconds: 50 },
      { fromIndex: 5, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 0, toIndex: 1, distanceMeters: 1_000, durationSeconds: 1_000 },
    ])
    const nowMs = Date.parse('2026-09-23T00:00:00.000Z')
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date(nowMs).toISOString(),
        expiresAt: new Date(nowMs + 60 * 60_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 120,
              upcomingArrivalSeconds: [120],
              headwaySeconds: null,
            },
          },
          'STOP-C': {
            B1: {
              nextArrivalSeconds: 450,
              upcomingArrivalSeconds: [450],
              headwaySeconds: null,
            },
          },
        },
      })),
    }
    const shuttleServiceHoursClient = {
      getServiceWindows: vi.fn(async () => ({
        A1: [{ routeId: 'A1', firstTime: '07:00', lastTime: '09:00', dayType: 'Mon-Fri', dates: [] }],
        B1: [{ routeId: 'B1', firstTime: '07:00', lastTime: '09:00', dayType: 'Mon-Fri', dates: [] }],
      })),
    }

    const service = createFindPathsTestService(
      routeEngine,
      shuttleArrivalClient,
      shuttleServiceHoursClient,
      () => nowMs,
    )
    const request = {
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.012, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    } satisfies Parameters<typeof service>[0]
    const result = await service(request)

    expect(shuttleArrivalClient.getArrivals).toHaveBeenCalledWith(
      [
        { stopId: 'STOP-A', stopName: 'Stop A' },
        { stopId: 'STOP-C', stopName: 'Stop C' },
      ],
      expect.any(AbortSignal),
    )
    expect(shuttleServiceHoursClient.getServiceWindows).toHaveBeenCalledWith(
      ['A1', 'B1'],
      expect.any(AbortSignal),
    )
    const transferCandidate = result?.candidates.find(({ path: candidatePath }) => (
      candidatePath.legs.filter((leg) => leg.mode === 'shuttle')
        .map((leg) => leg.routeId).join(',') === 'A1,B1'
    ))
    expect(transferCandidate?.path.legs.map((leg) => leg.mode)).toEqual([
      'walking', 'shuttle', 'walking', 'shuttle', 'walking',
    ])
    const shuttleLegs = transferCandidate?.path.legs.filter((leg) => leg.mode === 'shuttle') ?? []
    expect(shuttleLegs.map((leg) => leg.mode === 'shuttle' ? [leg.routeId, leg.waitingSeconds] : []))
      .toEqual([['A1', 20], ['B1', expect.any(Number)]])
    const transferPath = transferCandidate!.path
    const secondShuttleIndex = transferPath.legs.findIndex((leg) => (
      leg.mode === 'shuttle' && leg.routeId === 'B1'
    ))
    const secondBoardingElapsedSeconds = transferPath.legs
      .slice(0, secondShuttleIndex)
      .reduce((total, leg) => total + leg.durationSeconds, 0)
    const secondShuttleLeg = transferPath.legs[secondShuttleIndex]
    expect(secondShuttleLeg?.mode).toBe('shuttle')
    if (secondShuttleLeg?.mode === 'shuttle') {
      expect(secondShuttleLeg.waitingSeconds).toBe(450 - secondBoardingElapsedSeconds)
    }
    expect(transferCandidate?.path.legs.every((leg) => (
      leg.mode !== 'walking' || leg.geometry.coordinates.length >= 2
    ))).toBe(true)

    shuttleServiceHoursClient.getServiceWindows.mockResolvedValue({
      A1: [{ routeId: 'A1', firstTime: '07:00', lastTime: '09:00', dayType: 'Mon-Fri', dates: [] }],
      B1: [{ routeId: 'B1', firstTime: '08:30', lastTime: '09:00', dayType: 'Mon-Fri', dates: [] }],
    })
    const beforeService = await service(request)
    expect(beforeService?.candidates.every(({ path: candidatePath }) => (
      candidatePath.legs.every((leg) => leg.mode === 'walking')
    ))).toBe(true)
  })

  it('uses a complete one-bus route with a walking leg after alighting', async () => {
    const transit = createAlternativeTransitData()
    const routeEngine = createAlternativeRouteEngine()
    routeEngine.matrixWalking.mockResolvedValue([
      { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 3, toIndex: 4, distanceMeters: 50, durationSeconds: 50 },
      { fromIndex: 3, toIndex: 1, distanceMeters: 200, durationSeconds: 200 },
      { fromIndex: 5, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      { fromIndex: 0, toIndex: 1, distanceMeters: 1_000, durationSeconds: 1_000 },
    ])
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {
          'STOP-A': {
            A1: {
              nextArrivalSeconds: 120,
              upcomingArrivalSeconds: [120],
              headwaySeconds: null,
            },
          },
        },
      })),
    }

    const path = (await createFindPathsTestService(routeEngine, shuttleArrivalClient)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.012, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking', 'shuttle', 'walking'])
    expect(path?.legs.find((leg) => leg.mode === 'shuttle')).toMatchObject({
      routeId: 'A1',
      boardingStopId: 'STOP-A',
      alightingStopId: 'STOP-B',
    })
  })

  it('keeps the walking-only Path when live timing removes every shuttle edge', async () => {
    const transit = createAlternativeTransitData()
    const routeEngine = createAlternativeRouteEngine()
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {},
      })),
    }

    const path = (await createFindPathsTestService(routeEngine, shuttleArrivalClient)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.012, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }))?.candidates[0]?.path ?? null

    expect(path?.legs).toHaveLength(1)
    expect(path?.legs[0].mode).toBe('walking')
    expect(path?.totalDurationSeconds).toBe(1_000)
  })

  it('throws when live arrival data cannot be fetched', async () => {
    const transit = createAlternativeTransitData()
    const routeEngine = createAlternativeRouteEngine()
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => {
        throw new Error('Live shuttle API unavailable')
      }),
    }

    await expect(createFindPathsTestService(routeEngine, shuttleArrivalClient)({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.012, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })).rejects.toThrow('Live shuttle API unavailable')
  })

  it('does not return a shuttle path after the route service window ends', async () => {
    const transit = createTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const shuttleArrivalClient = {
      getArrivals: vi.fn(async () => ({
        observedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        stops: {},
      })),
    }
    const shuttleServiceHoursClient = {
      getServiceWindows: vi.fn(async () => ({
        A1: [{ routeId: 'A1', firstTime: '07:15', lastTime: '07:20', dayType: 'Mon-Fri', dates: [] }],
      })),
    }

    await expect(createFindPathsTestService(
      routeEngine,
      shuttleArrivalClient,
      shuttleServiceHoursClient,
      () => new Date('2026-09-23T02:00:00.000Z').getTime(),
    )({
      tripRequest: {
        origin: { kind: 'venue', id: 'ORIGIN' },
        destination: { kind: 'venue', id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: 'NoPathAvailableError',
      message: 'bus service has ended for today. It resumes tomorrow at 7:15 AM.',
    })
  })

  it('uses fixed test waits and the selected service window without fetching live arrivals', async () => {
    const transit = createTransitData()
    const routeEngine = {
      matrixWalking: vi.fn(async () => [
        { fromIndex: 0, toIndex: 1, distanceMeters: 2_000, durationSeconds: 2_000 },
        { fromIndex: 0, toIndex: 2, distanceMeters: 100, durationSeconds: 100 },
        { fromIndex: 3, toIndex: 1, distanceMeters: 100, durationSeconds: 100 },
      ]),
      routeWalking: vi.fn(async ({ origin, destination }) => ({
        distanceMeters: Math.round(Math.abs(destination.longitude - origin.longitude) * 100_000),
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      })),
    }
    const shuttleArrivalClient = { getArrivals: vi.fn() }
    const shuttleServiceHoursClient = {
      getServiceWindows: vi.fn(async () => ({
        A1: [{ routeId: 'A1', firstTime: '07:15', lastTime: '23:00', dayType: 'Mon-Fri', dates: [] }],
      })),
    }
    let testDepartureMs = Date.parse('2026-09-23T04:00:00Z')
    const service = createFindPathsTestService(
      routeEngine,
      shuttleArrivalClient,
      shuttleServiceHoursClient,
      Date.now,
      undefined,
      () => testDepartureMs,
    )
    const request = {
      tripRequest: {
        origin: { kind: 'venue' as const, id: 'ORIGIN' },
        destination: { kind: 'venue' as const, id: 'DESTINATION' },
      },
      venues: {
        ORIGIN: { roomName: 'Origin', location: { x: 102.999, y: 1 } },
        DESTINATION: { roomName: 'Destination', location: { x: 103.002, y: 1 } },
      },
      transit,
      signal: new AbortController().signal,
    }

    const activePath = (await service(request))?.candidates[0]?.path ?? null
    expect(activePath?.legs.find((leg) => leg.mode === 'shuttle')).toMatchObject({ waitingSeconds: 300 })
    expect(shuttleArrivalClient.getArrivals).not.toHaveBeenCalled()

    testDepartureMs = Date.parse('2026-09-23T15:25:00Z')
    const endedPath = (await service(request))?.candidates[0]?.path ?? null
    expect(endedPath?.legs.every((leg) => leg.mode === 'walking')).toBe(true)
    expect(shuttleArrivalClient.getArrivals).not.toHaveBeenCalled()
  })
})
