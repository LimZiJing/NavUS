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

function asOutcome(
  path: Path | null,
  diagnostics: Readonly<Record<string, number | string | boolean>> = {},
): PathfindingBenchmarkOutcome {
  if (!path) {
    return { kind: 'no-route', reason: 'The Path service returned no route.', diagnostics }
  }
  return { kind: 'path', path, diagnostics }
}

function createAbortError(): Error {
  const error = new Error('The benchmark candidate search was cancelled')
  error.name = 'AbortError'
  return error
}

export const createPathfindingBenchmarkAdapter: PathfindingBenchmarkAdapterFactory = () => ({
  id: 'scored-candidate-pool',
  label: 'Scored candidate pool with geometry enrichment',

  createSearchRunner({ benchmarkCase }) {
    return async (signal) => {
      const result = await searchPathsWithinBudget(benchmarkCase.searchInput, {
        maxDurationMs: PATHFINDING_SEARCH_MAX_DURATION_MS,
        maxExpandedPaths: PATHFINDING_SEARCH_MAX_EXPANDED_PATHS,
        shouldCancel: () => signal.aborted,
        yieldEvery: 0,
        now: () => performance.now(),
      })
      if (signal.aborted || result.status === 'cancelled') throw createAbortError()
      return asOutcome(result.path, {
        planningStatus: result.status,
        expandedPathCount: result.expandedPathCount,
        indexBuildDurationMs: result.indexBuildDurationMs,
        candidateResolutionDurationMs: result.candidateResolutionDurationMs,
        candidateEnumerationStepCount: result.candidateEnumerationStepCount,
        searchDurationMs: result.searchDurationMs,
        searchYieldWaitMs: result.searchYieldWaitMs,
        searchCpuMs: result.searchCpuMs,
        maxSearchChunkDurationMs: result.maxSearchChunkDurationMs,
        geometrySliceCount: result.geometrySliceCount,
        geometrySliceDurationMs: result.geometrySliceDurationMs,
        candidatePoolSize: result.candidates.length,
        busCandidateCount: result.candidates.filter(({ path }) => (
          path.legs.some((leg) => leg.mode === 'shuttle')
        )).length,
      })
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
        return asOutcome(result?.candidates[0]?.path ?? null, result ? {
          planningStatus: result.searchStatus,
          ...result.metrics,
          candidatePoolSize: result.candidates.length,
          busCandidateCount: result.candidates.filter(({ path }) => (
            path.legs.some((leg) => leg.mode === 'shuttle')
          )).length,
          geometryCandidateChecks: result.metrics.geometryCandidateChecks,
          geometryRouteRequests: result.metrics.geometryRouteRequests,
          geometryRouteCacheHits: result.metrics.geometryRouteCacheHits,
        } : {})
      } catch (error) {
        if (error instanceof NoPathAvailableError) {
          return { kind: 'no-route', reason: error.message }
        }
        throw error
      }
    }
  },
})
