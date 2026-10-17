import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMapSession } from './session'
import {
  createTransferTransitNetwork,
  createValidTransitNetwork,
} from '../../domain/transit/test-fixtures'
import { createTransitIndex } from '../../domain/transit'
import { generateShuttleTimingData } from '@navus/shared/transit/timing'
import type { BusRouteGeometry } from '@navus/shared/transit/types'
import type { Path } from '@navus/shared/routing/path'
import type { VenueLocation } from '@navus/shared/venue/types'
import type { DeviceLocationFix } from '../../domain/location/types'

const fakeMapState = vi.hoisted(() => ({
  maps: [] as unknown[],
  popups: [] as unknown[],
  durationMarkers: [] as unknown[],
  popupCloseButton: null as { click: () => void } | null,
}))

vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: 'worker.js',
}))

vi.mock('maplibre-gl', () => {
  class FakeMap {
    readonly sources = new Set<string>()
    readonly sourceData = new globalThis.Map<string, { data: unknown; setData: ReturnType<typeof vi.fn> }>()
    readonly layers = new Set<string>()
    readonly handlers = new globalThis.Map<string, Set<(...args: never[]) => void>>()
    readonly removedSources: string[] = []
    readonly removedLayers: string[] = []
    readonly addedMarkers: FakeMarker[] = []
    readonly failingLayers = new Set<string>()
    readonly paintProperties = new globalThis.Map<string, unknown>()
    readonly layoutProperties = new globalThis.Map<string, unknown>()
    readonly filters = new globalThis.Map<string, unknown>()
    readonly on = vi.fn((event: string, handler: (...args: never[]) => void) => {
      const handlers = this.handlers.get(event) ?? new Set()
      handlers.add(handler)
      this.handlers.set(event, handlers)
      return this
    })
    readonly off = vi.fn((event: string, handler: (...args: never[]) => void) => {
      this.handlers.get(event)?.delete(handler)
      return this
    })
    readonly once = vi.fn((event: string, handler: (...args: never[]) => void) => {
      const onceHandler = (...args: never[]) => {
        this.handlers.get(event)?.delete(onceHandler)
        handler(...args)
      }
      return this.on(event, onceHandler)
    })
    readonly addControl = vi.fn(() => this)
    readonly removeControl = vi.fn(() => this)
    readonly addSource = vi.fn((id: string, source: { data?: unknown }) => {
      this.sources.add(id)
      this.sourceData.set(id, {
        data: source.data,
        setData: vi.fn((data: unknown) => {
          const currentSource = this.sourceData.get(id)
          if (currentSource) currentSource.data = data
        }),
      })
    })
    readonly addLayer = vi.fn((layer: { id: string }) => {
      if (this.failingLayers.has(layer.id)) throw new Error(`Unable to add ${layer.id}`)
      this.layers.add(layer.id)
    })
    readonly images = new Set<string>()
    readonly hasImage = vi.fn((id: string) => this.images.has(id))
    readonly addImage = vi.fn((id: string) => {
      this.images.add(id)
    })
    readonly removeImage = vi.fn((id: string) => {
      this.images.delete(id)
    })
    readonly removeSource = vi.fn((id: string) => {
      this.removedSources.push(id)
      this.sources.delete(id)
      this.sourceData.delete(id)
    })
    readonly removeLayer = vi.fn((id: string) => {
      this.removedLayers.push(id)
      this.layers.delete(id)
    })
    readonly setFilter = vi.fn((id: string, filter: unknown) => {
      this.filters.set(id, filter)
    })
    readonly setLayerZoomRange = vi.fn()
    readonly setPaintProperty = vi.fn((id: string, name: string, value: unknown) => {
      this.paintProperties.set(`${id}:${name}`, value)
    })
    readonly setLayoutProperty = vi.fn((id: string, name: string, value: unknown) => {
      this.layoutProperties.set(`${id}:${name}`, value)
    })
    readonly getContainer = vi.fn(() => ({
      clientWidth: 1200,
      clientHeight: 800,
      querySelector: (selector: string) => selector === '.maplibregl-popup-close-button'
        ? fakeMapState.popupCloseButton
        : null,
    }))
    readonly fitBounds = vi.fn()
    readonly getZoom = vi.fn(() => 15)
    readonly flyTo = vi.fn()
    readonly zoomIn = vi.fn()
    readonly zoomOut = vi.fn()
    readonly queryRenderedFeatures = vi.fn(() => [])
    readonly remove = vi.fn()

    constructor() {
      fakeMapState.maps.push(this)
    }

    isStyleLoaded() {
      return true
    }

    fire(event: string) {
      for (const handler of [...(this.handlers.get(event) ?? [])]) handler()
      return this
    }

    getSource(id: string) {
      return this.sourceData.get(id)
    }

    getLayer(id: string) {
      return this.layers.has(id) ? {} : undefined
    }
  }

  class FakeNavigationControl {}

  class FakeMarker {
    readonly element: HTMLElement
    readonly options: { element?: HTMLElement; color?: string; offset?: number[] }
    popup: FakePopup | null = null
    coordinate: unknown = null
    readonly remove = vi.fn()

    constructor(options: { element?: HTMLElement; color?: string; offset?: number[] }) {
      this.options = options
      this.element = options.element ?? document.createElement('div')
    }

    getElement() {
      return this.element
    }

    setLngLat(coordinate: unknown) {
      this.coordinate = coordinate
      return this
    }

    setOpacity(opacity: string | number) {
      this.element.style.opacity = String(opacity)
      return this
    }

    setPopup(popup: FakePopup) {
      this.popup = popup
      return this
    }

    getPopup() {
      return this.popup
    }

    togglePopup() {
      if (this.popup?.isOpen()) this.popup.remove()
      else this.popup?.show()
      return this
    }

    addTo(map: FakeMap) {
      if (this.element.className === 'journey-duration-marker') {
        fakeMapState.durationMarkers.push(this)
      } else {
        map.addedMarkers.push(this)
      }
      return this
    }
  }

  class FakePopup {
    readonly handlers = new globalThis.Map<string, Set<() => void>>()
    open = false
    readonly remove = vi.fn(() => {
      this.open = false
      this.handlers.get('close')?.forEach((handler) => handler())
      return this
    })

    constructor() {
      fakeMapState.popups.push(this)
    }

    setDOMContent() {
      return this
    }

    on(event: string, handler: () => void) {
      const handlers = this.handlers.get(event) ?? new Set()
      handlers.add(handler)
      this.handlers.set(event, handlers)
      return this
    }

    off(event: string, handler: () => void) {
      this.handlers.get(event)?.delete(handler)
      return this
    }

    isOpen() {
      return this.open
    }

    show() {
      this.open = true
      this.handlers.get('open')?.forEach((handler) => handler())
    }
  }

  return {
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    NavigationControl: FakeNavigationControl,
    setWorkerUrl: vi.fn(),
  }
})

