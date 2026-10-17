import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { before, describe, it } from 'node:test'
import { generateShuttleTimingData, validateTransitMapData } from '@navus/shared'
import { createApp } from '../http/app.ts'
import { loadBackendConfig } from '../config.ts'
import { validateCanonicalData, type BackendData } from '../canonical-data.ts'
import { closeHttpServer, listenHttpServer } from '../server.ts'
import { createBackendLiveData } from './runtime.ts'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const sourceDataDirectory = resolve(repositoryRoot, 'frontend/public/data')
const fixedNow = Date.parse('2026-10-15T03:00:00.000Z')
const arrivalTime = new Date(fixedNow + 5 * 60_000).toISOString()
let backendData: BackendData

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(sourceDataDirectory, filename), 'utf8')) as unknown
}

before(async () => {
  const [venues, buildings, network, routeGeometry, walkingStopGraph] = await Promise.all([
    readJson('venues.json'),
    readJson('buildings.json'),
    readJson('shuttle-network.json'),
    readJson('shuttle-routes.geojson'),
    readJson('walking-stop-graph.json'),
  ])
  const transit = validateTransitMapData(network, routeGeometry)
  backendData = validateCanonicalData({
    venues,
    buildings,
    network,
    routeGeometry,
    walkingStopGraph,
    shuttleTiming: generateShuttleTimingData(
      transit.network,
      transit.geometry,
      transit.network.metadata.verifiedAt,
    ),
  }, 'development')
})

function createConfig(ltaAccountKey = 'test-lta-account-key') {
  return loadBackendConfig({
    NODE_ENV: 'test',
    NAVUS_DATA_DIR: sourceDataDirectory,
    NUS_BUS_PROXY_BASE_URL: 'https://bus-proxy.nus.example',
    NUS_ACCESS_TOKEN_URL: 'https://auth.nus.example/token',
    NUS_X_HTD_API: 'test-htd-api',
    NUS_X_APP_API: 'test-app-api',
    NUS_X_API_KEY: 'test-api-key',
    NUS_UNIVUS_JWT: 'test-token',
    NUS_USER_ID: 'test-user',
    LIVE_DATA_MAX_CONCURRENCY: '3',
    LIVE_DATA_RETRY_ATTEMPTS: '0',
    ...(ltaAccountKey ? { LTA_ACCOUNT_KEY: ltaAccountKey } : {}),
  }, repositoryRoot)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createSuccessfulFetcher(
  counts: { routeWindows: number; shuttleStops?: number },
  routeWindowResponse?: Promise<Response>,
  failedStopName?: string,
): typeof fetch {
  return async (input, init) => {
    const url = String(input)
    if (url.endsWith('/shuttle-service')) {
      counts.shuttleStops = (counts.shuttleStops ?? 0) + 1
      const requestBody = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { busstopname?: unknown }
        : null
      if (failedStopName && requestBody?.busstopname === failedStopName) {
        return jsonResponse({ error: 'provider unavailable' }, 503)
      }
      return jsonResponse({
        data: [{
          routeId: 'D1',
          nextArrivalSeconds: 120,
          upcomingArrivalSeconds: [120, 480],
        }],
      })
    }
    if (url.endsWith('/route-min-max-time')) {
      counts.routeWindows += 1
      if (routeWindowResponse) return routeWindowResponse
      return jsonResponse({
        data: {
          RouteMinMaxTime: [{
            FirstTime: '06:00',
            LastTime: '23:00',
            DayType: 'Daily',
            Dates: '',
          }],
        },
      })
    }
    if (url.includes('/BusArrival?')) {
      return jsonResponse({
        Services: [{
          ServiceNo: '95',
          NextBus: { EstimatedArrival: arrivalTime, Monitored: 1 },
        }],
      })
    }
    throw new Error('Unexpected upstream request: ' + url)
  }
}

async function waitForSnapshot(liveData: Awaited<ReturnType<typeof createBackendLiveData>>): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!liveData.isSnapshotReady() && Date.now() < deadline) {
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5))
  }
  assert.equal(liveData.isSnapshotReady(), true, 'the initial shuttle refresh should publish a snapshot')
}

