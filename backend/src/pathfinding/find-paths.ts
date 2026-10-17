import type { ShuttleArrivalSnapshot } from '@navus/shared/transit/live-arrivals'
import type { TransitIndex } from '@navus/shared/transit/index'
import type { TripEndpoint } from '@navus/shared/routing/path'
import type { VenueLocationMap } from '@navus/shared/venue/types'
import type { BuildingIndex } from './endpoints.ts'
import type { ShuttleTimingData } from '@navus/shared/transit/timing'
import type { BusRouteGeometry } from '@navus/shared/transit/types'
import type { ShuttleServiceWindow } from '@navus/shared/transit/service-hours-policy'
import {
  applyBusWaits,
  describeUnavailableBusService,
  NoPathAvailableError,
} from './pipeline/apply-bus-waits.ts'
import { completePathGeometry } from './pipeline/complete-path-geometry.ts'
import { resolvePathEndpoints } from './pipeline/resolve-path-endpoints.ts'
import { selectWalkingConnections } from './pipeline/select-walking-connections.ts'
import {
  searchPathCandidatesWithinBudget,
  zeroBusWaitingTime,
  type PathSearchStatus,
} from './search/search-path-candidates.ts'
import type {
  WalkingConnectionProvider,
  WalkingRouteEngine,
} from './walking/walking-contracts.ts'
import type { ScoredPathCandidate } from './path.ts'

// Indexing and enumeration share the 350 ms request budget and stop after 10,000 expanded candidates.
const MAX_SEARCH_DURATION_MS = 350
const MAX_EXPANDED_PATHS = 10_000
// Yield every 64 steps so Express can handle other requests between search batches.
const SEARCH_YIELD_EVERY = 64
// Cap indexing and enumeration so wait scoring still has up to 50 ms of the original budget.
const MAX_CANDIDATE_SEARCH_DURATION_MS = 300

export interface FindPathsRequest {
  readonly origin: TripEndpoint
  readonly destination: TripEndpoint
  readonly simulatedDepartureMs?: number
  readonly venues: VenueLocationMap
  readonly buildings?: BuildingIndex | null
  readonly transit: {
    readonly index: TransitIndex
    readonly geometry: BusRouteGeometry
    readonly shuttleTiming: ShuttleTimingData
  }
}

export interface FindPathsMetrics {
  readonly expandedPathCount: number
  readonly indexBuildDurationMs: number
  readonly candidateResolutionDurationMs: number
  readonly candidateEnumerationStepCount: number
  readonly searchDurationMs: number
  readonly searchYieldWaitMs: number
  readonly searchCpuMs: number
  readonly maxSearchChunkDurationMs: number
  readonly geometrySliceCount: number
  readonly geometrySliceDurationMs: number
  readonly geometryCandidateChecks: number
  readonly geometryRouteRequests: number
  readonly geometryRouteCacheHits: number
}

/** Keep returned options, search completeness, and instrumentation as separate values. */
export interface FindPathsResult {
  readonly candidates: readonly ScoredPathCandidate[]
  readonly searchStatus: PathSearchStatus
  readonly metrics: FindPathsMetrics
}