class FakeElement {
  readonly children: FakeElement[] = []
  readonly dataset: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly style = {
    display: '',
    opacity: '',
    pointerEvents: '',
    setProperty: vi.fn(),
  }
  readonly classes = new Set<string>()
  readonly classList = {
    add: vi.fn((name: string) => this.classes.add(name)),
    remove: vi.fn((name: string) => this.classes.delete(name)),
    toggle: vi.fn((name: string, force: boolean) => {
      if (force) this.classes.add(name)
      else this.classes.delete(name)
    }),
  }
  textContent = ''
  type = ''
  className = ''
  disabled = false
  tabIndex = 0

  append(...children: FakeElement[]) {
    this.children.push(...children)
  }

  addEventListener() {}

  removeEventListener() {}

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string) {
    this.attributes.delete(name)
  }
}

function createTransitData(routeId = 'A1', color = '#123456') {
  const network = createValidTransitNetwork()
  network.routes[0].id = routeId
  network.routes[0].name = routeId
  network.routes[0].color = color
  network.stops.forEach((stop) => {
    stop.services = [routeId, ...(stop.id === 'STOP-A' ? ['PUB:95'] : [])]
  })
  const geometry: BusRouteGeometry = {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { routeId, name: routeId, color },
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.1, 1.1]] },
    }],
  }
  const index = createTransitIndex(network)
  return {
    network: index.network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(index.network, geometry, '2026-09-22'),
  }
}

function createRouteSelection(data: ReturnType<typeof createTransitData>) {
  return {
    route: data.index.routes[0],
    overlappingRouteIds: new Set<string>(),
  }
}

function createPath(): Path {
  return {
    origin: { kind: 'venue', id: 'ORIGIN' },
    destination: { kind: 'venue', id: 'DESTINATION' },
    legs: [{
      mode: 'walking',
      from: { kind: 'venue', id: 'ORIGIN' },
      to: { kind: 'venue', id: 'DESTINATION' },
      durationSeconds: 60,
      distanceMeters: 100,
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.1, 1.1]] },
    }],
    totalDurationSeconds: 60,
    totalDistanceMeters: 100,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }
}

function setSingleJourney(
  session: ReturnType<typeof createMapSession>,
  path: Path | null,
): void {
  session.setJourneyOptions(
    path ? [{ candidateKey: 'selected', path }] : [],
    path ? 'selected' : null,
  )
}

function createTwoRouteTransitData() {
  const index = createTransitIndex(createTransferTransitNetwork())
  const geometry: BusRouteGeometry = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { routeId: 'A1', name: 'A1', color: '#123456' },
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.1, 1.1]] },
      },
      {
        type: 'Feature',
        properties: { routeId: 'B1', name: 'B1', color: '#654321' },
        geometry: { type: 'LineString', coordinates: [[103.1, 1.1], [103.2, 1.2]] },
      },
    ],
  }

  return {
    network: index.network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(index.network, geometry, '2026-09-22'),
  }
}

function createJourneyStopTransitData() {
  const network = createTransferTransitNetwork()
  network.routes[0].stopIds = ['STOP-A', 'STOP-MIDDLE', 'STOP-B', 'STOP-AFTER']
  network.stops.push(
    {
      id: 'STOP-MIDDLE',
      longName: 'Middle Stop',
      shortName: 'Middle',
      latitude: 1.05,
      longitude: 103.05,
      services: ['A1'],
      opposite: null,
    },
    {
      id: 'STOP-AFTER',
      longName: 'Stop After Alighting',
      shortName: 'After',
      latitude: 1.15,
      longitude: 103.15,
      services: ['A1'],
      opposite: null,
    },
  )
  const index = createTransitIndex(network)
  const geometry: BusRouteGeometry = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { routeId: 'A1', name: 'A1', color: '#123456' },
        geometry: {
          type: 'LineString',
          coordinates: [[103, 1], [103.05, 1.05], [103.1, 1.1], [103.15, 1.15]],
        },
      },
      {
        type: 'Feature',
        properties: { routeId: 'B1', name: 'B1', color: '#654321' },
        geometry: { type: 'LineString', coordinates: [[103.1, 1.1], [103.2, 1.2]] },
      },
    ],
  }

  return {
    network: index.network,
    geometry,
    index,
    shuttleTiming: generateShuttleTimingData(index.network, geometry, '2026-09-22'),
  }
}

