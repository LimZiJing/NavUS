import type { LoadedTransitData } from '../../src/app/contracts/data.js'
import type { WalkingRouteEngine } from '../../../backend/src/pathfinding/walking/walking-contracts.js'
import type { ShuttleArrivalClient } from '../../src/app/contracts/shuttle-arrivals.js'
import type { ShuttleArrivalSnapshot } from '../../src/domain/transit/arrivals.js'
import type { Path } from '../../../backend/src/pathfinding/path.js'
import type { PathSearchInput } from '../../../backend/src/pathfinding/search/search-path-candidates.js'
import type { TripEndpoint } from '../../src/domain/trip/types.js'
import type { VenueLocationMap } from '@navus/shared/venue/types'
import type { WalkingStopGraph } from '@navus/shared/routing/walking-stop-graph'
import type { ShuttleServiceHoursClient } from '../../src/infrastructure/shuttle-service-hours/client.js'
import type { PathfindingBenchmarkGroup, PathfindingBenchmarkScenario, PathfindingBenchmarkTimingProfile } from './manifest.js'

export interface PathfindingBenchmarkExpectation {
  readonly outcome: 'path' | 'no-route'
  readonly shuttleBoardings?: number
  readonly modes?: readonly ('walking' | 'shuttle')[]
  readonly routeIds?: readonly string[]
}

export interface PathfindingBenchmarkDurationBounds {
  readonly min?: number
  readonly max?: number
}

export interface PathfindingBenchmarkCase {
  readonly id: string
  readonly label: string
  readonly origin: TripEndpoint
  readonly destination: TripEndpoint
  readonly arrivalSeconds: number
  readonly group?: PathfindingBenchmarkGroup
  readonly scenario?: PathfindingBenchmarkScenario
  readonly timingProfile?: PathfindingBenchmarkTimingProfile
  readonly arrivalRouteIds?: readonly string[]
  readonly arrivalSnapshot?: ShuttleArrivalSnapshot
  readonly transit?: LoadedTransitData
  readonly expected: PathfindingBenchmarkExpectation
  readonly durationBoundsSeconds?: PathfindingBenchmarkDurationBounds
  readonly searchInput: PathSearchInput
}

export type PathfindingBenchmarkOutcome =
  | {
    readonly kind: 'path'
    readonly path: Path
    readonly diagnostics?: Readonly<Record<string, number | string | boolean>>
  }
  | {
    readonly kind: 'no-route'
    readonly reason: string
    readonly diagnostics?: Readonly<Record<string, number | string | boolean>>
  }

export type PathfindingBenchmarkRunner = (
  signal: AbortSignal,
) => Promise<PathfindingBenchmarkOutcome>

export interface PathfindingBenchmarkContext {
  readonly transit: LoadedTransitData
  readonly venues: VenueLocationMap
  readonly walkingGraph: WalkingStopGraph
  readonly routeEngine: WalkingRouteEngine
  readonly now: () => number
  readonly createArrivalClient: (benchmarkCase: PathfindingBenchmarkCase) => ShuttleArrivalClient
  readonly createServiceHoursClient?: (benchmarkCase: PathfindingBenchmarkCase) => ShuttleServiceHoursClient
  readonly cases: readonly PathfindingBenchmarkCase[]
}

export interface PathfindingBenchmarkCaseContext extends PathfindingBenchmarkContext {
  readonly benchmarkCase: PathfindingBenchmarkCase
}

export interface PathfindingBenchmarkAdapter {
  readonly id: string
  readonly label: string
  createSearchRunner(context: PathfindingBenchmarkCaseContext):
    | PathfindingBenchmarkRunner
    | Promise<PathfindingBenchmarkRunner>
  createPathRunner(context: PathfindingBenchmarkCaseContext):
    | PathfindingBenchmarkRunner
    | Promise<PathfindingBenchmarkRunner>
  dispose?(): void | Promise<void>
}

export type PathfindingBenchmarkAdapterFactory = (
  context: PathfindingBenchmarkContext,
) => PathfindingBenchmarkAdapter | Promise<PathfindingBenchmarkAdapter>
