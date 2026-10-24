import type { ShuttleTimingData, ShuttleTimingRecord } from '@nusgo/shared/transit/timing'
import type { TransitStop } from '@nusgo/shared/transit/types'
import type { ShuttleArrivalSnapshot } from '@nusgo/shared/transit/live-arrivals'
import {
  describeShuttleServiceUnavailable,
  evaluateShuttleService,
  type ShuttleServiceEvaluation,
  type ShuttleServiceWindow,
} from '@nusgo/shared/transit/service-hours-policy'
import type {
  BusWaitingTimeContext,
  BusWaitingTimeProvider,
  PathCandidateSearchResult,
} from '../search/search-path-candidates.ts'
import type { Path } from '../path.ts'

export const TEST_SHUTTLE_WAIT_SECONDS = 5 * 60
// A boarding wait at or above this is not a useful option, so the Path is dropped.
export const MAX_BUS_WAIT_SECONDS = 5 * 60 * 60

interface BoardingStopRequest {
  readonly stopId: string
  readonly stopName: string
}

export interface ApplyBusWaitsDependencies {
  readonly signal: AbortSignal
  readonly now: () => number
  readonly monotonicNow: () => number
  readonly remainingSearchBudgetMs: number
  readonly getTestDepartureMs: () => number | null
  readonly getArrivals?: (
    stops: readonly { readonly stopId: string; readonly stopName: string }[],
    signal: AbortSignal,
  ) => Promise<ShuttleArrivalSnapshot>
  readonly getServiceWindows?: (
    routeIds: readonly string[],
    signal: AbortSignal,
  ) => Promise<Readonly<Record<string, readonly ShuttleServiceWindow[]>>>
}

export interface ApplyBusWaitsResult {
  readonly search: PathCandidateSearchResult
  readonly unavailableService: ShuttleServiceEvaluation | null
}

export class NoPathAvailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoPathAvailableError'
  }
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

function createAbortError(): Error {
  const error = new Error('The pathfinding request was aborted')
  error.name = 'AbortError'
  return error
}

export function createTestBusWaitingTimeProvider(
  departureMs: number,
  serviceWindows: Readonly<Record<string, readonly ShuttleServiceWindow[]>>,
): BusWaitingTimeProvider {
  return (_record, context) => {
    const windows = serviceWindows[context.routeId]
    if (!windows) return null
    const boardingAtMs = departureMs + (context.elapsedSeconds + TEST_SHUTTLE_WAIT_SECONDS) * 1000
    return evaluateShuttleService(windows, new Date(boardingAtMs)).status === 'active'
      ? TEST_SHUTTLE_WAIT_SECONDS
      : null
  }
}

const LIVE_DATA_STALE_AFTER_SECONDS = 45
const LIVE_DATA_EXPIRED_AFTER_SECONDS = 120

function getSnapshotAgeSeconds(observedAtMs: number, nowMs: number): number | null {
  const ageSeconds = Math.floor((nowMs - observedAtMs) / 1000)
  if (
    ageSeconds < 0 ||
    ageSeconds > LIVE_DATA_EXPIRED_AFTER_SECONDS ||
    ageSeconds > LIVE_DATA_STALE_AFTER_SECONDS
  ) return null
  return ageSeconds
}

export function createLiveBusWaitingTimeProvider(
  snapshot: ShuttleArrivalSnapshot,
  nowMs: number,
): BusWaitingTimeProvider {
  return (_record, context) => {
    // An unavailable stop has no live data at all, so it must not fall back to the snapshot's observedAt.
    if (snapshot.unavailableStopIds?.includes(context.boardingStopId)) return null

    const stop = snapshot.stops[context.boardingStopId]
    const route = stop?.[context.routeId]
    if (!route) return null

    const observation = snapshot.stopObservations?.[context.boardingStopId] ?? {
      observedAt: snapshot.observedAt,
      expiresAt: snapshot.expiresAt,
    }
    const observedAtMs = Date.parse(observation.observedAt)
    const expiresAtMs = Date.parse(observation.expiresAt)
    const snapshotAgeSeconds = Number.isFinite(observedAtMs)
      ? getSnapshotAgeSeconds(observedAtMs, nowMs)
      : null
    if (
      snapshotAgeSeconds === null ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= observedAtMs ||
      expiresAtMs <= nowMs
    ) return null

    const elapsedSinceObservation = snapshotAgeSeconds + context.elapsedSeconds
    const nextArrival = route.upcomingArrivalSeconds.find(
      (arrivalSeconds) => arrivalSeconds >= elapsedSinceObservation,
    )
    if (nextArrival !== undefined) return nextArrival - elapsedSinceObservation
    if (route.headwaySeconds === null) return null
    return Math.max(1, Math.round(route.headwaySeconds.median / 2))
  }
}

