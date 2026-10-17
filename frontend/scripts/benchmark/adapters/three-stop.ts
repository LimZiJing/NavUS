import {
  createFindPathsService,
  NoPathAvailableError,
} from '../../../../backend/src/pathfinding/find-paths.js'
import { searchPaths } from '../../../../backend/src/pathfinding/search/search-path-candidates.js'
import type { Path } from '../../../../backend/src/pathfinding/path.js'
import { createWalkingConnectionProvider } from '../../../../backend/src/pathfinding/walking/walking-connections.js'
import type {
  PathfindingBenchmarkAdapterFactory,
  PathfindingBenchmarkOutcome,
} from '../contract.js'

function asOutcome(path: Path | null): PathfindingBenchmarkOutcome {
  if (!path) return { kind: 'no-route', reason: 'The Path service returned no route.' }
  return { kind: 'path', path }
}

function createAbortError(): Error {
  const error = new Error('The benchmark Path was cancelled')
  error.name = 'AbortError'
  return error
}

export const createPathfindingBenchmarkAdapter: PathfindingBenchmarkAdapterFactory = () => ({
  id: 'three-stop-single-shuttle',
  label: 'Three-stop single-shuttle planner',

  createSearchRunner({ benchmarkCase }) {
    return async (signal) => {
      if (signal.aborted) throw createAbortError()
      const path = searchPaths(benchmarkCase.searchInput)
      if (signal.aborted) throw createAbortError()
      return asOutcome(path)
    }
  },

  createPathRunner({ benchmarkCase, venues, transit, walkingGraph, routeEngine, now, createArrivalClient, createServiceHoursClient }) {
    const walkingConnectionProvider = createWalkingConnectionProvider({
      routeEngine,
      loadGraph: async () => walkingGraph,
    })
    const arrivals = createArrivalClient(benchmarkCase)
    const serviceHours = createServiceHoursClient?.(benchmarkCase)
    const service = createFindPathsService({
      routeEngine,
      walkingConnectionProvider,
      getArrivals: (stops, signal) => arrivals.getArrivals(stops, signal),
      getServiceWindows: serviceHours
        ? (routeIds, signal) => serviceHours.getServiceWindows(routeIds, signal)
        : undefined,
      getTestDepartureMs: () => null,
      now,
      monotonicNow: () => performance.now(),
      yieldControl: () => Promise.resolve(),
    })

    return async (signal) => {
      try {
        const result = await service({
          origin: benchmarkCase.origin,
          destination: benchmarkCase.destination,
          venues,
          transit: {
            index: transit.index,
            geometry: transit.geometry,
            shuttleTiming: transit.shuttleTiming,
          },
        }, { signal })
        return asOutcome(result?.candidates[0]?.path ?? null)
      } catch (error) {
        if (error instanceof NoPathAvailableError) {
          return { kind: 'no-route', reason: error.message }
        }
        throw error
      }
    }
  },
})
