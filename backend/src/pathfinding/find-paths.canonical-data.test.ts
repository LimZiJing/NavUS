import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createTransitNetworkIndex } from '@navus/shared/transit/index'
import { validateTransitNetwork } from '@navus/shared/transit/model'
import { generateShuttleTimingData } from '@navus/shared/transit/timing'
import { validateBusRouteGeometry } from '@navus/shared/transit/geometry'
import { validateVenueLocationMap } from '@navus/shared/venue/validation'
import { createFindPathsService } from './find-paths.ts'
import type { TestTransitData } from './find-paths.test-support.ts'
import { validateWalkingStopGraph } from '@navus/shared/routing/walking-stop-graph'

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
}

function createTransitData(): TestTransitData {
  const network = validateTransitNetwork(readJson('../../../frontend/public/data/shuttle-network.json'))
  const geometry = validateBusRouteGeometry(
    network,
    readJson('../../../frontend/public/data/shuttle-routes.geojson'),
  )
  const index = createTransitNetworkIndex(network)
  return {
    network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(network, geometry, '2026-09-22'),
  }
}

function createWalkingConnections(
): readonly {
  readonly fromKey: string
  readonly toKey: string
  readonly distanceMeters: number
  readonly durationSeconds: number
}[] {
  const graph = validateWalkingStopGraph(readJson('../../../frontend/public/data/walking-stop-graph.json'))
  const stopConnections = graph.connections.map((connection) => ({
    ...connection,
  }))
  const destinationConnections = ['PGP', 'PGPR', 'COM2', 'UTown'].map((stopId) => ({
    fromKey: `stop:${stopId}`,
    toKey: 'venue:UT-AUD2',
    distanceMeters: 100,
    durationSeconds: 100,
  }))
  return [...stopConnections, ...destinationConnections]
}

describe('canonical-data path planning regression', () => {
  it('returns a valid Path for PGP to UTown Auditorium 2 within the search budget', { timeout: 5_000 }, async () => {
    const transit = createTransitData()
    const venues = validateVenueLocationMap(readJson('../../../frontend/public/data/venues.json'))
    const walkingConnections = createWalkingConnections()
    const routeEngine = {
      matrixWalking: async () => [],
      routeWalking: async ({ origin, destination }: {
        readonly origin: { readonly longitude: number; readonly latitude: number }
        readonly destination: { readonly longitude: number; readonly latitude: number }
      }) => ({
        distanceMeters: 100,
        durationSeconds: 100,
        geometry: {
          type: 'LineString' as const,
          coordinates: [
            [origin.longitude, origin.latitude] as const,
            [destination.longitude, destination.latitude] as const,
          ],
        },
      }),
    }
    const service = createFindPathsService({
      routeEngine,
      walkingConnectionProvider: { getWalkingConnections: async () => walkingConnections },
      getTestDepartureMs: () => null,
      now: Date.now,
      monotonicNow: () => performance.now(),
      yieldControl: () => Promise.resolve(),
    })
    const path = (await service({
      origin: { kind: 'stop', id: 'PGP' },
      destination: { kind: 'venue', id: 'UT-AUD2' },
      venues,
      transit: {
        index: transit.index,
        geometry: transit.geometry,
        shuttleTiming: transit.shuttleTiming,
      },
    }, { signal: new AbortController().signal }))?.candidates[0]?.path ?? null

    expect(path).not.toBeNull()
    expect(path?.origin).toEqual({ kind: 'stop', id: 'PGP' })
    expect(path?.destination).toEqual({ kind: 'venue', id: 'UT-AUD2' })
    expect(path?.legs.length).toBeGreaterThan(0)
    expect(path?.totalDurationSeconds).toBeGreaterThan(0)
  })
})
