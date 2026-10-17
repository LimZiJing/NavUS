import type { TransitIndex } from '@navus/shared/transit/index'
import type { TripEndpoint } from '@navus/shared/routing/path'
import type { VenueLocationMap } from '@navus/shared/venue/types'
import { getTripEndpointCoordinate, getTripEndpointKey, type BuildingIndex, type ResolvedPathLocation } from '../endpoints.ts'

export interface ResolvedPathEndpoints {
  readonly origin: ResolvedPathLocation
  readonly destination: ResolvedPathLocation
  readonly all: readonly ResolvedPathLocation[]
}

function resolveEndpoint(
  endpoint: TripEndpoint,
  sources: { readonly venues: VenueLocationMap; readonly buildings: BuildingIndex; readonly transit: TransitIndex },
): ResolvedPathLocation | null {
  const coordinate = getTripEndpointCoordinate(endpoint, sources)
  return coordinate ? { key: getTripEndpointKey(endpoint), endpoint, coordinate } : null
}

function addLocation(
  locations: Map<string, ResolvedPathLocation>,
  location: ResolvedPathLocation,
): void {
  if (!locations.has(location.key)) locations.set(location.key, location)
}

export function resolvePathEndpoints(
  originEndpoint: TripEndpoint,
  destinationEndpoint: TripEndpoint,
  venues: VenueLocationMap,
  transit: TransitIndex,
  buildings: BuildingIndex = { byId: new Map() },
): ResolvedPathEndpoints | null {
  const sources = { venues, buildings, transit }
  const origin = resolveEndpoint(originEndpoint, sources)
  const destination = resolveEndpoint(destinationEndpoint, sources)
  if (!origin || !destination || origin.key === destination.key) return null

  const locations = new Map<string, ResolvedPathLocation>()
  addLocation(locations, origin)
  addLocation(locations, destination)
  for (const stop of transit.stops) {
    const endpoint: TripEndpoint = { kind: 'stop', id: stop.id }
    const coordinate = getTripEndpointCoordinate(endpoint, sources)
    if (!coordinate) continue
    addLocation(locations, { key: getTripEndpointKey(endpoint), endpoint, coordinate })
  }

  return { origin, destination, all: [...locations.values()] }
}
export type { ResolvedPathLocation } from '../endpoints.ts'
