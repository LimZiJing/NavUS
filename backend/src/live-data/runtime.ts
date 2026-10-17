import { randomUUID } from 'node:crypto'
import type {
  ApiErrorCode,
  ApiPublicBusArrivalsResponse,
  ApiShuttleArrivalsResponse,
  ApiShuttleServiceWindowsResponse,
  PublicBusArrivalSnapshot,
} from '@navus/shared'
import type { BackendConfig } from '../config.ts'
import type { BackendData } from '../canonical-data.ts'
import {
  loadLtaPublicBusStopMapping,
  validateLtaPublicBusStopMappings,
  type LtaPublicBusStopMapping,
} from './providers/lta/bus-stop-mapping.ts'
import { createNusAuthenticatedClient } from './providers/nus/client.ts'
import { createNusBusArrivalProvider } from './providers/nus/bus-arrivals.ts'
import { loadNusBusStopMapping } from './providers/nus/bus-stop-mapping.ts'
import { createNusServiceWindowsProvider } from './providers/nus/service-windows.ts'
import { createBusArrivalSnapshotStore, type BusArrivalStop } from './bus-arrivals/snapshot.ts'
import { mapWithConcurrency } from './upstream/concurrency.ts'
import { fetchWithRetry } from './upstream/retry.ts'
import { createLtaPublicBusArrivalProvider } from './providers/lta/provider.ts'
import { createLtaScheduleLoader } from './providers/lta/service-schedules.ts'

export interface BackendLiveData {
  isSnapshotReady(): boolean
  getPublicBusStopIds(): readonly string[]
  getBusArrivals(stopIds: readonly string[]): ApiShuttleArrivalsResponse
  getServiceWindows(routeIds: readonly string[], signal?: AbortSignal): Promise<ApiShuttleServiceWindowsResponse>
  getPublicBusArrivals(stopIds: readonly string[]): Promise<ApiPublicBusArrivalsResponse>
  start(): void
  stop(): Promise<void>
}

export class LiveDataRequestError extends Error {
  readonly status: number
  readonly code: ApiErrorCode

  constructor(status: number, code: ApiErrorCode, message: string) {
    super(message)
    this.name = 'LiveDataRequestError'
    this.status = status
    this.code = code
  }
}

interface BackendLiveDataOptions {
  readonly fetcher?: typeof fetch
  readonly now?: () => number
  readonly ltaMappings?: readonly LtaPublicBusStopMapping[]
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString()
}

function waitForRequest<Value>(operation: Promise<Value>, signal?: AbortSignal): Promise<Value> {
  if (!signal) return operation
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort)
    const abort = () => {
      cleanup()
      reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    operation.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The operation was aborted', 'AbortError')
  }
}

