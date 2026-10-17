import { describe, expect, it } from 'vitest'
import { createTransitNetworkIndex } from '@navus/shared/transit/index'
import { validateBusRouteGeometry } from '@navus/shared/transit/geometry'
import { generateShuttleTimingData } from '@navus/shared/transit/timing'
import { validateTransitNetwork } from '@navus/shared/transit/model'
import type { TripEndpoint } from '@navus/shared/routing/path'
import { getTripEndpointKey } from '../endpoints.ts'
import {
  searchPaths,
  searchPathsWithinBudget,
  searchPathCandidatesWithinBudget,
  zeroBusWaitingTime,
  type PathSearchInput,
  type PathWalkingConnection,
} from './search-path-candidates.ts'

const origin: TripEndpoint = { kind: 'venue', id: 'ORIGIN' }
const destination: TripEndpoint = { kind: 'venue', id: 'DESTINATION' }
const stopA: TripEndpoint = { kind: 'stop', id: 'STOP-A' }
const stopB: TripEndpoint = { kind: 'stop', id: 'STOP-B' }
const stopC: TripEndpoint = { kind: 'stop', id: 'STOP-C' }
const stopD: TripEndpoint = { kind: 'stop', id: 'STOP-D' }
const stopE: TripEndpoint = { kind: 'stop', id: 'STOP-E' }
const stopF: TripEndpoint = { kind: 'stop', id: 'STOP-F' }
const stopG: TripEndpoint = { kind: 'stop', id: 'STOP-G' }
const stopH: TripEndpoint = { kind: 'stop', id: 'STOP-H' }

function lineGeometry(from: TripEndpoint, to: TripEndpoint): PathWalkingConnection['geometry'] {
  const coordinateByEndpoint = new Map([
    [`venue:ORIGIN`, [102.999, 1] as const],
    [`stop:STOP-A`, [103, 1] as const],
    [`stop:STOP-B`, [103.001, 1] as const],
    [`stop:STOP-C`, [103.002, 1] as const],
    [`stop:STOP-D`, [103.003, 1] as const],
    [`stop:STOP-E`, [103.004, 1] as const],
    [`stop:STOP-F`, [103.005, 1] as const],
    [`stop:STOP-G`, [103.006, 1] as const],
    [`stop:STOP-H`, [103.007, 1] as const],
    [`venue:DESTINATION`, [103.002, 1] as const],
  ])
  return {
    type: 'LineString',
    coordinates: [coordinateByEndpoint.get(getTripEndpointKey(from))!, coordinateByEndpoint.get(getTripEndpointKey(to))!],
  }
}

function createTwoTransferInput(
  getShuttleWaitingSeconds: PathSearchInput['getShuttleWaitingSeconds'],
): PathSearchInput {
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
      { id: 'B1', name: 'B1', color: '#234567', stopIds: ['STOP-B', 'STOP-C'] },
      { id: 'C1', name: 'C1', color: '#345678', stopIds: ['STOP-C', 'STOP-D'] },
    ],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: ['A1', 'B1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1, longitude: 103.002, services: ['B1', 'C1'] },
      { id: 'STOP-D', longName: 'Stop D', shortName: 'D', latitude: 1, longitude: 103.003, services: ['C1'] },
    ],
  })
  const geometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { routeId: 'A1', name: 'A1', color: '#123456' }, geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] } },
      { type: 'Feature', properties: { routeId: 'B1', name: 'B1', color: '#234567' }, geometry: { type: 'LineString', coordinates: [[103.001, 1], [103.002, 1]] } },
      { type: 'Feature', properties: { routeId: 'C1', name: 'C1', color: '#345678' }, geometry: { type: 'LineString', coordinates: [[103.002, 1], [103.003, 1]] } },
    ],
  })
  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.002, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry: geometry,
    shuttleTiming: generateShuttleTimingData(network, geometry, '2026-09-22'),
    walkingConnections: [
      walking(origin, stopA, 100),
      walking({ kind: 'stop', id: 'STOP-D' }, destination, 100),
      walking(origin, destination, 1_000),
    ],
    getShuttleWaitingSeconds,
  }
}

function walking(
  from: TripEndpoint,
  to: TripEndpoint,
  durationSeconds: number,
  distanceMeters = durationSeconds,
): PathWalkingConnection {
  return {
    from,
    to,
    durationSeconds,
    distanceMeters,
    geometry: lineGeometry(from, to),
  }
}

function createInput(
  walkingConnections: readonly PathWalkingConnection[],
  getShuttleWaitingSeconds = zeroBusWaitingTime,
): PathSearchInput {
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
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'A1', name: 'A1', color: '#123456' },
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] },
    }],
  })

  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.002, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections,
    getShuttleWaitingSeconds,
  }
}

