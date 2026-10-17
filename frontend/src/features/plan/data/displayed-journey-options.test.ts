import { describe, expect, it } from 'vitest'
import type { Path } from '@navus/shared/routing/path'
import type { ScoredPathCandidate } from '@navus/shared/routing/path'
import { selectDisplayedJourneyOptions } from './displayed-journey-options'

const origin = { kind: 'stop', id: 'STOP-A' } as const
const destination = { kind: 'stop', id: 'STOP-B' } as const

function candidate(
  key: string,
  mode: 'walking' | 'shuttle',
  adjustedDurationSeconds: number,
): ScoredPathCandidate {
  const durationSeconds = mode === 'walking'
    ? adjustedDurationSeconds * 0.8
    : adjustedDurationSeconds
  const leg: Path['legs'][number] = mode === 'walking'
    ? {
        mode,
        from: origin,
        to: destination,
        durationSeconds,
        distanceMeters: 100,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1.001]] },
      }
    : {
        mode,
        from: origin,
        to: destination,
        durationSeconds,
        distanceMeters: 500,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.001, 1.001]] },
        routeId: key,
        boardingStopId: origin.id,
        alightingStopId: destination.id,
        waitingSeconds: 0,
        rideSeconds: durationSeconds,
      }
  const path: Path = {
    origin,
    destination,
    legs: [leg],
    totalDurationSeconds: durationSeconds,
    totalDistanceMeters: leg.distanceMeters,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }

  return {
    candidateKey: `${mode}:${key}`,
    path,
    adjustedDurationSeconds,
    score: adjustedDurationSeconds === 0 ? Number.POSITIVE_INFINITY : 1 / adjustedDurationSeconds,
  }
}

describe('selectJourneysForDisplay', () => {
  it('puts buses first unless walking is strictly more than 20% faster', () => {
    const busA = candidate('A1', 'shuttle', 190)
    const busB = candidate('B1', 'shuttle', 230)
    const busC = candidate('C1', 'shuttle', 280)
    const walking = candidate('walk', 'walking', 160)

    expect(selectDisplayedJourneyOptions([busA, walking, busB, busC]))
      .toEqual([busA, busB, busC, walking])
  })

  it('uses a strict adjusted-duration 20% boundary', () => {
    const busA = candidate('A1', 'shuttle', 200)
    const busB = candidate('B1', 'shuttle', 240)
    const busC = candidate('C1', 'shuttle', 280)
    const boundaryWalk = candidate('boundary', 'walking', 160)
    const fasterWalk = candidate('faster', 'walking', 159.9)

    expect(selectDisplayedJourneyOptions([boundaryWalk, busC, busA, busB]))
      .toEqual([busA, busB, busC, boundaryWalk])
    expect(selectDisplayedJourneyOptions([fasterWalk, busC, busA, busB]))
      .toEqual([fasterWalk, busA, busB, busC])
  })

  it('includes walking after all three bus candidates when it does not meet the strict threshold', () => {
    const busA = candidate('A1', 'shuttle', 200)
    const busB = candidate('B1', 'shuttle', 240)
    const busC = candidate('C1', 'shuttle', 280)
    const walking = candidate('walk', 'walking', 170)

    expect(selectDisplayedJourneyOptions([walking, busB, busA, busC]))
      .toEqual([busA, busB, busC, walking])
  })

  it('shows the fastest walking Journey alone when no bus candidate exists', () => {
    const slowerWalk = candidate('slower', 'walking', 180)
    const fasterWalk = candidate('faster', 'walking', 120)

    expect(selectDisplayedJourneyOptions([slowerWalk, fasterWalk])).toEqual([fasterWalk])
  })

  it('ranks equal adjusted-duration bus candidates deterministically', () => {
    const busB = candidate('B1', 'shuttle', 200)
    const busA = candidate('A1', 'shuttle', 200)

    expect(selectDisplayedJourneyOptions([busB, busA])).toEqual([busA, busB])
  })

  it('uses candidateKey for final ties when it differs from journey sequence order', () => {
    const sequenceFirst = { ...candidate('A1', 'shuttle', 200), candidateKey: 'z-candidate' }
    const candidateKeyFirst = { ...candidate('Z1', 'shuttle', 200), candidateKey: 'a-candidate' }

    expect(selectDisplayedJourneyOptions([sequenceFirst, candidateKeyFirst]))
      .toEqual([candidateKeyFirst, sequenceFirst])
  })

  it('filters incomplete or invalid candidates while keeping complete Journeys', () => {
    const complete = candidate('A1', 'shuttle', 200)
    const incomplete = {
      ...candidate('B1', 'shuttle', 210),
      path: {
        ...candidate('B1', 'shuttle', 210).path,
        legs: [{
          ...candidate('B1', 'shuttle', 210).path.legs[0]!,
          geometry: { type: 'LineString', coordinates: [[103, 1]] },
        }],
      },
    } as ScoredPathCandidate
    const invalid = {
      ...candidate('C1', 'shuttle', 220),
      path: { ...candidate('C1', 'shuttle', 220).path, legs: [] },
    }

    expect(selectDisplayedJourneyOptions([incomplete, invalid, complete])).toEqual([complete])
  })

  it('displays up to three distinct bus Journeys plus one walking Journey', () => {
    const buses = [
      candidate('A1', 'shuttle', 200),
      candidate('B1', 'shuttle', 210),
      candidate('C1', 'shuttle', 220),
      candidate('D1', 'shuttle', 230),
    ]
    const walking = candidate('walk', 'walking', 180)

    expect(selectDisplayedJourneyOptions([...buses, walking]))
      .toEqual([...buses.slice(0, 3), walking])
  })
})
