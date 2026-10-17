import type { ApiJourneyPlanningRequest } from '@navus/shared/routing/path'

export class InvalidJourneyRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidJourneyRequestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEndpoint(value: unknown): ApiJourneyPlanningRequest['origin'] {
  if (!isRecord(value)) throw new InvalidJourneyRequestError('Each endpoint must be an object')
  if (value.kind === 'current-location') {
    if (Object.keys(value).sort().join(',') !== 'coordinate,kind' || !isRecord(value.coordinate) ||
      Object.keys(value.coordinate).sort().join(',') !== 'latitude,longitude') {
      throw new InvalidJourneyRequestError('Current location must contain only frozen coordinates')
    }
    const { longitude, latitude } = value.coordinate
    if (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new InvalidJourneyRequestError('Current location coordinates are invalid')
    }
    return { kind: 'current-location', coordinate: { longitude, latitude } }
  }

  if (value.kind !== 'venue' && value.kind !== 'building' && value.kind !== 'stop') {
    throw new InvalidJourneyRequestError('Endpoint kind is invalid')
  }
  if (Object.keys(value).sort().join(',') !== 'id,kind' || typeof value.id !== 'string' ||
    value.id.length === 0 || value.id.length > 128 || value.id.trim() !== value.id) {
    throw new InvalidJourneyRequestError('Canonical endpoints must contain only a valid ID')
  }
  return { kind: value.kind, id: value.id }
}

export function parseJourneyPlanningRequest(
  value: unknown,
  environment: 'development' | 'test' | 'production',
): ApiJourneyPlanningRequest {
  if (!isRecord(value) || !Object.hasOwn(value, 'origin') || !Object.hasOwn(value, 'destination')) {
    throw new InvalidJourneyRequestError('Origin and destination are required')
  }
  const allowedKeys = environment === 'development'
    ? ['destination', 'origin', 'simulatedDepartureMs']
    : ['destination', 'origin']
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) {
    throw new InvalidJourneyRequestError('Request contains unsupported fields')
  }
  const origin = parseEndpoint(value.origin)
  const destination = parseEndpoint(value.destination)
  if (!Object.hasOwn(value, 'simulatedDepartureMs')) return { origin, destination }

  const simulatedDepartureMs = value.simulatedDepartureMs
  if (environment !== 'development' || typeof simulatedDepartureMs !== 'number' ||
    !Number.isSafeInteger(simulatedDepartureMs) || simulatedDepartureMs < 0) {
    throw new InvalidJourneyRequestError('Simulated departure time is unavailable or invalid')
  }
  return { origin, destination, simulatedDepartureMs }
}