describe('Express live transit API', () => {
  it('stops a cancelled Journey waiting without cancelling shared service-window data', async () => {
    let markStarted = (): void => {}
    let resolveResponse: (response: Response) => void = () => {}
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const upstreamResponse = new Promise<Response>((resolve) => { resolveResponse = resolve })
    const liveData = await createBackendLiveData(createConfig(''), backendData, {
      fetcher: async (input) => {
        if (String(input).endsWith('/route-min-max-time')) {
          markStarted()
          return upstreamResponse
        }
        throw new Error('Unexpected upstream request: ' + String(input))
      },
      now: () => fixedNow,
      ltaMappings: [],
    })
    const cancelledController = new AbortController()
    const cancelledRequest = liveData.getServiceWindows(['D1'], cancelledController.signal)
      .then(() => null, (error: unknown) => error)
    const activeRequest = liveData.getServiceWindows(['D1'])

    try {
      await started
      cancelledController.abort()
      const cancelledResult = await Promise.race([
        cancelledRequest,
        new Promise<never>((_, reject) => {
          const timeout = setTimeout(() => reject(new Error('Cancelled Journey kept waiting for shared data')), 2_000)
          timeout.unref()
        }),
      ])
      assert.equal(cancelledResult instanceof Error ? cancelledResult.name : '', 'AbortError')

      resolveResponse(jsonResponse({
        data: {
          RouteMinMaxTime: [{ FirstTime: '06:00', LastTime: '23:00', DayType: 'Daily', Dates: '' }],
        },
      }))
      const result = await activeRequest
      assert.equal(result.routes.D1?.[0]?.firstTime, '06:00')
    } finally {
      await liveData.stop()
    }
  })

  it('uses NUS provider stop names when loading the initial shuttle snapshot', async () => {
    const receivedStopNames: string[] = []
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/shuttle-service')) {
        const requestBody = typeof init?.body === 'string'
          ? JSON.parse(init.body) as { busstopname?: unknown }
          : null
        if (typeof requestBody?.busstopname !== 'string') {
          throw new Error('Expected a NUS provider stop name')
        }
        receivedStopNames.push(requestBody.busstopname)
        if (requestBody.busstopname === 'Botanic Gardens MRT') {
          return jsonResponse({
            code: '10001',
            msg: 'Record not found.',
            data: { error: 'Record not found.' },
          })
        }
        return jsonResponse({ data: [] })
      }
      throw new Error('Unexpected upstream request: ' + url)
    }
    const liveData = await createBackendLiveData(createConfig(), backendData, {
      fetcher,
      now: () => fixedNow,
      ltaMappings: [],
    })

    try {
      liveData.start()
      await waitForSnapshot(liveData)
      assert.ok(receivedStopNames.includes('Botanic Gardens MRT (PUDO)'))
      assert.equal(receivedStopNames.length, backendData.network.stops.length)
    } finally {
      await liveData.stop()
    }
  })

  it('retries a transient NUS stop failure before publishing the first snapshot', async () => {
    const targetProviderStopName = 'Botanic Gardens MRT (PUDO)'
    const attemptsByStopName = new Map<string, number>()
    const config = createConfig()
    const retryConfig = {
      ...config,
      liveData: {
        ...config.liveData,
        retryAttempts: 1,
        retryBaseDelayMs: 0,
      },
    }
    const fetcher: typeof fetch = async (input, init) => {
      if (!String(input).endsWith('/shuttle-service')) {
        throw new Error('Unexpected upstream request: ' + String(input))
      }

      const body = typeof init?.body === 'string'
        ? JSON.parse(init.body) as { busstopname?: unknown }
        : null
      if (typeof body?.busstopname !== 'string') throw new Error('Expected a NUS provider stop name')
      const stopName = body.busstopname
      const attempts = (attemptsByStopName.get(stopName) ?? 0) + 1
      attemptsByStopName.set(stopName, attempts)
      if (stopName === targetProviderStopName && attempts === 1) {
        return jsonResponse({ error: 'temporarily unavailable' }, 503)
      }
      return jsonResponse({ data: [] })
    }
    const liveData = await createBackendLiveData(retryConfig, backendData, {
      fetcher,
      now: () => fixedNow,
      ltaMappings: [],
    })

    try {
      liveData.start()
      await waitForSnapshot(liveData)
      assert.equal(attemptsByStopName.get(targetProviderStopName), 2)
    } finally {
      await liveData.stop()
    }
  })

  it('reports a provider error when an LTA schedule lookup fails', async () => {
    const liveData = await createBackendLiveData(createConfig(), backendData, {
      fetcher: async (input) => {
        const url = String(input)
        if (url.includes('/BusArrival?')) return jsonResponse({ Services: [] })
        if (url.includes('/BusRoutes?')) return jsonResponse({ invalid: true })
        throw new Error('Unexpected upstream request: ' + url)
      },
      now: () => fixedNow,
      ltaMappings: [{ stopId: 'KR-MRT', busStopCode: '18331', services: ['95'] }],
    })

    try {
      const result = await liveData.getPublicBusArrivals(['KR-MRT'])
      assert.equal(result.stops['KR-MRT']?.services['95']?.status, 'provider-error')
    } finally {
      await liveData.stop()
    }
  })

  it('reports live readiness and serves validated shuttle, service-window, and public-bus contracts', async () => {
    const config = createConfig()
    const firstStop = backendData.network.stops[0]
    assert.ok(firstStop)
    const upstreamCounts = { routeWindows: 0, shuttleStops: 0 }
    let resolveWindowResponse: (response: Response) => void = () => undefined
    const routeWindowResponse = new Promise<Response>((resolveResponse) => {
      resolveWindowResponse = resolveResponse
    })
    const liveData = await createBackendLiveData(config, backendData, {
      fetcher: createSuccessfulFetcher(upstreamCounts, routeWindowResponse),
      now: () => fixedNow,
      ltaMappings: [{
        stopId: 'KR-MRT',
        busStopCode: '18331',
        services: ['95'],
      }],
    })
    const server = await listenHttpServer(createApp(config, backendData, liveData), '127.0.0.1', 0)
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const baseUrl = 'http://127.0.0.1:' + address.port

    try {
      const beforeRefresh = await fetch(baseUrl + '/api/ready')
      assert.equal(beforeRefresh.status, 503)
      assert.deepEqual(await beforeRefresh.json(), {
        status: 'not-ready',
        dataVersion: 'development',
        canonicalDataReady: true,
        liveSnapshotReady: false,
        error: 'Live transit snapshot is not ready',
      })

      liveData.start()
      await waitForSnapshot(liveData)

      const ready = await fetch(baseUrl + '/api/ready')
      assert.equal(ready.status, 200)
      assert.equal((await ready.json() as { liveSnapshotReady: boolean }).liveSnapshotReady, true)

      const shuttleResponse = await fetch(baseUrl + '/api/shuttle-arrivals?stops=' + encodeURIComponent(JSON.stringify([firstStop.id])))
      assert.equal(shuttleResponse.status, 200)
      const shuttle = await shuttleResponse.json() as {
        snapshotVersion: string
        stops: Record<string, Record<string, { nextArrivalSeconds: number }>>
        stopObservations: Record<string, { observedAt: string; expiresAt: string }>
      }
      assert.deepEqual(Object.keys(shuttle.stops), [firstStop.id])
      assert.equal(shuttle.stops[firstStop.id]?.D1?.nextArrivalSeconds, 120)
      assert.equal(shuttle.stopObservations[firstStop.id]?.observedAt, new Date(fixedNow).toISOString())
      assert.ok(Date.parse(shuttle.stopObservations[firstStop.id]?.expiresAt ?? '') > fixedNow)
      assert.ok(shuttle.snapshotVersion.length > 0)

      const invalidStop = await fetch(baseUrl + '/api/shuttle-arrivals?stops=' + encodeURIComponent(JSON.stringify(['UNKNOWN'])))
      assert.equal(invalidStop.status, 400)
      assert.deepEqual(await invalidStop.json(), {
        error: 'Unknown canonical bus stop: UNKNOWN',
        code: 'invalid_request',
      })

      const windowsUrl = baseUrl + '/api/shuttle-service-windows?routes=D1'
      const cancelledWindowRequest = new AbortController()
      const firstWindowsRequest = fetch(windowsUrl, { signal: cancelledWindowRequest.signal })
        .catch((error: unknown) => error)
      const requestDeadline = Date.now() + 2_000
      while (upstreamCounts.routeWindows === 0 && Date.now() < requestDeadline) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5))
      }
      const secondWindowsRequest = fetch(windowsUrl)
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10))
      cancelledWindowRequest.abort()
      resolveWindowResponse(jsonResponse({
        data: {
          RouteMinMaxTime: [{
            FirstTime: '06:00',
            LastTime: '23:00',
            DayType: 'Daily',
            Dates: '',
          }],
        },
      }))
      const cancelledResult = await firstWindowsRequest
      assert.equal(cancelledResult instanceof Error ? cancelledResult.name : '', 'AbortError')
      const windowsResponse = await secondWindowsRequest
      assert.equal(windowsResponse.status, 200)
      const windows = await windowsResponse.json() as {
        observedAt: string
        expiresAt: string
        routes: Record<string, readonly { routeId: string; firstTime: string }[]>
      }
      assert.equal(windows.routes.D1?.[0]?.firstTime, '06:00')
      assert.equal(windows.routes.D1?.[0]?.routeId, 'D1')
      assert.ok(Date.parse(windows.expiresAt) > Date.parse(windows.observedAt))
      assert.equal(upstreamCounts.routeWindows, 1)

      const busesResponse = await fetch(baseUrl + '/api/public-bus-arrivals?stops=' + encodeURIComponent(JSON.stringify(['KR-MRT'])))
      assert.equal(busesResponse.status, 200)
      const buses = await busesResponse.json() as {
        source: string
        stops: Record<string, { services: Record<string, { status: string; arrivals: readonly { estimatedAt: string }[] }> }>
      }
      assert.equal(buses.source, 'lta-datamall')
      assert.equal(buses.stops['KR-MRT']?.services['95']?.status, 'live')
      assert.equal(buses.stops['KR-MRT']?.services['95']?.arrivals[0]?.estimatedAt, arrivalTime)

      const invalidBusStop = await fetch(baseUrl + '/api/public-bus-arrivals?stops=' + encodeURIComponent(JSON.stringify(['NOT-MAPPED'])))
      assert.equal(invalidBusStop.status, 400)
      assert.equal((await invalidBusStop.json() as { code: string }).code, 'invalid_request')
    } finally {
      await Promise.all([closeHttpServer(server), liveData.stop()])
    }
  })

  it('keeps readiness unavailable after an incomplete first shuttle cycle', async () => {
    const config = createConfig()
    const firstStop = backendData.network.stops[0]
    assert.ok(firstStop)
    const upstreamCounts = { routeWindows: 0, shuttleStops: 0 }
    const liveData = await createBackendLiveData(config, backendData, {
      fetcher: createSuccessfulFetcher(upstreamCounts, undefined, firstStop.longName),
      now: () => fixedNow,
      ltaMappings: [],
    })
    const server = await listenHttpServer(createApp(config, backendData, liveData), '127.0.0.1', 0)
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const baseUrl = 'http://127.0.0.1:' + address.port

    try {
      liveData.start()
      const deadline = Date.now() + 5_000
      while (upstreamCounts.shuttleStops < backendData.network.stops.length && Date.now() < deadline) {
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5))
      }
      assert.equal(upstreamCounts.shuttleStops, backendData.network.stops.length)
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 25))
      assert.equal(liveData.isSnapshotReady(), false)

      const health = await fetch(baseUrl + '/api/health')
      const ready = await fetch(baseUrl + '/api/ready')
      const arrivals = await fetch(baseUrl + '/api/shuttle-arrivals?stops=' + encodeURIComponent(JSON.stringify([firstStop.id])))
      assert.equal(health.status, 200)
      assert.equal(ready.status, 503)
      assert.deepEqual(await ready.json(), {
        status: 'not-ready',
        dataVersion: 'development',
        canonicalDataReady: true,
        liveSnapshotReady: false,
        error: 'Live transit snapshot is not ready',
      })
      assert.equal(arrivals.status, 503)
      assert.deepEqual(await arrivals.json(), {
        error: 'Shuttle arrival snapshot is not ready',
        code: 'not_ready',
      })
    } finally {
      await Promise.all([closeHttpServer(server), liveData.stop()])
    }
  })
  it('aborts in-flight provider work and leaves no shuttle snapshot during shutdown', async () => {
    let started = 0
    let aborted = 0
    const fetcher: typeof fetch = async (_input, init) => {
      started += 1
      return new Promise<Response>((_resolveResponse, rejectResponse) => {
        init?.signal?.addEventListener('abort', () => {
          aborted += 1
          rejectResponse(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }
    const config = createConfig('')
    const liveData = await createBackendLiveData(config, backendData, {
      fetcher,
      now: () => fixedNow,
      ltaMappings: [],
    })

    liveData.start()
    const deadline = Date.now() + 2_000
    while (started === 0 && Date.now() < deadline) {
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5))
    }
    assert.ok(started > 0)
    await liveData.stop()
    assert.ok(aborted > 0)
    assert.equal(liveData.isSnapshotReady(), false)
  })
})
