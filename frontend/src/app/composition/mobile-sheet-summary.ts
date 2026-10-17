import type { Path } from '@navus/shared/routing/path'
import { formatDuration } from '../../domain/trip/duration-format'
import type { TripRequest } from '../../domain/trip/types'
import type { ExploreState } from '../../features/explore/state/explore-state'
import type { JourneyState } from '../journey-state'

// One-line text shown on a collapsed mobile sheet so each tab says what it holds.
// Terms follow CONTEXT.md (Nearby, Journey).

interface StopsSummaryInput {
  readonly selectedStop?: { readonly longName: string } | null
  readonly stopListEntries?: readonly unknown[]
  readonly stopListLoading?: boolean
  readonly selectedStopList?: 'nearby' | 'favourites'
}

export function getStopsSheetSummary({
  selectedStop = null,
  stopListEntries = [],
  stopListLoading = false,
  selectedStopList = 'nearby',
}: StopsSummaryInput): string {
  if (selectedStop) return `Stops · ${selectedStop.longName}`
  if (stopListEntries.length === 0) {
    if (stopListLoading) return 'Stops · Finding nearby stops'
    return selectedStopList === 'favourites' ? 'Stops · No favourites yet' : 'Stops · No stops nearby'
  }
  if (selectedStopList === 'favourites') {
    return `Stops · ${stopListEntries.length} ${stopListEntries.length === 1 ? 'favourite' : 'favourites'}`
  }
  return `Stops · ${stopListEntries.length} nearby`
}

function describePath(path: Path): string {
  const duration = formatDuration(path.totalDurationSeconds)
  return path.legs.every((leg) => leg.mode === 'walking') ? `${duration} walk` : `${duration} Journey`
}

export function getPlanSheetSummary(
  tripRequest: TripRequest,
  journeyState: Pick<JourneyState, 'status' | 'path'> | undefined,
): string {
  const { origin, destination } = tripRequest
  if (!origin && !destination) return 'Plan trip · Choose origin and destination'
  if (!origin) return 'Plan trip · Choose an origin'
  if (!destination) return 'Plan trip · Choose a destination'

  switch (journeyState?.status) {
    case 'loading': return 'Plan trip · Planning your Journey'
    case 'no-route': return 'Plan trip · No Journey found'
    case 'failed': return 'Plan trip · Could not plan a Journey'
    case 'ready':
      return journeyState.path
        ? `Plan trip · ${describePath(journeyState.path)}`
        : 'Plan trip · Ready to plan'
    default: return 'Plan trip · Ready to plan'
  }
}

export function getExploreSheetSummary(
  state: Pick<ExploreState, 'mode' | 'selectedVenue' | 'selectedBuildingId'>,
  selectedRoute: { readonly id: string, readonly name: string } | null,
  selectedBuildingName?: string,
): string {
  if (state.mode === 'venue-detail' && state.selectedVenue) return `Explore · ${state.selectedVenue.code}`
  if (state.mode === 'venue-detail' && state.selectedBuildingId) {
    return `Explore · ${selectedBuildingName ?? 'Building'}`
  }
  if (state.mode === 'bus-routes') {
    return selectedRoute ? `Explore · Route ${selectedRoute.id}` : 'Explore · Bus routes'
  }
  return 'Explore · Search venues'
}
