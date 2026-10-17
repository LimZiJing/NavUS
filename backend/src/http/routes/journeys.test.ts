import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ApiJourneyPlanningRequest, ApiJourneyPlanningResponse } from '@navus/shared/routing/path'
import { loadBackendConfig } from '../../config.ts'
import { createApp } from '../app.ts'
import { closeHttpServer, listenHttpServer } from '../../server.ts'
import { InvalidJourneyEndpointError } from '../../pathfinding/service.ts'
import { ValhallaRouteError } from '../../pathfinding/walking/valhalla-walking-client.ts'
import { InvalidJourneyRequestError, parseJourneyPlanningRequest } from './journeys.ts'

const request = {
  origin: { kind: 'venue', id: 'COM1' },
  destination: { kind: 'stop', id: 'COM3' },
} as const

describe('parseJourneyPlanningRequest', () => {
  it('accepts canonical references and frozen Current location coordinates', () => {
    assert.deepEqual(parseJourneyPlanningRequest({
      origin: { kind: 'venue', id: 'COM1' },
      destination: { kind: 'current-location', coordinate: { longitude: 103.78, latitude: 1.29 } },
    }, 'production'), {
      origin: { kind: 'venue', id: 'COM1' },
      destination: { kind: 'current-location', coordinate: { longitude: 103.78, latitude: 1.29 } },
    })
  })

  it('accepts building and stop references without client supplied location data', () => {
    assert.deepEqual(parseJourneyPlanningRequest({
      origin: { kind: 'building', id: 'com3' },
      destination: { kind: 'stop', id: 'COM3' },
    }, 'production'), {
      origin: { kind: 'building', id: 'com3' },
      destination: { kind: 'stop', id: 'COM3' },
    })
  })

  it('rejects malformed endpoint coordinates and client supplied canonical coordinates', () => {
    assert.throws(() => parseJourneyPlanningRequest({
      origin: { kind: 'current-location', coordinate: { longitude: 181, latitude: 1 } },
      destination: { kind: 'stop', id: 'COM3' },
    }, 'production'), InvalidJourneyRequestError)
    assert.throws(() => parseJourneyPlanningRequest({
      origin: { kind: 'venue', id: 'COM1', coordinate: { longitude: 103, latitude: 1 } },
      destination: { kind: 'stop', id: 'COM3' },
    }, 'production'), InvalidJourneyRequestError)
  })

  it('allows only a finite simulated departure clock in development', () => {
    assert.equal(parseJourneyPlanningRequest({
      origin: request.origin,
      destination: request.destination,
      simulatedDepartureMs: 1_800_000_000_000,
    }, 'development').simulatedDepartureMs, 1_800_000_000_000)
    assert.throws(() => parseJourneyPlanningRequest({
      origin: request.origin,
      destination: request.destination,
      simulatedDepartureMs: 1_800_000_000_000,
    }, 'production'), InvalidJourneyRequestError)
    assert.throws(() => parseJourneyPlanningRequest({
      origin: request.origin,
      destination: request.destination,
      simulatedDepartureMs: Number.NaN,
    }, 'development'), InvalidJourneyRequestError)
  })
})

interface Planner {
  plan(request: ApiJourneyPlanningRequest, signal: AbortSignal): Promise<ApiJourneyPlanningResponse>
}

async function withServer(
  planner: Planner | null,
  run: (baseUrl: string) => Promise<void>,
  journeyRequestTimeoutMs = 10_000,
): Promise<void> {
  const config = loadBackendConfig({
    NODE_ENV: 'test',
    API_CORS_ORIGINS: 'http://localhost:5173',
    JOURNEY_REQUEST_TIMEOUT_MS: String(journeyRequestTimeoutMs),
  })
  const server = await listenHttpServer(createApp(config, null, null, planner), '127.0.0.1', 0)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Test server did not expose its port')
  try {
    await run('http://127.0.0.1:' + address.port)
  } finally {
    await closeHttpServer(server)
  }
}

async function post(baseUrl: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(baseUrl + '/api/journeys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

describe('POST /api/journeys', () => {
  it('passes only endpoint references to the planner and returns complete options', async () => {
    let received: ApiJourneyPlanningRequest | null = null
    await withServer({
      async plan(planningRequest) {
        received = planningRequest
        return { outcome: 'paths', candidates: [], searchStatus: 'complete' }
      },
    }, async (baseUrl) => {
      const response = await post(baseUrl, request)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), {
        outcome: 'paths',
        candidates: [],
        searchStatus: 'complete',
      })
    })
    assert.deepEqual(received, request)
  })

  it('keeps no-path separate from provider failure', async () => {
    await withServer({ async plan() { return { outcome: 'no-path' } } }, async (baseUrl) => {
      const response = await post(baseUrl, request)
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { outcome: 'no-path' })
    })
    await withServer({
      async plan() { throw new ValhallaRouteError('upstream details stay private') },
    }, async (baseUrl) => {
      const response = await post(baseUrl, request)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), {
        error: 'Walking route provider is unavailable',
        code: 'provider_unavailable',
      })
    })
  })

  it('aborts overdue planner work and reports a provider timeout', async () => {
    let aborted = false
    await withServer({
      plan(_planningRequest, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    }, async (baseUrl) => {
      const response = await post(baseUrl, request)
      assert.equal(response.status, 504)
      assert.deepEqual(await response.json(), {
        error: 'Journey planning timed out',
        code: 'provider_unavailable',
      })
    }, 100)
    assert.equal(aborted, true)
  })

  it('limits Journey requests per client and returns a retry delay', async () => {
    let plannerCalls = 0
    await withServer({
      async plan() {
        plannerCalls += 1
        return { outcome: 'no-path' }
      },
    }, async (baseUrl) => {
      for (let requestNumber = 1; requestNumber <= 20; requestNumber += 1) {
        const response = await post(baseUrl, request)
        assert.equal(response.status, 200)
      }
      const limited = await post(baseUrl, request)
      assert.equal(limited.status, 429)
      assert.equal(limited.headers.get('retry-after'), '60')
      assert.deepEqual(await limited.json(), {
        error: 'Journey planning rate limit reached',
        code: 'rate_limited',
      })
    })
    assert.equal(plannerCalls, 20)
  })

  it('rejects unknown canonical references and reports not-ready separately', async () => {
    await withServer({
      async plan() { throw new InvalidJourneyEndpointError('unknown endpoint') },
    }, async (baseUrl) => {
      const response = await post(baseUrl, request)
      assert.equal(response.status, 400)
      assert.deepEqual(await response.json(), {
        error: 'unknown endpoint',
        code: 'invalid_request',
      })
    })
    await withServer(null, async (baseUrl) => {
      const response = await post(baseUrl, request)
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), {
        error: 'Journey planning is not ready',
        code: 'not_ready',
      })
    })
  })

  it('aborts planner work when the browser disconnects', async () => {
    let markStarted = (): void => {}
    let markAborted = (): void => {}
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const aborted = new Promise<void>((resolve) => { markAborted = resolve })
    await withServer({
      plan(_planningRequest, signal) {
        markStarted()
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            markAborted()
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    }, async (baseUrl) => {
      const controller = new AbortController()
      const response = post(baseUrl, request, controller.signal).catch(() => null)
      await started
      controller.abort()
      await Promise.race([
        aborted,
        new Promise<never>((_, reject) => { const timeout = setTimeout(() => reject(new Error('Planner did not observe disconnect')), 2_000); timeout.unref() }),
      ])
      await response
    })
  })
})