function collectEligibleBoardingStops(
  stops: readonly TransitStop[],
  search: PathCandidateSearchResult,
): readonly BoardingStopRequest[] {
  const eligibleBoardingIds = new Set<string>()
  for (const { path } of search.rankedCandidates) {
    for (const leg of path.legs) {
      if (leg.mode === 'shuttle') eligibleBoardingIds.add(leg.boardingStopId)
    }
  }
  return stops
    .filter((stop) => eligibleBoardingIds.has(stop.id))
    .map((stop) => ({ stopId: stop.id, stopName: stop.longName }))
}

function collectEligibleRouteIds(search: PathCandidateSearchResult): readonly string[] {
  const routeIds = new Set<string>()
  for (const { path } of search.rankedCandidates) {
    for (const leg of path.legs) {
      if (leg.mode === 'shuttle') routeIds.add(leg.routeId)
    }
  }
  return [...routeIds]
}

function timingKey(routeId: string, boardingStopId: string, alightingStopId: string): string {
  return `${routeId}\u0000${boardingStopId}\u0000${alightingStopId}`
}

function compareText(first: string, second: string): number {
  if (first < second) return -1
  if (first > second) return 1
  return 0
}

function compareRankedCandidates(
  first: PathCandidateSearchResult['rankedCandidates'][number],
  second: PathCandidateSearchResult['rankedCandidates'][number],
): number {
  const shuttleBoardings = (candidate: PathCandidateSearchResult['rankedCandidates'][number]) => (
    candidate.path.legs.filter((leg) => leg.mode === 'shuttle').length
  )
  const walkingDistance = (candidate: PathCandidateSearchResult['rankedCandidates'][number]) => (
    candidate.path.legs.reduce((total, leg) => (
      total + (leg.mode === 'walking' ? leg.distanceMeters : 0)
    ), 0)
  )
  return first.adjustedDurationSeconds - second.adjustedDurationSeconds ||
    shuttleBoardings(first) - shuttleBoardings(second) ||
    walkingDistance(first) - walkingDistance(second) ||
    first.path.legs.length - second.path.legs.length ||
    compareText(first.candidateKey, second.candidateKey)
}

function isWalkingOnlyCandidate(candidate: PathCandidateSearchResult['rankedCandidates'][number]): boolean {
  return candidate.path.legs.every((leg) => leg.mode === 'walking')
}

function walkingOnlySearch(search: PathCandidateSearchResult): PathCandidateSearchResult {
  return {
    ...search,
    rankedCandidates: search.rankedCandidates.filter(isWalkingOnlyCandidate),
  }
}

function scoreCandidatesWithWaiting(
  search: PathCandidateSearchResult,
  timingRecords: readonly ShuttleTimingRecord[],
  getShuttleWaitingSeconds: BusWaitingTimeProvider,
  serviceWindows: Readonly<Record<string, readonly ShuttleServiceWindow[]>> | null,
  departureMs: number,
  signal: AbortSignal,
  deadlineAtMs: number,
  monotonicNow: () => number,
): PathCandidateSearchResult {
  const timingByKey = new Map(timingRecords.map((record) => [
    timingKey(record.routeId, record.fromStopId, record.toStopId),
    record,
  ]))
  const rankedCandidates = search.rankedCandidates.filter(isWalkingOnlyCandidate)
  let status = search.status

  for (const candidate of search.rankedCandidates) {
    if (isWalkingOnlyCandidate(candidate)) continue
    if (signal.aborted) throw createAbortError()
    if (monotonicNow() >= deadlineAtMs) {
      status = 'budget-exceeded'
      break
    }
    let elapsedSeconds = 0
    let adjustedDurationSeconds = 0
    let shuttleBoardings = 0
    let valid = true
    const legs: Path['legs'][number][] = []

    for (const leg of candidate.path.legs) {
      if (leg.mode === 'walking') {
        legs.push(leg)
        elapsedSeconds += leg.durationSeconds
        adjustedDurationSeconds += leg.durationSeconds / 0.8
        continue
      }

      const record = timingByKey.get(timingKey(
        leg.routeId,
        leg.boardingStopId,
        leg.alightingStopId,
      ))
      if (!record) {
        valid = false
        break
      }
      // Recalculate this boarding after prior walks and waits have advanced the expected arrival time.
      const waitingSeconds = getShuttleWaitingSeconds(record, {
        routeId: leg.routeId,
        boardingStopId: leg.boardingStopId,
        elapsedSeconds,
      } satisfies BusWaitingTimeContext)
      if (
        waitingSeconds === null ||
        !Number.isFinite(waitingSeconds) ||
        waitingSeconds < 0 ||
        waitingSeconds >= MAX_BUS_WAIT_SECONDS
      ) {
        valid = false
        break
      }
      const windows = serviceWindows?.[leg.routeId]
      if (windows) {
        const service = evaluateShuttleService(
          windows,
          new Date(departureMs + (elapsedSeconds + waitingSeconds) * 1000),
        )
        if (service.status !== 'active') {
          valid = false
          break
        }
      }

      const durationSeconds = waitingSeconds + leg.rideSeconds
      legs.push({ ...leg, durationSeconds, waitingSeconds })
      elapsedSeconds += durationSeconds
      // Each later boarding adds uncertainty, so apply the established 0.9 weight after the first.
      adjustedDurationSeconds += durationSeconds / (shuttleBoardings > 0 ? 0.9 : 1)
      shuttleBoardings += 1
    }

    if (!valid) continue
    rankedCandidates.push({
      ...candidate,
      adjustedDurationSeconds,
      score: adjustedDurationSeconds === 0 ? Number.POSITIVE_INFINITY : 1 / adjustedDurationSeconds,
      path: {
        ...candidate.path,
        totalDurationSeconds: elapsedSeconds,
        legs,
      },
    })
  }

  rankedCandidates.sort(compareRankedCandidates)
  return { ...search, status, rankedCandidates }
}

