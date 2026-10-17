import { describe, expect, it } from 'vitest'
import { createLiveBusWaitingTimeProvider } from '../../../backend/src/pathfinding/pipeline/apply-bus-waits'
import { evaluateShuttleService } from '../../src/domain/transit/service-hours'
import type { ShuttleTimingRecord } from '@navus/shared/transit/timing'
import { loadPathfindingBenchmarkManifest } from './manifest'
import {
  applyBenchmarkShuttleTimingProfile,
  createBenchmarkArrivalSnapshot,
  createBenchmarkServiceWindows,
} from './profiles'

const NOW = Date.parse('2026-10-01T00:00:00.000Z')
const ROUTES = [
  { id: 'P', stopIds: ['KV', 'UTOWN'] },
  { id: 'R1', stopIds: ['KV', 'UTOWN'] },
]

const RECORD: ShuttleTimingRecord = {
  routeId: 'P',
  fromStopId: 'KV',
  toStopId: 'UTOWN',
  status: 'estimated',
  rideSeconds: 500,
  rideSecondsLowerBound: 400,
  rideSecondsUpperBound: 600,
  waitingSeconds: null,
  source: 'test',
  method: 'test',
  methodVersion: 'test-v1',
  observedAt: null,
  geometryVerifiedAt: '2026-10-01',
  unavailableReason: null,
}

describe('Path benchmark timing profiles', () => {
  it('builds fresh, stale, headway, missing, and expired arrival snapshots', async () => {
    const { profiles } = await loadPathfindingBenchmarkManifest()
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
    const getWait = (profileId: string) => {
      const profile = profileById.get(profileId)
      if (!profile) throw new Error(`Missing profile ${profileId}`)
      const snapshot = createBenchmarkArrivalSnapshot(profile, ROUTES, ['P'], NOW)
      return createLiveBusWaitingTimeProvider(snapshot, NOW)(RECORD, {
        routeId: 'P',
        boardingStopId: 'KV',
        elapsedSeconds: 0,
      })
    }

    expect(getWait('fresh-30')).toBe(30)
    expect(getWait('stale-46')).toBeNull()
    expect(getWait('headway-only')).toBe(60)
    expect(getWait('no-arrivals')).toBeNull()
    expect(getWait('expired-arrivals')).toBeNull()
  })

  it('limits arrivals to the case route scope and marks unavailable ride timing', async () => {
    const { profiles } = await loadPathfindingBenchmarkManifest()
    const profile = profiles.find(({ id }) => id === 'invalid-shuttle-timing')
    if (!profile) throw new Error('Missing invalid timing profile')
    const snapshot = createBenchmarkArrivalSnapshot(profile, ROUTES, ['P'], NOW)
    const records = applyBenchmarkShuttleTimingProfile([RECORD], profile, ['P'])

    expect(snapshot.stops.KV).toHaveProperty('P')
    expect(snapshot.stops.KV).not.toHaveProperty('R1')
    expect(records[0]).toMatchObject({ status: 'unavailable', rideSeconds: null })
  })

  it('creates active, pre-service, and post-service windows at the fixed clock', async () => {
    const { profiles } = await loadPathfindingBenchmarkManifest()
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
    const status = (profileId: string) => {
      const profile = profileById.get(profileId)
      if (!profile) throw new Error(`Missing profile ${profileId}`)
      const windows = createBenchmarkServiceWindows(profile, NOW)(['P']).P ?? []
      return evaluateShuttleService(windows, new Date(NOW)).status
    }

    expect(status('fresh-30')).toBe('active')
    expect(status('pre-service')).toBe('before-start')
    expect(status('post-service')).toBe('after-end')
  })

  it('normalizes tie-case ride estimates to one fixed duration', async () => {
    const { profiles } = await loadPathfindingBenchmarkManifest()
    const profile = profiles.find(({ id }) => id === 'tie-equal-rides')
    if (!profile) throw new Error('Missing tie profile')

    expect(applyBenchmarkShuttleTimingProfile([RECORD], profile, ['P'])[0]).toMatchObject({
      rideSeconds: 1,
      rideSecondsLowerBound: 1,
      rideSecondsUpperBound: 1,
    })
  })
})
