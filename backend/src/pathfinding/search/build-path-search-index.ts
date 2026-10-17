import type { TransitGeoJsonPosition } from '@navus/shared/transit/types'
import { placeRouteStopsOnLine, type ShuttleTimingRecord } from '@navus/shared/transit/timing'
import { getTripEndpointKey } from '../endpoints.ts'
import type { TripEndpoint } from '@navus/shared/routing/path'
import type { BusPathLeg, PathEndpointLocation, PathGeometry, WalkingPathLeg } from '../path.ts'
import { MAX_PATH_ENDPOINT_STOP_CONNECTORS, type PathSearchIndex, type PathSearchInput, type PathWalkingConnection, type ProjectedPoint, type ShuttleRideDefinition, type TransferOption, type WalkingConnector } from './path-search-types.ts'

const METRES_PER_LATITUDE_DEGREE = 110540

const METRES_PER_LONGITUDE_DEGREE = 111320

const PROJECTION_EPSILON_METRES = 0.001

function compareText(first: string, second: string): number {
  if (first < second) return -1
  if (first > second) return 1
  return 0
}

export function isFiniteNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0
}

export function isValidLineString(geometry: PathGeometry): boolean {
  return geometry.type === 'LineString' &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(([longitude, latitude]) => (
      Number.isFinite(longitude) &&
      Number.isFinite(latitude) &&
      longitude >= -180 &&
      longitude <= 180 &&
      latitude >= -90 &&
      latitude <= 90
    ))
}

function toPosition(longitude: number, latitude: number): TransitGeoJsonPosition {
  return [longitude, latitude]
}

function toLocalMeters(
  position: TransitGeoJsonPosition,
  referenceLatitude: number,
): [number, number] {
  const longitudeScale = METRES_PER_LONGITUDE_DEGREE * Math.cos(referenceLatitude * Math.PI / 180)
  return [position[0] * longitudeScale, position[1] * METRES_PER_LATITUDE_DEGREE]
}

function distanceBetween(
  first: TransitGeoJsonPosition,
  second: TransitGeoJsonPosition,
): number {
  const referenceLatitude = (first[1] + second[1]) / 2
  const firstMeters = toLocalMeters(first, referenceLatitude)
  const secondMeters = toLocalMeters(second, referenceLatitude)
  return Math.hypot(secondMeters[0] - firstMeters[0], secondMeters[1] - firstMeters[1])
}

function projectPointOntoLine(
  point: TransitGeoJsonPosition,
  line: readonly TransitGeoJsonPosition[],
): readonly ProjectedPoint[] {
  // Stops can sit slightly off the drawn line; retain along-line position as well as proximity.
  let distanceAlongLine = 0
  const candidates: ProjectedPoint[] = []

  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1]
    const end = line[index]
    const segmentLength = distanceBetween(start, end)
    const pointMeters = toLocalMeters(point, point[1])
    const startMeters = toLocalMeters(start, point[1])
    const endMeters = toLocalMeters(end, point[1])
    const deltaX = endMeters[0] - startMeters[0]
    const deltaY = endMeters[1] - startMeters[1]
    const lengthSquared = deltaX * deltaX + deltaY * deltaY
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(
        0,
        Math.min(
          1,
          ((pointMeters[0] - startMeters[0]) * deltaX +
            (pointMeters[1] - startMeters[1]) * deltaY) / lengthSquared,
        ),
      )
    const projected: TransitGeoJsonPosition = [
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
    ]
    candidates.push({
      segmentIndex: index,
      distanceAlongLine: distanceAlongLine + segmentLength * ratio,
      distanceToLine: distanceBetween(point, projected),
      coordinate: projected,
    })
    distanceAlongLine += segmentLength
  }

  return candidates.sort((first, second) => first.distanceAlongLine - second.distanceAlongLine)
}

function withoutDuplicateCoordinates(
  coordinates: readonly TransitGeoJsonPosition[],
): readonly TransitGeoJsonPosition[] {
  return coordinates.filter((coordinate, index) => {
    if (index === 0) return true
    const previous = coordinates[index - 1]
    return coordinate[0] !== previous[0] || coordinate[1] !== previous[1]
  })
}

