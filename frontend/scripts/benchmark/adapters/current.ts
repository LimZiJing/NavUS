import {
  createFindPathsService,
  NoPathAvailableError,
} from '../../../../backend/src/pathfinding/find-paths.js'
import { searchPathsWithinBudget } from '../../../../backend/src/pathfinding/search/search-path-candidates.js'
import type { Path } from '../../../../backend/src/pathfinding/path.js'
import { createWalkingConnectionProvider } from '../../../../backend/src/pathfinding/walking/walking-connections.js'
import type {
  PathfindingBenchmarkAdapterFactory,
  PathfindingBenchmarkOutcome,
} from '../contract.js'

const PATHFINDING_SEARCH_MAX_DURATION_MS = 350
const PATHFINDING_SEARCH_MAX_EXPANDED_PATHS = 10_000

function asOutcome(path: Path | null): PathfindingBenchmarkOutcome {
  if (!path) return { kind: 'no-route', reason: 'The Path service returned no route.' }
  return { kind: 'path', path }
}

export const createPathfindingBenchmarkAdapter: PathfindingBenchmarkAdapterFactory = () => ({
  id: 'current-priority-queue',
  label: 'Current NavUS planner',

  createSearchRunner({ benchmarkCase }) {
    return async (signal) => {
      const result = await searchPathsWithinBudget(benchmarkCase.searchInput, {
        maxDurationMs: PATHFINDING_SEARCH_MAX_DURATION_MS,
        maxExpandedPaths: PATHFINDING_SEARCH_MAX_EXPANDED_PATHS,
        shouldCancel: () => signal.aborted,
        yieldEvery: 0,
      })
      if (signal.aborted || result.status === 'cancelled') {
        const error = new Error('The benchmark search was cancelled')
        error.name = 'AbortError'
        throw error
      }
      if (!result.path) {
        return {
          kind: 'no-route',
          reason: `Planner returned no path (${result.status}).`,
          diagnostics: {
            planningStatus: result.status,
            expandedPathCount: result.expandedPathCount,
          },
        }
      }
      return {
        kind: 'path',
        path: result.path,
        diagnostics: {
          planningStatus: result.status,
          expandedPathCount: result.expandedPathCount,
        },
      }
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
