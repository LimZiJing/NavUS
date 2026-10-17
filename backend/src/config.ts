import { resolve } from 'node:path'
import { isIP } from 'node:net'
import {
  LOCAL_DATA_VERSION,
  SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS,
  parseCorsOrigins,
  parseDataVersion,
} from '@navus/shared'

const PAGES_ORIGIN = 'https://limzijing.github.io'
const DEVELOPMENT_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  PAGES_ORIGIN,
])
const DEFAULT_ACCESS_TOKEN_URL = 'https://myizaac2.nus.edu.sg/univus-public/mobile/get-access-token'
const DEFAULT_NUS_APP_VERSION = 'univus_android_2.59.2_140'

export interface NusProviderConfig {
  readonly busProxyBaseUrl: string
  readonly accessTokenUrl: string
  readonly htdApi: string
  readonly appApi: string
  readonly apiKey: string
  readonly deviceId: string
  readonly ipaddr: string
  readonly version: string
  readonly initialToken?: string
  readonly initialUserId?: string
  readonly initialDomain?: string
}

export interface BackendConfig {
  readonly environment: 'development' | 'test' | 'production'
  readonly host: string
  readonly port: number
  readonly corsOrigins: readonly string[]
  readonly dataVersion: string
  readonly dataDirectory: string
  readonly valhallaBaseUrl: string
  readonly journeyRequestTimeoutMs: number
  readonly liveData: {
    readonly shuttleRefreshIntervalMs: number
    readonly requestTimeoutMs: number
    readonly maxConcurrency: number
    readonly retryAttempts: number
    readonly retryBaseDelayMs: number
    readonly nusProvider: NusProviderConfig | null
    readonly ltaAccountKey: string
  }
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') return fallback
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(name + ' must be an integer from ' + minimum + ' to ' + maximum)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(name + ' must be an integer from ' + minimum + ' to ' + maximum)
  }
  return parsed
}

function parsePort(value: string | undefined): number {
  return parseInteger(value, 3001, 'PORT', 1, 65535)
}

function parseEnvironment(value: string | undefined): BackendConfig['environment'] {
  const environment = value?.trim() || 'development'
  if (environment !== 'development' && environment !== 'test' && environment !== 'production') {
    throw new Error('NODE_ENV must be development, test, or production')
  }
  return environment
}

function optionalText(environment: Record<string, string | undefined>, name: string): string {
  return environment[name]?.trim() ?? ''
}

function parseNusProviderConfig(
  environment: Record<string, string | undefined>,
): NusProviderConfig | null {
  const required = {
    busProxyBaseUrl: optionalText(environment, 'NUS_BUS_PROXY_BASE_URL').replace(/\/+$/, ''),
    htdApi: optionalText(environment, 'NUS_X_HTD_API'),
    appApi: optionalText(environment, 'NUS_X_APP_API'),
    apiKey: optionalText(environment, 'NUS_X_API_KEY'),
  }
  const values = Object.values(required)
  if (values.every((value) => value.length === 0)) return null
  if (values.some((value) => value.length === 0)) {
    throw new Error('NUS live-data configuration requires NUS_BUS_PROXY_BASE_URL, NUS_X_HTD_API, NUS_X_APP_API, and NUS_X_API_KEY')
  }

  let baseUrl: URL
  try {
    baseUrl = new URL(required.busProxyBaseUrl)
  } catch {
    throw new Error('NUS_BUS_PROXY_BASE_URL must be an HTTPS URL')
  }
  if (baseUrl.protocol !== 'https:') {
    throw new Error('NUS_BUS_PROXY_BASE_URL must be an HTTPS URL')
  }

  const accessTokenUrl = optionalText(environment, 'NUS_ACCESS_TOKEN_URL') || DEFAULT_ACCESS_TOKEN_URL
  let tokenUrl: URL
  try {
    tokenUrl = new URL(accessTokenUrl)
  } catch {
    throw new Error('NUS_ACCESS_TOKEN_URL must be an HTTPS URL')
  }
  if (tokenUrl.protocol !== 'https:') throw new Error('NUS_ACCESS_TOKEN_URL must use HTTPS')

  const deviceId = optionalText(environment, 'NUS_DEVICE_ID')
  const initialToken = optionalText(environment, 'NUS_UNIVUS_JWT')
  const initialUserId = optionalText(environment, 'NUS_USER_ID')
  const initialDomain = optionalText(environment, 'NUS_DOMAIN')

  return Object.freeze({
    ...required,
    accessTokenUrl,
    deviceId,
    ipaddr: optionalText(environment, 'NUS_IPADDR') || '0.0.0.0',
    version: optionalText(environment, 'NUS_APP_VERSION') || DEFAULT_NUS_APP_VERSION,
    ...(initialToken ? { initialToken } : {}),
    ...(initialUserId ? { initialUserId } : {}),
    ...(initialDomain ? { initialDomain } : {}),
  })
}