function createTransferJourney(): Path {
  return {
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
}

function createSingleRouteJourney(): Path {
  return {
    origin: { kind: 'stop', id: 'STOP-B' },
    destination: { kind: 'stop', id: 'STOP-C' },
    legs: [createTransferJourney().legs[1]],
    totalDurationSeconds: 180,
    totalDistanceMeters: 1000,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }
}

function createBusPath(): Path {
  return {
    origin: { kind: 'stop', id: 'STOP-A' },
    destination: { kind: 'stop', id: 'STOP-B' },
    legs: [{
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
    }],
    totalDurationSeconds: 120,
    totalDistanceMeters: 900,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }
}

describe('MapSession', () => {
  it('updates, hides, shows, and removes the current-location marker without moving the camera', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    await session.ready
    const map = fakeMapState.maps.at(-1) as {
      readonly addedMarkers: Array<{
        readonly element: FakeElement
        readonly coordinate: unknown
        readonly remove: ReturnType<typeof vi.fn>
      }>
      readonly fire: (event: string) => void
      readonly once: ReturnType<typeof vi.fn>
      readonly flyTo: ReturnType<typeof vi.fn>
      readonly fitBounds: ReturnType<typeof vi.fn>
    }
    const firstFix: DeviceLocationFix = {
      longitude: 103.7844,
      latitude: 1.2933,
      accuracy: 12,
      timestamp: 1_000,
    }
    const secondFix: DeviceLocationFix = { ...firstFix, longitude: 103.785, timestamp: 2_000 }

    session.setCurrentLocation(firstFix, true)
    const marker = map.addedMarkers.at(-1)
    expect(marker?.element.className).toBe('current-location-marker')
    expect(marker?.element.attributes.get('aria-label')).toBe('Current location')
    expect(marker?.coordinate).toEqual([firstFix.longitude, firstFix.latitude])

    session.setCurrentLocation(secondFix, true)
    expect(marker?.coordinate).toEqual([secondFix.longitude, secondFix.latitude])

    session.setCurrentLocation(secondFix, false)
    expect(marker?.remove).toHaveBeenCalledOnce()
    session.setCurrentLocation(secondFix, true)
    session.setCurrentLocation(null, true)
    expect(marker?.remove).toHaveBeenCalledTimes(2)
    session.setCurrentLocation(secondFix, true)
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(map.fitBounds).not.toHaveBeenCalled()

    session.focusCurrentLocation(secondFix)
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [secondFix.longitude, secondFix.latitude],
      zoom: 17,
    }))
    expect(map.once).toHaveBeenCalledWith('moveend', expect.any(Function))
    const currentLocationMarker = marker?.element as FakeElement
    expect(currentLocationMarker.classes.has('current-location-marker-pulsing')).toBe(false)
    map.fire('moveend')
    expect(currentLocationMarker.classes.has('current-location-marker-pulsing')).toBe(true)

    session.dispose()
    expect(currentLocationMarker.classes.has('current-location-marker-pulsing')).toBe(false)
    expect(marker?.remove).toHaveBeenCalledTimes(3)
  })

  beforeEach(() => {
    fakeMapState.maps.length = 0
    fakeMapState.popups.length = 0
    fakeMapState.durationMarkers.length = 0
    fakeMapState.popupCloseButton = null
    vi.unstubAllGlobals()
  })

  it('dismisses the active MapLibre popup through its map container', () => {
    const closePopup = vi.fn()
    fakeMapState.popupCloseButton = { click: closePopup }
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })

    expect(session.dismissPopup()).toBe(true)
    expect(closePopup).toHaveBeenCalledOnce()

    fakeMapState.popupCloseButton = null
    expect(session.dismissPopup()).toBe(false)

    session.dispose()
    expect(session.dismissPopup()).toBe(false)
  })

  it('dismisses only a shuttle-stop popup through the stop-specific command', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const closeEndpointPopup = vi.fn()
    fakeMapState.popupCloseButton = { click: closeEndpointPopup }
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const transitData = createTransitData()

    await session.ready
    session.loadTransitData(transitData, createRouteSelection(transitData))
    session.focusStop('STOP-A')

    expect(session.dismissStopPopup()).toBe(true)
    expect(fakeMapState.popups.some((popup) => (popup as { open: boolean }).open)).toBe(false)
    expect(closeEndpointPopup).not.toHaveBeenCalled()
    expect(session.dismissStopPopup()).toBe(false)

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('preserves a valid route presentation across transit reloads without refitting', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const transitData = createTransitData()
    const map = fakeMapState.maps.at(-1) as {
      addedMarkers: Array<{ element: FakeElement; getElement: () => FakeElement }>
      fitBounds: ReturnType<typeof vi.fn>
      paintProperties: Map<string, unknown>
    }

    await session.ready
    const selectedRoute = createRouteSelection(transitData)
    session.loadTransitData(transitData, {
      route: null,
      overlappingRouteIds: new Set(),
    })
    session.setRouteSelection(selectedRoute)

    expect(map.fitBounds).not.toHaveBeenCalled()
    session.setViewportInsets({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(map.fitBounds).toHaveBeenCalledOnce()
    session.loadTransitData(transitData, selectedRoute)

    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.paintProperties.get('shuttle-route-lines:line-color')).toEqual([
      'case',
      ['==', ['get', 'routeId'], 'A1'],
      ['get', 'color'],
      '#64748b',
    ])
    const reloadedMarkers = map.addedMarkers.slice(-transitData.index.stops.length)
    expect(reloadedMarkers.map((marker) => marker.element.classes.has('bus-stop-marker-selected')))
      .toEqual([true, true])

    session.setRouteSelection({ route: null, overlappingRouteIds: new Set() })

    expect(map.fitBounds).toHaveBeenCalledOnce()
    session.setViewportInsets({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
    expect(map.paintProperties.get('shuttle-route-lines:line-color')).toBe('#64748b')
    expect(reloadedMarkers.every((marker) => (
      !marker.element.classes.has('bus-stop-marker-selected') &&
      !marker.element.classes.has('bus-stop-marker-dimmed')
    ))).toBe(true)

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('renders and clears the selected Journey independently of transit layers', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      layers: Set<string>
      removedLayers: string[]
      removedSources: string[]
    }

    await session.ready
    setSingleJourney(session, createPath())
    expect(map.layers).toEqual(new Set([
      'journey-alternative-casing',
      'journey-alternative-walking-lines',
      'journey-alternative-shuttle-lines',
      'journey-selected-casing',
      'journey-selected-walking-lines',
      'journey-selected-shuttle-lines',
      'journey-selected-shuttle-directions',
    ]))

    setSingleJourney(session, null)
    expect(map.layers).toEqual(new Set())
    expect(map.removedLayers).toHaveLength(7)
    expect(map.removedSources).toEqual(['journey-route-geometry'])

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('fits every option with overlay insets, keeps the camera on selection, and refits on command', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      fitBounds: ReturnType<typeof vi.fn>
      flyTo: ReturnType<typeof vi.fn>
      layers: Set<string>
      sourceData: globalThis.Map<string, { setData: ReturnType<typeof vi.fn> }>
    }
    const options = [
      { candidateKey: 'bus', path: createPath() },
      { candidateKey: 'walking', path: createTransferJourney() },
    ]
    const insets = { top: 32, right: 12, bottom: 184, left: 20 }

    await session.ready
    session.setViewportInsets(insets)
    session.setJourneyOptions(options, 'bus', true)

    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [103.2, 1.2]],
      { duration: 500, maxZoom: 17, padding: { top: 80, right: 60, bottom: 232, left: 68 } },
    )
    expect(map.layers.size).toBe(7)
    const source = map.sourceData.get('journey-route-geometry')

    session.setJourneyOptions(options, 'walking')

    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(source?.setData).not.toHaveBeenCalled()
    expect(map.layers.size).toBe(7)

    session.fitJourneyRoutes()
    expect(map.fitBounds).toHaveBeenCalledTimes(2)
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [103.2, 1.2]],
      { duration: 500, maxZoom: 17, padding: { top: 80, right: 60, bottom: 232, left: 68 } },
    )

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('hides planned Journey layers and endpoint markers outside Plan and restores them without replanning', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      layers: Set<string>
      addedMarkers: Array<{ remove: ReturnType<typeof vi.fn> }>
    }
    const venues = {
      ONE: { roomName: 'One', location: { x: 103.7, y: 1.3 } },
      TWO: { roomName: 'Two', location: { x: 103.8, y: 1.4 } },
    }
    const request = { origin: { kind: 'venue', id: 'ONE' }, destination: { kind: 'venue', id: 'TWO' } } as const
    const options = [{ candidateKey: 'bus', path: createPath() }]

    await session.ready
    session.setTripRequest(request, venues, null)
    session.setJourneyOptions(options, 'bus')
    const endpointMarkers = [...map.addedMarkers]
    expect(endpointMarkers.length).toBeGreaterThan(0)
    expect(map.layers.size).toBe(7)

    session.setPlanLayersVisible(false)

    expect(map.layers.size).toBe(0)
    expect(endpointMarkers.every((marker) => marker.remove.mock.calls.length > 0)).toBe(true)

    session.setJourneyOptions(options, 'bus')
    session.setTripRequest(request, venues, null)
    expect(map.layers.size).toBe(0)
    const markerCountWhileHidden = map.addedMarkers.length

    session.setPlanLayersVisible(true)

    expect(map.layers.size).toBe(7)
    expect(map.addedMarkers.length).toBe(markerCountWhileHidden + endpointMarkers.length)

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('forwards rendered Journey route clicks through the MapSession callback', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    vi.stubGlobal('Element', class {})
    const onJourneyOptionSelected = vi.fn()
    const onEmptyMapClick = vi.fn()
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick,
      onJourneyOptionSelected,
    })
    const map = fakeMapState.maps.at(-1) as {
      handlers: globalThis.Map<string, Set<(...args: never[]) => void>>
      queryRenderedFeatures: ReturnType<typeof vi.fn>
    }
    await session.ready
    session.setJourneyOptions([
      { candidateKey: 'option-a', path: createPath() },
      { candidateKey: 'option-b', path: createPath() },
    ], 'option-a')
    map.queryRenderedFeatures.mockReturnValue([{ properties: { candidateKey: 'option-b' } }])

    for (const handler of map.handlers.get('click') ?? []) {
      handler({
        point: { x: 1, y: 1 },
        originalEvent: { target: null, stopPropagation: vi.fn() },
      } as never)
    }

    expect(onJourneyOptionSelected).toHaveBeenCalledWith('option-b')
    expect(onEmptyMapClick).not.toHaveBeenCalled()
    session.dispose()
    vi.unstubAllGlobals()
  })

  it('waits for initial overlay measurements before fitting a new result', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as { fitBounds: ReturnType<typeof vi.fn> }
    const insets = { top: 28, right: 12, bottom: 172, left: 12 }

    await session.ready
    session.setJourneyOptions([
      { candidateKey: 'bus', path: createPath() },
      { candidateKey: 'walking', path: createTransferJourney() },
    ], 'bus', true)

    expect(map.fitBounds).not.toHaveBeenCalled()
    session.setViewportInsets(insets)

    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [103.2, 1.2]],
      { duration: 500, maxZoom: 17, padding: { top: 76, right: 60, bottom: 220, left: 60 } },
    )

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('limits Journey fit breathing room on short mobile viewports', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      fitBounds: ReturnType<typeof vi.fn>
      getContainer: ReturnType<typeof vi.fn>
    }
    map.getContainer.mockReturnValue({ clientWidth: 390, clientHeight: 320 })

    await session.ready
    session.setViewportInsets({ top: 84, right: 12, bottom: 162, left: 12 })
    session.setJourneyOptions([
      { candidateKey: 'bus', path: createPath() },
      { candidateKey: 'walking', path: createTransferJourney() },
    ], 'bus', true)

    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [103.2, 1.2]],
      { duration: 500, maxZoom: 17, padding: { top: 97, right: 60, bottom: 175, left: 60 } },
    )

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('highlights only stops traversed by each bus leg with its Route color', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const transitData = createJourneyStopTransitData()
    const map = fakeMapState.maps.at(-1) as {
      addedMarkers: Array<{ element: FakeElement }>
    }

    await session.ready
    session.loadTransitData(transitData, { route: null, overlappingRouteIds: new Set() })
    const stopMarkers = map.addedMarkers.slice(-transitData.index.stops.length)
    const markerByStopId = new Map(
      stopMarkers.map((marker) => [marker.element.dataset.stopId, marker.element]),
    )

    setSingleJourney(session, createTransferJourney())

    expect(Array.from(markerByStopId.entries()).map(([stopId, marker]) => [
      stopId,
      marker.classes.has('bus-stop-marker-selected'),
    ])).toEqual([
      ['STOP-A', true],
      ['STOP-B', true],
      ['STOP-C', true],
      ['STOP-MIDDLE', true],
      ['STOP-AFTER', false],
    ])
    expect(markerByStopId.get('STOP-A')?.style.setProperty).toHaveBeenCalledWith(
      '--bus-stop-journey-color',
      'linear-gradient(#123456, #123456)',
    )
    expect(markerByStopId.get('STOP-A')?.attributes.get('aria-label')).toBe(
      'Stop A bus stop on Journey Route A1',
    )
    expect(markerByStopId.get('STOP-MIDDLE')?.style.setProperty).toHaveBeenCalledWith(
      '--bus-stop-journey-color',
      'linear-gradient(#123456, #123456)',
    )
    expect(markerByStopId.get('STOP-C')?.style.setProperty).toHaveBeenCalledWith(
      '--bus-stop-journey-color',
      'linear-gradient(#654321, #654321)',
    )
    expect(markerByStopId.get('STOP-B')?.style.setProperty).toHaveBeenCalledWith(
      '--bus-stop-journey-color',
      'conic-gradient(#123456 0deg 180deg, #654321 180deg 360deg)',
    )
    expect(markerByStopId.get('STOP-B')?.attributes.get('aria-label')).toBe(
      'Stop B bus stop on Journey Routes A1, B1',
    )
    expect(markerByStopId.get('STOP-AFTER')?.attributes.get('title')).toBeUndefined()

    setSingleJourney(session, createSingleRouteJourney())

    expect(markerByStopId.get('STOP-A')?.classes.has('bus-stop-marker-selected')).toBe(false)
    expect(markerByStopId.get('STOP-MIDDLE')?.classes.has('bus-stop-marker-selected')).toBe(false)
    expect(markerByStopId.get('STOP-B')?.style.setProperty).toHaveBeenLastCalledWith(
      '--bus-stop-journey-color',
      'linear-gradient(#654321, #654321)',
    )
    expect(markerByStopId.get('STOP-B')?.attributes.get('aria-label')).toBe(
      'Stop B bus stop on Journey Route B1',
    )

    setSingleJourney(session, null)

    expect(markerByStopId.get('STOP-B')?.classes.has('bus-stop-marker-selected')).toBe(false)
    expect(markerByStopId.get('STOP-B')?.style.setProperty).toHaveBeenLastCalledWith(
      '--bus-stop-journey-color',
      '',
    )
    expect(markerByStopId.get('STOP-B')?.attributes.get('aria-label')).toBe(
      'Stop B bus stop',
    )
    expect(markerByStopId.get('STOP-B')?.attributes.get('title')).toBeUndefined()

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('replaces route browsing with Journey legs and restores the prior route and stop interactions', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const transitData = createTwoRouteTransitData()
    const map = fakeMapState.maps.at(-1) as {
      layoutProperties: Map<string, unknown>
      paintProperties: Map<string, unknown>
      fitBounds: ReturnType<typeof vi.fn>
      addedMarkers: Array<{
        element: FakeElement
        getPopup: () => {
          show: () => void
          isOpen: () => boolean
        } | null
      }>
    }

    await session.ready
    session.loadTransitData(transitData, { route: null, overlappingRouteIds: new Set() })
    session.setRouteSelection({
      route: transitData.index.routeById.get('B1') ?? null,
      overlappingRouteIds: new Set(),
    })
    const stopMarkers = map.addedMarkers.slice(-transitData.index.stops.length)
    const stopCMarker = stopMarkers.find((marker) => marker.element.dataset.stopId === 'STOP-C')
    const stopCPopup = stopCMarker?.getPopup()
    stopCPopup?.show()

    setSingleJourney(session, createBusPath())
    session.setViewportInsets({ top: 80, right: 12, bottom: 180, left: 12 })

    expect(map.fitBounds).not.toHaveBeenCalled()
    expect(map.layoutProperties.get('shuttle-route-lines:visibility')).toBe('none')
    expect(map.layoutProperties.get('shuttle-route-casing:visibility')).toBe('none')
    expect(map.layoutProperties.get('shuttle-route-directions:visibility')).toBe('none')
    expect(stopMarkers.map((marker) => marker.element.disabled)).toEqual([false, false, true])
    expect(stopCMarker?.element.tabIndex).toBe(-1)
    expect(stopCPopup?.isOpen()).toBe(false)
    expect(map.paintProperties.get('shuttle-stop-inactive-labels:text-color')).toBe('#64748b')

    setSingleJourney(session, null)

    expect(map.layoutProperties.get('shuttle-route-lines:visibility')).toBe('visible')
    expect(map.paintProperties.get('shuttle-route-lines:line-color')).toEqual([
      'case', ['==', ['get', 'routeId'], 'B1'], ['get', 'color'], '#64748b',
    ])
    expect(stopMarkers.map((marker) => marker.element.disabled)).toEqual([false, false, false])
    expect(stopMarkers.map((marker) => marker.element.classes.has('bus-stop-marker-selected')))
      .toEqual([false, true, true])

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('restores route browsing when MapLibre rejects Journey layers', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const onMapError = vi.fn()
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError,
      onEmptyMapClick: vi.fn(),
    })
    const transitData = createTwoRouteTransitData()
    const map = fakeMapState.maps.at(-1) as {
      failingLayers: Set<string>
      layoutProperties: Map<string, unknown>
      paintProperties: Map<string, unknown>
      addedMarkers: Array<{ element: FakeElement }>
    }

    await session.ready
    session.loadTransitData(transitData, { route: null, overlappingRouteIds: new Set() })
    session.setRouteSelection({
      route: transitData.index.routeById.get('B1') ?? null,
      overlappingRouteIds: new Set(),
    })
    const stopMarkers = map.addedMarkers.slice(-transitData.index.stops.length)
    map.failingLayers.add('journey-selected-walking-lines')

    setSingleJourney(session, createBusPath())

    expect(onMapError).toHaveBeenCalledWith(new Error('Unable to add journey-selected-walking-lines'))
    expect(map.layoutProperties.get('shuttle-route-lines:visibility')).toBe('visible')
    expect(map.paintProperties.get('shuttle-route-lines:line-color')).toEqual([
      'case', ['==', ['get', 'routeId'], 'B1'], ['get', 'color'], '#64748b',
    ])
    expect(stopMarkers.map((marker) => marker.element.disabled)).toEqual([false, false, false])
    expect(stopMarkers.map((marker) => marker.element.classes.has('bus-stop-marker-selected')))
      .toEqual([false, true, true])

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('replaces pending route framing when the selected route is missing from reloaded data', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const originalData = createTransitData()
    const replacementData = createTransitData('B1', '#654321')
    replacementData.geometry.features.push({
      type: 'Feature',
      properties: { routeId: 'B2', name: 'B2', color: '#abcdef' },
      geometry: { type: 'LineString', coordinates: [[104, 2], [104.1, 2.1]] },
    })
    const map = fakeMapState.maps.at(-1) as {
      fitBounds: ReturnType<typeof vi.fn>
      paintProperties: Map<string, unknown>
      addedMarkers: Array<{ element: FakeElement }>
    }

    await session.ready
    const selectedRoute = createRouteSelection(originalData)
    session.loadTransitData(originalData, selectedRoute)
    session.loadTransitData(replacementData, selectedRoute)

    expect(map.fitBounds).not.toHaveBeenCalled()
    session.setViewportInsets({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [104.1, 2.1]],
      expect.objectContaining({ duration: 500 }),
    )

    expect(map.paintProperties.get('shuttle-route-lines:line-color')).toBe('#64748b')
    const reloadedMarkers = map.addedMarkers.slice(-replacementData.index.stops.length)
    expect(reloadedMarkers.every((marker) => !marker.element.classes.has('bus-stop-marker-selected')))
      .toBe(true)
    expect(reloadedMarkers.every((marker) => !marker.element.classes.has('bus-stop-marker-dimmed')))
      .toBe(true)

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('fits the replacement route when the selected route changes during reload', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const firstData = createTransitData()
    const replacementData = createTransitData('B1', '#654321')
    const map = fakeMapState.maps.at(-1) as {
      fitBounds: ReturnType<typeof vi.fn>
    }

    await session.ready
    session.loadTransitData(firstData, createRouteSelection(firstData))
    session.loadTransitData(replacementData, createRouteSelection(replacementData))

    expect(map.fitBounds).not.toHaveBeenCalled()
    session.setViewportInsets({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [103.1, 1.1]],
      expect.objectContaining({ duration: 500 }),
    )

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('queues the latest venue fit and cancels pending framing on clear or dispose', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const venueOne: VenueLocation = {
      roomName: 'Venue One',
      location: { x: 103.7, y: 1.3 },
    }
    const venueTwo: VenueLocation = {
      roomName: 'Venue Two',
      location: { x: 103.8, y: 1.4 },
    }
    const map = fakeMapState.maps.at(-1) as {
      addedMarkers: Array<{ coordinate: unknown; remove: ReturnType<typeof vi.fn> }>
      flyTo: ReturnType<typeof vi.fn>
    }

    await session.ready
    session.selectVenue(venueOne)
    expect(map.flyTo).not.toHaveBeenCalled()
    session.clearVenue()
    session.setViewportInsets({ top: 80, right: 12, bottom: 180, left: 12 })
    expect(map.flyTo).not.toHaveBeenCalled()

    session.selectVenue(venueOne)
    session.selectVenue(venueTwo)
    expect(map.flyTo).not.toHaveBeenCalled()
    session.setViewportInsets({ top: 88, right: 12, bottom: 196, left: 12 })
    expect(map.flyTo).toHaveBeenCalledOnce()

    expect(map.addedMarkers).toHaveLength(3)
    expect(map.addedMarkers[0].remove).toHaveBeenCalledOnce()
    expect(map.addedMarkers[1].remove).toHaveBeenCalledOnce()
    expect(map.addedMarkers[2].remove).not.toHaveBeenCalled()
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [103.8, 1.4],
      zoom: 17,
      offset: [0, -54],
      essential: true,
    }))
    session.setViewportInsets({ top: 96, right: 12, bottom: 208, left: 12 })
    expect(map.flyTo).toHaveBeenCalledOnce()

    session.clearVenue()
    session.clearVenue()

    session.selectVenue(venueOne)
    expect(map.flyTo).toHaveBeenCalledOnce()
    session.dispose()
    session.setViewportInsets({ top: 100, right: 12, bottom: 220, left: 12 })
    expect(map.flyTo).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('marks every part of a selected building and fits the camera to all of them once insets are known', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      addedMarkers: Array<{ coordinate: unknown; remove: ReturnType<typeof vi.fn> }>
      fitBounds: ReturnType<typeof vi.fn>
      flyTo: ReturnType<typeof vi.fn>
    }

    await session.ready
    session.selectBuilding({
      name: 'Saga College',
      locations: [{ x: 103.7745, y: 1.2951 }, { x: 103.7752, y: 1.2943 }, { x: 103.7749, y: 1.2956 }],
    })
    expect(map.addedMarkers).toHaveLength(3)
    expect(map.fitBounds).not.toHaveBeenCalled()

    session.setViewportInsets({ top: 88, right: 12, bottom: 196, left: 12 })
    expect(map.fitBounds).toHaveBeenCalledWith(
      [[103.7745, 1.2943], [103.7752, 1.2956]],
      expect.objectContaining({ maxZoom: 17, padding: { top: 88, right: 12, bottom: 196, left: 12 } }),
    )

    session.clearVenue()
    expect(map.addedMarkers.every((marker) => marker.remove.mock.calls.length === 1)).toBe(true)

    session.selectBuilding({ name: 'COM3', locations: [{ x: 103.775, y: 1.295 }] })
    session.setViewportInsets({ top: 88, right: 12, bottom: 196, left: 12 })
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [103.775, 1.295], zoom: 17 }))
    vi.unstubAllGlobals()
  })

  it('uses measured insets for route, endpoint, zoom, and reset camera actions', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const transitData = createTransitData()
    const map = fakeMapState.maps.at(-1) as {
      fitBounds: ReturnType<typeof vi.fn>
      flyTo: ReturnType<typeof vi.fn>
      zoomIn: ReturnType<typeof vi.fn>
      zoomOut: ReturnType<typeof vi.fn>
    }
    const insets = { top: 88, right: 12, bottom: 196, left: 12 }

    await session.ready
    session.setViewportInsets(insets)
    session.loadTransitData(transitData, { route: null, overlappingRouteIds: new Set() })
    session.setRouteSelection(createRouteSelection(transitData))
    expect(map.fitBounds).not.toHaveBeenCalled()
    session.setViewportInsets(insets)
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [103.1, 1.1]],
      expect.objectContaining({
        padding: { top: 88, right: 24, bottom: 196, left: 24 },
      }),
    )

    session.setRouteSelection({ route: null, overlappingRouteIds: new Set() })
    expect(map.fitBounds).toHaveBeenCalledOnce()
    session.resetView({ kind: 'campus', center: [103.784413, 1.29482], zoom: 15 })
    expect(map.flyTo).toHaveBeenCalledWith(expect.objectContaining({
      center: [103.784413, 1.29482],
      zoom: 15,
      offset: [0, -54],
    }))
    session.setViewportInsets({ top: 96, right: 12, bottom: 208, left: 12 })
    expect(map.fitBounds).toHaveBeenCalledOnce()

    session.resetView({ kind: 'trip', coordinates: [[103, 1], [103.1, 1.1]] })
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [[103, 1], [103.1, 1.1]],
      expect.objectContaining({
        padding: { top: 96, right: 12, bottom: 208, left: 12 },
        maxZoom: 17,
      }),
    )
    session.resetView({ kind: 'trip', coordinates: [[103.2, 1.2]] })
    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [103.2, 1.2],
      zoom: 17,
      offset: [0, -56],
    }))
    session.zoomIn()
    session.zoomOut()
    expect(map.zoomIn).toHaveBeenCalledWith({ duration: 200 })
    expect(map.zoomOut).toHaveBeenCalledWith({ duration: 200 })

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('fits a route after focusing a venue beneath mobile sheets', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      fitBounds: ReturnType<typeof vi.fn>
      flyTo: ReturnType<typeof vi.fn>
    }
    const transitData = createTransitData()
    let retainedBottomPadding = 0
    let availableRouteHeight: number | null = null

    map.flyTo.mockImplementation((options: { padding?: { bottom: number } }) => {
      retainedBottomPadding = options.padding?.bottom ?? retainedBottomPadding
    })
    map.fitBounds.mockImplementation((
      _bounds: unknown,
      options: { padding: { top: number; bottom: number } },
    ) => {
      availableRouteHeight = 844 - retainedBottomPadding -
        options.padding.top - options.padding.bottom
    })

    await session.ready
    session.loadTransitData(transitData, { route: null, overlappingRouteIds: new Set() })
    session.selectVenue({ roomName: 'COM2-0108', location: { x: 103.774, y: 1.293 } })
    session.setViewportInsets({ top: 0, right: 12, bottom: 373, left: 12 })
    session.setRouteSelection(createRouteSelection(transitData))
    session.setViewportInsets({ top: 0, right: 12, bottom: 498, left: 12 })

    expect(map.flyTo).toHaveBeenCalledOnce()
    expect(map.fitBounds).toHaveBeenCalledOnce()
    expect(availableRouteHeight).toBeGreaterThan(0)

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('focuses a validated route stop above the sheet and opens its popup', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      flyTo: ReturnType<typeof vi.fn>
    }
    const transitData = createTransitData()

    await session.ready
    session.loadTransitData(transitData, createRouteSelection(transitData))
    session.setViewportInsets({ top: 0, right: 12, bottom: 400, left: 12 })
    session.focusStop('STOP-A')

    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [103, 1],
      offset: [0, -256],
    }))
    expect(fakeMapState.popups.some((popup) => (popup as { open: boolean }).open)).toBe(true)
    expect(session.dismissStopPopup()).toBe(true)
    expect(fakeMapState.popups.some((popup) => (popup as { open: boolean }).open)).toBe(false)
    session.focusStop('unknown')
    expect(map.flyTo).toHaveBeenCalledOnce()

    session.dispose()
    vi.unstubAllGlobals()
  })

  it('focuses a Stops pin in the exposed map without opening a popup', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as {
      flyTo: ReturnType<typeof vi.fn>
      addedMarkers: Array<{
        getElement(): FakeElement
        coordinate: unknown
        options: { color?: string; offset?: number[] }
        remove: ReturnType<typeof vi.fn>
      }>
    }
    const transitData = createTransitData()

    await session.ready
    session.loadTransitData(transitData, createRouteSelection(transitData))
    session.setStopsPinVisible(true)
    session.setViewportInsets({ top: 0, right: 12, bottom: 400, left: 12 })
    session.focusStopInStopsTab('STOP-A')

    expect(map.flyTo).toHaveBeenLastCalledWith(expect.objectContaining({
      center: [103, 1],
      zoom: 17,
      duration: 500,
      offset: [0, -200],
    }))
    expect(fakeMapState.popups.some((popup) => (popup as { open: boolean }).open)).toBe(false)
    const marker = map.addedMarkers.find((candidate) => candidate.getElement().dataset.stopId === 'STOP-A')
    const pin = map.addedMarkers.find((candidate) => (
      candidate.getElement().attributes.get('aria-hidden') === 'true'
    ))
    expect(marker?.getElement().className).toBe('bus-stop-marker')
    expect(pin?.options).toEqual(expect.objectContaining({ color: '#64748b' }))
    expect(pin?.options.offset).toBeUndefined()
    expect(pin?.coordinate).toEqual([103, 1])
    expect(pin?.getElement().style.pointerEvents).toBe('none')

    session.focusStopInStopsTab('STOP-A')
    expect(map.flyTo).toHaveBeenCalledTimes(2)
    session.setStopsPinVisible(false)
    expect(pin?.remove).toHaveBeenCalled()
    expect(marker?.getElement().className).toBe('bus-stop-marker')
    session.setStopsPinVisible(true)
    expect(map.addedMarkers.at(-1)).toBe(pin)
    expect(map.flyTo).toHaveBeenCalledTimes(2)

    session.loadTransitData(transitData, createRouteSelection(transitData))
    const reloadedMarker = map.addedMarkers.findLast((candidate) => (
      candidate.getElement().dataset.stopId === 'STOP-A'
    ))
    expect(reloadedMarker?.getElement().className).toBe('bus-stop-marker')
    expect(map.addedMarkers.at(-1)?.getElement().attributes.get('aria-hidden')).toBe('true')

    session.focusStopInStopsTab('unknown')
    expect(map.flyTo).toHaveBeenCalledTimes(2)
    session.dispose()
    vi.unstubAllGlobals()
  })

  it('clears a mobile route highlight without fitting all routes', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const map = fakeMapState.maps.at(-1) as { fitBounds: ReturnType<typeof vi.fn> }
    const transitData = createTransitData()

    await session.ready
    session.loadTransitData(transitData, createRouteSelection(transitData))
    session.setRouteSelection({ route: null, overlappingRouteIds: new Set() }, false)
    session.setViewportInsets({ top: 0, right: 0, bottom: 400, left: 0 })

    expect(map.fitBounds).not.toHaveBeenCalled()
    session.dispose()
    vi.unstubAllGlobals()
  })

  it('replaces endpoint markers from the current immutable transit index and clears them', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const firstTransitData = createTransitData()
    const changedNetwork = createValidTransitNetwork()
    changedNetwork.stops[0].longitude = 104
    const secondIndex = createTransitIndex(changedNetwork)
    const request = {
      origin: { kind: 'stop' as const, id: 'STOP-A' },
      destination: { kind: 'venue' as const, id: 'VENUE-A' },
    }
    const venues = {
      'VENUE-A': {
        roomName: 'Venue A',
        location: { x: 103.9, y: 1.5 },
      },
    }
    const map = fakeMapState.maps.at(-1) as {
      addedMarkers: Array<{ coordinate: unknown; remove: ReturnType<typeof vi.fn> }>
    }

    await session.ready
    session.setTripRequest(request, venues, firstTransitData.index)
    session.loadTransitData(firstTransitData, {
      route: null,
      overlappingRouteIds: new Set(),
    })
    const initialEndpointMarkers = map.addedMarkers.slice(-2)
    expect(initialEndpointMarkers.map((marker) => marker.coordinate)).toEqual([
      [103, 1],
      [103.9, 1.5],
    ])

    session.loadTransitData({
      network: secondIndex.network,
      geometry: firstTransitData.geometry,
      index: secondIndex,
      shuttleTiming: firstTransitData.shuttleTiming,
    }, {
      route: null,
      overlappingRouteIds: new Set(),
    })

    expect(initialEndpointMarkers[0].remove).toHaveBeenCalledOnce()
    expect(initialEndpointMarkers[1].remove).toHaveBeenCalledOnce()
    expect(map.addedMarkers.slice(-2).map((marker) => marker.coordinate)).toEqual([
      [104, 1],
      [103.9, 1.5],
    ])

    session.setTripRequest({ origin: null, destination: null }, venues, secondIndex)

    expect(map.addedMarkers.slice(-2).every((marker) => marker.remove.mock.calls.length === 1)).toBe(true)
    session.dispose()
    vi.unstubAllGlobals()
  })

  it('replaces transit installations and makes disposal idempotent', async () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const session = createMapSession({
      container: {} as HTMLElement,
      onMapError: vi.fn(),
      onEmptyMapClick: vi.fn(),
    })
    const transitData = createTransitData()
    const map = fakeMapState.maps.at(-1) as {
      removedSources: string[]
      removedLayers: string[]
      addedMarkers: Array<{ remove: ReturnType<typeof vi.fn> }>
      off: ReturnType<typeof vi.fn>
      remove: ReturnType<typeof vi.fn>
      removeControl: ReturnType<typeof vi.fn>
      flyTo: ReturnType<typeof vi.fn>
      fitBounds: ReturnType<typeof vi.fn>
    }

    await session.ready
    session.setTripRequest(
      { origin: { kind: 'stop', id: 'STOP-A' }, destination: null },
      {},
      null,
    )
    session.loadTransitData(transitData, {
      route: null,
      overlappingRouteIds: new Set(),
    })
    session.loadTransitData(transitData, {
      route: null,
      overlappingRouteIds: new Set(),
    })
    expect(map.fitBounds).not.toHaveBeenCalled()

    session.dispose()
    session.dispose()
    expect(map.removedLayers).toHaveLength(12)
    expect(map.removedSources).toHaveLength(4)
    expect(map.addedMarkers).toHaveLength((transitData.index.stops.length + 1) * 2)
    expect(map.addedMarkers.every((marker) => marker.remove.mock.calls.length === 1)).toBe(true)
    expect(fakeMapState.popups).toHaveLength((transitData.index.stops.length + 1) * 2)
    expect(fakeMapState.popups.every((popup) => (
      (popup as { remove: ReturnType<typeof vi.fn> }).remove.mock.calls.length === 1
    ))).toBe(true)
    expect(map.off).toHaveBeenCalled()
    expect(map.removeControl).toHaveBeenCalledTimes(2)
    expect(map.remove).toHaveBeenCalledOnce()

    const markerCount = map.addedMarkers.length
    const removedLayerCount = map.removedLayers.length
    const flyToCount = map.flyTo.mock.calls.length
    session.setRouteSelection({ route: null, overlappingRouteIds: new Set() })
    session.setTripRequest({ origin: null, destination: null }, {}, null)
    session.selectVenue({} as VenueLocation)
    session.clearVenue()
    expect(map.addedMarkers).toHaveLength(markerCount)
    expect(map.removedLayers).toHaveLength(removedLayerCount)
    expect(map.flyTo).toHaveBeenCalledTimes(flyToCount)
    session.loadTransitData(transitData, {
      route: null,
      overlappingRouteIds: new Set(),
    })

    vi.unstubAllGlobals()
  })
})
