export interface ApiHealthResponse {
  readonly status: 'ok'
  readonly dataVersion: string
}

export interface ApiReadyResponse {
  readonly status: 'ready'
  readonly dataVersion: string
  readonly canonicalDataReady: true
  readonly liveSnapshotReady: true
  readonly venueCount: number
  readonly routeCount: number
  readonly stopCount: number
  readonly walkingConnectionCount: number
}

export interface ApiNotReadyResponse {
  readonly status: 'not-ready'
  readonly dataVersion: string
  readonly canonicalDataReady: boolean
  readonly liveSnapshotReady: boolean
  readonly error: string
}

export type ApiReadinessResponse = ApiReadyResponse | ApiNotReadyResponse

export type ApiErrorCode = 'invalid_request' | 'not_ready' | 'provider_unavailable' | 'rate_limited'

export interface ApiErrorResponse {
  readonly error: string
  readonly code?: ApiErrorCode
}