function sliceRouteGeometry(
  line: readonly TransitGeoJsonPosition[],
  fromCandidates: readonly ProjectedPoint[],
  toCandidates: readonly ProjectedPoint[],
): { readonly geometry: PathGeometry; readonly distanceMeters: number } | null {
  // A bus can pass near the same stop more than once; select a forward pair on the official line.
  let selected: { readonly from: ProjectedPoint; readonly to: ProjectedPoint } | null = null
  let fromIndex = 0
  let closestForwardFrom: ProjectedPoint | null = null
  for (const to of toCandidates) {
    while (
      fromIndex < fromCandidates.length &&
      fromCandidates[fromIndex]!.distanceAlongLine + PROJECTION_EPSILON_METRES < to.distanceAlongLine
    ) {
      const from = fromCandidates[fromIndex++]!
      if (!closestForwardFrom || from.distanceToLine < closestForwardFrom.distanceToLine) {
        closestForwardFrom = from
      }
    }
    if (!closestForwardFrom) continue
    if (
      !selected ||
      closestForwardFrom.distanceToLine + to.distanceToLine <
        selected.from.distanceToLine + selected.to.distanceToLine
    ) selected = { from: closestForwardFrom, to }
  }
  if (!selected) return null
  return sliceBetweenProjections(line, selected.from, selected.to)
}

function sliceBetweenProjections(
  line: readonly TransitGeoJsonPosition[],
  from: ProjectedPoint,
  to: ProjectedPoint,
): { readonly geometry: PathGeometry; readonly distanceMeters: number } | null {
  const coordinates = withoutDuplicateCoordinates([
    from.coordinate,
    ...line.slice(from.segmentIndex, to.segmentIndex),
    to.coordinate,
  ])
  if (coordinates.length < 2) return null

  return {
    geometry: { type: 'LineString', coordinates },
    distanceMeters: Math.round(to.distanceAlongLine - from.distanceAlongLine),
  }
}

export function createShuttleLeg(
  ride: ShuttleRideDefinition,
  waitingSeconds: number,
  geometry: PathGeometry,
  distanceMeters: number,
): BusPathLeg {
  const from: TripEndpoint = { kind: 'stop', id: ride.fromStopId }
  const to: TripEndpoint = { kind: 'stop', id: ride.toStopId }
  return {
    mode: 'shuttle',
    from,
    to,
    durationSeconds: waitingSeconds + ride.rideSeconds,
    distanceMeters,
    geometry,
    routeId: ride.routeId,
    boardingStopId: ride.fromStopId,
    alightingStopId: ride.toStopId,
    waitingSeconds,
    rideSeconds: ride.rideSeconds,
  }
}

export function createWalkingLeg(connection: PathWalkingConnection): WalkingPathLeg {
  return {
    mode: 'walking',
    from: connection.from,
    to: connection.to,
    durationSeconds: connection.durationSeconds,
    distanceMeters: connection.distanceMeters,
    geometry: connection.geometry,
  }
}

export function isValidWalkingConnection(connection: PathWalkingConnection): boolean {
  return isFiniteNonNegativeInteger(connection.durationSeconds) &&
    isFiniteNonNegativeInteger(connection.distanceMeters) &&
    isValidLineString(connection.geometry)
}

function compareWalkingConnections(
  first: PathWalkingConnection,
  second: PathWalkingConnection,
): number {
  return first.durationSeconds - second.durationSeconds ||
    first.distanceMeters - second.distanceMeters ||
    compareText(getTripEndpointKey(first.from), getTripEndpointKey(second.from)) ||
    compareText(getTripEndpointKey(first.to), getTripEndpointKey(second.to))
}

function compareConnectors(first: WalkingConnector, second: WalkingConnector): number {
  const firstDuration = first.connection?.durationSeconds ?? 0
  const secondDuration = second.connection?.durationSeconds ?? 0
  const firstDistance = first.connection?.distanceMeters ?? 0
  const secondDistance = second.connection?.distanceMeters ?? 0
  return firstDuration - secondDuration ||
    firstDistance - secondDistance ||
    compareText(first.stopId, second.stopId)
}

