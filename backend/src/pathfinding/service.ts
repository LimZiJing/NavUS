import type { ApiJourneyPlanningRequest, ApiJourneyPlanningResponse } from '@navus/shared/routing/path'
import { createTransitIndex } from '@navus/shared/transit/index'
import type { BackendConfig } from '../config.ts'
import type { BackendData } from '../canonical-data.ts'
import type { BackendLiveData } from '../live-data/runtime.ts'
import { createFindPathsService, NoPathAvailableError } from './find-paths.ts'
import { buildBuildingLocations, hasCanonicalEndpoint } from './endpoints.ts'
import { createValhallaRouteEngine } from './walking/valhalla-walking-client.ts'
import { getValhallaBaseUrl } from './walking/valhalla-config.ts'
import { createWalkingConnectionProvider } from './walking/walking-connections.ts'

export class InvalidJourneyEndpointError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidJourneyEndpointError'
  }
}

export interface PathfindingService {
  plan(request: ApiJourneyPlanningRequest, signal: AbortSignal): Promise<ApiJourneyPlanningResponse>
}

export interface PathfindingServiceOptions {
  readonly fetcher?: typeof fetch
  readonly now?: () => number
  readonly monotonicNow?: () => number
  readonly yieldControl?: () => Promise<void>
}

export function createPathfindingService(
  data: BackendData,
  liveData: BackendLiveData,
  config: Pick<BackendConfig, 'valhallaBaseUrl'>,
  options: PathfindingServiceOptions = {},
): PathfindingService {
  const transitIndex = createTransitIndex(data.network)
  const buildingIndex = buildBuildingLocations(data.buildings)
  const sources = { venues: data.venues, buildings: buildingIndex, transit: transitIndex }
  const routeEngine = createValhallaRouteEngine({
    baseUrl: getValhallaBaseUrl(config.valhallaBaseUrl),
    fetcher: options.fetcher,
  })
  const walkingConnectionProvider = createWalkingConnectionProvider({
    routeEngine,
    walkingStopGraph: data.walkingStopGraph,
  })
  const findPaths = createFindPathsService({
    routeEngine,
    walkingConnectionProvider,
    getArrivals: async (stops) => liveData.getBusArrivals(stops.map(({ stopId }) => stopId)),
    getServiceWindows: async (routeIds, signal) => (
      (await liveData.getServiceWindows(routeIds, signal)).routes
    ),
    getTestDepartureMs: () => null,
    now: options.now ?? Date.now,
    monotonicNow: options.monotonicNow ?? (() => performance.now()),
    yieldControl: options.yieldControl ?? (() => new Promise((resolve) => setImmediate(resolve))),
  })

  return {
    async plan(request, signal) {
      if (!hasCanonicalEndpoint(request.origin, sources) || !hasCanonicalEndpoint(request.destination, sources)) {
        throw new InvalidJourneyEndpointError('Journey endpoint does not match canonical data')
      }
      try {
        const result = await findPaths({
          origin: request.origin,
          destination: request.destination,
          venues: data.venues,
          buildings: buildingIndex,
          transit: {
            index: transitIndex,
            geometry: data.routeGeometry,
            shuttleTiming: data.shuttleTiming,
          },
          simulatedDepartureMs: request.simulatedDepartureMs,
        }, { signal })
        if (!result) return { outcome: 'no-path' }
        if (result.searchStatus === 'cancelled') {
          const error = new Error('The pathfinding request was aborted')
          error.name = 'AbortError'
          throw error
        }
        const searchStatus = result.searchStatus
        return {
          outcome: 'paths',
          candidates: result.candidates,
          searchStatus,
        }
      } catch (error: unknown) {
        if (error instanceof NoPathAvailableError) {
          return { outcome: 'no-path', message: error.message }
        }
        throw error
      }
    },
  }
}
