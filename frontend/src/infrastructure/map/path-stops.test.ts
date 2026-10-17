import { describe, expect, it } from 'vitest'
import type { BusRoute } from '@navus/shared/transit/types'
import type { BusPathLeg } from '@navus/shared/routing/path'
import { getBusPathLegStopIds } from './path-stops'

const route: BusRoute = {
  id: 'A1',
  name: 'A1',
  color: '#123456',
  stopIds: ['STOP-A', 'STOP-MIDDLE', 'STOP-B', 'STOP-AFTER'],
}

function createShuttleLeg(
  boardingStopId: string,
  alightingStopId: string,
): Pick<BusPathLeg, 'routeId' | 'boardingStopId' | 'alightingStopId'> {
  return {
    routeId: 'A1',
    boardingStopId,
    alightingStopId,
  }
}

describe('getBusPathLegStopIds', () => {
  it('returns the inclusive ordered stop segment for a bus leg', () => {
    expect(getBusPathLegStopIds(
      createShuttleLeg('STOP-A', 'STOP-B'),
      route,
    )).toEqual(['STOP-A', 'STOP-MIDDLE', 'STOP-B'])
  })

  it('resolves a ride ending at a repeated first stop of a loop Route forward', () => {
    const loopRoute: BusRoute = { ...route, stopIds: ['STOP-A', 'STOP-MIDDLE', 'STOP-B', 'STOP-AFTER', 'STOP-A'] }

    expect(getBusPathLegStopIds(
      createShuttleLeg('STOP-B', 'STOP-A'),
      loopRoute,
    )).toEqual(['STOP-B', 'STOP-AFTER', 'STOP-A'])
  })

  it('returns null when the Route or forward ordered segment cannot be resolved', () => {
    expect(getBusPathLegStopIds(createShuttleLeg('STOP-A', 'STOP-B'), null)).toBeNull()
    expect(getBusPathLegStopIds(createShuttleLeg('STOP-B', 'STOP-A'), route)).toBeNull()
    expect(getBusPathLegStopIds({
      ...createShuttleLeg('STOP-A', 'STOP-B'),
      routeId: 'B1',
    }, route)).toBeNull()
  })
})
