import type { Path } from '../path.ts'
import { buildSearchIndex, buildSearchIndexSteps, SEARCH_INDEX_YIELD_CHECKPOINTS } from './build-path-search-index.ts'
import { enumerateCandidateDefinitions, resolveCandidate } from './enumerate-path-candidates.ts'
import { addCandidate, collectPathCandidates, collectRankedPathCandidates, createCollector } from './rank-path-candidates.ts'
import type { CandidateCollector, CandidateSearchState, PathCandidateSearchResult, PathSearchInput, PathSearchOptions, PathSearchResult, PathSearchStatus } from './path-search-types.ts'

export type {
  BusWaitingTimeContext,
  BusWaitingTimeProvider,
  PathCandidateSearchResult,
  PathSearchInput,
  PathSearchOptions,
  PathSearchResult,
  PathSearchStatus,
  PathWalkingConnection,
} from './path-search-types.ts'
export { MAX_BUS_PATH_CANDIDATES, MAX_PATH_ENDPOINT_STOP_CONNECTORS, zeroBusWaitingTime } from './path-search-types.ts'

function createPlanningResult(
  input: PathSearchInput,
  collector: CandidateCollector,
  status: PathSearchStatus,
  expandedPathCount: number,
  indexBuildDurationMs: number,
  candidateResolutionDurationMs: number,
  candidateEnumerationStepCount: number,
  searchDurationMs: number,
  searchYieldWaitMs: number,
  searchCpuMs: number,
  maxSearchChunkDurationMs: number,
  geometrySliceCount: number,
  geometrySliceDurationMs: number,
): PathSearchResult {
  const planningQuality = status === 'complete' ? 'exact' : 'bounded'
  const candidates = collectPathCandidates(input, collector, planningQuality)
  return {
    path: candidates[0]?.path ?? null,
    candidates,
    status,
    expandedPathCount,
    indexBuildDurationMs,
    candidateResolutionDurationMs,
    candidateEnumerationStepCount,
    searchDurationMs,
    searchYieldWaitMs,
    searchCpuMs,
    maxSearchChunkDurationMs,
    geometrySliceCount,
    geometrySliceDurationMs,
  }
}

export function searchPaths(input: PathSearchInput): Path | null {
  const index = buildSearchIndex(input)
  const collector = createCollector()
  for (const step of enumerateCandidateDefinitions(index)) {
    if (step.kind === 'candidate') {
      addCandidate(collector, resolveCandidate(input, index, step.definition))
    }
  }
  return createPlanningResult(input, collector, 'complete', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0).path
}

export async function searchPathsWithinBudget(
  input: PathSearchInput,
  options: PathSearchOptions = {},
): Promise<PathSearchResult> {
  const search = await runBoundedCandidateSearch(input, options)
  const planningQuality = search.status === 'complete' ? 'exact' : 'bounded'
  const candidates = collectPathCandidates(input, search.collector, planningQuality)
  return {
    path: candidates[0]?.path ?? null,
    candidates,
    status: search.status,
    expandedPathCount: search.expandedPathCount,
    indexBuildDurationMs: search.indexBuildDurationMs,
    candidateResolutionDurationMs: search.candidateResolutionDurationMs,
    candidateEnumerationStepCount: search.candidateEnumerationStepCount,
    searchDurationMs: search.searchDurationMs,
    searchYieldWaitMs: search.searchYieldWaitMs,
    searchCpuMs: search.searchCpuMs,
    maxSearchChunkDurationMs: search.maxSearchChunkDurationMs,
    geometrySliceCount: search.geometrySliceCount,
    geometrySliceDurationMs: search.geometrySliceDurationMs,
  }
}

export async function searchPathCandidatesWithinBudget(
  input: PathSearchInput,
  options: PathSearchOptions = {},
): Promise<PathCandidateSearchResult> {
  const search = await runBoundedCandidateSearch(input, options)
  return createSearchResult(input, search)
}

