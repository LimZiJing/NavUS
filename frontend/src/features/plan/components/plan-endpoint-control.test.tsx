import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PlanContentHarness as PlanContent } from './plan-content-harness'
import { PlanEndpointControl } from './plan-endpoint-control'
import { buildBuildingIndex } from '../../../domain/venue/building-index'
import { createTransitIndex } from '../../../domain/transit'
import { createValidTransitNetwork } from '../../../domain/transit/test-fixtures'
import type { TransitStopInput } from '@navus/shared/transit/types'
import type { Path } from '@navus/shared/routing/path'
import type { ScoredPathCandidate } from '@navus/shared/routing/path'
import type { VenueLocationMap } from '@navus/shared/venue/types'

const venues: VenueLocationMap = {
  'COM1-0210': {
    roomName: 'Computing 1, Level 2',
    location: { x: 103.77, y: 1.3 },
  },
}

const stops: TransitStopInput[] = [
  {
    id: 'STOP-A',
    longName: 'Central Library',
    shortName: 'Library',
    latitude: 1.3,
    longitude: 103.77,
    services: ['A1'],
  },
]

const transitNetwork = createValidTransitNetwork()
transitNetwork.stops = [stops[0], transitNetwork.stops[1]]
const networkIndex = createTransitIndex(transitNetwork)
const buildings = buildBuildingIndex([{
  id: 'central-library',
  name: 'Central Library',
  aliases: [],
  elementId: 'way/2',
  location: { x: 103.773, y: 1.2966 },
  roomCodePrefixes: [],
  sourceRefs: [],
}])