function createParallelRouteInput(): PathSearchInput {
  const routeIds = ['B1', 'A1']
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
    routes: routeIds.map((id) => ({ id, name: id, color: '#123456', stopIds: ['STOP-A', 'STOP-B'] })),
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: routeIds },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: routeIds },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: routeIds.map((routeId) => ({
      type: 'Feature' as const,
      properties: { routeId, name: routeId, color: '#123456' },
      geometry: { type: 'LineString' as const, coordinates: [[103, 1], [103.001, 1]] },
    })),
  })
  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.002, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      walking(origin, stopA, 10),
      walking(stopB, destination, 10),
      walking(origin, destination, 1_000),
    ],
    getShuttleWaitingSeconds: zeroBusWaitingTime,
  }
}

function createOneTransferInput(
  getShuttleWaitingSeconds: PathSearchInput['getShuttleWaitingSeconds'],
): PathSearchInput {
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
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1, longitude: 103.002, services: ['B1'] },
      { id: 'STOP-D', longName: 'Stop D', shortName: 'D', latitude: 1, longitude: 103.003, services: ['B1'] },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { routeId: 'A1', name: 'A1', color: '#123456' }, geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] } },
      { type: 'Feature', properties: { routeId: 'B1', name: 'B1', color: '#234567' }, geometry: { type: 'LineString', coordinates: [[103.002, 1], [103.003, 1]] } },
    ],
  })

  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.004, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      walking(origin, stopA, 80),
      walking(stopB, stopC, 30),
      walking({ kind: 'stop', id: 'STOP-D' }, destination, 80),
      walking(origin, destination, 2_000),
    ],
    getShuttleWaitingSeconds,
  }
}

function createFiveStopConnectorInput(
  walkingConnections: readonly PathWalkingConnection[],
  rideSecondsByPair: ReadonlyMap<string, number>,
): PathSearchInput {
  const stopIds = ['STOP-A', 'STOP-B', 'STOP-C', 'STOP-D', 'STOP-E']
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
      longName: 'Stop ' + id.slice(-1),
      shortName: id.slice(-1),
      latitude: 1,
      longitude: 103 + index * 0.001,
      services: ['A1'],
    })),
  })
  const routeGeometry = validateBusRouteGeometry(network, {
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
  const generatedTiming = generateShuttleTimingData(network, routeGeometry, '2026-09-22')
  const shuttleTiming = {
    ...generatedTiming,
    records: generatedTiming.records.map((record) => {
      const rideSeconds = rideSecondsByPair.get(record.fromStopId + '>' + record.toStopId)
      return rideSeconds === undefined
        ? record
        : {
          ...record,
          rideSeconds,
          rideSecondsLowerBound: rideSeconds,
          rideSecondsUpperBound: rideSeconds,
        }
    }),
  }

  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.005, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming,
    walkingConnections,
    getShuttleWaitingSeconds: zeroBusWaitingTime,
  }
}

function createEightStopDestinationInput(
  walkingConnections: readonly PathWalkingConnection[],
  rideSecondsByPair: ReadonlyMap<string, number>,
): PathSearchInput {
  const stopIds = ['STOP-A', 'STOP-B', 'STOP-C', 'STOP-D', 'STOP-E', 'STOP-F', 'STOP-G', 'STOP-H']
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
  const routeGeometry = validateBusRouteGeometry(network, {
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
  const generatedTiming = generateShuttleTimingData(network, routeGeometry, '2026-09-22')
  const shuttleTiming = {
    ...generatedTiming,
    records: generatedTiming.records.map((record) => {
      const rideSeconds = rideSecondsByPair.get(record.fromStopId + '>' + record.toStopId)
      return rideSeconds === undefined
        ? record
        : { ...record, rideSeconds, rideSecondsLowerBound: rideSeconds, rideSecondsUpperBound: rideSeconds }
    }),
  }

  return {
    origin: { endpoint: stopA, coordinate: { longitude: 103, latitude: 1 } },
    destination: { endpoint: stopH, coordinate: { longitude: 103.007, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming,
    walkingConnections,
    getShuttleWaitingSeconds: zeroBusWaitingTime,
  }
}

function createSameRouteInput(): PathSearchInput {
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
    routes: [{ id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-B', 'STOP-C'] }],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: ['A1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1, longitude: 103.002, services: ['A1'] },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'A1', name: 'A1', color: '#123456' },
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1], [103.002, 1]] },
    }],
  })

  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.002, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      walking(origin, stopA, 10),
      walking({ kind: 'stop', id: 'STOP-C' }, destination, 10),
      walking(origin, destination, 1_000),
    ],
    getShuttleWaitingSeconds: zeroBusWaitingTime,
  }
}

function createUpstreamBoardingInput(): PathSearchInput {
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
    routes: [{ id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-B', 'STOP-C'] }],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: ['A1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1, longitude: 103.002, services: ['A1'] },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'A1', name: 'A1', color: '#123456' },
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1], [103.002, 1]] },
    }],
  })
  const originStop: TripEndpoint = { kind: 'stop', id: 'STOP-B' }
  return {
    origin: { endpoint: originStop, coordinate: { longitude: 103.001, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.003, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      walking(originStop, stopA, 10),
      walking(stopC, destination, 10),
      walking(originStop, destination, 1_000),
    ],
    getShuttleWaitingSeconds: (record) => record.fromStopId === 'STOP-A' ? 0 : 100,
  }
}

