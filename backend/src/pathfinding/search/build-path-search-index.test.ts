import { describe, expect, it } from 'vitest'
import { validateBusRouteGeometry } from '@navus/shared/transit/geometry'
import { validateTransitNetwork } from '@navus/shared/transit/model'
import { generateShuttleTimingData } from '@navus/shared/transit/timing'
import { createTransitNetworkIndex } from '@navus/shared/transit/index'
import { buildSearchIndex } from './build-path-search-index.ts'
import { zeroBusWaitingTime, type PathSearchInput } from './search-path-candidates.ts'

// The line passes STOP-B twice: 3 m away on the way out, then directly over it on the way back to STOP-C.
function createLoopPassInput(): PathSearchInput {
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
    routes: [{ id: 'L1', name: 'L1', color: '#123456', stopIds: ['STOP-A', 'STOP-B', 'STOP-C'] }],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['L1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1.00003, longitude: 103.001, services: ['L1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1.00003, longitude: 103.003, services: ['L1'] },
    ],
  })
  const geometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'L1', name: 'L1', color: '#123456' },
      geometry: {
        type: 'LineString',
        coordinates: [
          [103, 1],
          [103.0012, 1],
          [103.0012, 1.01],
          [103.001, 1.01],
          [103.001, 1.00003],
          [103.003, 1.00003],
        ],
      },
    }],
  })
  return {
    origin: { endpoint: { kind: 'venue', id: 'ORIGIN' }, coordinate: { longitude: 103, latitude: 1 } },
    destination: { endpoint: { kind: 'venue', id: 'DESTINATION' }, coordinate: { longitude: 103.001, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry: geometry,
    shuttleTiming: generateShuttleTimingData(network, geometry, '2026-09-22'),
    walkingConnections: [],
    getShuttleWaitingSeconds: zeroBusWaitingTime,
  }
}

describe('buildSearchIndex ride geometry', () => {
  it('slices a ride at the stop pass that follows Route order, not the nearest later pass', () => {
    const index = buildSearchIndex(createLoopPassInput())
    const ride = index.ridesByBoardingStopId.get('STOP-A')?.find((candidate) => candidate.toStopId === 'STOP-B')

    expect(ride).toBeDefined()
    const sliced = index.getRideGeometry(ride!)
    expect(sliced?.distanceMeters).toBeLessThan(150)
    expect(sliced?.geometry.coordinates.every(([, latitude]) => latitude < 1.001)).toBe(true)
  })
})
