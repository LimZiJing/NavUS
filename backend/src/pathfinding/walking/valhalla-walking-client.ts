import type {
  RoutingCoordinate,
  WalkingMatrixConnection,
  WalkingRoute,
  WalkingRouteEngine,
} from './walking-contracts.ts'

interface ValhallaRouteEngineOptions {
  readonly baseUrl: string
  readonly fetcher?: typeof fetch
}

interface JsonRecord {
  readonly [key: string]: unknown
}

interface ValhallaRequestLocation {
  readonly lat: number
  readonly lon: number
}

export class ValhallaRouteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValhallaRouteError'
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function requireCoordinate(value: RoutingCoordinate, label: string): ValhallaRequestLocation {
  if (
    !isFiniteNumber(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    !isFiniteNumber(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90
  ) {
    throw new ValhallaRouteError(`${label} has invalid coordinates`)
  }

  return { lat: value.latitude, lon: value.longitude }
}

function requireLocations(
  locations: readonly RoutingCoordinate[],
  label: string,
): ValhallaRequestLocation[] {
  if (locations.length === 0) {
    throw new ValhallaRouteError(`${label} must not be empty`)
  }
  return locations.map((location, index) => requireCoordinate(location, `${label}[${index}]`))
}

function requireNonNegativeMetric(value: unknown, label: string): number {
  if (!isFiniteNumber(value) || value < 0) {
    throw new ValhallaRouteError(`Valhalla route response has invalid ${label}`)
  }
  return value
}

function requireKilometerUnits(value: unknown, label: string): void {
  if (value !== undefined && value !== 'kilometers') {
    throw new ValhallaRouteError(`Valhalla ${label} must use kilometre units`)
  }
}

function roundMetric(value: number): number {
  return Math.round(value)
}

function requireJsonRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new ValhallaRouteError(`Valhalla route response has invalid ${label}`)
  return value
}

function decodePolylineComponent(value: string, index: { current: number }): number {
  let result = 0
  let shift = 0
  while (true) {
    if (index.current >= value.length || shift > 30) {
      throw new ValhallaRouteError('Valhalla route response has invalid geometry')
    }
    const byte = value.charCodeAt(index.current) - 63
    index.current += 1
    result |= (byte & 0x1f) << shift
    if (byte < 0x20) break
    shift += 5
  }
  return (result & 1) === 1 ? ~(result >> 1) : result >> 1
}

function decodeEncodedPolyline(value: string): WalkingRoute['geometry'] {
  const index = { current: 0 }
  const coordinates: (readonly [number, number])[] = []
  let latitude = 0
  let longitude = 0

  while (index.current < value.length) {
    latitude += decodePolylineComponent(value, index)
    longitude += decodePolylineComponent(value, index)
    coordinates.push([longitude / 1_000_000, latitude / 1_000_000])
  }

  if (coordinates.length < 2) {
    throw new ValhallaRouteError('Valhalla route response has invalid geometry')
  }
  return { type: 'LineString', coordinates }
}

function requireLineString(value: unknown): WalkingRoute['geometry'] {
  if (typeof value === 'string') return decodeEncodedPolyline(value)
  const geometry = requireJsonRecord(value, 'geometry')
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
    throw new ValhallaRouteError('Valhalla route response has invalid geometry')
  }

  const coordinates = geometry.coordinates.map((coordinate) => {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      !isFiniteNumber(coordinate[0]) ||
      !isFiniteNumber(coordinate[1]) ||
      coordinate[0] < -180 ||
      coordinate[0] > 180 ||
      coordinate[1] < -90 ||
      coordinate[1] > 90
    ) {
      throw new ValhallaRouteError('Valhalla route response has invalid geometry')
    }
    return [coordinate[0], coordinate[1]] as const
  })

  if (coordinates.length < 2) {
    throw new ValhallaRouteError('Valhalla route response has invalid geometry')
  }

  return { type: 'LineString', coordinates }
}

function requireRouteGeometry(trip: JsonRecord): WalkingRoute['geometry'] {
  if (!Array.isArray(trip.legs) || trip.legs.length === 0) {
    throw new ValhallaRouteError('Valhalla route response has no legs')
  }

  const coordinates: (readonly [number, number])[] = []
  for (const legValue of trip.legs) {
    const leg = requireJsonRecord(legValue, 'leg')
    const geometry = requireLineString(leg.shape)
    const legCoordinates = geometry.coordinates
    const startIndex = coordinates.length > 0 ? 1 : 0
    coordinates.push(...legCoordinates.slice(startIndex))
  }

  return { type: 'LineString', coordinates }
}

