import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolve } from 'node:path'
import { parseApiOrigin } from '@nusgo/shared'
import { loadBackendConfig } from './config.ts'

const commit = 'a'.repeat(40)

describe('parseApiOrigin', () => {
  it('allows HTTP for local development and requires HTTPS for production', () => {
    assert.equal(parseApiOrigin('http://localhost:3001'), 'http://localhost:3001')
    assert.equal(parseApiOrigin('https://api.example.edu.sg', 'VITE_API_ORIGIN', {
      requireHttps: true,
    }), 'https://api.example.edu.sg')
    assert.throws(() => parseApiOrigin('http://api.example.edu.sg', 'VITE_API_ORIGIN', {
      requireHttps: true,
    }), /must use HTTPS in production/)
  })
})

describe('loadBackendConfig', () => {
  it('resolves a supplied canonical data directory from the backend working directory', () => {
    const workingDirectory = resolve('nusgo-backend')
    const config = loadBackendConfig({ NUSGO_DATA_DIR: './data' }, workingDirectory)

    assert.equal(config.dataDirectory, resolve(workingDirectory, 'data'))
  })

  it('uses loopback and exact local origins by default', () => {
    const config = loadBackendConfig({}, 'C:/nusgo/backend')

    assert.equal(config.host, '127.0.0.1')
    assert.equal(config.port, 3001)
    assert.equal(config.valhallaBaseUrl, 'http://127.0.0.1:8002')
    assert.equal(config.apiRateLimitWindowMs, 60_000)
    assert.equal(config.apiRateLimitMaxRequests, 120)
    assert.equal(config.journeyRateLimitMaxRequests, 20)
    assert.equal(config.journeyMaxConcurrentRequests, 4)
    assert.equal(config.journeyRequestTimeoutMs, 10_000)
    assert.equal(config.dataVersion, 'development')
    assert.deepEqual(config.corsOrigins, [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'https://limzijing.github.io',
    ])
  })

  it('accepts production settings with a commit and HTTPS allowlist', () => {
    const config = loadBackendConfig({
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3001',
      API_CORS_ORIGINS: 'https://limzijing.github.io,https://nusgo.example.edu.sg',
      NUSGO_DATA_VERSION: commit,
    })

    assert.equal(config.environment, 'production')
    assert.equal(config.dataVersion, commit)
    assert.deepEqual(config.corsOrigins, [
      'https://limzijing.github.io',
      'https://nusgo.example.edu.sg',
    ])
  })

  it('accepts loopback and private-IP Valhalla URLs', () => {
    const loopback = loadBackendConfig({ VALHALLA_BASE_URL: 'http://127.0.0.1:8002/' })
    const privateNetwork = loadBackendConfig({ VALHALLA_BASE_URL: 'http://10.0.0.12:8002/' })
    const privateDns = loadBackendConfig({ VALHALLA_BASE_URL: 'http://valhalla:8002/' })
    const localDns = loadBackendConfig({ VALHALLA_BASE_URL: 'http://routing.local:8002/' })
    assert.equal(loopback.valhallaBaseUrl, 'http://127.0.0.1:8002')
    assert.equal(privateNetwork.valhallaBaseUrl, 'http://10.0.0.12:8002')
    assert.equal(privateDns.valhallaBaseUrl, 'http://valhalla:8002')
    assert.equal(localDns.valhallaBaseUrl, 'http://routing.local:8002')
  })

  it('loads bounded API and Journey request limits', () => {
    const config = loadBackendConfig({
      API_RATE_LIMIT_WINDOW_MS: '30000',
      API_RATE_LIMIT_MAX_REQUESTS: '45',
      JOURNEY_RATE_LIMIT_MAX_REQUESTS: '7',
      JOURNEY_MAX_CONCURRENT_REQUESTS: '3',
    })

    assert.equal(config.apiRateLimitWindowMs, 30_000)
    assert.equal(config.apiRateLimitMaxRequests, 45)
    assert.equal(config.journeyRateLimitMaxRequests, 7)
    assert.equal(config.journeyMaxConcurrentRequests, 3)
    assert.throws(() => loadBackendConfig({ API_RATE_LIMIT_WINDOW_MS: '999' }), /API_RATE_LIMIT_WINDOW_MS/)
    assert.throws(() => loadBackendConfig({ API_RATE_LIMIT_MAX_REQUESTS: '0' }), /API_RATE_LIMIT_MAX_REQUESTS/)
    assert.throws(() => loadBackendConfig({ JOURNEY_RATE_LIMIT_MAX_REQUESTS: '1001' }), /JOURNEY_RATE_LIMIT_MAX_REQUESTS/)
    assert.throws(() => loadBackendConfig({ JOURNEY_MAX_CONCURRENT_REQUESTS: '17' }), /JOURNEY_MAX_CONCURRENT_REQUESTS/)
  })

  it('rejects invalid provider URLs and other invalid backend settings', () => {
    assert.throws(() => loadBackendConfig({ VALHALLA_BASE_URL: 'ftp://routing.local' }), /VALHALLA_BASE_URL/)
    assert.throws(() => loadBackendConfig({ VALHALLA_BASE_URL: 'https://routing.example.com' }), /private-network address/)
    assert.throws(() => loadBackendConfig({ VALHALLA_BASE_URL: 'http://169.254.169.254' }), /private-network address/)
    assert.throws(() => loadBackendConfig({ JOURNEY_REQUEST_TIMEOUT_MS: '99' }), /JOURNEY_REQUEST_TIMEOUT_MS/)
    assert.throws(() => loadBackendConfig({ PORT: '70000' }), /PORT/)
    assert.throws(() => loadBackendConfig({ API_CORS_ORIGINS: 'https://example.com/path' }), /origin/)
    assert.throws(() => loadBackendConfig({
      NODE_ENV: 'production',
      HOST: '0.0.0.0',
      API_CORS_ORIGINS: 'https://limzijing.github.io',
      NUSGO_DATA_VERSION: commit,
    }), /loopback/)
    assert.throws(() => loadBackendConfig({
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'https://limzijing.github.io',
      NUSGO_DATA_VERSION: 'development',
    }), /source commit/)
    assert.throws(() => loadBackendConfig({
      NODE_ENV: 'production',
      API_CORS_ORIGINS: 'http://localhost:5173,https://limzijing.github.io',
      NUSGO_DATA_VERSION: commit,
    }), /HTTPS/)
  })
})

