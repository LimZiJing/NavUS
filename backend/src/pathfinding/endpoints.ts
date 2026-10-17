import type { Building, BuildingCatalogue } from '@navus/shared/venue/buildings'
import type { VenueLocationMap } from '@navus/shared/venue/types'
import type { TransitIndex } from '@navus/shared/transit/index'
import type { TripCoordinate, TripEndpoint, PathEndpointLocation } from '@navus/shared/routing/path'

export interface BuildingIndex {
  readonly byId: ReadonlyMap<string, { readonly location: Building['location'] }>
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function representativeLocation(parts: readonly Building[]): Building['location'] {
  const ordered = [...parts].sort((first, second) => compareText(first.id, second.id))
  const centreX = ordered.reduce((sum, part) => sum + part.location.x, 0) / ordered.length
  const centreY = ordered.reduce((sum, part) => sum + part.location.y, 0) / ordered.length
  const distance = (part: Building) => (
    (part.location.x - centreX) ** 2 + (part.location.y - centreY) ** 2
  )
  return ordered.reduce((best, part) => distance(part) < distance(best) ? part : best).location
}

/** Builds the same stable building/group endpoint map used by Plan's building search. */
export function buildBuildingIndex(buildings: readonly Building[]): BuildingIndex {
  const byId = new Map<string, { readonly location: Building['location'] }>()
  const groups = new Map<string, Building[]>()
  for (const building of buildings) {
    if (building.groupKey === undefined) byId.set(building.id, building)
    else groups.set(building.groupKey, [...(groups.get(building.groupKey) ?? []), building])
  }
  for (const [groupKey, parts] of groups) {
    byId.set(groupKey, { location: representativeLocation(parts) })
  }
  return { byId }
}

export function buildBuildingLocations(catalogue: BuildingCatalogue): BuildingIndex {
  return buildBuildingIndex(catalogue.buildings)
}

function isCoordinate(value: TripCoordinate): boolean {
  return Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180 &&
    Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90
}

export function createCurrentLocationTripEndpoint(
  coordinate: unknown,
): Extract<TripEndpoint, { kind: 'current-location' }> | null {
  if (typeof coordinate !== 'object' || coordinate === null || !('longitude' in coordinate) || !('latitude' in coordinate)) {
    return null
  }
  const longitude = coordinate.longitude
  const latitude = coordinate.latitude
  if (typeof longitude !== 'number' || typeof latitude !== 'number') return null
  const frozen = { longitude, latitude }
  return isCoordinate(frozen) ? { kind: 'current-location', coordinate: frozen } : null
}
export function getTripEndpointKey(endpoint: TripEndpoint): string {
  return endpoint.kind === 'current-location'
    ? 'current-location:' + endpoint.coordinate.longitude + ':' + endpoint.coordinate.latitude
    : endpoint.kind + ':' + endpoint.id
}

export function getTripEndpointCoordinate(
  endpoint: TripEndpoint,
  sources: {
    readonly venues: VenueLocationMap
    readonly buildings: BuildingIndex
    readonly transit: TransitIndex
  },
): TripCoordinate | null {
  if (endpoint.kind === 'current-location') return isCoordinate(endpoint.coordinate) ? endpoint.coordinate : null
  if (endpoint.kind === 'venue') {
    const location = sources.venues[endpoint.id]?.location
    if (location) {
      const coordinate = { longitude: location.x, latitude: location.y }
      return isCoordinate(coordinate) ? coordinate : null
    }
    return null
  }
  if (endpoint.kind === 'building') {
    const location = sources.buildings.byId.get(endpoint.id)?.location
    if (!location) return null
    const coordinate = { longitude: location.x, latitude: location.y }
    return isCoordinate(coordinate) ? coordinate : null
  }
  const stop = sources.transit.stopById.get(endpoint.id)
  if (!stop) return null
  const coordinate = { longitude: stop.longitude, latitude: stop.latitude }
  return isCoordinate(coordinate) ? coordinate : null
}

export function hasCanonicalEndpoint(
  endpoint: TripEndpoint,
  sources: { readonly venues: VenueLocationMap; readonly buildings: BuildingIndex; readonly transit: TransitIndex },
): boolean {
  return getTripEndpointCoordinate(endpoint, sources) !== null
}

export interface ResolvedPathLocation extends PathEndpointLocation {
  readonly key: string
}