function* collectConnectorsSteps(
  input: PathSearchInput,
  endpoint: PathEndpointLocation,
  isOrigin: boolean,
  shouldCheckpoint: () => boolean,
): Generator<void, readonly WalkingConnector[]> {
  // Walking direction is part of the graph: reverse costs are never inferred from a forward edge.
  if (endpoint.endpoint.kind === 'stop') {
    if (!input.transitIndex.stopById.has(endpoint.endpoint.id)) return []
    if (isOrigin) return [{ stopId: endpoint.endpoint.id, connection: null }]
  }

  const selectedByStop = new Map<string, WalkingConnector>()
  for (const connection of input.walkingConnections) {
    if (shouldCheckpoint()) yield
    if (!isValidWalkingConnection(connection)) continue
    const matchesEndpoint = isOrigin
      ? getTripEndpointKey(connection.from) === getTripEndpointKey(endpoint.endpoint) && connection.to.kind === 'stop'
      : endpoint.endpoint.kind === 'stop'
        ? connection.from.kind === 'stop' && connection.to.kind === 'stop' &&
          connection.from.id !== endpoint.endpoint.id && connection.to.id === endpoint.endpoint.id
        : connection.from.kind === 'stop' && getTripEndpointKey(connection.to) === getTripEndpointKey(endpoint.endpoint)
    if (!matchesEndpoint) continue

    const stopEndpoint = isOrigin ? connection.to : connection.from
    if (stopEndpoint.kind !== 'stop' || !input.transitIndex.stopById.has(stopEndpoint.id)) continue
    const candidate = { stopId: stopEndpoint.id, connection }
    const selected = selectedByStop.get(stopEndpoint.id)
    if (!selected || compareConnectors(candidate, selected) < 0) {
      selectedByStop.set(stopEndpoint.id, candidate)
    }
  }
  const topConnectors: WalkingConnector[] = []
  for (const candidate of selectedByStop.values()) {
    const insertAt = topConnectors.findIndex((connector) => compareConnectors(candidate, connector) < 0)
    if (insertAt < 0 && topConnectors.length >= MAX_PATH_ENDPOINT_STOP_CONNECTORS) {
      if (shouldCheckpoint()) yield
      continue
    }
    if (insertAt < 0) topConnectors.push(candidate)
    else topConnectors.splice(insertAt, 0, candidate)
    if (topConnectors.length > MAX_PATH_ENDPOINT_STOP_CONNECTORS) topConnectors.pop()
    if (shouldCheckpoint()) yield
  }
  if (!isOrigin && endpoint.endpoint.kind === 'stop') {
    return [{ stopId: endpoint.endpoint.id, connection: null }, ...topConnectors]
  }
  return topConnectors
}

function getTimingKey(routeId: string, fromStopId: string, toStopId: string): string {
  return `${routeId}\u0000${fromStopId}\u0000${toStopId}`
}

function addWalkingConnection(
  byDestinationStop: Map<string, PathWalkingConnection>,
  connection: PathWalkingConnection,
): void {
  if (connection.from.kind !== 'stop' || connection.to.kind !== 'stop' || connection.from.id === connection.to.id) return
  const existing = byDestinationStop.get(connection.to.id)
  if (!existing || compareWalkingConnections(connection, existing) < 0) {
    byDestinationStop.set(connection.to.id, connection)
  }
}

const SEARCH_INDEX_CHECKPOINT_WORK = 64

export const SEARCH_INDEX_YIELD_CHECKPOINTS = 8