describe('PlanEndpointControl', () => {
  it('shows the selected endpoint and a stable ID for a destination', () => {
    const markup = renderToStaticMarkup(
      <PlanEndpointControl
        role="destination"
        endpoint={{ kind: 'stop', id: 'STOP-A' }}
        venues={venues}
        networkIndex={networkIndex}
        searchQuery=""
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={vi.fn()}
      />,
    )

    expect(markup).toContain('Destination')
    expect(markup).toContain('STOP-A')
    expect(markup).toContain('aria-label="Clear destination"')
    expect(markup).toContain('id="trip-destination-search"')
  })

  it('lists a building by name with an accessible building label, apart from the stop of the same name', () => {
    const markup = renderToStaticMarkup(
      <PlanEndpointControl
        role="origin"
        endpoint={null}
        venues={venues}
        networkIndex={networkIndex}
        buildings={buildings}
        searchQuery="Library"
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="Set origin to Central Library, building"')
    expect(markup).toContain('aria-label="Set origin to Central Library, bus stop, STOP-A"')
    expect(markup).not.toContain('>central-library<')
  })

  it('shows the selected building by name', () => {
    const markup = renderToStaticMarkup(
      <PlanEndpointControl
        role="destination"
        endpoint={{ kind: 'building', id: 'central-library' }}
        venues={venues}
        networkIndex={networkIndex}
        buildings={buildings}
        searchQuery=""
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={vi.fn()}
      />,
    )

    expect(markup).toContain('value="Central Library"')
    expect(markup).toContain('Destination set to Central Library, building.')
    expect(markup).not.toContain('central-library)')
  })

  it('shows Current location without fabricating an endpoint identifier', () => {
    const markup = renderToStaticMarkup(
      <PlanEndpointControl
        role="origin"
        endpoint={{
          kind: 'current-location',
          coordinate: { longitude: 103.78, latitude: 1.29 },
        }}
        venues={venues}
        networkIndex={networkIndex}
        searchQuery=""
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={() => undefined}
      />,
    )

    expect(markup).toContain('value="Current location"')
    expect(markup).toContain('Origin set to Current location.')
    expect(markup).not.toContain('undefined')
  })

  it('uses the shared location search model and shows stable venue and stop IDs', () => {
    const venueMarkup = renderToStaticMarkup(
      <PlanEndpointControl
        role="origin"
        endpoint={null}
        venues={venues}
        networkIndex={networkIndex}
        searchQuery="COM1"
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={() => undefined}
      />,
    )
    const stopMarkup = renderToStaticMarkup(
      <PlanEndpointControl
        role="origin"
        endpoint={null}
        venues={venues}
        networkIndex={networkIndex}
        searchQuery="STOP-A"
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={() => undefined}
      />,
    )

    expect(venueMarkup).toContain('COM1-0210')
    expect(stopMarkup).toContain('STOP-A')
    expect(venueMarkup).toContain('Origin search results')
  })

  it('does not repeat a stop code in search results when the short name matches the ID', () => {
    const codeNetwork = createValidTransitNetwork()
    codeNetwork.stops = [{ ...stops[0], shortName: 'stop-a' }, codeNetwork.stops[1]]
    const markup = renderToStaticMarkup(
      <PlanEndpointControl
        role="origin"
        endpoint={null}
        venues={null}
        networkIndex={createTransitIndex(codeNetwork)}
        searchQuery="Central Library"
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={() => undefined}
      />,
    )

    expect(markup).toContain('<strong>STOP-A</strong>')
    expect(markup).toContain('<span>Central Library</span>')
    expect(markup).not.toContain('stop-a (STOP-A)')
    expect(markup).not.toContain('>stop-a<')
    expect(markup.match(/>STOP-A</g)).toHaveLength(1)
  })

  it('announces that location data is still loading when search data is unavailable', () => {
    const markup = renderToStaticMarkup(
      <PlanEndpointControl
        role="origin"
        endpoint={null}
        venues={null}
        networkIndex={null}
        searchQuery="COM1"
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={() => undefined}
      />,
    )

    expect(markup).toContain('Origin search is waiting for location data to load.')
  })

  it('searches stops and resolves a stop label when venue data is unavailable', () => {
    const markup = renderToStaticMarkup(
      <PlanEndpointControl
        role="origin"
        endpoint={{ kind: 'stop', id: 'STOP-A' }}
        venues={null}
        networkIndex={networkIndex}
        searchQuery="STOP-A"
        onSearchQueryChange={() => undefined}
        onSelect={() => undefined}
        onClear={() => undefined}
      />,
    )

    expect(markup).toContain('Central Library')
    expect(markup).toContain('STOP-A')
    expect(markup).toContain('Origin search results')
    expect(markup).not.toContain('waiting for location data')
  })
})

describe('Plan view Journey result', () => {
  it('shows the selected Journey inside the existing Plan trip experience', () => {
    const path: Path = {
      origin: { kind: 'venue', id: 'COM1-0210' },
      destination: { kind: 'stop', id: 'STOP-A' },
      legs: [{
        mode: 'walking',
        from: { kind: 'venue', id: 'COM1-0210' },
        to: { kind: 'stop', id: 'STOP-A' },
        durationSeconds: 60,
        distanceMeters: 100,
        geometry: { type: 'LineString', coordinates: [[103.77, 1.3], [103.771, 1.301]] },
      }],
      totalDurationSeconds: 60,
      totalDistanceMeters: 100,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }
    const candidate: ScoredPathCandidate = {
      candidateKey: 'walking:COM1-0210>STOP-A',
      path,
      adjustedDurationSeconds: 75,
      score: 1 / 75,
    }

    const markup = renderToStaticMarkup(
      <PlanContent
        tripRequest={{
          origin: { kind: 'venue', id: 'COM1-0210' },
          destination: { kind: 'stop', id: 'STOP-A' },
        }}
        venues={venues}
        networkIndex={networkIndex}
        path={{ status: 'ready', path, candidates: [candidate], error: null }}
        onSwap={() => undefined}
        onSelectOriginEndpoint={() => undefined}
        onClearOriginEndpoint={() => undefined}
        onSelectDestinationEndpoint={() => undefined}
        onClearDestinationEndpoint={() => undefined}
        onClearTrip={() => undefined}
        onPlanJourney={() => undefined}
      />,
    )

    expect(markup).toContain('Recommended')
    expect(markup).not.toMatch(/\b\d{2}:\d{2}\s*[–-]\s*\d{2}:\d{2}\b/)
    expect(markup).toContain('Walk')
  })
})
