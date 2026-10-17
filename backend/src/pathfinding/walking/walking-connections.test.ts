import { describe, expect, it, vi } from 'vitest'
import type { WalkingConnectionRequest, WalkingRouteEngine } from './walking-contracts.ts'
import { createWalkingConnectionProvider } from './walking-connections.ts'
import type { WalkingStopGraph } from '@navus/shared/routing/walking-stop-graph'

const origin = {
  key: 'venue:origin',
  coordinate: { longitude: 103, latitude: 1 },
}
const destination = {
  key: 'venue:destination',
  coordinate: { longitude: 103.01, latitude: 1.01 },
}
const stopA = {
  key: 'stop:STOP-A',
  stopId: 'STOP-A',
  coordinate: { longitude: 103.001, latitude: 1 },
}
const stopB = {
  key: 'stop:STOP-B',
  stopId: 'STOP-B',
  coordinate: { longitude: 103.002, latitude: 1 },
}

const request: WalkingConnectionRequest = {
  origin,
  destination,
  stops: [stopA, stopB],
}

const graph: WalkingStopGraph = {
  version: 1,
  networkVersion: 1,
  routingProfile: 'pedestrian',
  routingDataVersion: 'test',
  stopIds: ['STOP-A', 'STOP-B'],
  connections: [
    { fromKey: 'stop:STOP-A', toKey: 'stop:STOP-B', distanceMeters: 120, durationSeconds: 90 },
    { fromKey: 'stop:STOP-B', toKey: 'stop:STOP-A', distanceMeters: 140, durationSeconds: 110 },
  ],
}

function createRouteEngine(): WalkingRouteEngine {
  return {
    routeWalking: vi.fn(),
    matrixWalking: vi.fn(async ({ sources }) => {
      if (sources.length === 1) {
        return [
          { fromIndex: 0, toIndex: 0, distanceMeters: 1_000, durationSeconds: 800 },
          { fromIndex: 0, toIndex: 1, distanceMeters: 100, durationSeconds: 80 },
        ]
      }
      return [
        { fromIndex: 0, toIndex: 0, distanceMeters: 200, durationSeconds: 160 },
        { fromIndex: 1, toIndex: 0, distanceMeters: 300, durationSeconds: 240 },
      ]
    }),
  }
}

function connectionKeys(connections: readonly { fromKey: string; toKey: string }[]): string[] {
  return connections.map(({ fromKey, toKey }) => `${fromKey} -> ${toKey}`).sort()
}

describe('walking connection provider', () => {
  it('combines two endpoint queries with the static directed stop graph', async () => {
    const routeEngine = createRouteEngine()
    const loadGraph = vi.fn(async () => graph)
    const provider = createWalkingConnectionProvider({ routeEngine, loadGraph })

    const connections = await provider.getWalkingConnections(request, new AbortController().signal)

    expect(connectionKeys(connections)).toEqual([
      'stop:STOP-A -> stop:STOP-B',
      'stop:STOP-A -> venue:destination',
      'stop:STOP-B -> stop:STOP-A',
      'stop:STOP-B -> venue:destination',
      'venue:origin -> stop:STOP-A',
      'venue:origin -> venue:destination',
    ])
    expect(routeEngine.matrixWalking).toHaveBeenCalledTimes(2)
    expect(routeEngine.matrixWalking).toHaveBeenCalledWith({
      sources: [origin.coordinate],
      targets: [destination.coordinate, stopA.coordinate, stopB.coordinate],
    }, expect.any(AbortSignal))
    expect(routeEngine.matrixWalking).toHaveBeenCalledWith({
      sources: [stopA.coordinate, stopB.coordinate],
      targets: [destination.coordinate],
    }, expect.any(AbortSignal))
    expect(loadGraph).toHaveBeenCalledOnce()
  })

  it('loads the static graph once and supports arbitrary endpoint coordinates', async () => {
    const routeEngine = createRouteEngine()
    const loadGraph = vi.fn(async () => graph)
    const provider = createWalkingConnectionProvider({ routeEngine, loadGraph })

    await provider.getWalkingConnections(request, new AbortController().signal)
    await provider.getWalkingConnections({
      ...request,
      origin: { ...origin, key: 'venue:other-origin', coordinate: { longitude: 103.02, latitude: 1.02 } },
    }, new AbortController().signal)

    expect(loadGraph).toHaveBeenCalledOnce()
    expect(routeEngine.matrixWalking).toHaveBeenCalledTimes(4)
  })
})