function isPrivateNetworkAddress(hostname: string): boolean {
  const address = hostname.replace(/^\[|\]$/g, '')
  const version = isIP(address)
  if (version === 4) {
    const octets = address.split('.').map(Number)
    const [first, second] = octets
    return first === 127 || first === 10 ||
      (first === 172 && second! >= 16 && second! <= 31) ||
      (first === 192 && second === 168)
  }
  if (version === 6) {
    const normalized = address.toLowerCase()
    return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd')
  }
  const localName = address.toLowerCase()
  return localName === 'localhost' || localName.endsWith('.localhost') ||
    localName.endsWith('.local') || localName.endsWith('.internal') || !localName.includes('.')
}

function parseValhallaBaseUrl(value: string | undefined): string {
  const configured = value?.trim() || 'http://127.0.0.1:8002'
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw new Error('VALHALLA_BASE_URL must be a valid HTTP or HTTPS URL')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new Error('VALHALLA_BASE_URL must be an HTTP or HTTPS URL without credentials or query data')
  }
  // Keep server-side routing private even when this setting is supplied outside development.
  if (!isPrivateNetworkAddress(url.hostname)) {
    throw new Error('VALHALLA_BASE_URL must use a loopback or private-network address')
  }
  return configured.replace(/\/+$/, '')
}
export function loadBackendConfig(
  environment: Record<string, string | undefined> = process.env,
  workingDirectory = process.cwd(),
): BackendConfig {
  const mode = parseEnvironment(environment.NODE_ENV)
  const host = environment.HOST?.trim() || '127.0.0.1'
  if (mode === 'production' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('HOST must use loopback in production so the TLS proxy owns public traffic')
  }

  let corsOrigins: readonly string[]
  if (environment.API_CORS_ORIGINS?.trim()) {
    corsOrigins = parseCorsOrigins(environment.API_CORS_ORIGINS)
  } else if (mode === 'production') {
    throw new Error('API_CORS_ORIGINS is required in production')
  } else {
    corsOrigins = DEVELOPMENT_ORIGINS
  }

  if (mode === 'production') {
    if (!corsOrigins.includes(PAGES_ORIGIN)) {
      throw new Error('API_CORS_ORIGINS must include ' + PAGES_ORIGIN)
    }
    if (corsOrigins.some((origin) => !origin.startsWith('https://'))) {
      throw new Error('Production API_CORS_ORIGINS entries must use HTTPS')
    }
  }

  const dataVersion = parseDataVersion(
    environment.NAVUS_DATA_VERSION ?? environment.GITHUB_SHA ?? LOCAL_DATA_VERSION,
  )
  if (mode === 'production' && dataVersion === LOCAL_DATA_VERSION) {
    throw new Error('NAVUS_DATA_VERSION must be the deployed source commit in production')
  }

  const dataPath = environment.NAVUS_DATA_DIR?.trim() || '../frontend/public/data'
  return Object.freeze({
    environment: mode,
    host,
    port: parsePort(environment.PORT),
    corsOrigins,
    dataVersion,
    dataDirectory: resolve(workingDirectory, dataPath),
    valhallaBaseUrl: parseValhallaBaseUrl(environment.VALHALLA_BASE_URL),
    journeyRequestTimeoutMs: parseInteger(
      environment.JOURNEY_REQUEST_TIMEOUT_MS,
      10_000,
      'JOURNEY_REQUEST_TIMEOUT_MS',
      100,
      60_000,
    ),
    liveData: Object.freeze({
      shuttleRefreshIntervalMs: parseInteger(
        environment.NUS_SHUTTLE_REFRESH_INTERVAL_MS,
        SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS,
        'NUS_SHUTTLE_REFRESH_INTERVAL_MS',
        1_000,
        300_000,
      ),
      requestTimeoutMs: parseInteger(
        environment.LIVE_DATA_REQUEST_TIMEOUT_MS,
        5_000,
        'LIVE_DATA_REQUEST_TIMEOUT_MS',
        250,
        60_000,
      ),
      maxConcurrency: parseInteger(
        environment.LIVE_DATA_MAX_CONCURRENCY,
        6,
        'LIVE_DATA_MAX_CONCURRENCY',
        1,
        16,
      ),
      retryAttempts: parseInteger(environment.LIVE_DATA_RETRY_ATTEMPTS, 1, 'LIVE_DATA_RETRY_ATTEMPTS', 0, 3),
      retryBaseDelayMs: parseInteger(environment.LIVE_DATA_RETRY_BASE_DELAY_MS, 200, 'LIVE_DATA_RETRY_BASE_DELAY_MS', 0, 5_000),
      nusProvider: parseNusProviderConfig(environment),
      ltaAccountKey: optionalText(environment, 'LTA_ACCOUNT_KEY'),
    }),
  })
}
