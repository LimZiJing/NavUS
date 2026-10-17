import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { LoadedTransitData } from '../../src/app/contracts/data.js'
import type { PathEndpointLocation } from '../../../backend/src/pathfinding/path.js'
import {
  createLiveBusWaitingTimeProvider,
} from '../../../backend/src/pathfinding/pipeline/apply-bus-waits.js'
import type {
  PathSearchInput,
  PathWalkingConnection,
} from '../../../backend/src/pathfinding/search/search-path-candidates.js'
import type { ShuttleArrivalSnapshot } from '../../src/domain/transit/arrivals.js'
import { createTransitIndex } from '../../src/domain/transit/index.js'
import { validateTransitMapData } from '@navus/shared/transit/map-data'
import { evaluateShuttleService } from '../../src/domain/transit/service-hours.js'
import { generateShuttleTimingData } from '@navus/shared/transit/timing'
import type { VenueLocationMap } from '@navus/shared/venue/types'
import { validateVenueLocationMap } from '@navus/shared/venue/validation'
import { validateWalkingStopGraph } from '@navus/shared/routing/walking-stop-graph'
import type {
  PathfindingBenchmarkManifest,
  PathfindingBenchmarkManifestCase,
  PathfindingBenchmarkTimingProfile,
} from './manifest.js'
import {
  applyBenchmarkShuttleTimingProfile,
  createBenchmarkArrivalSnapshot,
  createBenchmarkServiceWindows,
} from './profiles.js'

export interface PathfindingBenchmarkFixtures {
  readonly transit: LoadedTransitData
  readonly venues: VenueLocationMap
  readonly walkingGraph: ReturnType<typeof validateWalkingStopGraph>
}

export interface PreparedPathfindingBenchmarkCase extends Omit<PathfindingBenchmarkManifestCase, 'timingProfile'> {
  readonly arrivalSeconds: number
  readonly arrivalSnapshot: ShuttleArrivalSnapshot
  readonly transit: LoadedTransitData
  readonly timingProfile: PathfindingBenchmarkTimingProfile
  readonly searchInput: PathSearchInput
}

async function readJson(root: string, path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(root, path), 'utf8')) as unknown
}

export async function loadPathfindingBenchmarkFixtures(
  root = process.cwd(),
): Promise<PathfindingBenchmarkFixtures> {
  const [networkInput, geometryInput, venuesInput, walkingGraphInput] = await Promise.all([
    readJson(root, 'public/data/shuttle-network.json'),
    readJson(root, 'public/data/shuttle-routes.geojson'),
    readJson(root, 'public/data/venues.json'),
    readJson(root, 'public/data/walking-stop-graph.json'),
  ])
  const { network, geometry } = validateTransitMapData(networkInput, geometryInput)
  const index = createTransitIndex(network)
  const transit = {
    network: index.network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(index.network, geometry, '2026-10-01'),
  }
  return {
    transit,
    venues: validateVenueLocationMap(venuesInput),
    walkingGraph: validateWalkingStopGraph(walkingGraphInput),
  }
}

function endpointCoordinate(
  endpoint: PathfindingBenchmarkManifestCase['origin'],
  venues: VenueLocationMap,
  transit: LoadedTransitData,
): { readonly longitude: number; readonly latitude: number } {
  if (endpoint.kind === 'stop') {
    const stop = transit.index.stopById.get(endpoint.id)
    if (!stop) throw new Error(`Unknown benchmark stop: ${endpoint.id}`)
    return { longitude: stop.longitude, latitude: stop.latitude }
  }
  const venue = venues[endpoint.id]
  if (!venue?.location) throw new Error(`Unknown benchmark venue: ${endpoint.id}`)
  return { longitude: venue.location.x, latitude: venue.location.y }
}

function distanceMeters(
  first: { readonly longitude: number; readonly latitude: number },
  second: { readonly longitude: number; readonly latitude: number },
): number {
  const latitude = (first.latitude + second.latitude) / 2
  const longitudeScale = 111320 * Math.cos(latitude * Math.PI / 180)
  return Math.hypot(
    (second.longitude - first.longitude) * longitudeScale,
    (second.latitude - first.latitude) * 110540,
  )
}

function toWalkingConnection(
  from: PathfindingBenchmarkManifestCase['origin'],
  to: PathfindingBenchmarkManifestCase['destination'],
  fromCoordinate: { readonly longitude: number; readonly latitude: number },
  toCoordinate: { readonly longitude: number; readonly latitude: number },
): PathWalkingConnection {
  const distance = Math.max(1, Math.round(distanceMeters(fromCoordinate, toCoordinate)))
  return {
    from,
    to,
    durationSeconds: Math.max(1, Math.round(distance / 1.3)),
    distanceMeters: distance,
    geometry: {
      type: 'LineString',
      coordinates: [
        [fromCoordinate.longitude, fromCoordinate.latitude],
        [toCoordinate.longitude, toCoordinate.latitude],
      ],
    },
  }
}