function getStaticServiceEvaluation(
  path: Path,
  serviceWindows: Readonly<Record<string, readonly ShuttleServiceWindow[]>>,
  nowMs: number,
): ShuttleServiceEvaluation | null {
  let elapsedSeconds = 0
  for (const leg of path.legs) {
    if (leg.mode === 'shuttle') {
      const windows = serviceWindows[leg.routeId]
      if (windows) {
        const evaluation = evaluateShuttleService(windows, new Date(nowMs + elapsedSeconds * 1000))
        if (evaluation.status !== 'active') return evaluation
      }
    }
    elapsedSeconds += leg.durationSeconds
  }
  return null
}

export async function applyBusWaits(
  search: PathCandidateSearchResult,
  stops: readonly TransitStop[],
  shuttleTiming: ShuttleTimingData,
  dependencies: ApplyBusWaitsDependencies,
): Promise<ApplyBusWaitsResult> {
  const testDepartureMs = dependencies.getTestDepartureMs()
  if (!dependencies.getArrivals && testDepartureMs === null) {
    return { search, unavailableService: null }
  }

  const boardingStops = collectEligibleBoardingStops(stops, search)
  if (boardingStops.length === 0) return { search, unavailableService: null }

  let serviceWindows: Readonly<Record<string, readonly ShuttleServiceWindow[]>> | null = null
  if (dependencies.getServiceWindows) {
    const routeIds = collectEligibleRouteIds(search)
    if (routeIds.length === 0) return { search, unavailableService: null }
    try {
      serviceWindows = await dependencies.getServiceWindows(routeIds, dependencies.signal)
    } catch (error: unknown) {
      if (dependencies.signal.aborted || isAbortError(error)) throw createAbortError()
      console.warn('bus service-hour data is unavailable; removing bus options.', error)
      return { search: walkingOnlySearch(search), unavailableService: null }
    }
    if (!routeIds.every((routeId) => serviceWindows?.[routeId] !== undefined)) {
      return { search: walkingOnlySearch(search), unavailableService: null }
    }
  }

  if (testDepartureMs !== null) {
    if (!serviceWindows) return { search, unavailableService: null }
    const testSearch = scoreCandidatesWithWaiting(
      search,
      shuttleTiming.records,
      createTestBusWaitingTimeProvider(testDepartureMs, serviceWindows),
      serviceWindows,
      testDepartureMs,
      dependencies.signal,
      dependencies.monotonicNow() + dependencies.remainingSearchBudgetMs,
      dependencies.monotonicNow,
    )
    return {
      search: testSearch.rankedCandidates.some((candidate) => (
        candidate.path.legs.some((leg) => leg.mode === 'shuttle')
      )) ? testSearch : walkingOnlySearch(testSearch),
      unavailableService: null,
    }
  }

  if (!dependencies.getArrivals) return { search, unavailableService: null }
  const liveArrivals = await dependencies.getArrivals(boardingStops, dependencies.signal).catch((error: unknown) => {
    if (dependencies.signal.aborted || isAbortError(error)) throw createAbortError()
    throw error
  })
  const nowMs = dependencies.now()
  const liveSearch = scoreCandidatesWithWaiting(
    search,
    shuttleTiming.records,
    createLiveBusWaitingTimeProvider(liveArrivals, nowMs),
    serviceWindows,
    nowMs,
    dependencies.signal,
    dependencies.monotonicNow() + dependencies.remainingSearchBudgetMs,
    dependencies.monotonicNow,
  )
  if (liveSearch.rankedCandidates.some((candidate) => (
    candidate.path.legs.some((leg) => leg.mode === 'shuttle')
  ))) return { search: liveSearch, unavailableService: null }

  const staticBusPath = search.rankedCandidates.find((candidate) => (
    candidate.path.legs.some((leg) => leg.mode === 'shuttle')
  ))?.path ?? null
  const unavailableService = serviceWindows && staticBusPath
    ? getStaticServiceEvaluation(staticBusPath, serviceWindows, nowMs)
    : null
  return { search: walkingOnlySearch(liveSearch), unavailableService }
}

export function describeUnavailableBusService(evaluation: ShuttleServiceEvaluation): string {
  return describeShuttleServiceUnavailable(evaluation)
}
