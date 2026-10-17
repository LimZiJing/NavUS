import type {
  WalkingMatrixConnection,
  WalkingMatrixRequest,
  WalkingRouteEngine,
  WalkingRouteRequest,
} from '../../../backend/src/pathfinding/walking/walking-contracts.js'
import type { PathfindingBenchmarkMatrixResult } from './outcome.js'

export interface MeasuredWalkingRouteEngine extends WalkingRouteEngine {
  readonly elapsedMs: number
  readonly matrixElapsedMs: number
  readonly routeElapsedMs: number
  readonly matrixRequests: readonly PathfindingBenchmarkMatrixResult[]
  readonly requestCounts: { readonly matrix: number; readonly route: number }
  reset(): void
}

export function createMeasuredRouteEngine(
  routeEngine: WalkingRouteEngine,
): MeasuredWalkingRouteEngine {
  let elapsedMs = 0
  let matrixElapsedMs = 0
  let routeElapsedMs = 0
  let matrixRequestCount = 0
  let routeRequestCount = 0
  const matrixRequests: PathfindingBenchmarkMatrixResult[] = []

  return {
    reset() {
      elapsedMs = 0
      matrixElapsedMs = 0
      routeElapsedMs = 0
      matrixRequestCount = 0
      routeRequestCount = 0
      matrixRequests.length = 0
    },
    get elapsedMs() {
      return elapsedMs
    },
    get matrixElapsedMs() {
      return matrixElapsedMs
    },
    get routeElapsedMs() {
      return routeElapsedMs
    },
    get matrixRequests() {
      return [...matrixRequests]
    },
    get requestCounts() {
      return { matrix: matrixRequestCount, route: routeRequestCount }
    },
    async routeWalking(request: WalkingRouteRequest, signal: AbortSignal) {
      routeRequestCount += 1
      const startedAt = performance.now()
      try {
        return await routeEngine.routeWalking(request, signal)
      } finally {
        const requestDurationMs = performance.now() - startedAt
        elapsedMs += requestDurationMs
        routeElapsedMs += requestDurationMs
      }
    },
    async matrixWalking(request: WalkingMatrixRequest, signal: AbortSignal): Promise<readonly WalkingMatrixConnection[]> {
      matrixRequestCount += 1
      const startedAt = performance.now()
      const capturedRequest: WalkingMatrixRequest = {
        sources: request.sources.map(({ longitude, latitude }) => ({ longitude, latitude })),
        targets: request.targets.map(({ longitude, latitude }) => ({ longitude, latitude })),
      }
      try {
        const connections = await routeEngine.matrixWalking(request, signal)
        matrixRequests.push({
          request: capturedRequest,
          connections: connections.map((connection) => ({ ...connection })),
        })
        return connections
      } finally {
        const requestDurationMs = performance.now() - startedAt
        elapsedMs += requestDurationMs
        matrixElapsedMs += requestDurationMs
      }
    },
  }
}
