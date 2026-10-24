import type {
  DataFreshness,
  ShuttleArrivalSnapshot,
  ShuttleRouteArrivalData,
} from '@nusgo/shared'

export interface BusArrivalStop {
  readonly stopId: string
  readonly stopName: string
}

export interface BusArrivalStopResult extends DataFreshness {
  readonly routes: Readonly<Record<string, ShuttleRouteArrivalData>>
}

export type BusArrivalStopLoader = (
  stop: BusArrivalStop,
  signal: AbortSignal,
) => Promise<BusArrivalStopResult>

export interface BusArrivalStopFailure {
  readonly stopId: string
  readonly error: unknown
}

export interface BusArrivalSnapshotRefreshResult {
  readonly snapshot: ShuttleArrivalSnapshot | null
  readonly published: boolean
  readonly successfulStopIds: readonly string[]
  readonly failures: readonly BusArrivalStopFailure[]
}

export interface RefreshBusArrivalSnapshotOptions {
  readonly previousSnapshot?: ShuttleArrivalSnapshot | null
  readonly snapshotVersion: string
  readonly refreshIntervalMs: number
  readonly nextRefreshAtMs?: number
  readonly maxConcurrency: number
  readonly now?: () => number
  readonly signal?: AbortSignal
}

export interface BusArrivalRefreshLog {
  readonly startedAt: string
  readonly completedAt: string
  readonly durationMs: number
  readonly successfulStopCount: number
  readonly failedStopCount: number
  readonly snapshotVersion: string | null
  readonly published: boolean
}

export interface BusArrivalSnapshotStoreOptions {
  readonly stops: readonly BusArrivalStop[]
  readonly loadStop: BusArrivalStopLoader
  readonly refreshIntervalMs: number
  readonly maxConcurrency: number
  readonly now?: () => number
  readonly onRefreshComplete?: (
    log: BusArrivalRefreshLog,
    failures: readonly BusArrivalStopFailure[],
  ) => void
}

export interface BusArrivalSnapshotStore {
  start(): void
  stop(): Promise<void>
  refreshNow(): Promise<BusArrivalSnapshotRefreshResult>
  getSnapshot(): ShuttleArrivalSnapshot | null
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

function earliestTimestamp(values: readonly string[], fallback: string): string {
  return values.length > 0 ? [...values].sort()[0] : fallback
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
}

async function loadStopsWithLimit(
  stops: readonly BusArrivalStop[],
  loadStop: BusArrivalStopLoader,
  signal: AbortSignal,
  maxConcurrency: number,
): Promise<readonly PromiseSettledResult<BusArrivalStopResult>[]> {
  const settled: PromiseSettledResult<BusArrivalStopResult>[] = new Array(stops.length)
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < stops.length) {
      const index = nextIndex
      nextIndex += 1
      const stop = stops[index]
      if (!stop) continue
      if (signal.aborted) {
        settled[index] = { status: 'rejected', reason: abortError(signal) }
        continue
      }

      try {
        settled[index] = { status: 'fulfilled', value: await loadStop(stop, signal) }
      } catch (error: unknown) {
        settled[index] = { status: 'rejected', reason: error }
      }
    }
  }

  const workerCount = Math.min(stops.length, maxConcurrency)
  await Promise.all(Array.from({ length: workerCount }, worker))
  return settled
}

