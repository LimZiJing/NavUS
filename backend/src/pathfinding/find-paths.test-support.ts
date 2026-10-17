import type { ShuttleArrivalSnapshot } from '@navus/shared/transit/live-arrivals'
import type { ShuttleServiceWindow } from '@navus/shared/transit/service-hours'
import type { TransitIndex } from '@navus/shared/transit/index'
import type { TransitNetwork, BusRouteGeometry } from '@navus/shared/transit/types'
import type { ShuttleTimingData } from '@navus/shared/transit/timing'
import type { TripEndpoint } from '@navus/shared/routing/path'
import type { VenueLocationMap } from '@navus/shared/venue/types'
import type {
  WalkingConnection,
  WalkingConnectionProvider,
  WalkingRouteEngine,
} from './walking/walking-contracts.ts'
import { createFindPathsService, type FindPathsResult } from './find-paths.ts'

export interface TestTransitData {
  readonly network: TransitNetwork
  readonly geometry: BusRouteGeometry
  readonly index: TransitIndex
  readonly shuttleTiming: ShuttleTimingData
}

interface TestTripRequest {
  readonly origin: TripEndpoint | null
  readonly destination: TripEndpoint | null
}

interface TestRequest {
  readonly tripRequest: TestTripRequest
  readonly venues: VenueLocationMap
  readonly transit: TestTransitData
  readonly signal: AbortSignal
}

interface TestArrivalClient {
  getArrivals(
    stops: readonly { readonly stopId: string; readonly stopName: string }[],
    signal: AbortSignal,
  ): Promise<ShuttleArrivalSnapshot>
}

interface TestServiceHoursClient {
  getServiceWindows(
    routeIds: readonly string[],
    signal: AbortSignal,
  ): Promise<Readonly<Record<string, readonly ShuttleServiceWindow[]>>>
}

function createMatrixTestProvider(routeEngine: WalkingRouteEngine): WalkingConnectionProvider {
  return {
    async getWalkingConnections(request, signal) {
      // Regression fixtures model walking costs as one all-pairs matrix; production uses the directed graph.
      const locations = new Map([
        [request.origin.key, request.origin],
        [request.destination.key, request.destination],
        ...request.stops.map((stop) => [stop.key, stop] as const),
      ])
      const orderedLocations = [...locations.values()]
      const matrix = await routeEngine.matrixWalking({
        sources: orderedLocations.map((location) => location.coordinate),
        targets: orderedLocations.map((location) => location.coordinate),
      }, signal)

      return matrix.flatMap((connection): readonly WalkingConnection[] => {
        const from = orderedLocations[connection.fromIndex]
        const to = orderedLocations[connection.toIndex]
        if (!from || !to) return []
        return [{
          fromKey: from.key,
          toKey: to.key,
          distanceMeters: connection.distanceMeters,
          durationSeconds: connection.durationSeconds,
        }]
      })
    },
  }
}

/** Test adapter for the public planner interface; app data clients stay outside the backend. */
export function createFindPathsTestService(
  routeEngine: WalkingRouteEngine,
  shuttleArrivalClient?: TestArrivalClient,
  shuttleServiceHoursClient?: TestServiceHoursClient,
  now: () => number = Date.now,
  walkingConnectionProvider?: WalkingConnectionProvider,
  getTestDepartureMs: () => number | null = () => null,
): (request: TestRequest) => Promise<FindPathsResult | null> {
  const service = createFindPathsService({
    routeEngine,
    walkingConnectionProvider: walkingConnectionProvider ?? createMatrixTestProvider(routeEngine),
    getArrivals: shuttleArrivalClient
      ? (stops, signal) => shuttleArrivalClient.getArrivals(stops, signal)
      : undefined,
    getServiceWindows: shuttleServiceHoursClient
      ? (routeIds, signal) => shuttleServiceHoursClient.getServiceWindows(routeIds, signal)
      : undefined,
    getTestDepartureMs,
    now,
    monotonicNow: () => performance.now(),
    yieldControl: () => Promise.resolve(),
  })

  return (request) => {
    const { origin, destination } = request.tripRequest
    if (!origin || !destination) return Promise.resolve(null)
    return service({
      origin,
      destination,
      venues: request.venues,
      transit: {
        index: request.transit.index,
        geometry: request.transit.geometry,
        shuttleTiming: request.transit.shuttleTiming,
      },
    }, { signal: request.signal })
  }
}
