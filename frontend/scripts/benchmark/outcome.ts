import type { LoadedTransitData } from '../../src/app/contracts/data.js'
import type {
  WalkingMatrixConnection,
  WalkingMatrixRequest,
} from '../../../backend/src/pathfinding/walking/walking-contracts.js'
import type { Path, PathGeometry } from '../../../backend/src/pathfinding/path.js'
import type { ShuttleTimingRecord } from '@navus/shared/transit/timing'
import type { TripEndpoint } from '../../src/domain/trip/types.js'
import { createCurrentLocationTripEndpoint, getTripEndpointKey } from '../../src/domain/trip/endpoints.js'
import type { VenueLocationMap } from '@navus/shared/venue/types'
import type { WalkingStopGraph } from '@navus/shared/routing/walking-stop-graph'
import type {
  PathfindingBenchmarkCase,
} from './contract.js'

export interface PathfindingBenchmarkValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly result: Readonly<Record<string, unknown>>
}

export interface PathfindingBenchmarkMatrixResult {
  readonly request: WalkingMatrixRequest
  readonly connections: readonly WalkingMatrixConnection[]
}

export interface PathfindingBenchmarkOutcomeEvidence {
  readonly mode: 'offline' | 'local'
  readonly matrixRequests?: readonly PathfindingBenchmarkMatrixResult[]
  readonly walkingStopGraph?: Pick<WalkingStopGraph, 'connections'>
  readonly valhallaRequestCounts?: { readonly matrix: number; readonly route: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function outcomeDiagnostics(value: unknown): Readonly<Record<string, number | string | boolean>> {
  if (!isRecord(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number | string | boolean] => (
    typeof entry[1] === 'string' ||
    typeof entry[1] === 'boolean' ||
    (typeof entry[1] === 'number' && Number.isFinite(entry[1]))
  )))
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function endpointKey(endpoint: TripEndpoint): string {
  return getTripEndpointKey(endpoint)
}

function isEndpoint(value: unknown): value is TripEndpoint {
  if (!isRecord(value)) return false
  if (value.kind === 'current-location') {
    return createCurrentLocationTripEndpoint(value.coordinate) !== null
  }
  return (value.kind === 'venue' || value.kind === 'stop') &&
    typeof value.id === 'string' &&
    value.id.length > 0
}

function isLineString(value: unknown): value is PathGeometry {
  return isRecord(value) &&
    value.type === 'LineString' &&
    Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2 &&
    value.coordinates.every((coordinate) => (
      Array.isArray(coordinate) &&
      coordinate.length >= 2 &&
      typeof coordinate[0] === 'number' &&
      Number.isFinite(coordinate[0]) &&
      coordinate[0] >= -180 &&
      coordinate[0] <= 180 &&
      typeof coordinate[1] === 'number' &&
      Number.isFinite(coordinate[1]) &&
      coordinate[1] >= -90 &&
      coordinate[1] <= 90
  ))
}

function endpointCoordinate(
  endpoint: TripEndpoint,
  transit: LoadedTransitData,
  venues: VenueLocationMap,
): readonly [number, number] | null {
  if (endpoint.kind === 'current-location') {
    return [endpoint.coordinate.longitude, endpoint.coordinate.latitude]
  }
  if (endpoint.kind === 'stop') {
    const stop = transit.index.stopById.get(endpoint.id)
    return stop && Number.isFinite(stop.longitude) && Number.isFinite(stop.latitude)
      ? [stop.longitude, stop.latitude]
      : null
  }
  const location = venues[endpoint.id]?.location
  return location && Number.isFinite(location.x) && Number.isFinite(location.y)
    ? [location.x, location.y]
    : null
}

function distanceMeters(
  first: readonly [number, number],
  second: readonly [number, number],
): number {
  const referenceLatitude = (first[1] + second[1]) / 2
  const longitudeScale = 111320 * Math.cos(referenceLatitude * Math.PI / 180)
  return Math.hypot(
    (first[0] - second[0]) * longitudeScale,
    (first[1] - second[1]) * 110540,
  )
}

function validateLegGeometry(
  value: unknown,
  from: TripEndpoint,
  to: TripEndpoint,
  mode: unknown,
  transit: LoadedTransitData,
  venues: VenueLocationMap,
  label: string,
  errors: string[],
): void {
  if (!isLineString(value)) {
    errors.push(`${label} geometry must be a valid LineString`)
    return
  }
  const fromCoordinate = endpointCoordinate(from, transit, venues)
  const toCoordinate = endpointCoordinate(to, transit, venues)
  if (!fromCoordinate || !toCoordinate) {
    errors.push(`${label} geometry endpoints cannot be checked against fixture coordinates`)
    return
  }
  const firstCoordinate = value.coordinates[0]
  const lastCoordinate = value.coordinates.at(-1)
  if (!firstCoordinate || !lastCoordinate) {
    errors.push(`${label} geometry must have start and end coordinates`)
    return
  }
  const toleranceMeters = mode === 'shuttle' ? 75 : 250
  if (distanceMeters(fromCoordinate, firstCoordinate) > toleranceMeters) {
    errors.push(`${label} geometry does not start near its from endpoint`)
  }
  if (distanceMeters(toCoordinate, lastCoordinate) > toleranceMeters) {
    errors.push(`${label} geometry does not end near its to endpoint`)
  }
}

function validateEndpointReference(
  endpoint: TripEndpoint,
  transit: LoadedTransitData,
  venues: VenueLocationMap,
  label: string,
  errors: string[],
): void {
  if (endpoint.kind === 'stop' && !transit.index.stopById.has(endpoint.id)) {
    errors.push(`${label} references unknown stop ${endpoint.id}`)
  } else if (endpoint.kind === 'venue' && !venues[endpoint.id]) {
    errors.push(`${label} references unknown venue ${endpoint.id}`)
  }
}

interface WalkingMetricConnection {
  readonly from: TripEndpoint
  readonly to: TripEndpoint
  readonly durationSeconds: number
  readonly distanceMeters: number
}

function isSameEndpoint(first: TripEndpoint, second: TripEndpoint): boolean {
  return endpointKey(first) === endpointKey(second)
}

function matchesCoordinate(
  coordinate: readonly [number, number] | null,
  longitude: number,
  latitude: number,
): boolean {
  return coordinate !== null && coordinate[0] === longitude && coordinate[1] === latitude
}

function walkingConnectionsForValidation(
  benchmarkCase: PathfindingBenchmarkCase,
  transit: LoadedTransitData,
  venues: VenueLocationMap,
  evidence: PathfindingBenchmarkOutcomeEvidence | undefined,
  label: string,
  errors: string[],
): readonly WalkingMetricConnection[] | null {
  if (evidence?.mode === 'offline') {
    return benchmarkCase.searchInput.walkingConnections
  }

  if (evidence?.mode !== 'local') {
    errors.push(`${label} has no walking evidence for this benchmark mode`)
    return null
  }

  const endpointByKey = new Map<string, TripEndpoint>()
  for (const endpoint of [
    benchmarkCase.origin,
    benchmarkCase.destination,
    ...transit.index.stops.map(({ id }) => ({ kind: 'stop' as const, id })),
  ]) endpointByKey.set(endpointKey(endpoint), endpoint)
  const locations = [...endpointByKey.values()].map((endpoint) => ({
    endpoint,
    coordinate: endpointCoordinate(endpoint, transit, venues),
  }))
  const getEndpointKeysAtCoordinate = (coordinate: { readonly longitude: number; readonly latitude: number }) => (
    locations.filter(({ coordinate: candidate }) => (
      matchesCoordinate(candidate, coordinate.longitude, coordinate.latitude)
    )).map(({ endpoint }) => endpoint)
  )

  const connectionsByKey = new Map<string, WalkingMetricConnection>()
  for (const { request, connections } of evidence.matrixRequests ?? []) {
    for (const connection of connections) {
      const source = request.sources[connection.fromIndex]
      const target = request.targets[connection.toIndex]
      if (!source || !target) continue
      const fromEndpoints = getEndpointKeysAtCoordinate(source)
      const toEndpoints = getEndpointKeysAtCoordinate(target)
      for (const from of fromEndpoints) {
        for (const to of toEndpoints) {
          if (isSameEndpoint(from, to) || (from.kind === 'stop' && to.kind === 'stop')) continue
          const touchesTripEndpoint = isSameEndpoint(from, benchmarkCase.origin) ||
            isSameEndpoint(to, benchmarkCase.destination)
          const isDirectTripPair = isSameEndpoint(from, benchmarkCase.origin) &&
            isSameEndpoint(to, benchmarkCase.destination)
          if (
            !isDirectTripPair &&
            touchesTripEndpoint &&
            connection.durationSeconds > 300
          ) continue
          const key = `${endpointKey(from)}\u0000${endpointKey(to)}`
          connectionsByKey.set(key, { from, to, ...connection })
        }
      }
    }
  }

  for (const connection of evidence.walkingStopGraph?.connections ?? []) {
    const fromStopId = connection.fromKey.slice('stop:'.length)
    const toStopId = connection.toKey.slice('stop:'.length)
    const from = transit.index.stopById.has(fromStopId)
      ? { kind: 'stop' as const, id: fromStopId }
      : null
    const to = transit.index.stopById.has(toStopId)
      ? { kind: 'stop' as const, id: toStopId }
      : null
    if (!from || !to) continue
    const fromStop = transit.index.stopById.get(from.id)
    const toStop = transit.index.stopById.get(to.id)
    const isOppositePair = fromStop?.opposite === to.id || toStop?.opposite === from.id
    if (connection.durationSeconds > 180 && !isOppositePair) continue
    const key = `${endpointKey(from)}\u0000${endpointKey(to)}`
    connectionsByKey.set(key, {
      from,
      to,
      durationSeconds: connection.durationSeconds,
      distanceMeters: connection.distanceMeters,
    })
  }

  const connections = [...connectionsByKey.values()]
  if (connections.length === 0) errors.push(`${label} has no captured walking evidence`)
  return connections
}

function hasWalkingEvidencePath(
  connections: readonly WalkingMetricConnection[],
  from: TripEndpoint,
  to: TripEndpoint,
  durationSeconds?: number,
  distanceMeters?: number,
): boolean {
  const toKey = endpointKey(to)
  const adjacency = new Map<string, WalkingMetricConnection[]>()
  for (const connection of connections) {
    const key = endpointKey(connection.from)
    const outgoing = adjacency.get(key) ?? []
    outgoing.push(connection)
    adjacency.set(key, outgoing)
  }
  const visited = new Set([endpointKey(from)])
  const maxEdges = Math.max(1, new Set(connections.flatMap(({ from: a, to: b }) => [endpointKey(a), endpointKey(b)])).size)

  function visit(
    current: string,
    elapsed: number,
    distance: number,
    edgeCount: number,
  ): boolean {
    if (current === toKey) {
      return (durationSeconds === undefined || elapsed === durationSeconds) &&
        (distanceMeters === undefined || distance === distanceMeters)
    }
    if (edgeCount >= maxEdges) return false
    for (const connection of adjacency.get(current) ?? []) {
      const next = endpointKey(connection.to)
      if (visited.has(next)) continue
      const nextElapsed = elapsed + connection.durationSeconds
      const nextDistance = distance + connection.distanceMeters
      if (durationSeconds !== undefined && nextElapsed > durationSeconds) continue
      if (distanceMeters !== undefined && nextDistance > distanceMeters) continue
      visited.add(next)
      const found = visit(next, nextElapsed, nextDistance, edgeCount + 1)
      visited.delete(next)
      if (found) return true
    }
    return false
  }

  return visit(endpointKey(from), 0, 0, 0)
}

function validateWalkingMetrics(
  from: TripEndpoint,
  to: TripEndpoint,
  durationSeconds: unknown,
  distanceMeters: unknown,
  benchmarkCase: PathfindingBenchmarkCase,
  transit: LoadedTransitData,
  venues: VenueLocationMap,
  evidence: PathfindingBenchmarkOutcomeEvidence | undefined,
  label: string,
  errors: string[],
): void {
  const connections = walkingConnectionsForValidation(
    benchmarkCase,
    transit,
    venues,
    evidence,
    label,
    errors,
  )
  if (!connections) return

  const hasEvidencePath = hasWalkingEvidencePath(connections, from, to)
  if (!hasEvidencePath) {
    errors.push(`${label} has no walking path in the benchmark evidence`)
    return
  }
  const durationMatches = isNonNegativeInteger(durationSeconds) &&
    hasWalkingEvidencePath(connections, from, to, durationSeconds)
  const distanceMatches = isNonNegativeInteger(distanceMeters) &&
    hasWalkingEvidencePath(connections, from, to, undefined, distanceMeters)
  if (!durationMatches) errors.push(`${label} durationSeconds does not match benchmark evidence`)
  if (!distanceMatches) errors.push(`${label} distanceMeters does not match benchmark evidence`)
  if (
    durationMatches &&
    distanceMatches &&
    !hasWalkingEvidencePath(connections, from, to, durationSeconds, distanceMeters)
  ) {
    errors.push(`${label} durationSeconds and distanceMeters do not match the same benchmark path`)
  }
}

function findCaseRideTiming(
  benchmarkCase: PathfindingBenchmarkCase,
  transit: LoadedTransitData,
  routeId: string,
  fromStopId: string,
  toStopId: string,
): ShuttleTimingRecord | undefined {
  const timingData = benchmarkCase.transit?.shuttleTiming ?? transit.shuttleTiming
  return timingData.records.find((record) => (
    record.routeId === routeId &&
    record.fromStopId === fromStopId &&
    record.toStopId === toStopId
  ))
}

function validatePath(
  value: unknown,
  benchmarkCase: PathfindingBenchmarkCase,
  transit: LoadedTransitData,
  venues: VenueLocationMap,
  evidence: PathfindingBenchmarkOutcomeEvidence | undefined,
  errors: string[],
): Path | null {
  if (!isRecord(value)) {
    errors.push('path must be an object')
    return null
  }

  if (!isEndpoint(value.origin)) errors.push('path origin must be a valid endpoint')
  if (!isEndpoint(value.destination)) errors.push('path destination must be a valid endpoint')
  if (isEndpoint(value.origin) && endpointKey(value.origin) !== endpointKey(benchmarkCase.origin)) {
    errors.push('path origin does not match the benchmark case')
  }
  if (isEndpoint(value.destination) && endpointKey(value.destination) !== endpointKey(benchmarkCase.destination)) {
    errors.push('path destination does not match the benchmark case')
  }
  if (value.estimateStatus !== 'estimated') errors.push('path estimateStatus must be estimated')
  if (value.planningQuality !== 'exact' && value.planningQuality !== 'bounded') {
    errors.push('path planningQuality must be exact or bounded')
  }
  if (!Array.isArray(value.legs) || value.legs.length === 0) {
    errors.push('path must contain at least one leg')
    return null
  }

  let expectedFrom = benchmarkCase.origin
  let durationTotal = 0
  let distanceTotal = 0
  let shuttleBoardings = 0
  let elapsedSeconds = 0
  const modes: string[] = []
  const routeIds: string[] = []
  value.legs.forEach((legValue, index) => {
    if (!isRecord(legValue)) {
      errors.push(`leg ${index + 1} must be an object`)
      return
    }
    const from = legValue.from
    const to = legValue.to
    if (!isEndpoint(from) || !isEndpoint(to)) {
      errors.push(`leg ${index + 1} endpoints must be valid trip endpoints`)
      return
    }
    validateEndpointReference(from, transit, venues, `leg ${index + 1} from`, errors)
    validateEndpointReference(to, transit, venues, `leg ${index + 1} to`, errors)
    if (endpointKey(from) !== endpointKey(expectedFrom)) {
      errors.push(`leg ${index + 1} does not continue from the previous endpoint`)
    }
    expectedFrom = to
    const elapsedBeforeLeg = elapsedSeconds
    if (!isNonNegativeInteger(legValue.durationSeconds)) {
      errors.push(`leg ${index + 1} durationSeconds must be a non-negative integer`)
    } else {
      durationTotal += legValue.durationSeconds
      elapsedSeconds += legValue.durationSeconds
    }
    if (!isNonNegativeInteger(legValue.distanceMeters)) {
      errors.push(`leg ${index + 1} distanceMeters must be a non-negative integer`)
    } else distanceTotal += legValue.distanceMeters
    validateLegGeometry(
      legValue.geometry,
      from,
      to,
      legValue.mode,
      transit,
      venues,
      `leg ${index + 1}`,
      errors,
    )

    if (legValue.mode === 'walking') {
      modes.push('walking')
      validateWalkingMetrics(
        from,
        to,
        legValue.durationSeconds,
        legValue.distanceMeters,
        benchmarkCase,
        transit,
        venues,
        evidence,
        `walking leg ${index + 1}`,
        errors,
      )
      return
    }
    if (legValue.mode !== 'shuttle') {
      errors.push(`leg ${index + 1} mode must be walking or shuttle`)
      return
    }

    modes.push('shuttle')
    shuttleBoardings += 1
    if (from.kind !== 'stop' || to.kind !== 'stop') {
      errors.push(`shuttle leg ${index + 1} must connect shuttle stops`)
      return
    }
    const routeId = legValue.routeId
    const route = typeof routeId === 'string' ? transit.index.routeById.get(routeId) : undefined
    if (!route) {
      errors.push(`shuttle leg ${index + 1} references an unknown route`)
      return
    }
    routeIds.push(route.id)
    const fromIndex = route.stopIds.indexOf(from.id)
    const toIndex = route.stopIds.indexOf(to.id)
    if (fromIndex < 0 || toIndex <= fromIndex) {
      errors.push(`shuttle leg ${index + 1} does not follow route ${route.id} stop order`)
    }
    if (legValue.boardingStopId !== from.id || legValue.alightingStopId !== to.id) {
      errors.push(`shuttle leg ${index + 1} boarding/alighting IDs must match its endpoints`)
    }
    if (!isNonNegativeInteger(legValue.waitingSeconds) || !isNonNegativeInteger(legValue.rideSeconds)) {
      errors.push(`shuttle leg ${index + 1} waiting and ride seconds must be non-negative integers`)
    } else if (legValue.durationSeconds !== legValue.waitingSeconds + legValue.rideSeconds) {
      errors.push(`shuttle leg ${index + 1} duration must equal waiting plus ride time`)
    }
    const timing = findCaseRideTiming(benchmarkCase, transit, route.id, from.id, to.id)
    if (!timing || timing.status !== 'estimated' || !isNonNegativeInteger(timing.rideSeconds)) {
      errors.push(`shuttle leg ${index + 1} has no estimated ride timing in the benchmark case`)
      return
    }
    if (legValue.rideSeconds !== timing.rideSeconds) {
      errors.push(`shuttle leg ${index + 1} rideSeconds does not match case timing`)
    }
    const getWaitingSeconds = benchmarkCase.searchInput.getShuttleWaitingSeconds
    const expectedWaitingSeconds = getWaitingSeconds(timing, {
      routeId: route.id,
      boardingStopId: from.id,
      elapsedSeconds: elapsedBeforeLeg,
    })
    if (!isNonNegativeInteger(expectedWaitingSeconds)) {
      errors.push(`shuttle leg ${index + 1} has no valid wait in the benchmark case`)
    } else if (legValue.waitingSeconds !== expectedWaitingSeconds) {
      errors.push(`shuttle leg ${index + 1} waitingSeconds does not match benchmark timing`)
    }
  })

  if (endpointKey(expectedFrom) !== endpointKey(benchmarkCase.destination)) {
    errors.push('path legs do not end at the benchmark destination')
  }
  if (!isNonNegativeInteger(value.totalDurationSeconds) || value.totalDurationSeconds !== durationTotal) {
    errors.push('path totalDurationSeconds must equal the sum of its leg durations')
  }
  if (!isNonNegativeInteger(value.totalDistanceMeters) || value.totalDistanceMeters !== distanceTotal) {
    errors.push('path totalDistanceMeters must equal the sum of its leg distances')
  }
  if (benchmarkCase.expected.shuttleBoardings !== undefined && shuttleBoardings !== benchmarkCase.expected.shuttleBoardings) {
    errors.push(`expected ${benchmarkCase.expected.shuttleBoardings} shuttle boardings; got ${shuttleBoardings}`)
  }
  if (benchmarkCase.expected.modes && JSON.stringify(modes) !== JSON.stringify(benchmarkCase.expected.modes)) {
    errors.push(`expected modes ${benchmarkCase.expected.modes.join(', ')}; got ${modes.join(', ')}`)
  }
  if (benchmarkCase.expected.routeIds && JSON.stringify(routeIds) !== JSON.stringify(benchmarkCase.expected.routeIds)) {
    errors.push(`expected routes ${benchmarkCase.expected.routeIds.join(', ')}; got ${routeIds.join(', ')}`)
  }
  const bounds = benchmarkCase.durationBoundsSeconds
  if (isNonNegativeInteger(value.totalDurationSeconds)) {
    if (bounds?.min !== undefined && value.totalDurationSeconds < bounds.min) {
      errors.push(`path totalDurationSeconds is below the minimum ${bounds.min}`)
    }
    if (bounds?.max !== undefined && value.totalDurationSeconds > bounds.max) {
      errors.push(`path totalDurationSeconds exceeds the maximum ${bounds.max}`)
    }
  }

  return value as unknown as Path
}

export function validatePathfindingBenchmarkOutcome(
  input: unknown,
  benchmarkCase: PathfindingBenchmarkCase,
  transit: LoadedTransitData,
  venues: VenueLocationMap,
  evidence?: PathfindingBenchmarkOutcomeEvidence,
): PathfindingBenchmarkValidation {
  const errors: string[] = []
  let result: Readonly<Record<string, unknown>> = { kind: 'invalid' }

  if (!isRecord(input)) {
    errors.push('benchmark outcome must be an object')
  } else if (input.kind === 'no-route') {
    if (typeof input.reason !== 'string' || input.reason.trim().length === 0) {
      errors.push('no-route outcome must include a reason')
    }
    if (benchmarkCase.expected.outcome !== 'no-route') {
      errors.push(`expected ${benchmarkCase.expected.outcome}; got no-route`)
    }
    result = {
      kind: 'no-route',
      reason: typeof input.reason === 'string' ? input.reason : '',
      ...outcomeDiagnostics(input.diagnostics),
    }
  } else if (input.kind === 'path') {
    if (benchmarkCase.expected.outcome !== 'path') errors.push('expected no-route; got path')
    const path = validatePath(input.path, benchmarkCase, transit, venues, evidence, errors)
    if (path) {
      result = {
        kind: 'path',
        modes: path.legs.map((leg) => leg.mode),
        shuttleBoardings: path.legs.filter((leg) => leg.mode === 'shuttle').length,
        routeIds: path.legs.flatMap((leg) => leg.mode === 'shuttle' ? [leg.routeId] : []),
        waitingSeconds: path.legs.reduce((sum, leg) => sum + (leg.mode === 'shuttle' ? leg.waitingSeconds : 0), 0),
        rideSeconds: path.legs.reduce((sum, leg) => sum + (leg.mode === 'shuttle' ? leg.rideSeconds : 0), 0),
        totalDurationSeconds: path.totalDurationSeconds,
        totalDistanceMeters: path.totalDistanceMeters,
        planningQuality: path.planningQuality,
        ...outcomeDiagnostics(input.diagnostics),
      }
    }
  } else {
    errors.push('benchmark outcome kind must be path or no-route')
  }

  if (evidence?.valhallaRequestCounts) {
    const { matrix, route } = evidence.valhallaRequestCounts
    result = { ...result, valhallaRequests: { matrix, route } }
    if (evidence.mode === 'offline' && (matrix !== 0 || route !== 0)) {
      errors.push(`offline benchmark made ${matrix} Valhalla matrix and ${route} route requests`)
    }
  }

  return { valid: errors.length === 0, errors, result }
}
