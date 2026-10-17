export interface TripCoordinate {
  readonly longitude: number
  readonly latitude: number
}

export type TripEndpoint = (
  | { readonly kind: 'venue'; readonly id: string }
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'stop'; readonly id: string }
  | { readonly kind: 'current-location'; readonly coordinate: TripCoordinate }
)

export interface ApiJourneyPlanningRequest {
  readonly origin: TripEndpoint
  readonly destination: TripEndpoint
  /** Available only in development for deterministic local planning and benchmark runs. */
  readonly simulatedDepartureMs?: number
}

export interface PathGeometry {
  readonly type: 'LineString'
  readonly coordinates: readonly (readonly [number, number])[]
}

/** One ordered travel-mode segment; its geometry is kept with the segment for map rendering. */
interface PathLegBase {
  readonly from: TripEndpoint
  readonly to: TripEndpoint
  readonly durationSeconds: number
  readonly distanceMeters: number
  readonly geometry: PathGeometry
}

export interface WalkingPathLeg extends PathLegBase {
  readonly mode: 'walking'
}

export interface BusPathLeg extends PathLegBase {
  readonly mode: 'shuttle'
  readonly routeId: string
  readonly boardingStopId: string
  readonly alightingStopId: string
  readonly waitingSeconds: number
  readonly rideSeconds: number
}

export type PathLeg = WalkingPathLeg | BusPathLeg
export type PathQuality = 'exact' | 'bounded'

/** One complete option between the selected endpoints, with ordered walking and bus legs. */
export interface Path {
  readonly origin: TripEndpoint
  readonly destination: TripEndpoint
  readonly legs: readonly PathLeg[]
  readonly totalDurationSeconds: number
  readonly totalDistanceMeters: number
  readonly estimateStatus: 'estimated'
  readonly planningQuality: PathQuality
}

/** A candidate Path paired with its core-search score for ranking and Plan selection. */
export interface ScoredPathCandidate {
  readonly candidateKey: string
  readonly path: Path
  readonly adjustedDurationSeconds: number
  readonly score: number
}

export interface PathEndpointLocation {
  readonly endpoint: TripEndpoint
  readonly coordinate: TripCoordinate
}

export type ApiJourneyPlanningResponse =
  | {
      readonly outcome: 'paths'
      readonly candidates: readonly ScoredPathCandidate[]
      readonly searchStatus: 'complete' | 'budget-exceeded'
    }
  | {
      readonly outcome: 'no-path'
      readonly message?: string
    }

export type ApiJourneyPlanningErrorCode = 'invalid_request' | 'not_ready' | 'provider_unavailable' | 'rate_limited'

export interface ApiJourneyPlanningError {
  readonly error: string
  readonly code?: ApiJourneyPlanningErrorCode
}
