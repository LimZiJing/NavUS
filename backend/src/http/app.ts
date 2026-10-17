import express, { type Express, type RequestHandler } from 'express'
import type { BackendConfig } from '../config.ts'
import type { BackendData } from '../canonical-data.ts'
import type { BackendLiveData } from '../live-data/runtime.ts'
import { registerHealthRoutes } from './routes/health.ts'
import { registerLiveDataRoutes } from './routes/live-data.ts'
import { registerJourneyRoutes } from './routes/journeys.ts'
import type { PathfindingService } from '../pathfinding/service.ts'
import { createApiErrorHandler, sendApiError } from './error-response.ts'

const BODY_LIMIT = '32kb'
const MAX_URL_LENGTH = 2048
const ALLOWED_METHODS = 'GET, HEAD, POST, OPTIONS'
const ALLOWED_HEADERS = new Set(['accept', 'content-type'])

function corsMiddleware(origins: readonly string[]): RequestHandler {
  const originSet = new Set(origins)

  return (request, response, next) => {
    const origin = request.get('origin')
    if (origin) {
      response.vary('Origin')
      if (!originSet.has(origin)) {
        sendApiError(response, 403, 'Origin is not allowed')
        return
      }
      response.setHeader('Access-Control-Allow-Origin', origin)
    }

    if (request.method === 'OPTIONS') {
      const requestedMethod = request.get('access-control-request-method')?.toUpperCase()
      if (requestedMethod && !['GET', 'HEAD', 'POST'].includes(requestedMethod)) {
        sendApiError(response, 403, 'Requested method is not allowed')
        return
      }

      const requestedHeaders = request.get('access-control-request-headers')
        ?.split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean) ?? []
      if (requestedHeaders.some((header) => !ALLOWED_HEADERS.has(header))) {
        sendApiError(response, 403, 'Requested headers are not allowed')
        return
      }

      response.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS)
      if (requestedHeaders.length > 0) {
        response.setHeader('Access-Control-Allow-Headers', requestedHeaders.join(', '))
      }
      response.setHeader('Access-Control-Max-Age', '600')
      response.status(204).end()
      return
    }

    next()
  }
}

export function createApp(
  config: Pick<BackendConfig, 'corsOrigins' | 'dataVersion'> & {
    readonly environment?: BackendConfig['environment']
    readonly journeyRequestTimeoutMs?: BackendConfig['journeyRequestTimeoutMs']
  },
  data: BackendData | null,
  liveData: BackendLiveData | null = null,
  planner: PathfindingService | null = null,
): Express {
  const app = express()
  app.disable('x-powered-by')
  // The API is loopback-bound behind a local TLS proxy in production; trust only that proxy hop for per-client limits.
  app.set('trust proxy', 'loopback')
  app.use('/api', (_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    next()
  })
  app.use('/api', corsMiddleware(config.corsOrigins))
  app.use('/api', (request, response, next) => {
    if (request.originalUrl.length > MAX_URL_LENGTH) {
      sendApiError(response, 414, 'Request URL is too long', 'invalid_request')
      return
    }
    next()
  })
  app.use('/api', express.json({ limit: BODY_LIMIT, strict: true }))

  registerHealthRoutes(app, config, data, liveData)
  registerLiveDataRoutes(app, data, liveData)
  registerJourneyRoutes(
    app,
    config.environment ?? 'production',
    planner,
    config.journeyRequestTimeoutMs,
  )

  app.use('/api', (_request, response) => {
    sendApiError(response, 404, 'API route not found', 'invalid_request')
  })
  app.use(createApiErrorHandler())
  return app
}
