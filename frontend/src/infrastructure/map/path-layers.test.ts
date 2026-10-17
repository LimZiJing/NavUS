// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Map } from 'maplibre-gl'
import type { Path } from '@navus/shared/routing/path'
import { createTransitIndex } from '../../domain/transit'
import {
  createTransferTransitNetwork,
} from '../../domain/transit/test-fixtures'
import {
  createPathLayers as createJourneyRouteLayers,
  JOURNEY_ROUTE_SOURCE_ID,
  JOURNEY_ALTERNATIVE_CASING_LAYER_ID,
  JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID,
  JOURNEY_ALTERNATIVE_WALKING_LAYER_ID,
  JOURNEY_SELECTED_CASING_LAYER_ID,
  JOURNEY_SELECTED_DIRECTION_LAYER_ID,
  JOURNEY_SELECTED_SHUTTLE_LAYER_ID,
  JOURNEY_SELECTED_WALKING_LAYER_ID,
} from './path-layers'

const markerState = vi.hoisted(() => ({ markers: [] as Array<{
  element: HTMLElement
  coordinate: unknown
  offset: number[] | undefined
  removed: boolean
}> }))

vi.mock('maplibre-gl', () => {
  class FakeMarker {
    readonly element: HTMLElement
    readonly offset: number[] | undefined
    coordinate: unknown = null
    removed = false

    constructor(options: { element: HTMLElement; offset?: number[] }) {
      this.element = options.element
      this.offset = options.offset
    }

    setLngLat(coordinate: unknown) {
      this.coordinate = coordinate
      return this
    }

    addTo(map?: { failDurationMarkerAt?: number }) {
      markerState.markers.push(this)
      if (markerState.markers.length === map?.failDurationMarkerAt) {
        throw new Error('Unable to add duration marker')
      }
      return this
    }

    remove() {
      this.removed = true
    }
  }

  return { Marker: FakeMarker }
})

function createFakeMap(failingLayerId?: string): {
  readonly map: Map
  readonly sources: globalThis.Map<string, unknown>
  readonly layers: Set<string>
  readonly images: Set<string>
  readonly addedSources: Array<{ id: string; source: unknown }>
  readonly addedLayers: Array<Record<string, unknown>>
  readonly removedSources: string[]
  readonly removedLayers: string[]
  readonly filters: Array<{ id: string; filter: unknown }>
  readonly paintProperties: Array<{ id: string; name: string; value: unknown }>
  readonly eventHandlers: globalThis.Map<string, Set<(event: unknown) => void>>
  readonly setRenderedFeatures: (features: readonly unknown[]) => void
  readonly sourceData: globalThis.Map<string, {
    data: unknown
    setData: ReturnType<typeof vi.fn>
  }>
} {
  const sources = new globalThis.Map<string, unknown>()
  const layers = new Set<string>()
  const images = new Set<string>()
  const addedSources: Array<{ id: string; source: unknown }> = []
  const addedLayers: Array<Record<string, unknown>> = []
  const removedSources: string[] = []
  const removedLayers: string[] = []
  const filters: Array<{ id: string; filter: unknown }> = []
  const paintProperties: Array<{ id: string; name: string; value: unknown }> = []
  const eventHandlers = new globalThis.Map<string, Set<(event: unknown) => void>>()
  let renderedFeatures: readonly unknown[] = []
  const sourceData = new globalThis.Map<string, { data: unknown; setData: ReturnType<typeof vi.fn> }>()
  const map = {
    getSource: vi.fn((id: string) => sources.get(id)),
    getLayer: vi.fn((id: string) => layers.has(id) ? {} : undefined),
    addSource: vi.fn((id: string, source: { data: unknown }) => {
      const installedSource = {
        data: source.data,
        setData: vi.fn((data: unknown) => {
          installedSource.data = data
        }),
      }
      sources.set(id, installedSource)
      sourceData.set(id, installedSource)
      addedSources.push({ id, source })
    }),
    addLayer: vi.fn((layer: Record<string, unknown>) => {
      const id = String(layer.id)
      if (layer.id === failingLayerId) throw new Error(`Unable to add ${layer.id}`)
      layers.add(id)
      addedLayers.push(layer)
    }),
    removeSource: vi.fn((id: string) => {
      sources.delete(id)
      sourceData.delete(id)
      removedSources.push(id)
    }),
    removeLayer: vi.fn((id: string) => {
      layers.delete(id)
      removedLayers.push(id)
    }),
    hasImage: vi.fn((id: string) => images.has(id)),
    addImage: vi.fn((id: string) => {
      images.add(id)
    }),
    removeImage: vi.fn((id: string) => {
      images.delete(id)
    }),
    setFilter: vi.fn((id: string, filter: unknown) => filters.push({ id, filter })),
    setPaintProperty: vi.fn((id: string, name: string, value: unknown) => (
      paintProperties.push({ id, name, value })
    )),
    setLayoutProperty: vi.fn(),
    on: vi.fn((type: string, handler: (event: unknown) => void) => {
      const handlers = eventHandlers.get(type) ?? new Set()
      handlers.add(handler)
      eventHandlers.set(type, handlers)
    }),
    off: vi.fn((type: string, handler: (event: unknown) => void) => {
      eventHandlers.get(type)?.delete(handler)
    }),
    queryRenderedFeatures: vi.fn(() => renderedFeatures),
  } as unknown as Map

  return {
    map,
    sources,
    layers,
    images,
    addedSources,
    addedLayers,
    removedSources,
    removedLayers,
    filters,
    paintProperties,
    eventHandlers,
    setRenderedFeatures: (features) => { renderedFeatures = features },
    sourceData,
  }
}