export async function refreshBusArrivalSnapshot(
  stops: readonly BusArrivalStop[],
  loadStop: BusArrivalStopLoader,
  options: RefreshBusArrivalSnapshotOptions,
): Promise<BusArrivalSnapshotRefreshResult> {
  if (!Number.isInteger(options.maxConcurrency) || options.maxConcurrency < 1) {
    throw new Error('Snapshot maxConcurrency must be a positive integer')
  }
  const now = options.now ?? Date.now
  const signal = options.signal ?? new AbortController().signal
  const settled = await loadStopsWithLimit(stops, loadStop, signal, options.maxConcurrency)
  const successfulStopIds: string[] = []
  const failures: BusArrivalStopFailure[] = []
  const loaded = new Map<string, BusArrivalStopResult>()

  settled.forEach((result, index) => {
    const stop = stops[index]
    if (!stop || !result) return
    if (result.status === 'fulfilled') {
      successfulStopIds.push(stop.stopId)
      loaded.set(stop.stopId, result.value)
    } else {
      failures.push({ stopId: stop.stopId, error: result.reason })
    }
  })

  if (signal.aborted || successfulStopIds.length === 0 || (!options.previousSnapshot && failures.length > 0)) {
    return {
      snapshot: options.previousSnapshot ?? null,
      published: false,
      successfulStopIds,
      failures: signal.aborted ? [] : failures,
    }
  }

  const previous = options.previousSnapshot
  const stopsSnapshot: Record<string, Readonly<Record<string, ShuttleRouteArrivalData>>> = {}
  const stopObservations: Record<string, DataFreshness> = {}
  const unavailableStopIds: string[] = []

  for (const stop of stops) {
    const result = loaded.get(stop.stopId)
    if (result) {
      stopsSnapshot[stop.stopId] = result.routes
      stopObservations[stop.stopId] = {
        observedAt: result.observedAt,
        expiresAt: result.expiresAt,
      }
      continue
    }

    // A stop without a fresh result is unavailable, even if we carry its previous routes over,
    // so clients and routing never present stale arrivals as live.
    stopsSnapshot[stop.stopId] = previous?.stops[stop.stopId] ?? {}
    unavailableStopIds.push(stop.stopId)
    const previousObservation = previous?.stopObservations?.[stop.stopId]
    if (previousObservation) stopObservations[stop.stopId] = previousObservation
  }

  const refreshedAtMs = now()
  const refreshedAt = toIso(refreshedAtMs)
  const nextRefreshAtMs = Math.max(refreshedAtMs, options.nextRefreshAtMs ?? refreshedAtMs + options.refreshIntervalMs)
  const nextRefreshAt = toIso(nextRefreshAtMs)
  const observationTimes = Object.values(stopObservations).map(({ observedAt }) => observedAt)
  const snapshot: ShuttleArrivalSnapshot = {
    observedAt: earliestTimestamp(observationTimes, refreshedAt),
    expiresAt: toIso(refreshedAtMs + options.refreshIntervalMs),
    snapshotVersion: options.snapshotVersion,
    refreshedAt,
    nextRefreshAt,
    stops: stopsSnapshot,
    stopObservations,
    unavailableStopIds,
  }

  return {
    snapshot,
    published: true,
    successfulStopIds,
    failures,
  }
}

export function createBusArrivalSnapshotStore(
  options: BusArrivalSnapshotStoreOptions,
): BusArrivalSnapshotStore {
  const now = options.now ?? Date.now
  let currentSnapshot: ShuttleArrivalSnapshot | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let refreshInFlight: Promise<BusArrivalSnapshotRefreshResult> | null = null
  let activeController: AbortController | null = null
  let started = false
  let generation = 0

  const scheduleNextRefresh = (delayMs: number): void => {
    if (!started) return
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => { void refreshNow().catch(logRefreshError) }, delayMs)
    refreshTimer.unref?.()
  }

  const refreshNow = (): Promise<BusArrivalSnapshotRefreshResult> => {
    if (refreshInFlight) return refreshInFlight

    const startedAtMs = now()
    const startedAt = toIso(startedAtMs)
    const snapshotVersion = startedAt + '-' + (generation + 1)
    generation += 1
    const controller = new AbortController()
    activeController = controller

    const refresh = (async (): Promise<BusArrivalSnapshotRefreshResult> => {
      const result = await refreshBusArrivalSnapshot(options.stops, options.loadStop, {
        previousSnapshot: currentSnapshot,
        snapshotVersion,
        refreshIntervalMs: options.refreshIntervalMs,
        nextRefreshAtMs: startedAtMs + options.refreshIntervalMs,
        maxConcurrency: options.maxConcurrency,
        now,
        signal: controller.signal,
      })
      if (result.published && result.snapshot) currentSnapshot = result.snapshot

      const completedAtMs = now()
      options.onRefreshComplete?.({
        startedAt,
        completedAt: toIso(completedAtMs),
        durationMs: Math.max(0, completedAtMs - startedAtMs),
        successfulStopCount: result.successfulStopIds.length,
        failedStopCount: result.failures.length,
        snapshotVersion: currentSnapshot?.snapshotVersion ?? null,
        published: result.published,
      }, result.failures)
      return result
    })()

    refreshInFlight = refresh.finally(() => {
      refreshInFlight = null
      if (activeController === controller) activeController = null
      scheduleNextRefresh(Math.max(0, options.refreshIntervalMs - Math.max(0, now() - startedAtMs)))
    })
    return refreshInFlight
  }

  return {
    start() {
      if (started) return
      started = true
      void refreshNow().catch(logRefreshError)
    },
    async stop() {
      started = false
      if (refreshTimer) clearTimeout(refreshTimer)
      refreshTimer = null
      activeController?.abort()
      await refreshInFlight
    },
    refreshNow,
    getSnapshot() {
      return currentSnapshot
    },
  }
}

function logRefreshError(error: unknown): void {
  console.error('Bus-arrival snapshot refresh failed unexpectedly.', error instanceof Error ? error.name : typeof error)
}
