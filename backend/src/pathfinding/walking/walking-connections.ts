import type {
  WalkingConnection,
  WalkingConnectionProvider,
  WalkingConnectionRequest,
  WalkingMatrixConnection,
  WalkingRouteEngine,
} from './walking-contracts.ts'
import type { WalkingStopGraph } from '@navus/shared/routing/walking-stop-graph'
export type WalkingStopGraphLoader = (signal: AbortSignal) => Promise<WalkingStopGraph>

interface WalkingConnectionProviderOptions {
  readonly routeEngine: WalkingRouteEngine
  readonly walkingStopGraph?: WalkingStopGraph
  readonly loadGraph?: WalkingStopGraphLoader
}

function uniqueLocations(request: WalkingConnectionRequest): readonly WalkingConnectionRequest['origin'][] {
  const locations = new Map<string, WalkingConnectionRequest['origin']>()
  for (const location of request.stops) {
    if (!locations.has(location.key)) locations.set(location.key, location)
  }
  return [...locations.values()]
}

function addConnection(
  connections: Map<string, WalkingConnection>,
  connection: WalkingConnection,
): void {
  if (connection.fromKey === connection.toKey) return
  connections.set(`${connection.fromKey}\u0000${connection.toKey}`, connection)
}

function addMatrixConnections(
  connections: Map<string, WalkingConnection>,
  matrixConnections: readonly WalkingMatrixConnection[],
  sources: readonly WalkingConnectionRequest['origin'][],
  targets: readonly WalkingConnectionRequest['origin'][],
): void {
  for (const connection of matrixConnections) {
    const from = sources[connection.fromIndex]
    const to = targets[connection.toIndex]
    if (!from || !to) continue
    addConnection(connections, {
      fromKey: from.key,
      toKey: to.key,
      distanceMeters: connection.distanceMeters,
      durationSeconds: connection.durationSeconds,
    })
  }
}

function addStaticConnections(
  connections: Map<string, WalkingConnection>,
  graph: WalkingStopGraph,
  stopLocations: readonly WalkingConnectionRequest['origin'][],
): void {
  const locationByStopId = new Map(
    stopLocations.flatMap((location) => location.stopId
      ? [[location.stopId, location] as const]
      : []),
  )
  if (
    graph.stopIds.length !== locationByStopId.size ||
    graph.stopIds.some((stopId) => !locationByStopId.has(stopId))
  ) {
    throw new Error('Walking stop graph does not match the loaded transit stops')
  }
  // Preserve graph direction: a walk from A to B does not imply that B to A is equivalent.
  for (const connection of graph.connections) {
    const fromStopId = connection.fromKey.slice('stop:'.length)
    const toStopId = connection.toKey.slice('stop:'.length)
    const from = locationByStopId.get(fromStopId)
    const to = locationByStopId.get(toStopId)
    if (!from || !to) {
      throw new Error('Walking stop graph does not match the loaded transit stops')
    }
    addConnection(connections, {
      fromKey: from.key,
      toKey: to.key,
      distanceMeters: connection.distanceMeters,
      durationSeconds: connection.durationSeconds,
    })
  }
}

export function createWalkingConnectionProvider(
  options: WalkingConnectionProviderOptions,
): WalkingConnectionProvider {
  const loadGraph = options.loadGraph ?? (() => options.walkingStopGraph
    ? Promise.resolve(options.walkingStopGraph)
    : Promise.reject(new Error('Canonical walking stop graph is required')))
  let graph: WalkingStopGraph | null = null

  return {
    async getWalkingConnections(request, signal) {
      const stopLocations = uniqueLocations(request)
      const targets = [request.destination, ...stopLocations]
        .filter((location, index, locations) => (
          locations.findIndex((candidate) => candidate.key === location.key) === index
        ))
      // Ask for endpoint connector costs while the checked-in graph loads or resolves from cache.
      const endpointQuery = options.routeEngine.matrixWalking({
        sources: [request.origin.coordinate],
        targets: targets.map((location) => location.coordinate),
      }, signal)
      const destinationQuery = stopLocations.length === 0
        ? Promise.resolve<readonly WalkingMatrixConnection[]>([])
        : options.routeEngine.matrixWalking({
          sources: stopLocations.map((location) => location.coordinate),
          targets: [request.destination.coordinate],
        }, signal)

      const [loadedGraph, [originConnections, destinationConnections]] = await Promise.all([
        graph ? Promise.resolve(graph) : loadGraph(signal),
        Promise.all([endpointQuery, destinationQuery]),
      ])
      graph = loadedGraph

      const connections = new Map<string, WalkingConnection>()
      addMatrixConnections(connections, originConnections, [request.origin], targets)
      addMatrixConnections(connections, destinationConnections, stopLocations, [request.destination])
      addStaticConnections(connections, graph, stopLocations)
      return [...connections.values()]
    },
  }
}
