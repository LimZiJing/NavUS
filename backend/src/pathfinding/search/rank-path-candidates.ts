import { getTripEndpointKey } from '../endpoints.ts'
import type { BusPathLeg, Path, PathLeg, PathQuality, ScoredPathCandidate } from '../path.ts'
import { MAX_BUS_PATH_CANDIDATES, type CandidateCollector, type PathCandidate, type PathSearchInput } from './path-search-types.ts'

function compareText(first: string, second: string): number {
  if (first < second) return -1
  if (first > second) return 1
  return 0
}

function shuttleCandidateKey(legs: readonly PathLeg[]): string {
  return 'bus:' + legs
    .filter((leg): leg is BusPathLeg => leg.mode === 'shuttle')
    .map((leg) => `${leg.routeId}:${leg.boardingStopId}>${leg.alightingStopId}`)
    .join('|')
}

function candidateSequenceKey(legs: readonly PathLeg[]): string {
  return legs.map((leg) => leg.mode === 'shuttle'
    ? `shuttle:${leg.routeId}:${leg.boardingStopId}>${leg.alightingStopId}`
    : `walking:${getTripEndpointKey(leg.from)}>${getTripEndpointKey(leg.to)}`)
    .join('|')
}

export function createCandidate(legs: readonly PathLeg[]): PathCandidate {
  const durationSeconds = legs.reduce((total, leg) => total + leg.durationSeconds, 0)
  const distanceMeters = legs.reduce((total, leg) => total + leg.distanceMeters, 0)
  const walkingDistanceMeters = legs.reduce(
    (total, leg) => total + (leg.mode === 'walking' ? leg.distanceMeters : 0),
    0,
  )
  let shuttleBoardings = 0
  let adjustedDurationSeconds = 0
  // These policy weights also drive Plan's 80% walking-first threshold; keep both in sync.
  for (const leg of legs) {
    if (leg.mode === 'walking') {
      adjustedDurationSeconds += leg.durationSeconds / 0.8
    } else if (leg.mode === 'shuttle') {
      adjustedDurationSeconds += leg.durationSeconds / (shuttleBoardings > 0 ? 0.9 : 1)
      shuttleBoardings += 1
    }
  }
  const candidateKey = shuttleBoardings > 0
    ? shuttleCandidateKey(legs)
    : `walking:${candidateSequenceKey(legs)}`
  return {
    legs,
    durationSeconds,
    distanceMeters,
    walkingDistanceMeters,
    shuttleBoardings,
    adjustedDurationSeconds,
    score: adjustedDurationSeconds === 0 ? Number.POSITIVE_INFINITY : 1 / adjustedDurationSeconds,
    candidateKey,
    sequenceKey: candidateSequenceKey(legs),
  }
}

function compareCandidates(first: PathCandidate, second: PathCandidate): number {
  return first.adjustedDurationSeconds - second.adjustedDurationSeconds ||
    first.shuttleBoardings - second.shuttleBoardings ||
    first.walkingDistanceMeters - second.walkingDistanceMeters ||
    first.legs.length - second.legs.length ||
    compareText(first.sequenceKey, second.sequenceKey)
}

export function addCandidate(collector: CandidateCollector, candidate: PathCandidate | null): void {
  if (!candidate) return
  if (candidate.shuttleBoardings === 0) {
    const current = collector.walkingByKey.get(candidate.candidateKey)
    if (!current || compareCandidates(candidate, current) < 0) {
      collector.walkingByKey.set(candidate.candidateKey, candidate)
    }
    return
  }

  const current = collector.busByKey.get(candidate.candidateKey)
  if (!current || compareCandidates(candidate, current) < 0) {
    collector.busByKey.set(candidate.candidateKey, candidate)
  }
}

function toPath(
  input: PathSearchInput,
  candidate: PathCandidate,
  planningQuality: PathQuality,
): Path {
  return {
    origin: input.origin.endpoint,
    destination: input.destination.endpoint,
    legs: candidate.legs,
    totalDurationSeconds: candidate.durationSeconds,
    totalDistanceMeters: candidate.distanceMeters,
    estimateStatus: 'estimated',
    planningQuality,
  }
}

export function collectPathCandidates(
  input: PathSearchInput,
  collector: CandidateCollector,
  planningQuality: PathQuality,
): readonly ScoredPathCandidate[] {
  const topBusCandidates = [...collector.busByKey.values()]
    .sort(compareCandidates)
    .slice(0, MAX_BUS_PATH_CANDIDATES)
  const walkingCandidate = [...collector.walkingByKey.values()]
    .sort(compareCandidates)[0]
  const candidates = [
    ...topBusCandidates,
    ...(walkingCandidate ? [walkingCandidate] : []),
  ].sort(compareCandidates)
  return toScoredPathCandidates(input, candidates, planningQuality)
}

export function collectRankedPathCandidates(
  input: PathSearchInput,
  collector: CandidateCollector,
  planningQuality: PathQuality,
): readonly ScoredPathCandidate[] {
  const candidates = [
    ...collector.busByKey.values(),
    ...collector.walkingByKey.values(),
  ].sort(compareCandidates)
  return toScoredPathCandidates(input, candidates, planningQuality)
}

function toScoredPathCandidates(
  input: PathSearchInput,
  candidates: readonly PathCandidate[],
  planningQuality: PathQuality,
): readonly ScoredPathCandidate[] {
  return candidates.map((candidate) => ({
    candidateKey: candidate.candidateKey,
    path: toPath(input, candidate, planningQuality),
    adjustedDurationSeconds: candidate.adjustedDurationSeconds,
    score: candidate.score,
  }))
}

export function createCollector(): CandidateCollector {
  return { busByKey: new Map(), walkingByKey: new Map() }
}
