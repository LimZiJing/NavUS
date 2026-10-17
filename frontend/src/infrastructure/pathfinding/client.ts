import type {
  ApiJourneyPlanningError,
  ApiJourneyPlanningRequest,
  ApiJourneyPlanningResponse,
} from '@navus/shared/routing/path'
import { parseApiJourneyPlanningResponse } from '@navus/shared/routing/validation'
import { buildApiUrl } from '../api/api-url.ts'

export interface JourneyPlanningClientOptions {
  readonly endpoint?: string
  readonly apiOrigin?: string
  readonly fetcher?: typeof fetch
  readonly getSimulatedDepartureMs?: () => number | null
}

export type JourneyPlanningClient = (
  request: ApiJourneyPlanningRequest,
  context: { readonly signal: AbortSignal },
) => Promise<ApiJourneyPlanningResponse>

export class JourneyPlanningRequestError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'JourneyPlanningRequestError'
    this.status = status
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseError(response: Response): Promise<JourneyPlanningRequestError> {
  let body: ApiJourneyPlanningError | null = null
  try {
    const value: unknown = await response.json()
    if (isRecord(value) && typeof value.error === 'string') {
      const code = value.code
      body = {
        error: value.error,
        ...(code === 'invalid_request' || code === 'not_ready' || code === 'provider_unavailable' || code === 'rate_limited'
          ? { code }
          : {}),
      }
    }
  } catch {
    // Preserve a stable error when the server's error body cannot be read.
  }
  return new JourneyPlanningRequestError(
    response.status,
    body?.error ?? 'Journey planning request failed',
    body?.code,
  )
}

/** Sends endpoint identities only; the backend resolves all canonical data and routing geometry. */
export function createJourneyPlanningClient(
  options: JourneyPlanningClientOptions = {},
): JourneyPlanningClient {
  const endpoint = options.endpoint ?? buildApiUrl('/api/journeys', options.apiOrigin)
  const fetcher = options.fetcher ?? fetch

  return async (request, context) => {
    const simulatedDepartureMs = options.getSimulatedDepartureMs?.()
    const body: ApiJourneyPlanningRequest = simulatedDepartureMs === null || simulatedDepartureMs === undefined
      ? { origin: request.origin, destination: request.destination }
      : { origin: request.origin, destination: request.destination, simulatedDepartureMs }

    let response: Response
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: context.signal,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new JourneyPlanningRequestError(0, 'Journey planning request failed')
    }

    if (!response.ok) throw await parseError(response)
    try {
      const value: unknown = await response.json()
      const parsed = parseApiJourneyPlanningResponse(value)
      if (!parsed) {
        throw new Error('Journey planning response was invalid')
      }
      return parsed
    } catch (error) {
      if (error instanceof JourneyPlanningRequestError) throw error
      throw new JourneyPlanningRequestError(response.status, 'Journey planning response was invalid')
    }
  }
}
