import type { TransitNetwork, BusRoute, TransitStop } from '@navus/shared/transit/types'

export class TransitIndexPreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransitIndexPreconditionError'
  }
}

/** Immutable canonical network route/stop snapshots; geometry and manifests are validated separately. */
export interface TransitIndex {
  readonly network: TransitNetwork
  readonly routes: readonly BusRoute[]
  readonly stops: readonly TransitStop[]
  readonly routeById: ReadonlyMap<string, BusRoute>
  readonly stopById: ReadonlyMap<string, TransitStop>
  readonly routeMembership: ReadonlyMap<string, ReadonlySet<string>>
  readonly stopIdsByRouteId: ReadonlyMap<string, ReadonlySet<string>>
  readonly routeIdsByStopId: ReadonlyMap<string, ReadonlySet<string>>
  readonly stopsByRouteId: ReadonlyMap<string, readonly TransitStop[]>
  readonly routeContainsStop: (routeId: string, stopId: string) => boolean
  readonly routeStop: (routeId: string, stopId: string) => TransitStop | undefined
  readonly routeStops: (routeId: string) => readonly TransitStop[]
}

function createReadonlyMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const map = new Map(entries)
  const facade: ReadonlyMap<K, V> = {
    get size() {
      return map.size
    },
    get(key) {
      return map.get(key)
    },
    has(key) {
      return map.has(key)
    },
    entries() {
      return map.entries()
    },
    keys() {
      return map.keys()
    },
    values() {
      return map.values()
    },
    forEach(callbackfn, thisArg) {
      map.forEach((value, key) => callbackfn.call(thisArg, value, key, facade))
    },
    [Symbol.iterator]() {
      return map[Symbol.iterator]()
    },
  }
  return Object.freeze(facade)
}

function createReadonlySet<T>(values: readonly T[]): ReadonlySet<T> {
  const set = new Set(values)
  const facade: ReadonlySet<T> = {
    get size() {
      return set.size
    },
    has(value) {
      return set.has(value)
    },
    entries() {
      return set.entries()
    },
    keys() {
      return set.keys()
    },
    values() {
      return set.values()
    },
    forEach(callbackfn, thisArg) {
      set.forEach((value) => callbackfn.call(thisArg, value, value, facade))
    },
    [Symbol.iterator]() {
      return set[Symbol.iterator]()
    },
  }
  return Object.freeze(facade)
}

function cloneNetwork(network: TransitNetwork): TransitNetwork {
  const metadata = Object.freeze({ ...network.metadata })
  const routes = network.routes.map((route) => Object.freeze({
    ...route,
    stopIds: Object.freeze([...route.stopIds]),
  }))
  const stops = network.stops.map((stop) => Object.freeze({
    ...stop,
    services: Object.freeze([...stop.services]),
  }))

  return Object.freeze({
    version: network.version,
    metadata,
    routes: Object.freeze(routes),
    stops: Object.freeze(stops),
  })
}

const EMPTY_STOPS: readonly TransitStop[] = Object.freeze([])

export function createTransitIndex(network: TransitNetwork): TransitIndex {
  const clonedNetwork = cloneNetwork(network)
  const routes = clonedNetwork.routes
  const stops = clonedNetwork.stops
  const routeById = createReadonlyMap(routes.map((route) => [route.id, route] as const))
  const stopById = createReadonlyMap(stops.map((stop) => [stop.id, stop] as const))
  const routeMembershipEntries = routes.map((route) => [
    route.id,
    createReadonlySet(route.stopIds),
  ] as const)
  const routeMembership = createReadonlyMap(routeMembershipEntries)
  const routeIdsByStop = new Map<string, Set<string>>(stops.map((stop) => [stop.id, new Set<string>()]))
  for (const route of routes) {
    for (const stopId of route.stopIds) {
      const routeIds = routeIdsByStop.get(stopId) ?? new Set<string>()
      routeIds.add(route.id)
      routeIdsByStop.set(stopId, routeIds)
    }
  }
  const routeIdsByStopId = createReadonlyMap(
    Array.from(routeIdsByStop.entries()).map(([stopId, routeIds]) => [
      stopId,
      createReadonlySet(Array.from(routeIds)),
    ] as const),
  )
  const stopsByRouteEntries = routes.map((route) => {
    const routeStops: TransitStop[] = []
    for (const stopId of route.stopIds) {
      const stop = stopById.get(stopId)
      if (!stop) {
        throw new TransitIndexPreconditionError(
          `Transit index route ${route.id} references missing stop ${stopId}`,
        )
      }
      routeStops.push(stop)
    }
    return [route.id, Object.freeze(routeStops)] as const
  })
  const stopsByRouteId = createReadonlyMap(stopsByRouteEntries)

  const routeStops = (routeId: string): readonly TransitStop[] => (
    stopsByRouteId.get(routeId) ?? EMPTY_STOPS
  )
  const routeContainsStop = (routeId: string, stopId: string): boolean => (
    routeMembership.get(routeId)?.has(stopId) ?? false
  )
  const routeStop = (routeId: string, stopId: string): TransitStop | undefined => (
    routeContainsStop(routeId, stopId) ? stopById.get(stopId) : undefined
  )

  return Object.freeze({
    network: clonedNetwork,
    routes,
    stops,
    routeById,
    stopById,
    routeMembership,
    stopIdsByRouteId: routeMembership,
    routeIdsByStopId,
    stopsByRouteId,
    routeContainsStop,
    routeStop,
    routeStops,
  })
}

export type TransitNetworkIndex = TransitIndex
export const createTransitNetworkIndex = createTransitIndex