function createPath(routeId: string): Path {
  return {
    origin: { kind: 'venue', id: 'ORIGIN' },
    destination: { kind: 'venue', id: 'DESTINATION' },
    legs: [
      {
        mode: 'walking',
        from: { kind: 'venue', id: 'ORIGIN' },
        to: { kind: 'stop', id: 'STOP-A' },
        durationSeconds: 60,
        distanceMeters: 80,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.01, 1.01]] },
      },
      {
        mode: 'shuttle',
        from: { kind: 'stop', id: 'STOP-A' },
        to: { kind: 'stop', id: 'STOP-B' },
        durationSeconds: 120,
        distanceMeters: 900,
        geometry: { type: 'LineString', coordinates: [[103.01, 1.01], [103.1, 1.1]] },
        routeId,
        boardingStopId: 'STOP-A',
        alightingStopId: 'STOP-B',
        waitingSeconds: 0,
        rideSeconds: 120,
      },
    ],
    totalDurationSeconds: 180,
    totalDistanceMeters: 980,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }
}

describe('journey route layer adapter', () => {
  beforeEach(() => {
    markerState.markers.length = 0
  })

  it('renders every option with selected emphasis, dashed walks, and an offset duration label', () => {
    const state = createFakeMap()
    const index = createTransitIndex(createTransferTransitNetwork())
    const layers = createJourneyRouteLayers(state.map, index)
    const options = [
      { candidateKey: 'option-1', path: createPath('A1') },
      { candidateKey: 'option-2', path: createPath('B1') },
      { candidateKey: 'option-3', path: createPath('A1') },
      { candidateKey: 'option-4', path: createPath('B1') },
    ]

    layers.setJourneyOptions(options, 'option-2')

    expect(state.addedSources).toHaveLength(1)
    expect(state.addedLayers.map(({ id }) => id)).toEqual(expect.arrayContaining([
      JOURNEY_ALTERNATIVE_CASING_LAYER_ID,
      JOURNEY_ALTERNATIVE_WALKING_LAYER_ID,
      JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID,
      JOURNEY_SELECTED_CASING_LAYER_ID,
      JOURNEY_SELECTED_WALKING_LAYER_ID,
      JOURNEY_SELECTED_SHUTTLE_LAYER_ID,
      JOURNEY_SELECTED_DIRECTION_LAYER_ID,
    ]))
    expect(state.addedLayers).toHaveLength(7)
    expect(state.addedLayers.at(-1)?.id).toBe(JOURNEY_SELECTED_DIRECTION_LAYER_ID)
    expect(state.sources.has(JOURNEY_ROUTE_SOURCE_ID)).toBe(true)
    const features = (state.sourceData.get(JOURNEY_ROUTE_SOURCE_ID)?.data as {
      features: Array<{ properties: Record<string, unknown>; geometry: { type: string } }>
    }).features
    expect(features).toHaveLength(8)
    expect(features).toEqual(expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          candidateKey: 'option-1',
          mode: 'walking',
          routeId: null,
        }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({
          candidateKey: 'option-2',
          mode: 'shuttle',
          routeId: 'B1',
          routeColor: '#654321',
        }),
      }),
    ]))
    expect(features.every(({ properties }) => properties.featureKind === 'route')).toBe(true)

    const layerById = new globalThis.Map(state.addedLayers.map((layer) => [layer.id, layer]))
    expect(layerById.get(JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID)).toMatchObject({
      paint: { 'line-color': '#64748b' },
    })
    expect(layerById.get(JOURNEY_SELECTED_SHUTTLE_LAYER_ID)).toMatchObject({
      paint: { 'line-color': ['coalesce', ['get', 'routeColor'], '#d97706'] },
    })
    expect(layerById.get(JOURNEY_ALTERNATIVE_WALKING_LAYER_ID)).toMatchObject({
      paint: { 'line-color': '#94a3b8', 'line-dasharray': [1, 1.5] },
    })
    expect(layerById.get(JOURNEY_SELECTED_WALKING_LAYER_ID)).toMatchObject({
      paint: { 'line-color': '#2563eb', 'line-dasharray': [1, 1.5] },
    })
    expect(layerById.get(JOURNEY_SELECTED_CASING_LAYER_ID)).toMatchObject({
      paint: { 'line-color': '#ffffff' },
    })
    const labelMarkers = markerState.markers.slice(0, 4)
    expect(labelMarkers.map(({ element }) => element.textContent)).toEqual([
      '3 min', '3 min', '3 min', '3 min',
    ])
    expect(labelMarkers.map(({ element }) => element.getAttribute('aria-label'))).toEqual([
      'Select journey option 1, 3 min',
      'Select journey option 2, 3 min',
      'Select journey option 3, 3 min',
      'Select journey option 4, 3 min',
    ])
    expect(labelMarkers.map(({ offset }) => offset)).toEqual([
      [0, -48], [0, -16], [0, 16], [0, 48],
    ])
    expect(labelMarkers.map(({ element }) => element.style.zIndex)).toEqual(['4', '4', '4', '4'])
    expect(labelMarkers.every(({ element }) => element.tagName === 'BUTTON')).toBe(true)
    expect(labelMarkers[1]?.element.classList.contains('journey-duration-marker-selected')).toBe(true)
    expect(labelMarkers[0]?.element.classList.contains('journey-duration-marker-alternative')).toBe(true)
    expect(labelMarkers[0]?.element.getAttribute('aria-pressed')).toBe('false')
    expect(JSON.stringify(
      state.filters.find(({ id }) => id === JOURNEY_SELECTED_SHUTTLE_LAYER_ID)?.filter,
    )).toContain('"option-2"')

    const installedSource = state.sourceData.get(JOURNEY_ROUTE_SOURCE_ID)
    layers.setJourneyOptions(options, 'option-3')
    expect(state.addedSources).toHaveLength(1)
    expect(installedSource?.setData).not.toHaveBeenCalled()
    expect(markerState.markers.slice(0, 4)).toEqual(labelMarkers)
    expect(labelMarkers.every(({ removed }) => !removed)).toBe(true)
    expect(labelMarkers[2]?.element.classList.contains('journey-duration-marker-selected')).toBe(true)
    expect(state.removedLayers).toEqual([])
    expect(state.removedSources).toEqual([])
    expect(state.filters.at(-1)).toMatchObject({ id: JOURNEY_SELECTED_DIRECTION_LAYER_ID })

    const changedOptions = options.map((option) => ({
      ...option,
      path: { ...option.path, totalDurationSeconds: option.path.totalDurationSeconds + 60 },
    }))
    layers.setJourneyOptions(changedOptions, 'option-3')
    expect(labelMarkers.every(({ removed }) => removed)).toBe(true)
    expect(markerState.markers).toHaveLength(8)
    expect(markerState.markers.slice(4).map(({ element }) => element.textContent)).toEqual([
      '4 min', '4 min', '4 min', '4 min',
    ])

    layers.setJourneyOptions([], null)
    expect(markerState.markers.slice(4).every(({ removed }) => removed)).toBe(true)
    expect(state.removedLayers).toHaveLength(state.addedLayers.length)
    expect(state.removedSources).toEqual([
      JOURNEY_ROUTE_SOURCE_ID,
    ])

    layers.dispose()
    layers.dispose()
    markerState.markers[4]?.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    layers.setJourneyOptions(options, 'option-1')
    expect(state.addedSources).toHaveLength(1)
    expect(state.removedSources).toEqual([JOURNEY_ROUTE_SOURCE_ID])
    expect(state.eventHandlers.get('click')?.size).toBe(0)
  })

  it('selects duration labels and resolves shared route hits to selected or highest-ranked options', () => {
    const state = createFakeMap()
    const onJourneyOptionSelected = vi.fn()
    const layers = createJourneyRouteLayers(state.map, null, onJourneyOptionSelected)
    const options = [
      { candidateKey: 'option-1', path: createPath('A1') },
      { candidateKey: 'option-2', path: createPath('B1') },
      { candidateKey: 'option-3', path: createPath('A1') },
    ]
    layers.setJourneyOptions(options, 'option-2')

    markerState.markers[2]?.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onJourneyOptionSelected).toHaveBeenLastCalledWith('option-3')

    state.setRenderedFeatures([
      { properties: { candidateKey: 'option-3' } },
      { properties: { candidateKey: 'option-1' } },
    ])
    for (const handler of state.eventHandlers.get('click') ?? []) {
      handler({ point: { x: 1, y: 1 }, originalEvent: new MouseEvent('click') })
    }
    expect(onJourneyOptionSelected).toHaveBeenLastCalledWith('option-1')

    layers.setJourneyOptions(options, 'option-3')
    for (const handler of state.eventHandlers.get('click') ?? []) {
      handler({ point: { x: 1, y: 1 }, originalEvent: new MouseEvent('click') })
    }
    expect(onJourneyOptionSelected).toHaveBeenLastCalledWith('option-3')
    layers.dispose()
    markerState.markers[2]?.element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onJourneyOptionSelected).toHaveBeenCalledTimes(3)
    expect(state.eventHandlers.get('click')?.size).toBe(0)
  })

  it('uses each canonical route color for bus legs in a Journey', () => {
    const index = createTransitIndex(createTransferTransitNetwork())
    const state = createFakeMap()
    const layers = createJourneyRouteLayers(state.map, index)
    const path: Path = {
      origin: { kind: 'stop', id: 'STOP-A' },
      destination: { kind: 'stop', id: 'STOP-C' },
      legs: [
        {
          mode: 'shuttle',
          from: { kind: 'stop', id: 'STOP-A' },
          to: { kind: 'stop', id: 'STOP-B' },
          durationSeconds: 120,
          distanceMeters: 900,
          geometry: { type: 'LineString', coordinates: [[103, 1], [103.1, 1.1]] },
          routeId: 'A1',
          boardingStopId: 'STOP-A',
          alightingStopId: 'STOP-B',
          waitingSeconds: 0,
          rideSeconds: 120,
        },
        {
          mode: 'shuttle',
          from: { kind: 'stop', id: 'STOP-B' },
          to: { kind: 'stop', id: 'STOP-C' },
          durationSeconds: 180,
          distanceMeters: 1000,
          geometry: { type: 'LineString', coordinates: [[103.1, 1.1], [103.2, 1.2]] },
          routeId: 'B1',
          boardingStopId: 'STOP-B',
          alightingStopId: 'STOP-C',
          waitingSeconds: 0,
          rideSeconds: 180,
        },
      ],
      totalDurationSeconds: 300,
      totalDistanceMeters: 1900,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }

    layers.setJourneyOptions([{ candidateKey: 'transfer', path }], 'transfer')

    expect((state.addedSources[0].source as { data: { features: Array<{ properties: unknown }> } }).data.features
      .filter((feature) => (feature.properties as { featureKind?: string }).featureKind === 'route'))
      .toMatchObject([
        { properties: { routeId: 'A1', routeColor: '#123456' } },
        { properties: { routeId: 'B1', routeColor: '#654321' } },
      ])
  })

  it('cleans up a partial installation when a layer cannot be added', () => {
    const state = createFakeMap(JOURNEY_SELECTED_WALKING_LAYER_ID)
    const layers = createJourneyRouteLayers(state.map, null)

    expect(() => layers.setJourneyOptions([
      { candidateKey: 'option-1', path: createPath('A1') },
    ], 'option-1'))
      .toThrow(`Unable to add ${JOURNEY_SELECTED_WALKING_LAYER_ID}`)
    expect(state.sources.size).toBe(0)
    expect(state.layers.size).toBe(0)
    expect(state.images.size).toBe(0)
    expect(state.removedLayers).toContain(JOURNEY_ALTERNATIVE_CASING_LAYER_ID)
    expect(state.removedSources).toEqual([JOURNEY_ROUTE_SOURCE_ID])
  })

  it('adds a lane-offset shuttle with a direction chevron layer for the selected journey only', () => {
    const state = createFakeMap()
    const layers = createJourneyRouteLayers(state.map, null)

    layers.setJourneyOptions([
      { candidateKey: 'option-1', path: createPath('A1') },
      { candidateKey: 'option-2', path: createPath('B1') },
    ], 'option-2')

    const layerById = new globalThis.Map(state.addedLayers.map((layer) => [layer.id, layer]))
    expect(layerById.get(JOURNEY_SELECTED_DIRECTION_LAYER_ID)).toMatchObject({
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-pattern': 'journey-route-direction-chevron' },
    })
    expect(layerById.get(JOURNEY_SELECTED_SHUTTLE_LAYER_ID)?.paint).toHaveProperty('line-offset')
    expect(state.images.has('journey-route-direction-chevron')).toBe(true)
    expect(JSON.stringify(
      state.filters.find(({ id }) => id === JOURNEY_SELECTED_DIRECTION_LAYER_ID)?.filter,
    )).toContain('"option-2"')

    layers.dispose()
    expect(state.removedLayers).toContain(JOURNEY_SELECTED_DIRECTION_LAYER_ID)
    expect(state.images.size).toBe(0)
  })

  it('cleans up duration markers added before a later marker fails', () => {
    const state = createFakeMap()
    Object.assign(state.map, { failDurationMarkerAt: 2 })
    const layers = createJourneyRouteLayers(state.map, null)

    expect(() => layers.setJourneyOptions([
      { candidateKey: 'option-1', path: createPath('A1') },
      { candidateKey: 'option-2', path: createPath('B1') },
      { candidateKey: 'option-3', path: createPath('A1') },
    ], 'option-1')).toThrow('Unable to add duration marker')
    expect(markerState.markers).toHaveLength(2)
    expect(markerState.markers.every(({ removed }) => removed)).toBe(true)
    expect(state.sources.size).toBe(0)
    expect(state.layers.size).toBe(0)
    expect(state.removedSources).toEqual([JOURNEY_ROUTE_SOURCE_ID])
  })
})