describe('backend live-data settings', () => {
  it('uses bounded defaults and lets the process start without provider credentials', () => {
    const config = loadBackendConfig({}, 'C:/nusgo/backend')

    assert.equal(config.liveData.shuttleRefreshIntervalMs, 30_000)
    assert.equal(config.liveData.requestTimeoutMs, 5_000)
    assert.equal(config.liveData.maxConcurrency, 6)
    assert.equal(config.liveData.retryAttempts, 1)
    assert.equal(config.liveData.nusProvider, null)
    assert.equal(config.liveData.ltaAccountKey, '')
  })

  it('defaults the first shuttle snapshot to 28 minimum stops and loads an override', () => {
    assert.equal(loadBackendConfig({}, 'C:/nusgo/backend').liveData.minFirstSnapshotStops, 28)
    assert.equal(loadBackendConfig({ LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS: '20' }).liveData.minFirstSnapshotStops, 20)
    assert.equal(loadBackendConfig({ LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS: '33' }).liveData.minFirstSnapshotStops, 33)
  })

  it('loads NUS and LTA secrets only into backend configuration', () => {
    const config = loadBackendConfig({
      NUS_BUS_PROXY_BASE_URL: 'https://bus-proxy.nus.example',
      NUS_X_HTD_API: 'secret-htd',
      NUS_X_APP_API: 'secret-app',
      NUS_X_API_KEY: 'secret-key',
      NUS_DEVICE_ID: 'backend-device',
      NUS_UNIVUS_JWT: 'private-token',
      NUS_USER_ID: 'private-user',
      LTA_ACCOUNT_KEY: 'private-lta-key',
      NUS_SHUTTLE_REFRESH_INTERVAL_MS: '45000',
      LIVE_DATA_REQUEST_TIMEOUT_MS: '9000',
      LIVE_DATA_MAX_CONCURRENCY: '4',
      LIVE_DATA_RETRY_ATTEMPTS: '2',
    })

    assert.equal(config.liveData.shuttleRefreshIntervalMs, 45_000)
    assert.equal(config.liveData.requestTimeoutMs, 9_000)
    assert.equal(config.liveData.maxConcurrency, 4)
    assert.equal(config.liveData.retryAttempts, 2)
    assert.equal(config.liveData.nusProvider?.deviceId, 'backend-device')
    assert.equal(config.liveData.nusProvider?.initialToken, 'private-token')
    assert.equal(config.liveData.ltaAccountKey, 'private-lta-key')
    assert.throws(() => loadBackendConfig({
      NUS_BUS_PROXY_BASE_URL: 'http://bus-proxy.nus.example',
      NUS_X_HTD_API: 'htd',
      NUS_X_APP_API: 'app',
      NUS_X_API_KEY: 'key',
    }), /HTTPS URL/)
  })

  it('rejects partial NUS credentials and unbounded live-data settings', () => {
    assert.throws(() => loadBackendConfig({ NUS_X_HTD_API: 'partial' }), /NUS live-data configuration/)
    assert.throws(() => loadBackendConfig({ NUS_SHUTTLE_REFRESH_INTERVAL_MS: '999' }), /NUS_SHUTTLE_REFRESH_INTERVAL_MS/)
    assert.throws(() => loadBackendConfig({ LIVE_DATA_MAX_CONCURRENCY: '17' }), /LIVE_DATA_MAX_CONCURRENCY/)
    assert.throws(() => loadBackendConfig({ LIVE_DATA_RETRY_ATTEMPTS: '4' }), /LIVE_DATA_RETRY_ATTEMPTS/)
  })

  it('rejects out-of-range and non-integer first-snapshot stop minimums', () => {
    assert.throws(() => loadBackendConfig({ LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS: '0' }), /LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS/)
    assert.throws(() => loadBackendConfig({ LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS: '34' }), /LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS/)
    assert.throws(() => loadBackendConfig({ LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS: '2.5' }), /LIVE_DATA_MIN_FIRST_SNAPSHOT_STOPS/)
  })
})