async function runBoundedCandidateSearch(
  input: PathSearchInput,
  options: PathSearchOptions,
): Promise<CandidateSearchState> {
  const now = options.now ?? Date.now
  const startedAt = now()
  const collector = createCollector()
  const yieldEvery = options.yieldEvery ?? (options.yieldControl ? 64 : 0)
  let expandedPathCount = 0
  let indexBuildDurationMs = 0
  let enumerationStepCount = 0
  let candidateResolutionDurationMs = 0
  let searchYieldWaitMs = 0
  let maxSearchChunkDurationMs = 0
  let searchChunkStartedAt = startedAt
  let getGeometryMetrics = () => ({ buildCount: 0, buildDurationMs: 0 })

  const createState = (status: PathSearchStatus): CandidateSearchState => {
    const geometryMetrics = getGeometryMetrics()
    const endedAt = now()
    const searchDurationMs = Math.max(0, endedAt - startedAt)
    return {
      collector,
      status,
      expandedPathCount,
      indexBuildDurationMs,
      candidateResolutionDurationMs,
      candidateEnumerationStepCount: enumerationStepCount,
      searchDurationMs,
      searchYieldWaitMs,
      searchCpuMs: Math.max(0, searchDurationMs - searchYieldWaitMs),
      maxSearchChunkDurationMs: Math.max(
        maxSearchChunkDurationMs,
        Math.max(0, endedAt - searchChunkStartedAt),
      ),
      geometrySliceCount: geometryMetrics.buildCount,
      geometrySliceDurationMs: geometryMetrics.buildDurationMs,
    }
  }

  if (options.shouldCancel?.()) {
    return createState('cancelled')
  }

  const indexBuildStartedAt = now()
  const exceededDuration = () => (
    (options.maxDurationMs !== undefined && now() - startedAt >= options.maxDurationMs) ||
    (options.deadlineAtMs !== undefined && now() >= options.deadlineAtMs)
  )
  const indexBuilder = buildSearchIndexSteps(input, now)
  let indexStep = indexBuilder.next()
  let indexCheckpointCount = 0
  const indexYieldEvery = Math.min(yieldEvery, SEARCH_INDEX_YIELD_CHECKPOINTS)
  while (!indexStep.done) {
    indexCheckpointCount += 1
    indexBuildDurationMs = Math.max(0, now() - indexBuildStartedAt)
    if (options.shouldCancel?.()) return createState('cancelled')
    if (exceededDuration()) return createState('budget-exceeded')

    if (
      yieldEvery > 0 &&
      options.yieldControl &&
      indexCheckpointCount % indexYieldEvery === 0 &&
      !options.shouldCancel?.()
    ) {
      const yieldStartedAt = now()
      maxSearchChunkDurationMs = Math.max(
        maxSearchChunkDurationMs,
        Math.max(0, yieldStartedAt - searchChunkStartedAt),
      )
      await options.yieldControl()
      searchYieldWaitMs += Math.max(0, now() - yieldStartedAt)
      searchChunkStartedAt = now()
      indexBuildDurationMs = Math.max(0, now() - indexBuildStartedAt)
      if (options.shouldCancel?.()) return createState('cancelled')
      if (exceededDuration()) return createState('budget-exceeded')
    }

    indexStep = indexBuilder.next()
  }
  const index = indexStep.value
  getGeometryMetrics = index.getRideGeometryMetrics
  indexBuildDurationMs = Math.max(0, now() - indexBuildStartedAt)
  if (options.shouldCancel?.()) return createState('cancelled')
  if (exceededDuration()) {
    return createState('budget-exceeded')
  }

  for (const step of enumerateCandidateDefinitions(index)) {
    if (options.shouldCancel?.()) {
      return createState('cancelled')
    }
    if (
      exceededDuration() ||
      (options.maxExpandedPaths !== undefined && expandedPathCount >= options.maxExpandedPaths)
    ) {
      return createState('budget-exceeded')
    }

    enumerationStepCount += 1
    if (step.kind === 'candidate') {
      const resolutionStartedAt = now()
      addCandidate(collector, resolveCandidate(input, index, step.definition))
      candidateResolutionDurationMs += now() - resolutionStartedAt
      expandedPathCount += 1
    }

    if (yieldEvery > 0 && enumerationStepCount % yieldEvery === 0 && !options.shouldCancel?.()) {
      const yieldStartedAt = now()
      maxSearchChunkDurationMs = Math.max(
        maxSearchChunkDurationMs,
        Math.max(0, yieldStartedAt - searchChunkStartedAt),
      )
      await options.yieldControl?.()
      searchYieldWaitMs += Math.max(0, now() - yieldStartedAt)
      searchChunkStartedAt = now()
    }
  }

  return createState('complete')
}

function createSearchResult(
  input: PathSearchInput,
  search: CandidateSearchState,
): PathCandidateSearchResult {
  return {
    rankedCandidates: collectRankedPathCandidates(
      input,
      search.collector,
      search.status === 'complete' ? 'exact' : 'bounded',
    ),
    status: search.status,
    expandedPathCount: search.expandedPathCount,
    indexBuildDurationMs: search.indexBuildDurationMs,
    candidateResolutionDurationMs: search.candidateResolutionDurationMs,
    candidateEnumerationStepCount: search.candidateEnumerationStepCount,
    searchDurationMs: search.searchDurationMs,
    searchYieldWaitMs: search.searchYieldWaitMs,
    searchCpuMs: search.searchCpuMs,
    maxSearchChunkDurationMs: search.maxSearchChunkDurationMs,
    geometrySliceCount: search.geometrySliceCount,
    geometrySliceDurationMs: search.geometrySliceDurationMs,
  }
}
