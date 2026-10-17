import { describe, expect, it } from 'vitest'
import type { WalkingRouteEngine } from '../../../backend/src/pathfinding/walking/walking-contracts'
import { createMeasuredRouteEngine } from './instrumentation'

const routeEngine: WalkingRouteEngine = {
  async routeWalking() {
    return {
      distanceMeters: 10,
      durationSeconds: 8,
      geometry: { type: 'LineString', coordinates: [[103.77, 1.29], [103.771, 1.291]] },
    }
  },
  async matrixWalking() {
    return [{ fromIndex: 0, toIndex: 0, distanceMeters: 12, durationSeconds: 9 }]
  },
}

describe('createMeasuredRouteEngine', () => {
  it('captures successful matrix requests and counts route requests', async () => {
    const measured = createMeasuredRouteEngine(routeEngine)
    const request = {
      sources: [{ longitude: 103.77, latitude: 1.29 }],
      targets: [{ longitude: 103.771, latitude: 1.291 }],
    }

    await measured.matrixWalking(request, new AbortController().signal)
    await measured.routeWalking({
      origin: request.sources[0],
      destination: request.targets[0],
    }, new AbortController().signal)

    expect(measured.requestCounts).toEqual({ matrix: 1, route: 1 })
    expect(measured.matrixRequests).toEqual([{
      request,
      connections: [{ fromIndex: 0, toIndex: 0, distanceMeters: 12, durationSeconds: 9 }],
    }])
    expect(measured.matrixElapsedMs).toBeGreaterThanOrEqual(0)
    expect(measured.routeElapsedMs).toBeGreaterThanOrEqual(0)
    expect(measured.elapsedMs).toBe(measured.matrixElapsedMs + measured.routeElapsedMs)
  })

  it('counts a failed matrix request so swallowed adapter errors remain visible', async () => {
    const measured = createMeasuredRouteEngine({
      ...routeEngine,
      async matrixWalking() {
        throw new Error('Valhalla unavailable')
      },
    })

    await expect(measured.matrixWalking({ sources: [], targets: [] }, new AbortController().signal))
      .rejects.toThrow('Valhalla unavailable')

    expect(measured.requestCounts).toEqual({ matrix: 1, route: 0 })
    expect(measured.matrixRequests).toEqual([])
  })

  it('resets counts and captured matrix evidence between benchmark samples', async () => {
    const measured = createMeasuredRouteEngine(routeEngine)
    await measured.matrixWalking({ sources: [], targets: [] }, new AbortController().signal)
    measured.reset()

    expect(measured.requestCounts).toEqual({ matrix: 0, route: 0 })
    expect(measured.matrixRequests).toEqual([])
    expect(measured.matrixElapsedMs).toBe(0)
    expect(measured.routeElapsedMs).toBe(0)
  })
})