export async function createBackendLiveData(
  config: BackendConfig,
  data: BackendData,
  options: BackendLiveDataOptions = {},
): Promise<BackendLiveData> {
  const now = options.now ?? Date.now
  const fetcher = options.fetcher ?? fetch
  const providerConfig = config.liveData.nusProvider
  const canonicalStops: readonly BusArrivalStop[] = data.network.stops.map((stop) => ({
    stopId: stop.id,
    stopName: stop.longName,
  }))
  if (canonicalStops.length !== 33) {
    throw new Error('The live shuttle provider requires exactly 33 canonical stops')
  }
  const providerStops = providerConfig
    ? await loadNusBusStopMapping(config.dataDirectory, canonicalStops)
    : canonicalStops
  const routeIds = data.network.routes.map((route) => route.id)
  const canonicalRouteIds = new Set(routeIds)
  const canonicalStopIds = new Set(canonicalStops.map(({ stopId }) => stopId))
  const mappings = options.ltaMappings
    ? validateLtaPublicBusStopMappings(options.ltaMappings, canonicalStopIds)
    : await loadLtaPublicBusStopMapping(config.dataDirectory, canonicalStopIds)

  const deviceId = providerConfig?.deviceId || randomUUID()
  const nusClient = providerConfig
    ? createNusAuthenticatedClient({
      accessTokenUrl: providerConfig.accessTokenUrl,
      htdApi: providerConfig.htdApi,
      appApi: providerConfig.appApi,
      deviceId,
      ipaddr: providerConfig.ipaddr,
      version: providerConfig.version,
      initialToken: providerConfig.initialToken,
      initialUserId: providerConfig.initialUserId,
      initialDomain: providerConfig.initialDomain,
      requestTimeoutMs: config.liveData.requestTimeoutMs,
      fetcher,
    })
    : null

  const nusBusArrivals = providerConfig && nusClient
    ? createNusBusArrivalProvider({
      provider: providerConfig,
      client: nusClient,
      deviceId,
      canonicalRouteIds,
      refreshIntervalMs: config.liveData.shuttleRefreshIntervalMs,
      retryAttempts: config.liveData.retryAttempts,
      retryBaseDelayMs: config.liveData.retryBaseDelayMs,
      now,
    })
    : null
  const nusServiceWindows = providerConfig && nusClient
    ? createNusServiceWindowsProvider({
      provider: providerConfig,
      client: nusClient,
      deviceId,
      retryAttempts: config.liveData.retryAttempts,
      retryBaseDelayMs: config.liveData.retryBaseDelayMs,
      now,
    })
    : null

  const snapshotStore = createBusArrivalSnapshotStore({
    stops: providerStops,
    loadStop(stop, signal) {
      if (!nusBusArrivals) throw new Error('NUS live-data provider is not configured')
      return nusBusArrivals.loadStop(stop, signal)
    },
    refreshIntervalMs: config.liveData.shuttleRefreshIntervalMs,
    maxConcurrency: config.liveData.maxConcurrency,
    now,
    onRefreshComplete(log, failures) {
      console.info('NUS bus-arrival refresh completed.', log)
      if (failures.length > 0) {
        console.warn('NUS bus-arrival refresh had failed stops.', {
          stopIds: failures.map(({ stopId }) => stopId),
          failureCount: failures.length,
        })
      }
    },
  })

  const shutdownController = new AbortController()
  const activeOperations = new Set<Promise<unknown>>()
  const track = <Value>(operation: Promise<Value>): Promise<Value> => {
    activeOperations.add(operation)
    void operation.finally(() => activeOperations.delete(operation)).catch(() => undefined)
    return operation
  }

  const publicBusFetcher: typeof fetch = (input, init) => fetchWithRetry(
    fetcher,
    String(input),
    init ?? {},
    {
      timeoutMs: config.liveData.requestTimeoutMs,
      retryAttempts: config.liveData.retryAttempts,
      retryBaseDelayMs: config.liveData.retryBaseDelayMs,
      signal: init?.signal ?? undefined,
    },
  )

  const scheduleLoader = createLtaScheduleLoader({
    mappings,
    accountKey: config.liveData.ltaAccountKey,
    fetcher: publicBusFetcher,
  })
  const ltaProvider = createLtaPublicBusArrivalProvider({
    accountKey: config.liveData.ltaAccountKey,
    mappings,
    scheduleLoader,
    now,
    fetcher: publicBusFetcher,
    maxConcurrency: config.liveData.maxConcurrency,
  })

  return {
    isSnapshotReady() {
      return snapshotStore.getSnapshot() !== null
    },
    getPublicBusStopIds() {
      return ltaProvider.getSupportedStopIds()
    },
    getBusArrivals(stopIds) {
      const snapshot = snapshotStore.getSnapshot()
      if (!snapshot) {
        throw new LiveDataRequestError(503, 'not_ready', 'Shuttle arrival snapshot is not ready')
      }
      const selected = {
        ...snapshot,
        stops: Object.fromEntries(stopIds.map((stopId) => [
          stopId,
          snapshot.stops[stopId] ?? {},
        ])),
        stopObservations: Object.fromEntries(stopIds.flatMap((stopId) => {
          const observation = snapshot.stopObservations?.[stopId]
          return observation ? [[stopId, observation]] : []
        })),
      } satisfies ApiShuttleArrivalsResponse
      return selected
    },
    getServiceWindows(routes, requestSignal) {
      const operation = (async (): Promise<ApiShuttleServiceWindowsResponse> => {
        const entries = await mapWithConcurrency(routes, config.liveData.maxConcurrency, async (routeId) => {
          throwIfAborted(requestSignal)
          return {
            routeId,
            data: nusServiceWindows
              // This fetch is shared and cached; one cancelled Journey must not cancel another caller's data.
              ? await nusServiceWindows.load(routeId, shutdownController.signal)
              : null,
          }
        })
        if (entries.some(({ data: entry }) => entry === null)) {
          throw new LiveDataRequestError(503, 'provider_unavailable', 'Shuttle service-window data is unavailable')
        }
        const available = entries.flatMap(({ routeId, data: entry }) => entry ? [[routeId, entry] as const] : [])
        const observations = available.map(([, entry]) => Date.parse(entry.observedAt))
        const expiries = available.map(([, entry]) => Date.parse(entry.expiresAt))
        return {
          observedAt: toIso(Math.min(...observations)),
          expiresAt: toIso(Math.min(...expiries)),
          routes: Object.fromEntries(available.map(([routeId, entry]) => [routeId, entry.windows])),
        }
      })()
      return waitForRequest(track(operation), requestSignal)
    },
    getPublicBusArrivals(stopIds) {
      if (!config.liveData.ltaAccountKey) {
        throw new LiveDataRequestError(503, 'provider_unavailable', 'LTA DataMall account key is not configured')
      }
      const operation = ltaProvider.getArrivals(stopIds, shutdownController.signal) as Promise<PublicBusArrivalSnapshot>
      return track(operation)
    },
    start() {
      snapshotStore.start()
    },
    async stop() {
      shutdownController.abort()
      await Promise.all([
        snapshotStore.stop(),
        ...[...activeOperations].map((operation) => Promise.resolve(operation).catch(() => undefined)),
      ])
    },
  }
}