function createOfflineWalkingConnections(
  benchmarkCase: PathfindingBenchmarkManifestCase,
  fixtures: PathfindingBenchmarkFixtures,
): readonly PathWalkingConnection[] {
  const { transit, venues, walkingGraph } = fixtures
  const originStopId = benchmarkCase.origin.kind === 'stop' ? benchmarkCase.origin.id : null
  const destinationStopId = benchmarkCase.destination.kind === 'stop' ? benchmarkCase.destination.id : null
  const connections: PathWalkingConnection[] = walkingGraph.connections.flatMap((connection) => {
    const fromStopId = connection.fromKey.slice('stop:'.length)
    const toStopId = connection.toKey.slice('stop:'.length)
    const from = transit.index.stopById.get(fromStopId)
    const to = transit.index.stopById.get(toStopId)
    if (!from || !to) throw new Error('Walking stop graph does not match the transit fixture')
    const isTripEndpointPair = fromStopId === originStopId && toStopId === destinationStopId
    const isOppositePair = from.opposite === toStopId || to.opposite === fromStopId
    if (!isTripEndpointPair && !isOppositePair && connection.durationSeconds > 180) return []
    return [{
      from: { kind: 'stop', id: fromStopId },
      to: { kind: 'stop', id: toStopId },
      durationSeconds: connection.durationSeconds,
      distanceMeters: connection.distanceMeters,
      geometry: {
        type: 'LineString',
        coordinates: [[from.longitude, from.latitude], [to.longitude, to.latitude]],
      },
    }]
  })

  const originCoordinate = endpointCoordinate(benchmarkCase.origin, venues, transit)
  const destinationCoordinate = endpointCoordinate(benchmarkCase.destination, venues, transit)
  if (benchmarkCase.origin.kind === 'venue') {
    for (const stop of transit.index.stops) {
      const toCoordinate = { longitude: stop.longitude, latitude: stop.latitude }
      const connection = toWalkingConnection(
        benchmarkCase.origin,
        { kind: 'stop', id: stop.id },
        originCoordinate,
        toCoordinate,
      )
      if (connection.durationSeconds <= 300) connections.push(connection)
    }
  }
  if (benchmarkCase.destination.kind === 'venue') {
    for (const stop of transit.index.stops) {
      const fromCoordinate = { longitude: stop.longitude, latitude: stop.latitude }
      const connection = toWalkingConnection(
        { kind: 'stop', id: stop.id },
        benchmarkCase.destination,
        fromCoordinate,
        destinationCoordinate,
      )
      if (connection.durationSeconds <= 300) connections.push(connection)
    }
  }
  if (benchmarkCase.origin.kind === 'venue' || benchmarkCase.destination.kind === 'venue') {
    connections.push(toWalkingConnection(
      benchmarkCase.origin,
      benchmarkCase.destination,
      originCoordinate,
      destinationCoordinate,
    ))
  }
  return connections
}

export function createPathfindingBenchmarkCases(
  manifest: PathfindingBenchmarkManifest,
  fixtures: PathfindingBenchmarkFixtures,
): readonly PreparedPathfindingBenchmarkCase[] {
  const fixedNowMs = Date.parse(manifest.fixedNow)
  const profileById = new Map(manifest.profiles.map((profile) => [profile.id, profile]))
  return manifest.cases.map((definition) => {
    const profile = profileById.get(definition.timingProfile)
    if (!profile) throw new Error(`Unknown timing profile: ${definition.timingProfile}`)
    const arrivalSnapshot = createBenchmarkArrivalSnapshot(
      profile,
      fixtures.transit.index.routes,
      definition.arrivalRouteIds,
      fixedNowMs,
    )
    const timingRecords = applyBenchmarkShuttleTimingProfile(
      fixtures.transit.shuttleTiming.records,
      profile,
      definition.arrivalRouteIds,
    )
    const caseTransit = {
      ...fixtures.transit,
      shuttleTiming: { ...fixtures.transit.shuttleTiming, records: timingRecords },
    }
    const origin: PathEndpointLocation = {
      endpoint: definition.origin,
      coordinate: endpointCoordinate(definition.origin, fixtures.venues, fixtures.transit),
    }
    const destination: PathEndpointLocation = {
      endpoint: definition.destination,
      coordinate: endpointCoordinate(definition.destination, fixtures.venues, fixtures.transit),
    }
    const windows = createBenchmarkServiceWindows(profile, fixedNowMs)(
      fixtures.transit.index.routes.map(({ id }) => id),
    )
    const liveWaiting = createLiveBusWaitingTimeProvider(arrivalSnapshot, fixedNowMs)
    const getShuttleWaitingSeconds: PathSearchInput['getShuttleWaitingSeconds'] = (record, context) => {
      const wait = liveWaiting(record, context)
      if (wait === null) return null
      const boardingAt = new Date(fixedNowMs + (context.elapsedSeconds + wait) * 1000)
      return evaluateShuttleService(windows[record.routeId] ?? [], boardingAt).status === 'active'
        ? wait
        : null
    }
    const searchInput: PathSearchInput = {
      origin,
      destination,
      transitIndex: fixtures.transit.index,
      routeGeometry: fixtures.transit.geometry,
      shuttleTiming: caseTransit.shuttleTiming,
      walkingConnections: createOfflineWalkingConnections(definition, fixtures),
      getShuttleWaitingSeconds,
    }
    return {
      ...definition,
      timingProfile: profile,
      arrivalSeconds: profile.arrivalSeconds ?? 0,
      arrivalSnapshot,
      transit: caseTransit,
      searchInput,
    }
  })
}

export function createBenchmarkServiceHoursClient(
  benchmarkCase: PreparedPathfindingBenchmarkCase,
  nowMs: number,
): {
  getServiceWindows(routeIds: readonly string[], signal: AbortSignal): Promise<Readonly<Record<string, readonly import('../../src/domain/transit/service-hours.js').ShuttleServiceWindow[]>>>
} {
  const profile = benchmarkCase.timingProfile
  const getWindows = createBenchmarkServiceWindows(profile, nowMs)
  return {
    async getServiceWindows(routeIds) {
      return getWindows(routeIds)
    },
  }
}