export interface FindPathsDependencies {
  readonly signal: AbortSignal
  readonly routeEngine: WalkingRouteEngine
  readonly walkingConnectionProvider: WalkingConnectionProvider
  readonly getArrivals?: (
    stops: readonly { readonly stopId: string; readonly stopName: string }[],
    signal: AbortSignal,
  ) => Promise<ShuttleArrivalSnapshot>
  readonly getServiceWindows?: (
    routeIds: readonly string[],
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, readonly ShuttleServiceWindow[]>>>
  readonly getTestDepartureMs: () => number | null
  readonly now: () => number
  readonly monotonicNow: () => number
  readonly yieldControl: () => Promise<void>
}

export interface FindPathsRunContext {
  readonly signal: AbortSignal
}

export type FindPathsService = (
  request: FindPathsRequest,
  context: FindPathsRunContext,
) => Promise<FindPathsResult | null>

export type FindPathsServiceDependencies = Omit<FindPathsDependencies, 'signal'>

function createAbortError(): Error {
  const error = new Error('The pathfinding request was aborted')
  error.name = 'AbortError'
  return error
}

function hasWalkingCandidate(candidates: readonly ScoredPathCandidate[]): boolean {
  return candidates.some((candidate) => candidate.path.legs.every((leg) => leg.mode === 'walking'))
}

/**
 * Coordinates the five stages of pathfinding. Each provider, clock, and cancellation effect enters
 * through dependencies so this function can move behind an HTTP boundary without changing search.
 */
export async function findPaths(
  request: FindPathsRequest,
  dependencies: FindPathsDependencies,
): Promise<FindPathsResult | null> {
  const { signal, routeEngine, walkingConnectionProvider, monotonicNow, yieldControl } = dependencies
  if (signal.aborted) throw createAbortError()

  const endpoints = resolvePathEndpoints(
    request.origin,
    request.destination,
    request.venues,
    request.transit.index,
    request.buildings ?? undefined,
  )
  if (!endpoints) return null

  const walkingConnections = await selectWalkingConnections(
    endpoints,
    request.transit.index,
    walkingConnectionProvider,
    signal,
  )
  if (signal.aborted) throw createAbortError()

  const searchStartedAtMs = monotonicNow()
  const searchDeadlineAtMs = searchStartedAtMs + MAX_SEARCH_DURATION_MS
  // Enumerate bus topology with zero waits first; applyBusWaits then scores each boarding at its expected time.
  const candidateSearch = await searchPathCandidatesWithinBudget({
    origin: endpoints.origin,
    destination: endpoints.destination,
    transitIndex: request.transit.index,
    routeGeometry: request.transit.geometry,
    shuttleTiming: request.transit.shuttleTiming,
    walkingConnections,
    getShuttleWaitingSeconds: zeroBusWaitingTime,
  }, {
    maxDurationMs: MAX_CANDIDATE_SEARCH_DURATION_MS,
    deadlineAtMs: searchDeadlineAtMs,
    maxExpandedPaths: MAX_EXPANDED_PATHS,
    shouldCancel: () => signal.aborted,
    yieldEvery: SEARCH_YIELD_EVERY,
    yieldControl,
    now: monotonicNow,
  })
  if (candidateSearch.status === 'cancelled' || signal.aborted) throw createAbortError()

  // Timing re-scoring gets only the part of the original search budget that remained after enumeration.
  const remainingSearchBudgetMs = Math.max(
    0,
    MAX_SEARCH_DURATION_MS - (monotonicNow() - searchStartedAtMs),
  )
  const waitResult = await applyBusWaits(
    candidateSearch,
    request.transit.index.stops,
    request.transit.shuttleTiming,
    {
      signal,
      now: dependencies.now,
      monotonicNow,
      remainingSearchBudgetMs,
      getTestDepartureMs: request.simulatedDepartureMs === undefined
        ? dependencies.getTestDepartureMs
        : () => request.simulatedDepartureMs!,
      getArrivals: dependencies.getArrivals,
      getServiceWindows: dependencies.getServiceWindows,
    },
  )
  if (signal.aborted) throw createAbortError()
  if (waitResult.unavailableService && !hasWalkingCandidate(waitResult.search.rankedCandidates)) {
    throw new NoPathAvailableError(describeUnavailableBusService(waitResult.unavailableService))
  }

  const geometry = await completePathGeometry(
    routeEngine,
    waitResult.search,
    endpoints.all,
    signal,
    monotonicNow() + MAX_SEARCH_DURATION_MS,
    monotonicNow,
  )
  if (!geometry) return null

  return {
    candidates: geometry.candidates,
    searchStatus: geometry.searchStatus,
    metrics: {
      expandedPathCount: waitResult.search.expandedPathCount,
      indexBuildDurationMs: waitResult.search.indexBuildDurationMs,
      candidateResolutionDurationMs: waitResult.search.candidateResolutionDurationMs,
      candidateEnumerationStepCount: waitResult.search.candidateEnumerationStepCount,
      searchDurationMs: waitResult.search.searchDurationMs,
      searchYieldWaitMs: waitResult.search.searchYieldWaitMs,
      searchCpuMs: waitResult.search.searchCpuMs,
      maxSearchChunkDurationMs: waitResult.search.maxSearchChunkDurationMs,
      geometrySliceCount: waitResult.search.geometrySliceCount,
      geometrySliceDurationMs: waitResult.search.geometrySliceDurationMs,
      geometryCandidateChecks: geometry.geometryCandidateChecks,
      geometryRouteRequests: geometry.geometryRouteRequests,
      geometryRouteCacheHits: geometry.geometryRouteCacheHits,
    },
  }
}

export function createFindPathsService(
  dependencies: FindPathsServiceDependencies,
): FindPathsService {
  return (request, context) => findPaths(request, { ...dependencies, ...context })
}

export { NoPathAvailableError }