function createTerminalReboardingInput(): PathSearchInput {
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
    routes: [{ id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-B', 'STOP-C', 'STOP-A'] }],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1.001, longitude: 103, services: ['A1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1.002, longitude: 103, services: ['A1'] },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'A1', name: 'A1', color: '#123456' },
      geometry: { type: 'LineString', coordinates: [[103, 1], [103, 1.001], [103, 1.002], [103, 1]] },
    }],
  })
  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.002, latitude: 1.003 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      walking(origin, stopB, 10),
      walking(stopC, destination, 10),
      walking(origin, destination, 1_000),
    ],
    getShuttleWaitingSeconds: (record) => (
      record.fromStopId === 'STOP-B' && record.toStopId === 'STOP-C' ? null : 5
    ),
  }
}

function createTimeDependentInput(): PathSearchInput {
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
      { id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-C', 'STOP-D'] },
      { id: 'B1', name: 'B1', color: '#234567', stopIds: ['STOP-D', 'STOP-E'] },
    ],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1, longitude: 103.002, services: ['A1'] },
      { id: 'STOP-D', longName: 'Stop D', shortName: 'D', latitude: 1, longitude: 103.003, services: ['A1', 'B1'] },
      { id: 'STOP-E', longName: 'Stop E', shortName: 'E', latitude: 1, longitude: 103.004, services: ['B1'] },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { routeId: 'A1', name: 'A1', color: '#123456' }, geometry: { type: 'LineString', coordinates: [[103, 1], [103.002, 1], [103.003, 1]] } },
      { type: 'Feature', properties: { routeId: 'B1', name: 'B1', color: '#234567' }, geometry: { type: 'LineString', coordinates: [[103.003, 1], [103.004, 1]] } },
    ],
  })
  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.005, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      walking(origin, stopA, 1),
      walking(origin, stopC, 100),
      walking(stopE, destination, 1),
      walking(origin, destination, 1_000),
    ],
    getShuttleWaitingSeconds: (record, context) => (
      record.routeId === 'B1' && context.elapsedSeconds < 100 ? 100 : 0
    ),
  }
}

function createLabelOverflowInput(): PathSearchInput {
  const branchStopIds = Array.from({ length: 9 }, (_, index) => `STOP-P${index + 1}`)
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
    routes: [{ id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-X', 'STOP-Y'] }],
    stops: [
      ...branchStopIds.map((id) => ({
        id,
        longName: id,
        shortName: id,
        latitude: 1,
        longitude: 103,
        services: ['PUB:WALKING'],
      })),
      { id: 'STOP-X', longName: 'Stop X', shortName: 'X', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-Y', longName: 'Stop Y', shortName: 'Y', latitude: 1, longitude: 103.001, services: ['A1'] },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId: 'A1', name: 'A1', color: '#123456' },
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1]] },
    }],
  })
  const genericGeometry: PathWalkingConnection['geometry'] = {
    type: 'LineString',
    coordinates: [[103, 1], [103.001, 1]],
  }

  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.002, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      ...branchStopIds.flatMap((id, index) => [
        { from: origin, to: { kind: 'stop', id } as TripEndpoint, durationSeconds: 0, distanceMeters: 0, geometry: genericGeometry },
        { from: { kind: 'stop', id } as TripEndpoint, to: { kind: 'stop', id: 'STOP-X' } as TripEndpoint, durationSeconds: index + 1, distanceMeters: index + 1, geometry: genericGeometry },
      ]),
      { from: { kind: 'stop', id: 'STOP-Y' } as TripEndpoint, to: destination, durationSeconds: 1, distanceMeters: 1, geometry: genericGeometry },
      { from: origin, to: destination, durationSeconds: 1_000, distanceMeters: 1_000, geometry: genericGeometry },
    ],
    getShuttleWaitingSeconds: (_record, context) => context.elapsedSeconds === 5 ? 0 : null,
  }
}