function requireRouteResult(payload: unknown): WalkingRoute {
  // Decode and validate provider-specific fields here so the rest of Pathfinding sees only normalized values.
  const response = requireJsonRecord(payload, 'payload')
  const trip = requireJsonRecord(response.trip, 'trip')
  requireKilometerUnits(trip.units, 'route response')
  const summary = requireJsonRecord(trip.summary, 'summary')
  const distanceKilometers = requireNonNegativeMetric(summary.length, 'summary distance')
  const durationSeconds = requireNonNegativeMetric(summary.time, 'summary duration')

  return {
    distanceMeters: roundMetric(distanceKilometers * 1000),
    durationSeconds: roundMetric(durationSeconds),
    geometry: requireRouteGeometry(trip),
  }
}

function requireMatrixResults(
  payload: unknown,
  sourceCount: number,
  targetCount: number,
): readonly WalkingMatrixConnection[] {
  // Valhalla reports kilometre distances and matrix indexes; normalize both at this boundary.
  const response = requireJsonRecord(payload, 'payload')
  requireKilometerUnits(response.units, 'matrix response')
  if (!Array.isArray(response.sources_to_targets)) {
    throw new ValhallaRouteError('Valhalla matrix response has invalid connections')
  }

  const rawConnections = response.sources_to_targets.every(Array.isArray)
    ? response.sources_to_targets.flat()
    : response.sources_to_targets
  const connections: WalkingMatrixConnection[] = []
  for (const value of rawConnections) {
    const connection = requireJsonRecord(value, 'matrix connection')
    const fromIndex = connection.from_index
    const toIndex = connection.to_index
    if (
      typeof fromIndex !== 'number' || !Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= sourceCount ||
      typeof toIndex !== 'number' || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= targetCount
    ) {
      throw new ValhallaRouteError('Valhalla matrix response has invalid connection indexes')
    }

    if (connection.distance === null || connection.time === null) continue

    const distanceKilometers = requireNonNegativeMetric(connection.distance, 'matrix distance')
    const durationSeconds = requireNonNegativeMetric(connection.time, 'matrix duration')
    connections.push({
      fromIndex,
      toIndex,
      distanceMeters: roundMetric(distanceKilometers * 1000),
      durationSeconds: roundMetric(durationSeconds),
    })
  }

  return connections
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === 'AbortError'
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.length === 0) throw new ValhallaRouteError('Valhalla base URL is required')
  return normalized
}

async function requestJson(
  fetcher: typeof fetch,
  url: string,
  body: unknown,
  signal: AbortSignal,
  resourceName: string,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new ValhallaRouteError(`Valhalla ${resourceName} request failed`)
  }

  if (!response.ok) {
    throw new ValhallaRouteError(`Valhalla ${resourceName} request failed: ${response.status}`)
  }

  try {
    return await response.json() as unknown
  } catch {
    throw new ValhallaRouteError(`Valhalla ${resourceName} response was not valid JSON`)
  }
}

export function createValhallaRouteEngine(
  options: ValhallaRouteEngineOptions,
): WalkingRouteEngine {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetcher = options.fetcher ?? fetch

  return {
    async routeWalking(request, signal) {
      const payload = await requestJson(
        fetcher,
        `${baseUrl}/route`,
        {
          locations: [
            { ...requireCoordinate(request.origin, 'Origin'), type: 'break' },
            { ...requireCoordinate(request.destination, 'Destination'), type: 'break' },
          ],
          costing: 'pedestrian',
          directions_type: 'none',
          directions_options: { narrative: false, units: 'kilometers' },
          shape_format: 'geojson',
        },
        signal,
        'route',
      )
      return requireRouteResult(payload)
    },

    async matrixWalking(request, signal) {
      const sources = requireLocations(request.sources, 'Sources')
      const targets = requireLocations(request.targets, 'Targets')
      const payload = await requestJson(
        fetcher,
        `${baseUrl}/sources_to_targets`,
        {
          sources,
          targets,
          costing: 'pedestrian',
          units: 'kilometers',
          verbose: true,
        },
        signal,
        'matrix',
      )
      return requireMatrixResults(payload, sources.length, targets.length)
    },
  }
}
