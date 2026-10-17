import type { PathLeg } from '../path.ts'
import { createShuttleLeg, createWalkingLeg, isFiniteNonNegativeInteger, isValidLineString, isValidWalkingConnection } from './build-path-search-index.ts'
import { createCandidate } from './rank-path-candidates.ts'
import type { CandidateEnumerationStep, PathCandidate, PathCandidateDefinition, PathSearchIndex, PathSearchInput, PathWalkingConnection, ShuttleRideDefinition } from './path-search-types.ts'

function hasRepeatedStops(
  firstRide: ShuttleRideDefinition,
  secondRide?: ShuttleRideDefinition,
  transferConnection?: PathWalkingConnection,
): boolean {
  // A two-route option must not revisit any stop already traversed by its first ride or transfer.
  const visited = firstRide.traversedStopIds
  if (transferConnection?.to.kind === 'stop' && visited.has(transferConnection.to.id)) return true
  if (secondRide) {
    for (const stopId of secondRide.traversedStopIds) {
      if (visited.has(stopId)) return true
    }
  }
  return false
}

export function* enumerateCandidateDefinitions(
  index: PathSearchIndex,
): Generator<CandidateEnumerationStep> {
  for (const connection of index.directWalkingConnections) {
    yield { kind: 'work' }
    yield { kind: 'candidate', definition: { kind: 'walking', connection } }
  }

  for (const originConnector of index.originConnectors) {
    const firstRides = index.ridesByBoardingStopId.get(originConnector.stopId) ?? []
    for (const firstRide of firstRides) {
      yield { kind: 'work' }
      const destinationConnector = index.destinationConnectorByStopId.get(firstRide.toStopId)
      if (destinationConnector) {
        yield { kind: 'candidate', definition: {
          kind: 'shuttle',
          originConnector,
          rides: [firstRide],
          destinationConnector,
        } }
      }

      const optionsByRoute = index.transferOptionsByAlightingStopAndRoute.get(firstRide.toStopId)
      if (!optionsByRoute) continue
      let rejectedOptionCount = 0
      for (const [secondRouteId, options] of optionsByRoute) {
        if (firstRide.routeId === secondRouteId) continue
        for (const option of options) {
          if (hasRepeatedStops(firstRide, option.ride, option.connection)) {
            rejectedOptionCount += 1
            if (rejectedOptionCount % 64 === 0) yield { kind: 'work' }
            continue
          }
          yield { kind: 'candidate', definition: {
            kind: 'shuttle',
            originConnector,
            rides: [firstRide, option.ride],
            transferConnection: option.connection,
            destinationConnector: option.destinationConnector,
          } }
        }
      }
    }
  }
}

export function resolveCandidate(
  input: PathSearchInput,
  index: PathSearchIndex,
  definition: PathCandidateDefinition,
): PathCandidate | null {
  if (definition.kind === 'walking') {
    return createCandidate([createWalkingLeg(definition.connection)])
  }

  const destinationStopId = input.destination.endpoint.kind === 'stop'
    ? input.destination.endpoint.id
    : null
  if (
    destinationStopId !== null &&
    definition.destinationConnector.connection &&
    definition.rides.some((ride) => ride.traversedStopIds.has(destinationStopId))
  ) return null

  const legs: PathLeg[] = []
  let elapsedSeconds = 0
  if (definition.originConnector.connection) {
    const walkingLeg = createWalkingLeg(definition.originConnector.connection)
    legs.push(walkingLeg)
    elapsedSeconds += walkingLeg.durationSeconds
  }

  for (const [rideIndex, ride] of definition.rides.entries()) {
    const waitingSeconds = input.getShuttleWaitingSeconds(ride.record, {
      routeId: ride.routeId,
      boardingStopId: ride.fromStopId,
      elapsedSeconds,
    })
    const routeGeometry = index.getRideGeometry(ride)
    if (
      waitingSeconds === null ||
      !isFiniteNonNegativeInteger(waitingSeconds) ||
      !isFiniteNonNegativeInteger(ride.rideSeconds) ||
      !routeGeometry ||
      !isValidLineString(routeGeometry.geometry)
    ) return null

    const shuttleLeg = createShuttleLeg(
      ride,
      waitingSeconds,
      routeGeometry.geometry,
      routeGeometry.distanceMeters,
    )
    legs.push(shuttleLeg)
    elapsedSeconds += shuttleLeg.durationSeconds

    if (rideIndex === 0 && definition.transferConnection) {
      if (!isValidWalkingConnection(definition.transferConnection)) return null
      const transferLeg = createWalkingLeg(definition.transferConnection)
      legs.push(transferLeg)
      elapsedSeconds += transferLeg.durationSeconds
    }
  }

  if (definition.destinationConnector.connection) {
    legs.push(createWalkingLeg(definition.destinationConnector.connection))
  }
  return createCandidate(legs)
}
