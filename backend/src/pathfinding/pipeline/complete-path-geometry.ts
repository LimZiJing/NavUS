import { getTripEndpointKey } from '../endpoints.ts'
import type { Path, ScoredPathCandidate } from '../path.ts'
import {
  MAX_BUS_PATH_CANDIDATES,
  type PathCandidateSearchResult,
  type PathSearchStatus,
} from '../search/search-path-candidates.ts'
import type { WalkingRouteEngine } from '../walking/walking-contracts.ts'
import type { ResolvedPathLocation } from './resolve-path-endpoints.ts'

export interface CompletedPathGeometry {
  readonly candidates: readonly ScoredPathCandidate[]
  readonly searchStatus: PathSearchStatus
  readonly geometryCandidateChecks: number
  readonly geometryRouteRequests: number
  readonly geometryRouteCacheHits: number
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function createAbortError(): Error {
  const error = new Error('The pathfinding request was aborted')
  error.name = 'AbortError'
  return error
}

function isValidWalkingGeometry(geometry: Path['legs'][number]['geometry']): boolean {
  return geometry.type === 'LineString' &&
    geometry.coordinates.length >= 2 &&
    geometry.coordinates.every(([longitude, latitude]) => (
      Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 &&
      Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    ))
}

function createDeadlineSignal(signal: AbortSignal, deadlineAtMs: number, monotonicNow: () => number) {
  // Route requests must stop on either caller cancellation or the geometry-stage deadline.
  const controller = new AbortController()
  const abortFromRequest = () => controller.abort(createAbortError())
  if (signal.aborted) abortFromRequest()
  else signal.addEventListener('abort', abortFromRequest, { once: true })
  const remainingMs = Math.max(0, deadlineAtMs - monotonicNow())
  const timeout = setTimeout(() => {
    const timeoutError = new Error('Path geometry completion exceeded its time budget')
    timeoutError.name = 'TimeoutError'
    controller.abort(timeoutError)
  }, remainingMs)
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abortFromRequest)
    },
  }
}

export async function completePathGeometry(
  routeEngine: WalkingRouteEngine,
  search: PathCandidateSearchResult,
  locations: readonly ResolvedPathLocation[],
  signal: AbortSignal,
  deadlineAtMs: number,
  monotonicNow: () => number,
): Promise<CompletedPathGeometry | null> {
  const locationByKey = new Map(locations.map((location) => [location.key, location]))
  const routePromises = new Map<string, Promise<Path['legs'][number]['geometry']>>()
  const deadline = createDeadlineSignal(signal, deadlineAtMs, monotonicNow)
  const candidates: ScoredPathCandidate[] = []
  let geometryCandidateChecks = 0
  let geometryRouteRequests = 0
  let geometryRouteCacheHits = 0
  let searchStatus = search.status
  let lastGeometryError: unknown = null

  const getRouteGeometry = (
    from: ResolvedPathLocation,
    to: ResolvedPathLocation,
  ): Promise<Path['legs'][number]['geometry']> => {
    if (deadline.signal.aborted) {
      return Promise.reject(deadline.signal.reason ?? new Error('Walking geometry deadline exceeded'))
    }
    const key = `${from.key}\u0000${to.key}`
    const cached = routePromises.get(key)
    if (cached) {
      geometryRouteCacheHits += 1
      return cached
    }
    geometryRouteRequests += 1
    const promise = routeEngine.routeWalking(
      { origin: from.coordinate, destination: to.coordinate },
      deadline.signal,
    ).then(({ geometry }) => {
      if (!isValidWalkingGeometry(geometry)) throw new Error('Walking route returned incomplete geometry')
      return geometry
    })
    routePromises.set(key, promise)
    return promise
  }

  const preparedGeometry = new Map<ScoredPathCandidate, Promise<Path['legs']>>()
  const prepareCandidateGeometry = (candidate: ScoredPathCandidate): Promise<Path['legs']> => (
    Promise.all(candidate.path.legs.map(async (leg) => {
      if (leg.mode === 'shuttle') return leg
      const from = locationByKey.get(getTripEndpointKey(leg.from))
      const to = locationByKey.get(getTripEndpointKey(leg.to))
      if (!from || !to) throw new Error('Walking path leg has an unknown endpoint')
      // Search placeholders carry no routed shape; only validated provider geometry reaches a Path.
      return { ...leg, geometry: await getRouteGeometry(from, to) }
    }))
  )

  try {
    let preferredBusCount = 0
    let preferredWalkingFound = false
    for (const candidate of search.rankedCandidates) {
      const isBus = candidate.path.legs.some((leg) => leg.mode === 'shuttle')
      if (isBus) {
        if (preferredBusCount >= MAX_BUS_PATH_CANDIDATES) continue
        preferredBusCount += 1
      } else {
        if (preferredWalkingFound) continue
        preferredWalkingFound = true
      }
      const promise = prepareCandidateGeometry(candidate)
      void promise.catch(() => undefined)
      preparedGeometry.set(candidate, promise)
      if (preferredBusCount >= MAX_BUS_PATH_CANDIDATES && preferredWalkingFound) break
    }

    let busCandidateCount = 0
    let walkingCandidateFound = false
    for (const candidate of search.rankedCandidates) {
      if (signal.aborted) throw createAbortError()
      if (monotonicNow() >= deadlineAtMs) {
        searchStatus = 'budget-exceeded'
        break
      }

      const isBus = candidate.path.legs.some((leg) => leg.mode === 'shuttle')
      if (
        (isBus && busCandidateCount >= MAX_BUS_PATH_CANDIDATES) ||
        (!isBus && walkingCandidateFound)
      ) continue
      geometryCandidateChecks += 1
      let valid = true
      try {
        const legs = await (preparedGeometry.get(candidate) ?? prepareCandidateGeometry(candidate))
        if (deadline.signal.aborted) {
          if (signal.aborted) throw createAbortError()
          searchStatus = 'budget-exceeded'
          break
        }
        if (legs.some((leg) => leg.mode === 'walking' && !isValidWalkingGeometry(leg.geometry))) {
          valid = false
        } else {
          candidates.push({ ...candidate, path: { ...candidate.path, legs } })
          if (isBus) busCandidateCount += 1
          else walkingCandidateFound = true
        }
      } catch (error: unknown) {
        if (signal.aborted || isAbortError(error)) {
          if (signal.aborted) throw createAbortError()
          if (deadline.signal.aborted) {
            searchStatus = 'budget-exceeded'
            break
          }
        }
        valid = false
        lastGeometryError = error
      }
      if (!valid && deadline.signal.aborted) {
        searchStatus = 'budget-exceeded'
        break
      }
      if (busCandidateCount >= MAX_BUS_PATH_CANDIDATES && walkingCandidateFound) break
    }
  } finally {
    deadline.dispose()
  }

  if (signal.aborted) throw createAbortError()
  if (candidates.length === 0 && search.rankedCandidates.length > 0 && lastGeometryError) {
    throw lastGeometryError
  }

  // An incomplete option is skipped so the next ranked candidate can fill its display quota.
  return candidates.length === 0
    ? null
    : {
        candidates: candidates.map((candidate) => ({
          ...candidate,
          path: {
            ...candidate.path,
            planningQuality: searchStatus === 'complete' ? 'exact' : 'bounded',
          },
        })),
        searchStatus,
        geometryCandidateChecks,
        geometryRouteRequests,
        geometryRouteCacheHits,
      }
}
