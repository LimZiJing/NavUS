import { buildApiUrl } from '../api/api-url'
import type {
  ShuttleArrivalObservation,
  ShuttleArrivalSnapshot,
  ShuttleHeadwaySeconds,
  ShuttleRouteArrivalData,
} from '../../domain/transit/arrivals'
import {
  isOlderShuttleArrivalSnapshot,
  SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS,
} from '../../domain/transit/arrivals'
import type {
  ShuttleArrivalClient,
  ShuttleArrivalStopRequest,
} from '../../app/contracts/shuttle-arrivals'

export class ShuttleArrivalFetchError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ShuttleArrivalFetchError'
  }
}

interface CachedSnapshot {
  readonly snapshot: ShuttleArrivalSnapshot
  readonly cacheExpiresAt: number
}

interface ShuttleArrivalClientOptions {
  readonly apiOrigin?: string
  readonly endpoint?: string
  readonly cacheTtlMs?: number
  readonly now?: () => number
  readonly fetcher?: typeof fetch
}

const DEFAULT_CACHE_TTL_MS = SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`bus arrival response has an invalid ${label}`)
  }
  return value
}

function parseOptionalTimestamp(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : parseTimestamp(value, label)
}

function parseOptionalVersion(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('bus arrival response has an invalid snapshotVersion')
  }
  return value
}

function normalizeHeadway(
  value: unknown,
  arrivals: readonly number[],
): ShuttleHeadwaySeconds | null {
  if (arrivals.length < 2 || !isRecord(value)) return null
  const min = value.min
  const max = value.max
  const median = value.median
  if (
    typeof min !== 'number' || !Number.isFinite(min) || min <= 0 ||
    typeof max !== 'number' || !Number.isFinite(max) || max < min ||
    typeof median !== 'number' || !Number.isFinite(median) || median < min || median > max
  ) return null
  const hasPositiveGap = arrivals.some((arrival, index) => index > 0 && arrival > arrivals[index - 1])
  return hasPositiveGap ? { min, max, median } : null
}

function normalizeRouteData(value: unknown): ShuttleRouteArrivalData | null {
  if (!isRecord(value)) return null
  const nextArrival = value.nextArrivalSeconds
  const upcoming = Array.isArray(value.upcomingArrivalSeconds)
    ? value.upcomingArrivalSeconds
      .filter((arrival): arrival is number => typeof arrival === 'number' && Number.isFinite(arrival) && arrival >= 0)
    : []
  const arrivals = [
    ...(typeof nextArrival === 'number' && Number.isFinite(nextArrival) && nextArrival >= 0 ? [nextArrival] : []),
    ...upcoming,
  ].filter((arrival, index, values) => values.indexOf(arrival) === index).sort((first, second) => first - second)
  if (arrivals.length === 0) return null
  return {
    nextArrivalSeconds: arrivals[0],
    upcomingArrivalSeconds: arrivals,
    headwaySeconds: normalizeHeadway(value.headwaySeconds, arrivals),
  }
}

function parseStopObservations(value: unknown): Readonly<Record<string, ShuttleArrivalObservation>> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new Error('bus arrival response has invalid stopObservations')

  const observations: Record<string, ShuttleArrivalObservation> = {}
  for (const [stopId, observationValue] of Object.entries(value)) {
    if (!isRecord(observationValue)) throw new Error(`bus arrival response has invalid observation for ${stopId}`)
    const observedAt = parseTimestamp(observationValue.observedAt, `${stopId}.observedAt`)
    const expiresAt = parseTimestamp(observationValue.expiresAt, `${stopId}.expiresAt`)
    if (Date.parse(expiresAt) <= Date.parse(observedAt)) {
      throw new Error(`bus arrival response has an invalid expiry range for ${stopId}`)
    }
    observations[stopId] = { observedAt, expiresAt }
  }
  return observations
}

function parseUnavailableStopIds(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((stopId) => typeof stopId !== 'string')) {
    throw new Error('bus arrival response has invalid unavailableStopIds')
  }
  return value as string[]
}

function parseSnapshot(input: unknown): ShuttleArrivalSnapshot {
  if (!isRecord(input) || !isRecord(input.stops)) {
    throw new Error('bus arrival response was invalid')
  }
  const observedAt = parseTimestamp(input.observedAt, 'observedAt')
  const expiresAt = parseTimestamp(input.expiresAt, 'expiresAt')
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) {
    throw new Error('bus arrival response has an invalid expiry range')
  }

  const stops: Record<string, ShuttleArrivalSnapshot['stops'][string]> = {}
  for (const [stopId, routeValue] of Object.entries(input.stops)) {
    if (!isRecord(routeValue)) continue
    const routes: Record<string, ShuttleArrivalSnapshot['stops'][string][string]> = {}
    for (const [routeId, arrival] of Object.entries(routeValue)) {
      const normalized = normalizeRouteData(arrival)
      if (normalized) routes[routeId] = normalized
    }
    stops[stopId] = routes
  }

  return {
    observedAt,
    expiresAt,
    snapshotVersion: parseOptionalVersion(input.snapshotVersion),
    refreshedAt: parseOptionalTimestamp(input.refreshedAt, 'refreshedAt'),
    nextRefreshAt: parseOptionalTimestamp(input.nextRefreshAt, 'nextRefreshAt'),
    stops,
    stopObservations: parseStopObservations(input.stopObservations),
    unavailableStopIds: parseUnavailableStopIds(input.unavailableStopIds),
  }
}

