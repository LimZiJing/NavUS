import type { ShuttleTimingData, ShuttleTimingRecord } from '@navus/shared/transit/timing'
import type { TransitGeoJsonPosition, BusRouteGeometry } from '@navus/shared/transit/types'
import type { TransitIndex } from '@navus/shared/transit/index'
import type { TripEndpoint } from '@navus/shared/routing/path'
import type { Path, PathEndpointLocation, PathGeometry, PathLeg, ScoredPathCandidate } from '../path.ts'

export interface PathWalkingConnection {
  readonly from: TripEndpoint
  readonly to: TripEndpoint
  readonly durationSeconds: number
  readonly distanceMeters: number
  readonly geometry: PathGeometry
}

export interface BusWaitingTimeContext {
  readonly routeId: string
  readonly boardingStopId: string
  readonly elapsedSeconds: number
}

export type BusWaitingTimeProvider = (
  record: ShuttleTimingRecord,
  context: BusWaitingTimeContext,
) => number | null

export const zeroBusWaitingTime: BusWaitingTimeProvider = () => 0

export interface PathSearchOptions {
  /** Search stops at the first limit reached; a budget-limited Path is marked bounded. */
  readonly maxDurationMs?: number
  /** Optional monotonic deadline shared with downstream candidate enrichment. */
  readonly deadlineAtMs?: number
  readonly maxExpandedPaths?: number
  readonly shouldCancel?: () => boolean
  readonly yieldEvery?: number
  readonly yieldControl?: () => Promise<void>
  readonly now?: () => number
}

/** Complete exhausts the supported connector/transfer space; it does not promise unbounded routing. */
export type PathSearchStatus = 'complete' | 'budget-exceeded' | 'cancelled'

export interface PathSearchResult {
  /** The highest-scoring candidate, retained for search callers that need one Path. */
  readonly path: Path | null
  /** Up to three distinct bus-inclusive Paths plus the highest-scoring walking-only Path. */
  readonly candidates: readonly ScoredPathCandidate[]
  readonly status: PathSearchStatus
  readonly expandedPathCount: number
  readonly indexBuildDurationMs: number
  readonly candidateResolutionDurationMs: number
  readonly candidateEnumerationStepCount: number
  /** Search wall time, including cooperative yields but excluding network and geometry enrichment. */
  readonly searchDurationMs: number
  /** Time spent yielding to the host event loop during search. */
  readonly searchYieldWaitMs: number
  /** Search wall time with cooperative yield wait removed. */
  readonly searchCpuMs: number
  /** Longest synchronous search slice between opportunities for host event processing. */
  readonly maxSearchChunkDurationMs: number
  readonly geometrySliceCount: number
  readonly geometrySliceDurationMs: number
}

export interface PathCandidateSearchResult {
  /** Ranked complete candidates considered by the bounded search for downstream geometry checks. */
  readonly rankedCandidates: readonly ScoredPathCandidate[]
  readonly status: PathSearchStatus
  readonly expandedPathCount: number
  readonly indexBuildDurationMs: number
  readonly candidateResolutionDurationMs: number
  readonly candidateEnumerationStepCount: number
  readonly searchDurationMs: number
  readonly searchYieldWaitMs: number
  readonly searchCpuMs: number
  readonly maxSearchChunkDurationMs: number
  readonly geometrySliceCount: number
  readonly geometrySliceDurationMs: number
}

export interface PathSearchInput {
  readonly origin: PathEndpointLocation
  readonly destination: PathEndpointLocation
  readonly transitIndex: TransitIndex
  readonly routeGeometry: BusRouteGeometry
  readonly shuttleTiming: ShuttleTimingData
  readonly walkingConnections: readonly PathWalkingConnection[]
  readonly getShuttleWaitingSeconds: BusWaitingTimeProvider
}

export interface ProjectedPoint {
  readonly segmentIndex: number
  readonly distanceAlongLine: number
  readonly distanceToLine: number
  readonly coordinate: TransitGeoJsonPosition
}

export interface WalkingConnector {
  readonly stopId: string
  readonly connection: PathWalkingConnection | null
}

export interface ShuttleRideDefinition {
  readonly routeId: string
  readonly fromStopId: string
  readonly toStopId: string
  /** Positions in the Route's stop order; a loop Route repeats its first stop id at the end. */
  readonly fromStopIndex: number
  readonly toStopIndex: number
  readonly traversedStopIds: ReadonlySet<string>
  readonly rideSeconds: number
  readonly record: ShuttleTimingRecord
  readonly geometryLine: readonly TransitGeoJsonPosition[]
}

export interface TransferOption {
  readonly connection: PathWalkingConnection
  readonly ride: ShuttleRideDefinition
  readonly destinationConnector: WalkingConnector
}

export interface PathSearchIndex {
  readonly originConnectors: readonly WalkingConnector[]
  readonly destinationConnectorByStopId: ReadonlyMap<string, WalkingConnector>
  readonly directWalkingConnections: readonly PathWalkingConnection[]
  readonly ridesByBoardingStopId: ReadonlyMap<string, readonly ShuttleRideDefinition[]>
  readonly transferOptionsByAlightingStopAndRoute: ReadonlyMap<
    string,
    ReadonlyMap<string, readonly TransferOption[]>
  >
  readonly getRideGeometry: (ride: ShuttleRideDefinition) => {
    readonly geometry: PathGeometry
    readonly distanceMeters: number
  } | null
  readonly getRideGeometryMetrics: () => {
    readonly buildCount: number
    readonly buildDurationMs: number
  }
}

export interface DirectWalkingCandidateDefinition {
  readonly kind: 'walking'
  readonly connection: PathWalkingConnection
}

export interface ShuttleCandidateDefinition {
  readonly kind: 'shuttle'
  readonly originConnector: WalkingConnector
  readonly rides: readonly [ShuttleRideDefinition] | readonly [ShuttleRideDefinition, ShuttleRideDefinition]
  readonly transferConnection?: PathWalkingConnection
  readonly destinationConnector: WalkingConnector
}

export type PathCandidateDefinition = DirectWalkingCandidateDefinition | ShuttleCandidateDefinition

export type CandidateEnumerationStep =
  | { readonly kind: 'work' }
  | { readonly kind: 'candidate'; readonly definition: PathCandidateDefinition }

export interface PathCandidate {
  readonly legs: readonly PathLeg[]
  readonly durationSeconds: number
  readonly distanceMeters: number
  readonly walkingDistanceMeters: number
  readonly shuttleBoardings: number
  readonly adjustedDurationSeconds: number
  readonly score: number
  readonly candidateKey: string
  readonly sequenceKey: string
}

export interface CandidateCollector {
  readonly busByKey: Map<string, PathCandidate>
  readonly walkingByKey: Map<string, PathCandidate>
}

// Keep endpoint fan-out bounded so a nearby venue cannot multiply the bus search without limit.
export const MAX_PATH_ENDPOINT_STOP_CONNECTORS = 5

export const MAX_BUS_PATH_CANDIDATES = 3

export interface CandidateSearchState {
  readonly collector: CandidateCollector
  readonly status: PathSearchStatus
  readonly expandedPathCount: number
  readonly indexBuildDurationMs: number
  readonly candidateResolutionDurationMs: number
  readonly candidateEnumerationStepCount: number
  readonly searchDurationMs: number
  readonly searchYieldWaitMs: number
  readonly searchCpuMs: number
  readonly maxSearchChunkDurationMs: number
  readonly geometrySliceCount: number
  readonly geometrySliceDurationMs: number
}
