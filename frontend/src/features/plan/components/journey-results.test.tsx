// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createTransitIndex } from '../../../domain/transit'
import { createValidTransitNetwork } from '../../../domain/transit/test-fixtures'
import type { Path } from '@navus/shared/routing/path'
import type { ScoredPathCandidate } from '@navus/shared/routing/path'
import { buildBuildingIndex } from '../../../domain/venue/building-index'
import { getJourneyCompactSummary, getJourneyTimelineEntries } from '../data/journey-display-data'
import { JourneyResults } from './journey-results'

const network = createValidTransitNetwork()
network.routes[0].stopIds = ['STOP-A', 'STOP-MID', 'STOP-B']
network.stops.push({
  id: 'STOP-MID',
  longName: 'Middle Stop',
  shortName: 'MID',
  latitude: 1.05,
  longitude: 103.05,
  services: ['A1'],
  opposite: null,
})
const networkIndex = createTransitIndex(network)
const route = networkIndex.routes[0]
const boardingStopId = route.stopIds[0]
const alightingStopId = route.stopIds[2]

const path: Path = {
  origin: { kind: 'venue', id: 'ORIGIN' },
  destination: { kind: 'venue', id: 'DESTINATION' },
  legs: [
    {
      mode: 'walking',
      from: { kind: 'venue', id: 'ORIGIN' },
      to: { kind: 'stop', id: boardingStopId },
      durationSeconds: 90,
      distanceMeters: 120,
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.01, 1.01]] },
    },
    {
      mode: 'shuttle',
      from: { kind: 'stop', id: boardingStopId },
      to: { kind: 'stop', id: alightingStopId },
      durationSeconds: 300,
      distanceMeters: 2200,
      geometry: { type: 'LineString', coordinates: [[103.01, 1.01], [103.1, 1.1]] },
      routeId: route.id,
      boardingStopId,
      alightingStopId,
      waitingSeconds: 0,
      rideSeconds: 300,
    },
    {
      mode: 'walking',
      from: { kind: 'stop', id: alightingStopId },
      to: { kind: 'venue', id: 'DESTINATION' },
      durationSeconds: 180,
      distanceMeters: 250,
      geometry: { type: 'LineString', coordinates: [[103.1, 1.1], [103.2, 1.2]] },
    },
  ],
  totalDurationSeconds: 570,
  totalDistanceMeters: 2570,
  estimateStatus: 'estimated',
  planningQuality: 'exact',
}

function scoreJourney(candidatePath: Path, candidateKey = 'test-candidate'): ScoredPathCandidate {
  let busBoardings = 0
  let adjustedDurationSeconds = 0
  for (const leg of candidatePath.legs) {
    if (leg.mode === 'walking') {
      adjustedDurationSeconds += leg.durationSeconds / 0.8
    } else {
      adjustedDurationSeconds += leg.durationSeconds / (busBoardings > 0 ? 0.9 : 1)
      busBoardings += 1
    }
  }
  return {
    candidateKey,
    path: candidatePath,
    adjustedDurationSeconds,
    score: adjustedDurationSeconds === 0 ? Number.POSITIVE_INFINITY : 1 / adjustedDurationSeconds,
  }
}

const venues = {
  ORIGIN: { roomName: 'Origin venue', location: { x: 103, y: 1 } },
  DESTINATION: { roomName: 'Destination venue', location: { x: 103.1, y: 1.1 } },
}

function renderJourneyWithWaitingSeconds(waitingSeconds: number): string {
  const busLeg = path.legs[1]
  if (!busLeg || busLeg.mode !== 'shuttle') {
    throw new Error('Test journey is missing its bus leg')
  }

  return renderToStaticMarkup(
    <JourneyResults
      state={{
        status: 'ready',
        path: {
          ...path,
          legs: [
            path.legs[0],
            {
              ...busLeg,
              waitingSeconds,
              durationSeconds: waitingSeconds + busLeg.rideSeconds,
            },
            path.legs[2],
          ],
          totalDurationSeconds: path.totalDurationSeconds + waitingSeconds,
        },
        candidates: [scoreJourney({
          ...path,
          legs: [
            path.legs[0],
            {
              ...busLeg,
              waitingSeconds,
              durationSeconds: waitingSeconds + busLeg.rideSeconds,
            },
            path.legs[2],
          ],
          totalDurationSeconds: path.totalDurationSeconds + waitingSeconds,
        })],
        error: null,
      }}
      venues={venues}
      networkIndex={networkIndex}
    />,
  )
}

