export type TripEndpoint = import('@navus/shared/routing/path').TripEndpoint
export type TripCoordinate = import('@navus/shared/routing/path').TripCoordinate

export type TripEndpointRole = 'origin' | 'destination'

export interface TripRequest {
  readonly origin: TripEndpoint | null
  readonly destination: TripEndpoint | null
}

export type TripLocationSearchResult = {
  endpoint: TripEndpoint
  label: string
  detail: string
}