function createCompleteAlternativeInput(): PathSearchInput {
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
      { id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-C'] },
      { id: 'B1', name: 'B1', color: '#234567', stopIds: ['STOP-B', 'STOP-C'] },
    ],
    stops: [
      { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
      { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1, longitude: 103.001, services: ['B1'] },
      { id: 'STOP-C', longName: 'Stop C', shortName: 'C', latitude: 1, longitude: 103.002, services: ['A1', 'B1'] },
    ],
  })
  const routeGeometry = validateBusRouteGeometry(network, {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { routeId: 'A1', name: 'A1', color: '#123456' }, geometry: { type: 'LineString', coordinates: [[103, 1], [103.002, 1]] } },
      { type: 'Feature', properties: { routeId: 'B1', name: 'B1', color: '#234567' }, geometry: { type: 'LineString', coordinates: [[103.001, 1], [103.002, 1]] } },
    ],
  })
  const genericGeometry: PathWalkingConnection['geometry'] = {
    type: 'LineString',
    coordinates: [[103, 1], [103.001, 1]],
  }

  return {
    origin: { endpoint: origin, coordinate: { longitude: 102.999, latitude: 1 } },
    destination: { endpoint: destination, coordinate: { longitude: 103.003, latitude: 1 } },
    transitIndex: createTransitNetworkIndex(network),
    routeGeometry,
    shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
    walkingConnections: [
      { from: origin, to: stopA, durationSeconds: 1, distanceMeters: 1, geometry: genericGeometry },
      { from: origin, to: { kind: 'stop', id: 'STOP-B' }, durationSeconds: 10, distanceMeters: 10, geometry: genericGeometry },
      { from: { kind: 'stop', id: 'STOP-C' }, to: destination, durationSeconds: 1, distanceMeters: 1, geometry: genericGeometry },
      { from: origin, to: destination, durationSeconds: 1_000, distanceMeters: 1_000, geometry: genericGeometry },
    ],
    getShuttleWaitingSeconds: (record) => record.routeId === 'A1' ? null : 0,
  }
}