describe('JourneyResults', () => {
  it('shows the estimated Journey totals and ordered walking and bus details', () => {
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{ status: 'ready', path, candidates: [scoreJourney(path)], error: null }}
        venues={venues}
        networkIndex={networkIndex}
      />,
    )

    expect(markup).toContain('Recommended')
    expect(markup).not.toContain('Alternative 2')
    expect(markup).toContain('10 min')
    expect(markup).toContain('2.6 km')
    expect(markup).not.toMatch(/\b\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}\b/)
    expect(markup).toContain('Walk')
    expect(markup).toContain('journey-walking-icon')
    expect(markup).toContain(`>${route.name}<`)
    expect(markup).toContain('journey-bus-icon')
    expect(markup).toContain('journey-disclosure-chevron')
    expect(markup).toContain(`aria-label="${route.name}, show bus stops"`)
    expect(markup).toContain('journey-stop-marker')
    expect(markup).toContain('>MID</span>')
    expect(markup).not.toContain('Middle Stop')
    expect(markup).toContain(`--journey-route-color:${route.color}`)
    expect(markup).toContain('Wait Arriving now')
    expect(markup).toContain('Arriving now')
    expect(markup).toContain('Ride')
    expect(markup).toContain('Origin venue')
    expect(markup).toContain('Destination venue')
    expect(markup).toContain('location-identity-icon--venue')
    expect(markup).toContain('location-identity-icon--stop')
    expect(markup).toContain('aria-label="Origin venue, venue"')
    expect(markup).toContain('aria-label="Stop A, bus stop"')
    expect(markup).toContain('aria-label="MID, bus stop, code STOP-MID"')
    expect(markup).toContain('aria-label="Journey details"')
    expect(markup).not.toContain('Board')
    expect(markup).not.toContain('Alight')
    expect(markup).not.toContain('Stops:')
    expect(markup).not.toContain('journey-option-endpoint-arrow')
    expect(markup).toContain('Uses live arrivals where available.')
    expect(markup).not.toContain('not guaranteed arrival times')
  })

  it('does not show a walking-only travel-time disclaimer', () => {
    const walkingPath: Path = {
      origin: path.origin,
      destination: path.destination,
      legs: [{
        mode: 'walking',
        from: path.origin,
        to: path.destination,
        durationSeconds: 600,
        distanceMeters: 4200,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.2, 1.2]] },
      }],
      totalDurationSeconds: 600,
      totalDistanceMeters: 4200,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{ status: 'ready', path: walkingPath, candidates: [scoreJourney(walkingPath)], error: null }}
        venues={venues}
        networkIndex={networkIndex}
      />,
    )

    expect(markup).not.toContain('Travel times are estimates, not guaranteed arrival times.')
  })

  it('renders every Journey chosen from the candidate pool as an ordered Plan option', () => {
    const walkingAlternative: Path = {
      origin: path.origin,
      destination: path.destination,
      legs: [{
        mode: 'walking',
        from: path.origin,
        to: path.destination,
        durationSeconds: 600,
        distanceMeters: 4200,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.2, 1.2]] },
      }],
      totalDurationSeconds: 600,
      totalDistanceMeters: 4200,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{
          status: 'ready',
          path,
          candidates: [
            scoreJourney(walkingAlternative, 'walking-alternative'),
            scoreJourney(path, 'bus-recommendation'),
          ],
          error: null,
        }}
        venues={venues}
        networkIndex={networkIndex}
      />,
    )

    expect(markup).toContain('aria-label="Journey options"')
    expect(markup).toContain('Recommended')
    expect(markup).not.toContain('Alternative 2')
    expect(markup.match(/class="journey-option-summary"/g)).toHaveLength(2)
    expect(markup.match(/class="journey-result(?: journey-result-selected)?"/g)).toHaveLength(2)
  })

  it('renders recommendation and mode headers for each option without departure-arrival ranges', () => {
    const walkingPath: Path = {
      ...path,
      legs: [{
        mode: 'walking',
        from: path.origin,
        to: path.destination,
        durationSeconds: 600,
        distanceMeters: 4200,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.2, 1.2]] },
      }],
      totalDurationSeconds: 600,
      totalDistanceMeters: 4200,
    }
    const busLeg = path.legs.find((leg) => leg.mode === 'shuttle')
    if (!busLeg || busLeg.mode !== 'shuttle') {
      throw new Error('Test journey is missing its bus leg')
    }
    const transferPath: Path = {
      ...path,
      legs: [
        busLeg,
        {
          ...busLeg,
          from: busLeg.to,
          to: busLeg.from,
          boardingStopId: busLeg.alightingStopId,
          alightingStopId: busLeg.boardingStopId,
        },
      ],
      totalDurationSeconds: busLeg.durationSeconds * 2,
      totalDistanceMeters: busLeg.distanceMeters * 2,
    }
    const options = [
      scoreJourney(walkingPath, 'walking-recommendation'),
      scoreJourney(path, 'direct-bus'),
      scoreJourney(transferPath, 'one-transfer'),
      scoreJourney(walkingPath, 'walking-alternative'),
    ]
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{
          status: 'ready',
          path: walkingPath,
          candidates: options,
          displayedCandidates: options,
          selectedCandidateKey: 'walking-alternative',
          error: null,
        }}
        venues={venues}
        networkIndex={networkIndex}
      />,
    )

    const parsed = new DOMParser().parseFromString(markup, 'text/html')
    const [recommended, direct, transfer, walking] = Array.from(
      parsed.querySelectorAll('.journey-option-summary'),
    )
    expect(recommended?.querySelector('.journey-option-heading-recommended')?.textContent).toBe('Recommended')
    expect(recommended?.querySelector('.journey-option-heading-qualifier')?.textContent).toBe('Walking')
    expect(direct?.querySelector('.journey-option-heading-neutral')?.textContent).toBe('Direct bus')
    expect(transfer?.querySelector('.journey-option-heading-neutral')?.textContent).toBe('1 transfer')
    expect(walking?.querySelector('.journey-option-heading-neutral')?.textContent).toBe('Walking')
    expect(recommended?.getAttribute('aria-expanded')).toBe('false')
    expect(walking?.getAttribute('aria-expanded')).toBe('true')
    for (const option of [recommended, direct, transfer, walking]) {
      expect(option?.querySelector('.journey-option-times')).toBeNull()
      expect(option?.textContent).not.toMatch(/\b\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}\b/)
      expect(option?.querySelector('.journey-option-duration')).toBeTruthy()
      expect(option?.querySelector('.disclosure-chevron')).toBeTruthy()
      expect(option?.querySelector('.journey-option-summary-bottomline')).toBeTruthy()
    }
  })

  it('shows one accessible expanded option and keeps the first-ranked option in recommendation position', async () => {
    const walkingAlternative: Path = {
      origin: path.origin,
      destination: path.destination,
      legs: [{
        mode: 'walking',
        from: path.origin,
        to: path.destination,
        durationSeconds: 600,
        distanceMeters: 4200,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.2, 1.2]] },
      }],
      totalDurationSeconds: 600,
      totalDistanceMeters: 4200,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }
    const options = [
      scoreJourney(path, 'bus-recommendation'),
      scoreJourney(walkingAlternative, 'walking-alternative'),
    ]
    const onSelectCandidate = vi.fn()
    const user = userEvent.setup()
    const view = render(
      <JourneyResults
        state={{
          status: 'ready',
          path,
          candidates: options,
          displayedCandidates: options,
          selectedCandidateKey: 'bus-recommendation',
          error: null,
        }}
        venues={venues}
        networkIndex={networkIndex}
        onSelectCandidate={onSelectCandidate}
      />,
    )

    const [firstOptionButton, secondOptionButton] = screen.getAllByRole('button')
    expect(firstOptionButton.getAttribute('aria-expanded')).toBe('true')
    expect(secondOptionButton.getAttribute('aria-expanded')).toBe('false')
    expect(secondOptionButton.getAttribute('aria-controls')).toBe('journey-option-details-2')
    expect(firstOptionButton.textContent).toContain('Recommended')
    expect(firstOptionButton.textContent).not.toMatch(/\b\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}\b/)
    expect(firstOptionButton.textContent).not.toContain('Depart')
    expect(firstOptionButton.textContent).not.toContain('Arrive')
    expect(firstOptionButton.textContent).not.toContain('Origin venue')
    expect(firstOptionButton.textContent).not.toContain('Destination venue')
    expect(firstOptionButton.textContent).toContain('10 min')
    expect(firstOptionButton.textContent).toContain('Walk 5 min')
    const summaryBottomRow = firstOptionButton.querySelector('.journey-option-summary-bottomline')
    expect(summaryBottomRow?.children[0]?.classList.contains('journey-option-modes')).toBe(true)
    expect(summaryBottomRow?.children[1]?.classList.contains('journey-option-walking-total')).toBe(true)
    expect(firstOptionButton.getAttribute('aria-current')).toBe('true')
    expect(firstOptionButton.querySelector('.disclosure-chevron')?.getAttribute('data-expanded')).toBe('true')
    expect(secondOptionButton.querySelector('.disclosure-chevron')?.getAttribute('data-expanded')).toBe('false')
    expect(screen.getByRole('img', { name: /Journey modes: Walk, .* bus, Walk/ })).toBeTruthy()
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.getByText('Walking')).toBeTruthy()
    expect(screen.queryByText('Alternative 2')).toBeNull()
    expect(screen.queryByText('A faster route may exist')).toBeNull()

    await user.tab()
    expect(document.activeElement).toBe(firstOptionButton)
    await user.keyboard('{Enter}')
    expect(onSelectCandidate).toHaveBeenCalledWith('bus-recommendation')
    await user.tab()
    // The expanded timeline's accessible stop disclosure comes before the next option.
    await user.tab()
    expect(document.activeElement).toBe(secondOptionButton)
    await user.keyboard(' ')
    expect(onSelectCandidate).toHaveBeenLastCalledWith('walking-alternative')
    await user.click(secondOptionButton)
    expect(onSelectCandidate).toHaveBeenLastCalledWith('walking-alternative')

    view.rerender(
      <JourneyResults
        state={{
          status: 'ready',
          path,
          candidates: options,
          displayedCandidates: options,
          selectedCandidateKey: 'walking-alternative',
          error: null,
        }}
        venues={venues}
        networkIndex={networkIndex}
        onSelectCandidate={onSelectCandidate}
      />,
    )

    const [firstOptionButtonAfterSelection, selectedAlternative] = screen.getAllByRole('button')
    expect(firstOptionButtonAfterSelection.getAttribute('aria-expanded')).toBe('false')
    expect(selectedAlternative.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('list', { name: 'Journey 2 details' })).toBeTruthy()
    await user.click(selectedAlternative)
    expect(onSelectCandidate).toHaveBeenLastCalledWith('walking-alternative')
    expect(selectedAlternative.getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps the first-ranked option aligned with the map Journey when candidate keys break a sequence tie', () => {
    const withRouteId = (routeId: string): Path => ({
      ...path,
      legs: path.legs.map((leg) => leg.mode === 'shuttle' ? { ...leg, routeId } : leg),
    })
    const mapJourney = withRouteId('ZZZ')
    const sequenceFirst = scoreJourney(withRouteId('AAA'), 'z-candidate')
    const mapCandidate = scoreJourney(mapJourney, 'a-candidate')
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{
          status: 'ready',
          path: mapJourney,
          candidates: [sequenceFirst, mapCandidate],
          error: null,
        }}
        venues={venues}
        networkIndex={networkIndex}
      />,
    )
    const firstOption = markup.indexOf('<li class="journey-results-item"')
    const secondOption = markup.indexOf('<li class="journey-results-item"', firstOption + 1)
    const firstRankedMarkup = markup.slice(firstOption, secondOption)

    expect(firstRankedMarkup).toContain('id="journey-option-summary-1" type="button"')
    expect(firstRankedMarkup).toContain('aria-expanded="true" aria-current="true"')
    expect(firstRankedMarkup).toContain('<span>ZZZ</span>')
    expect(markup.slice(secondOption)).toContain('<span>AAA</span>')
  })

  it('flattens each Journey into one ordered timeline without repeating locations', () => {
    const entries = getJourneyTimelineEntries(path, venues, networkIndex)

    expect(entries.map((entry) => entry.kind)).toEqual([
      'location',
      'walking',
      'location',
      'bus',
      'location',
      'walking',
      'location',
    ])
    expect(entries.filter((entry) => entry.kind === 'location')).toHaveLength(4)
    expect(entries.filter((entry) => entry.kind === 'location').map((entry) => entry.locationKind))
      .toEqual(['venue', 'stop', 'stop', 'venue'])
    expect(entries.find((entry) => entry.kind === 'bus')).toMatchObject({
      routeColor: route.color,
      intermediateStops: [{ id: 'STOP-MID', label: 'MID' }],
    })
  })

  it('names a building endpoint in the timeline and keeps it distinct from a stop', () => {
    const buildings = buildBuildingIndex([{
      id: 'com3',
      name: 'COM3',
      aliases: [],
      elementId: 'way/1',
      location: { x: 103.775, y: 1.295 },
      roomCodePrefixes: [],
      sourceRefs: [],
    }])
    const buildingPath: Path = { ...path, origin: { kind: 'building', id: 'com3' } }

    const [first] = getJourneyTimelineEntries(buildingPath, venues, networkIndex, buildings)

    expect(first).toMatchObject({ kind: 'location', label: 'COM3', locationKind: 'building' })
  })

  it('keeps a venue and bus stop distinct when their journey names match', () => {
    const collidingVenues = {
      ...venues,
      ORIGIN: { ...venues.ORIGIN, roomName: 'COM 3' },
    }
    const collidingNetwork = createValidTransitNetwork()
    collidingNetwork.stops[0] = {
      ...collidingNetwork.stops[0],
      longName: 'COM 3',
      shortName: 'COM 3',
    }
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{ status: 'ready', path, candidates: [scoreJourney(path)], error: null }}
        venues={collidingVenues}
        networkIndex={createTransitIndex(collidingNetwork)}
      />,
    )

    expect(markup).toContain('aria-label="COM 3, venue"')
    expect(markup).toContain('aria-label="COM 3, bus stop"')
  })

  it('summarizes ordered modes, canonical route labels, and total walking duration', () => {
    expect(getJourneyCompactSummary(path, networkIndex)).toEqual({
      walkingDurationLabel: '5 min',
      modeSegments: [
        { kind: 'walking' },
        { kind: 'bus', routeLabel: route.name, routeColor: route.color },
        { kind: 'walking' },
      ],
    })
  })

  it('explains when the Journey was selected within a search budget', () => {
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{
          status: 'ready',
          path: { ...path, planningQuality: 'bounded' },
          candidates: [scoreJourney({ ...path, planningQuality: 'bounded' })],
          error: null,
        }}
        venues={venues}
        networkIndex={networkIndex}
      />,
    )

    expect(markup).toContain('A faster route may exist')
    expect(markup).not.toContain('Fastest estimated Journey')
  })

  it('leaves the detailed simulation notice to PlanContent', () => {
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{ status: 'ready', path, candidates: [scoreJourney(path)], error: null }}
        venues={venues}
        networkIndex={networkIndex}
        simulated
      />,
    )

    expect(markup).not.toContain('simulated route')
    expect(markup).toContain('Journey options')
  })

  it.each([
    [0, 'Arriving now'],
    [29, 'Arriving now'],
    [60, '1 min'],
    [119, '2 min'],
  ])('uses threshold wording for a %s-second wait', (waitingSeconds, expected) => {
    const markup = renderJourneyWithWaitingSeconds(waitingSeconds)

    expect(markup).toContain(`Wait ${expected}`)
  })

  it.each([
    ['loading', 'Calculating recommended Journey…'],
    ['no-route', 'No complete estimated Journey is available'],
    ['failed', 'Journey calculation is unavailable right now'],
  ] as const)('announces the %s state', (status, message) => {
    const markup = renderToStaticMarkup(
      <JourneyResults
        state={{
          status,
          path: null,
          candidates: [],
          error: status === 'failed' ? 'Unable to plan journey' : null,
        }}
        venues={venues}
        networkIndex={networkIndex}
      />,
    )

    expect(markup).toContain(message)
    expect(markup).toContain('role="status"')
  })
})
