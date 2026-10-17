import type { BusRoute } from '@navus/shared/transit/types'
import type { BusPathLeg } from '@navus/shared/routing/path'

export function getBusPathLegStopIds(
  leg: Pick<BusPathLeg, 'routeId' | 'boardingStopId' | 'alightingStopId'>,
  route: BusRoute | null,
): readonly string[] | null {
  if (!route || route.id !== leg.routeId) return null

  // Search forward from boarding so a loop Route's repeated first stop resolves to its final visit.
  const boardingIndex = route.stopIds.indexOf(leg.boardingStopId)
  if (boardingIndex < 0) return null
  const alightingIndex = route.stopIds.indexOf(leg.alightingStopId, boardingIndex + 1)
  if (alightingIndex < 0) return null

  // The map highlights every ordered stop between this Path leg's boarding and alighting stops.
  return route.stopIds.slice(boardingIndex, alightingIndex + 1)
}