describe('searchPathCandidates', () => {
  it('caps venue-origin connectors to the five shortest walking durations', () => {
    const input = createFiveStopConnectorInput([
      walking(origin, stopA, 1),
      walking(origin, stopB, 2),
      walking(origin, stopC, 3),
      walking(origin, { kind: 'stop', id: 'STOP-D' }, 4),
      walking(stopE, destination, 1),
      walking(origin, destination, 10_000),
    ], new Map([
      ['STOP-A>STOP-E', 900],
      ['STOP-B>STOP-E', 800],
      ['STOP-C>STOP-E', 700],
      ['STOP-D>STOP-E', 1],
    ]))

    const path = searchPaths(input)

    expect(path?.legs.find((leg) => leg.mode === 'shuttle')).toMatchObject({
      boardingStopId: 'STOP-D',
      alightingStopId: 'STOP-E',
    })
  })

  it('caps venue-destination connectors to the five shortest walking durations', () => {
    const input = createFiveStopConnectorInput([
      walking(origin, stopA, 1),
      walking({ kind: 'stop', id: 'STOP-B' }, destination, 1),
      walking({ kind: 'stop', id: 'STOP-C' }, destination, 2),
      walking({ kind: 'stop', id: 'STOP-D' }, destination, 3),
      walking(stopE, destination, 4),
      walking(origin, destination, 10_000),
    ], new Map([
      ['STOP-A>STOP-B', 900],
      ['STOP-A>STOP-C', 800],
      ['STOP-A>STOP-D', 700],
      ['STOP-A>STOP-E', 1],
    ]))

    const path = searchPaths(input)

    expect(path?.legs.find((leg) => leg.mode === 'shuttle')).toMatchObject({
      boardingStopId: 'STOP-A',
      alightingStopId: 'STOP-E',
    })
  })

  it('allows a directed final walk from a same-route stop to a selected destination stop', async () => {
    const selectedDestination: TripEndpoint = { kind: 'stop', id: 'STOP-E' }
    const input = createFiveStopConnectorInput([
      walking(origin, stopA, 10),
      walking(stopD, selectedDestination, 20),
      walking(origin, selectedDestination, 2_000),
    ], new Map())
    const result = await searchPathCandidatesWithinBudget({
      ...input,
      destination: {
        endpoint: selectedDestination,
        coordinate: { longitude: 103.004, latitude: 1 },
      },
    })

    expect(result.rankedCandidates.some(({ path }) => {
      const lastLeg = path.legs.at(-1)
      return path.legs.some((leg) => leg.mode === 'shuttle') &&
        lastLeg?.mode === 'walking' &&
        lastLeg.from.kind === 'stop' && lastLeg.from.id === 'STOP-D' &&
        lastLeg.to.kind === 'stop' && lastLeg.to.id === 'STOP-E'
    })).toBe(true)
  })

  it('keeps exact direct walking available for a selected destination stop', async () => {
    const selectedDestination: TripEndpoint = { kind: 'stop', id: 'STOP-E' }
    const input = createFiveStopConnectorInput([
      walking(origin, selectedDestination, 100),
    ], new Map())
    const result = await searchPathCandidatesWithinBudget({
      ...input,
      destination: {
        endpoint: selectedDestination,
        coordinate: { longitude: 103.004, latitude: 1 },
      },
    })

    expect(result.rankedCandidates.some(({ path }) => (
      path.legs.length === 1 &&
      path.legs[0].mode === 'walking' &&
      path.legs[0].from.kind === 'venue' &&
      path.legs[0].to.kind === 'stop' &&
      path.legs[0].to.id === 'STOP-E'
    ))).toBe(true)
  })

  it('does not reverse a walking connection when reaching a selected destination stop', async () => {
    const selectedDestination: TripEndpoint = { kind: 'stop', id: 'STOP-E' }
    const input = createFiveStopConnectorInput([
      walking(origin, stopA, 10),
      walking(selectedDestination, stopD, 20),
      walking(origin, selectedDestination, 2_000),
    ], new Map())
    const result = await searchPathCandidatesWithinBudget({
      ...input,
      destination: {
        endpoint: selectedDestination,
        coordinate: { longitude: 103.004, latitude: 1 },
      },
    })

    expect(result.rankedCandidates.some(({ path }) => (
      path.legs.some((leg) => leg.mode === 'walking' &&
        leg.from.kind === 'stop' && leg.from.id === 'STOP-D' &&
        leg.to.kind === 'stop' && leg.to.id === 'STOP-E')
    ))).toBe(false)
  })

  it('keeps the exact destination plus at most five ranked egress connectors', async () => {
    const input = createEightStopDestinationInput([
      walking(stopB, stopH, 1),
      walking(stopC, stopH, 2),
      walking(stopD, stopH, 3),
      walking(stopE, stopH, 4),
      walking(stopF, stopH, 5),
      walking(stopG, stopH, 6),
      walking(stopA, stopH, 10_000),
    ], new Map([
      ['STOP-A>STOP-B', 200],
      ['STOP-A>STOP-C', 200],
      ['STOP-A>STOP-D', 200],
      ['STOP-A>STOP-E', 200],
      ['STOP-A>STOP-F', 200],
      ['STOP-A>STOP-G', 10],
      ['STOP-A>STOP-H', 500],
    ]))
    const result = await searchPathCandidatesWithinBudget(input)

    expect(result.rankedCandidates.some(({ path }) => (
      path.legs.some((leg) => leg.mode === 'shuttle' && leg.alightingStopId === 'STOP-H')
    ))).toBe(true)
    expect(result.rankedCandidates.some(({ path }) => {
      const lastLeg = path.legs.at(-1)
      return path.legs.some((leg) => leg.mode === 'shuttle') &&
        lastLeg?.mode === 'walking' &&
        lastLeg.from.kind === 'stop' && lastLeg.from.id === 'STOP-G' &&
        lastLeg.to.kind === 'stop' && lastLeg.to.id === 'STOP-H'
    })).toBe(false)
  })

  it('does not walk back to a selected stop already traversed by the bus leg', async () => {
    const selectedDestination: TripEndpoint = { kind: 'stop', id: 'STOP-D' }
    const input = createEightStopDestinationInput([
      walking(stopG, selectedDestination, 5),
      walking(stopA, selectedDestination, 5_000),
    ], new Map([
      ['STOP-A>STOP-D', 200],
      ['STOP-A>STOP-G', 10],
      ['STOP-A>STOP-H', 300],
    ]))
    const result = await searchPathCandidatesWithinBudget({
      ...input,
      destination: {
        endpoint: selectedDestination,
        coordinate: { longitude: 103.003, latitude: 1 },
      },
    })

    expect(result.rankedCandidates.some(({ path }) => {
      const lastLeg = path.legs.at(-1)
      return path.legs.some((leg) => leg.mode === 'shuttle') &&
        lastLeg?.mode === 'walking' &&
        lastLeg.from.kind === 'stop' && lastLeg.from.id === 'STOP-G' &&
        lastLeg.to.kind === 'stop' && lastLeg.to.id === 'STOP-D'
    })).toBe(false)
    expect(result.rankedCandidates.some(({ path }) => (
      path.legs.some((leg) => leg.mode === 'shuttle' && leg.alightingStopId === 'STOP-D')
    ))).toBe(true)
  })

  it('returns the walking-only Path and up to three distinct scored shuttle Paths', async () => {
    const input = createFiveStopConnectorInput([
      walking(origin, stopA, 10),
      walking(origin, { kind: 'stop', id: 'STOP-B' }, 20),
      walking({ kind: 'stop', id: 'STOP-E' }, destination, 10),
      walking(origin, destination, 1_000),
    ], new Map())
    const result = await searchPathsWithinBudget(input)
    const busCandidates = result.candidates.filter(({ path }) => (
      path.legs.some((leg) => leg.mode === 'shuttle')
    ))
    const walkingCandidates = result.candidates.filter(({ path }) => (
      path.legs.every((leg) => leg.mode === 'walking')
    ))

    expect(busCandidates.map(({ path }) => path.legs
      .filter((leg) => leg.mode === 'shuttle')
      .map((leg) => `${leg.routeId}:${leg.boardingStopId}>${leg.alightingStopId}`)))
      .toEqual([['A1:STOP-B>STOP-E'], ['A1:STOP-A>STOP-E']])
    expect(walkingCandidates).toHaveLength(1)
    expect(result.candidates).toHaveLength(3)
    expect(busCandidates[0]?.score).toBe(1 / busCandidates[0]!.adjustedDurationSeconds)
    expect(result.status).toBe('complete')
  })

  it('orders equal-score candidates deterministically by bus route sequence', async () => {
    const input = createParallelRouteInput()
    const firstSearch = await searchPathsWithinBudget(input)
    const secondSearch = await searchPathsWithinBudget(input)
    const firstBusCandidates = firstSearch.candidates.filter(({ path }) => (
      path.legs.some((leg) => leg.mode === 'shuttle')
    ))
    const secondBusCandidates = secondSearch.candidates.filter(({ path }) => (
      path.legs.some((leg) => leg.mode === 'shuttle')
    ))

    expect(firstBusCandidates.map(({ path }) => (
      path.legs.find((leg) => leg.mode === 'shuttle')?.routeId
    ))).toEqual(['A1', 'B1'])
    expect(firstBusCandidates[0]?.adjustedDurationSeconds)
      .toBe(firstBusCandidates[1]?.adjustedDurationSeconds)
    expect(firstBusCandidates.map(({ candidateKey }) => candidateKey))
      .toEqual(secondBusCandidates.map(({ candidateKey }) => candidateKey))
  })

  it('scores each walk and discounts only bus legs boarded after a transfer', async () => {
    const input = createOneTransferInput((record) => record.routeId === 'A1' ? 10 : 20)
    const result = await searchPathsWithinBudget(input)
    const candidate = result.candidates.find(({ path }) => (
      path.legs.filter((leg) => leg.mode === 'shuttle').length === 2
    ))
    const firstRide = input.shuttleTiming.records.find((record) => (
      record.routeId === 'A1' && record.fromStopId === 'STOP-A' && record.toStopId === 'STOP-B'
    ))?.rideSeconds
    const secondRide = input.shuttleTiming.records.find((record) => (
      record.routeId === 'B1' && record.fromStopId === 'STOP-C' && record.toStopId === 'STOP-D'
    ))?.rideSeconds

    expect(firstRide).not.toBeNull()
    expect(secondRide).not.toBeNull()
    expect(candidate?.path.legs.map((leg) => leg.mode)).toEqual([
      'walking', 'shuttle', 'walking', 'shuttle', 'walking',
    ])
    expect(candidate?.path.legs.filter((leg) => leg.mode === 'shuttle').map((leg) => (
      leg.mode === 'shuttle' ? leg.routeId : null
    ))).toEqual(['A1', 'B1'])
    expect(candidate?.adjustedDurationSeconds).toBeCloseTo(
      80 / 0.8 + 10 + firstRide! + 30 / 0.8 + (20 + secondRide!) / 0.9 + 80 / 0.8,
      8,
    )
    expect(candidate?.score).toBeCloseTo(1 / candidate!.adjustedDurationSeconds, 12)
  })

  it('deduplicates bus Paths that differ only by walking approaches', async () => {
    const input = createInput([
      walking(origin, stopA, 120),
      walking(origin, stopA, 90),
      walking(stopB, destination, 100),
    ])
    const result = await searchPathsWithinBudget(input)
    const busCandidates = result.candidates.filter(({ path }) => (
      path.legs.some((leg) => leg.mode === 'shuttle')
    ))

    expect(busCandidates).toHaveLength(1)
    expect(busCandidates[0]?.path.legs[0]).toMatchObject({ durationSeconds: 90 })
  })

  it('rejects incomplete walking geometry while keeping other complete candidates', async () => {
    const invalidGeometry = { type: 'LineString', coordinates: [[103, 1]] } as const
    const input = createInput([
      { ...walking(origin, stopA, 100), geometry: invalidGeometry },
      walking(stopB, destination, 100),
      walking(origin, destination, 500),
    ])
    const result = await searchPathsWithinBudget(input)

    expect(result.candidates.map(({ path }) => path.legs.map((leg) => leg.mode)))
      .toEqual([['walking']])
  })

  it('returns a valid one-transfer Path between different routes', async () => {
    const result = await searchPathsWithinBudget(createOneTransferInput(() => 5))
    const candidate = result.candidates.find(({ path }) => (
      path.legs.filter((leg) => leg.mode === 'shuttle').length === 2
    ))

    expect(candidate?.path.legs.filter((leg) => leg.mode === 'shuttle').map((leg) => (
      leg.mode === 'shuttle' ? leg.routeId : null
    ))).toEqual(['A1', 'B1'])
  })

  it('includes a directed bus leg when zero waiting makes it the best path', () => {
    const path = searchPaths(createInput([
      walking(origin, stopA, 100),
      walking(stopB, destination, 100),
      walking(origin, destination, 500),
    ]))

    expect(path).not.toBeNull()
    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking', 'shuttle', 'walking'])
    expect(path?.legs[1]).toMatchObject({
      routeId: 'A1',
      boardingStopId: 'STOP-A',
      alightingStopId: 'STOP-B',
      waitingSeconds: 0,
    })
    expect(path?.totalDurationSeconds).toBeLessThan(500)
    expect(path?.estimateStatus).toBe('estimated')
  })

  it('uses the waiting-time seam without changing the planner', () => {
    const path = searchPaths(createInput([
      walking(origin, stopA, 100),
      walking(stopB, destination, 100),
      walking(origin, destination, 500),
    ], () => 1_000))

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking'])
    expect(path?.totalDurationSeconds).toBe(500)
  })

  it('uses the direct walking connection instead of composing endpoint connectors', () => {
    const path = searchPaths(createInput([
      walking(origin, stopA, 100, 120),
      walking(stopA, destination, 200, 240),
      walking(origin, destination, 500, 600),
    ]))

    expect(path?.legs).toHaveLength(1)
    expect(path?.legs[0]).toMatchObject({
      mode: 'walking',
      from: origin,
      to: destination,
      durationSeconds: 500,
      distanceMeters: 600,
      geometry: {
        type: 'LineString',
        coordinates: [
          [102.999, 1],
          [103.002, 1],
        ],
      },
    })
    expect(path?.totalDurationSeconds).toBe(500)
    expect(path?.totalDistanceMeters).toBe(600)
  })

  it('keeps a continuous same-route ride as one bus leg', () => {
    const path = searchPaths(createSameRouteInput())

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking', 'shuttle', 'walking'])
    expect(path?.legs.filter((leg) => leg.mode === 'shuttle')).toHaveLength(1)
    expect(path?.legs[1]).toMatchObject({
      routeId: 'A1',
      boardingStopId: 'STOP-A',
      alightingStopId: 'STOP-C',
      waitingSeconds: 0,
    })
  })

  it('keeps a selected stop fixed instead of walking to another boarding stop', () => {
    const path = searchPaths(createUpstreamBoardingInput())

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['shuttle', 'walking'])
    expect(path?.legs[0]).toMatchObject({
      routeId: 'A1',
      boardingStopId: 'STOP-B',
      alightingStopId: 'STOP-C',
    })
  })

  it('does not reboard after a route reaches its declared terminal', () => {
    const path = searchPaths(createTerminalReboardingInput())

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking'])
    expect(path?.totalDurationSeconds).toBe(1_000)
  })

  it('uses direct walking when only a two-bus route could reach the destination', () => {
    const path = searchPaths(createTimeDependentInput())

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking'])
    expect(path?.totalDurationSeconds).toBe(1_000)
  })

  it('does not treat stop-to-stop walking as a path into the bus network', () => {
    const path = searchPaths(createLabelOverflowInput())

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking'])
    expect(path?.totalDurationSeconds).toBe(1_000)
  })

  it('does not use a walking cycle to manufacture a later shuttle opportunity', () => {
    const path = searchPaths(createInput([
      walking(origin, stopA, 0),
      walking(stopA, origin, 1),
      walking(stopB, destination, 1),
    ], (_record, context) => context.elapsedSeconds === 1 ? 0 : null))

    expect(path).toBeNull()
  })

  it('chooses a slower complete route when a faster option is unavailable', () => {
    const path = searchPaths(createCompleteAlternativeInput())

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking', 'shuttle', 'walking'])
    expect(path?.legs[1]).toMatchObject({ routeId: 'B1', boardingStopId: 'STOP-B' })
  })

  it('passes the elapsed path time to each bus wait calculation', () => {
    const contexts: number[] = []
    const path = searchPaths(createInput([
      walking(origin, stopA, 100),
      walking(stopB, destination, 100),
      walking(origin, destination, 500),
    ], (_record, context) => {
      contexts.push(context.elapsedSeconds)
      return 10
    }))

    expect(path?.legs[1]).toMatchObject({ waitingSeconds: 10 })
    expect(contexts).toContain(100)
  })

  it('falls back to direct walking when reaching the destination needs two transfers', () => {
    const path = searchPaths(createTwoTransferInput(() => 25))

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking'])
    expect(path?.totalDurationSeconds).toBe(1_000)
  })

  it('keeps shuttle movement directed and falls back to walking', () => {
    const path = searchPaths(createInput([
      walking(origin, stopB, 100),
      walking(stopA, destination, 100),
      walking(origin, destination, 500),
    ]))

    expect(path?.legs.map((leg) => leg.mode)).toEqual(['walking'])
    expect(path?.totalDurationSeconds).toBe(500)
  })

  it('plans the closing leg of a one-way loop', () => {
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
      routes: [{ id: 'A1', name: 'A1', color: '#123456', stopIds: ['STOP-A', 'STOP-B', 'STOP-A'] }],
      stops: [
        { id: 'STOP-A', longName: 'Stop A', shortName: 'A', latitude: 1, longitude: 103, services: ['A1'] },
        { id: 'STOP-B', longName: 'Stop B', shortName: 'B', latitude: 1.001, longitude: 103, services: ['A1'] },
      ],
    })
    const routeGeometry = validateBusRouteGeometry(network, {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { routeId: 'A1', name: 'A1', color: '#123456' },
        geometry: { type: 'LineString', coordinates: [[103, 1], [103, 1.001], [103, 1]] },
      }],
    })
    const path = searchPaths({
      origin: { endpoint: stopB, coordinate: { longitude: 103, latitude: 1.001 } },
      destination: { endpoint: stopA, coordinate: { longitude: 103, latitude: 1 } },
      transitIndex: createTransitNetworkIndex(network),
      routeGeometry,
      shuttleTiming: generateShuttleTimingData(network, routeGeometry, '2026-09-22'),
      walkingConnections: [],
      getShuttleWaitingSeconds: zeroBusWaitingTime,
    })

    expect(path?.legs).toHaveLength(1)
    expect(path?.legs[0]).toMatchObject({
      mode: 'shuttle',
      routeId: 'A1',
      boardingStopId: 'STOP-B',
      alightingStopId: 'STOP-A',
    })
  })

  it('returns no path when no complete connection exists', () => {
    expect(searchPaths(createInput([]))).toBeNull()
  })

  it('returns an exact result when the bounded search finishes', async () => {
    const result = await searchPathsWithinBudget(createInput([
      walking(origin, stopA, 100),
      walking(stopB, destination, 100),
      walking(origin, destination, 500),
    ]), { maxExpandedPaths: 10_000 })

    expect(result.status).toBe('complete')
    expect(result.path?.planningQuality).toBe('exact')
    expect(result.path?.totalDurationSeconds).toBeLessThan(500)
  })

  it('returns the best complete result when the search budget is reached', async () => {
    const input = createInput([
      walking(origin, stopA, 1),
      walking(stopB, destination, 1),
    ])
    const rideSeconds = input.shuttleTiming.records.find((record) => (
      record.routeId === 'A1' &&
      record.fromStopId === 'STOP-A' &&
      record.toStopId === 'STOP-B'
    ))?.rideSeconds
    if (rideSeconds === null || rideSeconds === undefined) {
      throw new Error('Expected a generated A1 ride estimate')
    }

    const result = await searchPathsWithinBudget({
      ...input,
      walkingConnections: [
        ...input.walkingConnections,
        walking(origin, destination, rideSeconds + 2),
      ],
    }, { maxExpandedPaths: 1 })

    expect(result.status).toBe('budget-exceeded')
    expect(result.path?.planningQuality).toBe('bounded')
    expect(result.path?.totalDurationSeconds).toBe(rideSeconds + 2)
  })

  it('enforces the deadline while building the bounded search index', async () => {
    const input = createInput([])
    const timingRecord = input.shuttleTiming.records[0]
    if (!timingRecord) throw new Error('Expected a generated bus timing record')
    let nowMs = 0
    let yieldCount = 0

    const result = await searchPathsWithinBudget({
      ...input,
      shuttleTiming: {
        ...input.shuttleTiming,
        records: Array.from({ length: 128 }, () => timingRecord),
      },
    }, {
      deadlineAtMs: 5,
      yieldEvery: 1,
      yieldControl: async () => {
        yieldCount += 1
        nowMs = 10
      },
      now: () => nowMs,
    })

    expect(yieldCount).toBe(1)
    expect(result.status).toBe('budget-exceeded')
    expect(result.expandedPathCount).toBe(0)
    expect(result.indexBuildDurationMs).toBe(10)
  })

  it('checks cancellation while building the bounded search index', async () => {
    const input = createInput([])
    const timingRecord = input.shuttleTiming.records[0]
    if (!timingRecord) throw new Error('Expected a generated bus timing record')
    const abortController = new AbortController()
    let yieldCount = 0

    const result = await searchPathsWithinBudget({
      ...input,
      shuttleTiming: {
        ...input.shuttleTiming,
        records: Array.from({ length: 128 }, () => timingRecord),
      },
    }, {
      shouldCancel: () => abortController.signal.aborted,
      yieldEvery: 1,
      yieldControl: async () => {
        yieldCount += 1
        abortController.abort()
      },
      now: () => 0,
    })

    expect(yieldCount).toBe(1)
    expect(result.status).toBe('cancelled')
    expect(result.expandedPathCount).toBe(0)
  })

  it('keeps explicit zero yieldEvery disabled during index construction', async () => {
    const input = createInput([])
    const timingRecord = input.shuttleTiming.records[0]
    if (!timingRecord) throw new Error('Expected a generated bus timing record')
    let yieldCount = 0

    const result = await searchPathsWithinBudget({
      ...input,
      shuttleTiming: {
        ...input.shuttleTiming,
        records: Array.from({ length: 128 }, () => timingRecord),
      },
    }, {
      yieldEvery: 0,
      yieldControl: async () => {
        yieldCount += 1
      },
    })

    expect(result.status).toBe('complete')
    expect(yieldCount).toBe(0)
  })

  it('stops before expanding a path when cancelled', async () => {
    const result = await searchPathsWithinBudget(createInput([
      walking(origin, destination, 100),
    ]), { shouldCancel: () => true })

    expect(result.status).toBe('cancelled')
    expect(result.expandedPathCount).toBe(0)
    expect(result.path).toBeNull()
  })
})