function requestKey(stop: ShuttleArrivalStopRequest): string {
  return stop.stopId
}

function hasStops(
  snapshot: ShuttleArrivalSnapshot,
  stops: readonly ShuttleArrivalStopRequest[],
): boolean {
  return stops.every((stop) => Object.prototype.hasOwnProperty.call(snapshot.stops, stop.stopId))
}

function selectStops(
  snapshot: ShuttleArrivalSnapshot,
  stops: readonly ShuttleArrivalStopRequest[],
): ShuttleArrivalSnapshot {
  const selectedStops: Record<string, ShuttleArrivalSnapshot['stops'][string]> = {}
  for (const stop of stops) selectedStops[stop.stopId] = snapshot.stops[stop.stopId] ?? {}

  const selectedObservations: Record<string, ShuttleArrivalObservation> = {}
  for (const stop of stops) {
    const observation = snapshot.stopObservations?.[stop.stopId]
    if (observation) selectedObservations[stop.stopId] = observation
  }

  return {
    ...snapshot,
    stops: selectedStops,
    ...(snapshot.stopObservations ? { stopObservations: selectedObservations } : {}),
    ...(snapshot.unavailableStopIds
      ? { unavailableStopIds: snapshot.unavailableStopIds.filter((stopId) => stopId in selectedStops) }
      : {}),
  }
}

function sameGeneration(first: ShuttleArrivalSnapshot, second: ShuttleArrivalSnapshot): boolean {
  if (first.snapshotVersion && second.snapshotVersion) {
    return first.snapshotVersion === second.snapshotVersion
  }
  return first.refreshedAt !== undefined && first.refreshedAt === second.refreshedAt
}

function mergeSnapshot(
  current: ShuttleArrivalSnapshot | null,
  incoming: ShuttleArrivalSnapshot,
): ShuttleArrivalSnapshot {
  if (!current || isOlderShuttleArrivalSnapshot(incoming, current)) return current ?? incoming
  if (!sameGeneration(current, incoming)) return incoming

  return {
    ...incoming,
    stops: { ...current.stops, ...incoming.stops },
    stopObservations: current.stopObservations || incoming.stopObservations
      ? { ...current.stopObservations, ...incoming.stopObservations }
      : undefined,
    unavailableStopIds: current.unavailableStopIds || incoming.unavailableStopIds
      ? [
        ...(current.unavailableStopIds ?? []).filter((stopId) => !(stopId in incoming.stops)),
        ...(incoming.unavailableStopIds ?? []),
      ]
      : undefined,
  }
}

function cacheExpiryMs(snapshot: ShuttleArrivalSnapshot, now: () => number, cacheTtlMs: number): number {
  return Math.min(Date.parse(snapshot.expiresAt), now() + cacheTtlMs)
}

export function createShuttleArrivalClient(
  options: ShuttleArrivalClientOptions = {},
): ShuttleArrivalClient {
  const endpoint = options.endpoint ?? buildApiUrl('/api/shuttle-arrivals', options.apiOrigin)
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const fetcher = options.fetcher ?? fetch
  let cached: CachedSnapshot | null = null
  let inFlight: Promise<void> | null = null

  const readSnapshot = async (
    stops: readonly ShuttleArrivalStopRequest[],
    signal: AbortSignal,
  ): Promise<void> => {
    if (inFlight) {
      await inFlight
      if (cached && cached.cacheExpiresAt > now() && hasStops(cached.snapshot, stops)) return
    }

    const requestedStopIds = stops.map(({ stopId }) => stopId)
    const request = fetcher(
      `${endpoint}?stops=${encodeURIComponent(JSON.stringify(requestedStopIds))}`,
      { signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(`bus arrival request failed: ${response.status}`)
        const snapshot = parseSnapshot(await response.json() as unknown)
        if (Date.parse(snapshot.expiresAt) <= now()) {
          throw new Error('bus arrival response has expired')
        }
        const current = cached?.snapshot ?? null
        const merged = mergeSnapshot(current, snapshot)
        if (isOlderShuttleArrivalSnapshot(snapshot, merged)) {
          if (cached) {
            cached = {
              snapshot: cached.snapshot,
              cacheExpiresAt: cacheExpiryMs(cached.snapshot, now, cacheTtlMs),
            }
          }
          return
        }
        cached = {
          snapshot: merged,
          cacheExpiresAt: cacheExpiryMs(merged, now, cacheTtlMs),
        }
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') throw error
        throw new ShuttleArrivalFetchError('Live bus arrival data could not be fetched', {
          cause: error,
        })
      })

    inFlight = request
    try {
      await request
    } finally {
      if (inFlight === request) inFlight = null
    }
  }

  return {
    async getArrivals(stops, signal) {
      const uniqueStops = [...new Map(stops.map((stop) => [requestKey(stop), stop])).values()]
      if (uniqueStops.length === 0) {
        throw new ShuttleArrivalFetchError('At least one bus stop is required')
      }

      if (!cached || cached.cacheExpiresAt <= now() || !hasStops(cached.snapshot, uniqueStops)) {
        await readSnapshot(uniqueStops, signal)
      }

      if (!cached || cached.cacheExpiresAt <= now() || !hasStops(cached.snapshot, uniqueStops)) {
        throw new ShuttleArrivalFetchError('Live bus arrival data did not include the requested stops')
      }
      return selectStops(cached.snapshot, uniqueStops)
    },
  }
}