export function* buildSearchIndexSteps(
  input: PathSearchInput,
  now: () => number = () => performance.now(),
): Generator<void, PathSearchIndex> {
  let workSinceCheckpoint = 0
  const shouldCheckpoint = () => {
    workSinceCheckpoint += 1
    if (workSinceCheckpoint < SEARCH_INDEX_CHECKPOINT_WORK) return false
    workSinceCheckpoint = 0
    return true
  }
  const originKey = getTripEndpointKey(input.origin.endpoint)
  const destinationKey = getTripEndpointKey(input.destination.endpoint)
  const directWalkingConnections: PathWalkingConnection[] = []
  const walkingByFromStop = new Map<string, Map<string, PathWalkingConnection>>()
  const timingByKey = new Map<string, ShuttleTimingRecord>()
  for (const record of input.shuttleTiming.records) {
    timingByKey.set(getTimingKey(record.routeId, record.fromStopId, record.toStopId), record)
    if (shouldCheckpoint()) yield
  }
  const geometryByRouteId = new Map<string, readonly TransitGeoJsonPosition[]>()
  for (const feature of input.routeGeometry.features) {
    geometryByRouteId.set(feature.properties.routeId, feature.geometry.coordinates)
    if (shouldCheckpoint()) yield
  }

  for (const connection of input.walkingConnections) {
    if (shouldCheckpoint()) yield
    if (!isValidWalkingConnection(connection)) continue
    if (
      getTripEndpointKey(connection.from) === originKey &&
      getTripEndpointKey(connection.to) === destinationKey
    ) directWalkingConnections.push(connection)

    if (connection.from.kind !== 'stop' || connection.to.kind !== 'stop') continue
    if (
      !input.transitIndex.stopById.has(connection.from.id) ||
      !input.transitIndex.stopById.has(connection.to.id) ||
      connection.from.id === connection.to.id
    ) continue
    const byDestination = walkingByFromStop.get(connection.from.id) ?? new Map<string, PathWalkingConnection>()
    addWalkingConnection(byDestination, connection)
    walkingByFromStop.set(connection.from.id, byDestination)
  }

  const ridesByBoardingStop = new Map<string, ShuttleRideDefinition[]>()
  for (const route of input.transitIndex.routes) {
    if (shouldCheckpoint()) yield
    const geometryLine = geometryByRouteId.get(route.id)
    if (!geometryLine || geometryLine.length < 2) continue
    for (let fromIndex = 0; fromIndex < route.stopIds.length - 1; fromIndex += 1) {
      const fromStopId = route.stopIds[fromIndex]
      const traversedStopIds = [fromStopId]
      const seenStopIds = new Set(traversedStopIds)
      for (let toIndex = fromIndex + 1; toIndex < route.stopIds.length; toIndex += 1) {
        if (shouldCheckpoint()) yield
        const toStopId = route.stopIds[toIndex]
        if (seenStopIds.has(toStopId)) break
        seenStopIds.add(toStopId)
        traversedStopIds.push(toStopId)
        const record = timingByKey.get(getTimingKey(route.id, fromStopId, toStopId))
        if (
          !record ||
          record.status !== 'estimated' ||
          record.rideSeconds === null ||
          !isFiniteNonNegativeInteger(record.rideSeconds)
        ) continue
        if (!input.transitIndex.stopById.has(fromStopId) || !input.transitIndex.stopById.has(toStopId)) continue
        const ride: ShuttleRideDefinition = {
          routeId: route.id,
          fromStopId,
          toStopId,
          fromStopIndex: fromIndex,
          toStopIndex: toIndex,
          traversedStopIds: new Set(traversedStopIds),
          rideSeconds: record.rideSeconds,
          record,
          geometryLine,
        }
        const rides = ridesByBoardingStop.get(fromStopId) ?? []
        rides.push(ride)
        ridesByBoardingStop.set(fromStopId, rides)
      }
    }
  }

  const compareRides = (first: ShuttleRideDefinition, second: ShuttleRideDefinition) => (
    first.rideSeconds - second.rideSeconds ||
    compareText(first.routeId, second.routeId) ||
    compareText(first.toStopId, second.toStopId)
  )
  for (const rides of ridesByBoardingStop.values()) {
    rides.sort(compareRides)
    if (shouldCheckpoint()) yield
  }

  const destinationConnectors = yield* collectConnectorsSteps(
    input,
    input.destination,
    false,
    shouldCheckpoint,
  )
  const destinationConnectorByStopId = new Map<string, WalkingConnector>()
  for (const connector of destinationConnectors) {
    destinationConnectorByStopId.set(connector.stopId, connector)
    if (shouldCheckpoint()) yield
  }
  const transferOptionsByAlightingStopAndRoute = new Map<string, Map<string, TransferOption[]>>()
  for (const [alightingStopId, connections] of walkingByFromStop) {
    if (shouldCheckpoint()) yield
    const optionsByRoute = new Map<string, TransferOption[]>()
    for (const connection of connections.values()) {
      if (shouldCheckpoint()) yield
      if (connection.to.kind !== 'stop') continue
      const secondRides = ridesByBoardingStop.get(connection.to.id) ?? []
      for (const ride of secondRides) {
        if (shouldCheckpoint()) yield
        const destinationConnector = destinationConnectorByStopId.get(ride.toStopId)
        if (!destinationConnector) continue
        const options = optionsByRoute.get(ride.routeId) ?? []
        options.push({ connection, ride, destinationConnector })
        optionsByRoute.set(ride.routeId, options)
      }
    }
    if (optionsByRoute.size > 0) {
      transferOptionsByAlightingStopAndRoute.set(alightingStopId, optionsByRoute)
    }
  }

  const geometryByRideKey = new Map<string, ReturnType<typeof sliceRouteGeometry>>()
  const projectionsByRouteStopKey = new Map<string, readonly ProjectedPoint[]>()
  let geometrySliceCount = 0
  let geometrySliceDurationMs = 0
  const getStopProjections = (routeId: string, line: readonly TransitGeoJsonPosition[], stopId: string) => {
    const key = `${routeId}\u0000${stopId}`
    const cached = projectionsByRouteStopKey.get(key)
    if (cached) return cached
    const stop = input.transitIndex.stopById.get(stopId)
    if (!stop) return []
    const projections = projectPointOntoLine(toPosition(stop.longitude, stop.latitude), line)
    projectionsByRouteStopKey.set(key, projections)
    return projections
  }
  const placedStopsByRouteId = new Map<string, readonly ProjectedPoint[] | null>()
  const getPlacedStops = (routeId: string, line: readonly TransitGeoJsonPosition[]) => {
    if (placedStopsByRouteId.has(routeId)) return placedStopsByRouteId.get(routeId) ?? null
    const route = input.transitIndex.routeById.get(routeId)
    const placed = route ? placeRouteStopsOnLine(route.stopIds, input.transitIndex.stopById, line) : null
    placedStopsByRouteId.set(routeId, placed)
    return placed
  }
  const getRideGeometry = (ride: ShuttleRideDefinition) => {
    const key = getTimingKey(ride.routeId, ride.fromStopId, ride.toStopId)
    if (geometryByRideKey.has(key)) return geometryByRideKey.get(key) ?? null
    const startedAt = now()
    // Prefer the Route-ordered stop placement that ride timing uses; it keeps loop Routes on the right pass.
    const placedStops = getPlacedStops(ride.routeId, ride.geometryLine)
    const placedFrom = placedStops?.[ride.fromStopIndex]
    const placedTo = placedStops?.[ride.toStopIndex]
    let geometry: ReturnType<typeof sliceRouteGeometry>
    if (placedFrom && placedTo) {
      geometry = sliceBetweenProjections(ride.geometryLine, placedFrom, placedTo)
    } else {
      const fromCandidates = getStopProjections(ride.routeId, ride.geometryLine, ride.fromStopId)
      const toCandidates = getStopProjections(ride.routeId, ride.geometryLine, ride.toStopId)
      geometry = fromCandidates.length > 0 && toCandidates.length > 0
        ? sliceRouteGeometry(ride.geometryLine, fromCandidates, toCandidates)
        : null
    }
    geometrySliceCount += 1
    geometrySliceDurationMs += now() - startedAt
    geometryByRideKey.set(key, geometry)
    return geometry
  }

  return {
    originConnectors: yield* collectConnectorsSteps(input, input.origin, true, shouldCheckpoint),
    destinationConnectorByStopId,
    directWalkingConnections: directWalkingConnections.sort(compareWalkingConnections),
    ridesByBoardingStopId: ridesByBoardingStop,
    transferOptionsByAlightingStopAndRoute,
    getRideGeometry,
    getRideGeometryMetrics: () => ({
      buildCount: geometrySliceCount,
      buildDurationMs: geometrySliceDurationMs,
    }),
  }
}

export function buildSearchIndex(input: PathSearchInput, now: () => number = () => performance.now()): PathSearchIndex {
  const builder = buildSearchIndexSteps(input, now)
  let step = builder.next()
  while (!step.done) step = builder.next()
  return step.value
}
