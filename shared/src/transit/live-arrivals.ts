export interface DataFreshness {
  readonly observedAt: string
  readonly expiresAt: string
}

export interface ShuttleHeadwaySeconds {
  readonly min: number
  readonly max: number
  readonly median: number
}

export interface ShuttleRouteArrivalData {
  readonly nextArrivalSeconds: number
  readonly upcomingArrivalSeconds: readonly number[]
  readonly headwaySeconds: ShuttleHeadwaySeconds | null
}

export type ShuttleArrivalObservation = DataFreshness

export interface ShuttleArrivalSnapshot extends DataFreshness {
  readonly snapshotVersion?: string
  readonly refreshedAt?: string
  readonly nextRefreshAt?: string
  readonly stops: Readonly<Record<string, Readonly<Record<string, ShuttleRouteArrivalData>>>>
  readonly stopObservations?: Readonly<Record<string, ShuttleArrivalObservation>>
  readonly unavailableStopIds?: readonly string[]
}

export const SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS = 30_000
export const SHUTTLE_ARRIVAL_FRESHNESS_MS = 30_000
export const SHUTTLE_ARRIVAL_MAX_AGE_MS = 120_000
