import type {
  ApiJourneyPlanningResponse,
  Path,
  PathGeometry,
  PathLeg,
  ScoredPathCandidate,
  TripEndpoint,
} from './path.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCoordinate(value: unknown): boolean {
  return isRecord(value) && typeof value.longitude === 'number' && Number.isFinite(value.longitude) &&
    value.longitude >= -180 && value.longitude <= 180 &&
    typeof value.latitude === 'number' && Number.isFinite(value.latitude) &&
    value.latitude >= -90 && value.latitude <= 90
}

function isEndpoint(value: unknown): value is TripEndpoint {
  if (!isRecord(value)) return false
  if (value.kind === 'current-location') return isCoordinate(value.coordinate)
  return (value.kind === 'venue' || value.kind === 'building' || value.kind === 'stop') &&
    typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128 && value.id.trim() === value.id
}

function isGeometry(value: unknown): value is PathGeometry {
  return isRecord(value) && value.type === 'LineString' && Array.isArray(value.coordinates) &&
    value.coordinates.length >= 2 && value.coordinates.every((position) => (
      Array.isArray(position) && position.length === 2 &&
      typeof position[0] === 'number' && Number.isFinite(position[0]) &&
      position[0] >= -180 && position[0] <= 180 &&
      typeof position[1] === 'number' && Number.isFinite(position[1]) &&
      position[1] >= -90 && position[1] <= 90
    ))
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isPathLeg(value: unknown): value is PathLeg {
  if (!isRecord(value) || !isEndpoint(value.from) || !isEndpoint(value.to) ||
    !isNonNegativeNumber(value.durationSeconds) || !isNonNegativeNumber(value.distanceMeters) ||
    !isGeometry(value.geometry)) return false

  if (value.mode === 'walking') return true
  return value.mode === 'shuttle' &&
    typeof value.routeId === 'string' && value.routeId.length > 0 &&
    typeof value.boardingStopId === 'string' && value.boardingStopId.length > 0 &&
    typeof value.alightingStopId === 'string' && value.alightingStopId.length > 0 &&
    isNonNegativeNumber(value.waitingSeconds) && isNonNegativeNumber(value.rideSeconds)
}

function isPath(value: unknown): value is Path {
  return isRecord(value) && isEndpoint(value.origin) && isEndpoint(value.destination) &&
    Array.isArray(value.legs) && value.legs.length > 0 && value.legs.every(isPathLeg) &&
    isNonNegativeNumber(value.totalDurationSeconds) && isNonNegativeNumber(value.totalDistanceMeters) &&
    value.estimateStatus === 'estimated' &&
    (value.planningQuality === 'exact' || value.planningQuality === 'bounded')
}

function parseCandidate(value: unknown): ScoredPathCandidate | null {
  if (!isRecord(value) || typeof value.candidateKey !== 'string' || value.candidateKey.length === 0 ||
    !isPath(value.path) || !isNonNegativeNumber(value.adjustedDurationSeconds)) return null

  // JSON serializes the planner's positive-Infinity score as null for a zero-duration Path.
  const score = value.score === null && value.adjustedDurationSeconds === 0 ? Number.POSITIVE_INFINITY : value.score
  if (typeof score !== 'number' || Number.isNaN(score) || score < 0) return null
  return {
    candidateKey: value.candidateKey,
    path: value.path,
    adjustedDurationSeconds: value.adjustedDurationSeconds,
    score,
  }
}

/** Validate and normalize the complete server result before UI consumers use its geometry. */
export function parseApiJourneyPlanningResponse(value: unknown): ApiJourneyPlanningResponse | null {
  if (!isRecord(value)) return null
  if (value.outcome === 'no-path') {
    if (value.message !== undefined && typeof value.message !== 'string') return null
    return value.message === undefined
      ? { outcome: 'no-path' }
      : { outcome: 'no-path', message: value.message }
  }
  if (value.outcome !== 'paths' || !Array.isArray(value.candidates) ||
    (value.searchStatus !== 'complete' && value.searchStatus !== 'budget-exceeded')) return null
  const candidates: ScoredPathCandidate[] = []
  for (const candidate of value.candidates) {
    const parsed = parseCandidate(candidate)
    if (!parsed) return null
    candidates.push(parsed)
  }
  return { outcome: 'paths', candidates, searchStatus: value.searchStatus }
}
