import type { LoadedTransitData } from '../../app/contracts/data'
import type {
  MapRouteSelection,
  MapSession,
  MapSessionOptions,
  MapJourneyOption,
  MapResetTarget,
  MapViewportInsets,
} from '../../app/contracts/map'
import type { TripEndpoint, TripEndpointRole, TripRequest } from '../../domain/trip/types'
import type { Path } from '@navus/shared/routing/path'
import type { DeviceLocationFix } from '../../domain/location/types'
import { getBusPathLegStopIds } from './path-stops'
import type { VenueLocation } from '@navus/shared/venue/types'
import { applyBasemapPresentation } from './basemap'
import { createTripEndpointMarkers, type TripEndpointMarkers } from './endpoint-markers'
import { createMapLifecycle } from './lifecycle'
import {
  createShuttleStopMarkers,
  type JourneyStopRoute,
  type ShuttleStopMarkers,
} from './shuttle-stops'
import { createTransitRouteLayers, type TransitRouteLayers } from './transit'
import { createVenueMarker, type VenueMarker } from './venue-markers'
import { createPathLayers, type JourneyRouteLayers } from './path-layers'
import { createCurrentLocationMarker, type CurrentLocationMarker } from './current-location-marker'
import type { TransitIndex } from '../../domain/transit'
import type { BuildingIndex } from '../../domain/venue/building-index'
import type { VenueLocationMap } from '@navus/shared/venue/types'

const EMPTY_ROUTE_OVERLAP: ReadonlySet<string> = new Set()
const EMPTY_VIEWPORT_INSETS: MapViewportInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}
const JOURNEY_FIT_BREATHING_ROOM = 48
const MIN_JOURNEY_FIT_VIEWPORT = 48

function getJourneyFitInsets(
  insets: MapViewportInsets,
  width: number,
  height: number,
): MapViewportInsets {
  const horizontalRoom = Math.max(0, (width - insets.left - insets.right - MIN_JOURNEY_FIT_VIEWPORT) / 2)
  const verticalRoom = Math.max(0, (height - insets.top - insets.bottom - MIN_JOURNEY_FIT_VIEWPORT) / 2)
  const horizontal = Math.min(JOURNEY_FIT_BREATHING_ROOM, horizontalRoom)
  const vertical = Math.min(JOURNEY_FIT_BREATHING_ROOM, verticalRoom)
  return {
    top: insets.top + vertical,
    right: insets.right + horizontal,
    bottom: insets.bottom + vertical,
    left: insets.left + horizontal,
  }
}

export function createMapSession(options: MapSessionOptions): MapSession {
  const lifecycle = createMapLifecycle(options)
  const map = lifecycle.map
  let selectedVenueMarker: VenueMarker | null = null
  let endpointMarkers: TripEndpointMarkers | null = null
  let shuttleStopMarkers: ShuttleStopMarkers | null = null
  let transitRouteLayers: TransitRouteLayers | null = null
  let journeyRouteLayers: JourneyRouteLayers | null = null
  const currentLocationMarker: CurrentLocationMarker = createCurrentLocationMarker(map)
  let currentPath: Path | null = null
  let currentJourneyOptions: readonly MapJourneyOption[] = []
  let selectedJourneyCandidateKey: string | null = null
  // Keep the selected Path while Plan is hidden so returning to Plan restores the same route.
  let planLayersVisible = true
  let viewportInsetsReady = false
  let transitData: LoadedTransitData | null = null
  let currentTripRequest: TripRequest | null = null
  let currentVenues: VenueLocationMap = {}
  let currentBuildings: BuildingIndex | null = null
  let currentTransitIndex: TransitIndex | null = null
  let stopsPinStopId: string | null = null
  let stopsPinVisible = false
  let viewportInsets: MapViewportInsets = EMPTY_VIEWPORT_INSETS
  let pendingCameraFit: {
    readonly kind: 'venue'
    readonly venue: VenueLocation
  } | {
    readonly kind: 'building'
    readonly locations: readonly VenueLocation['location'][]
  } | {
    readonly kind: 'route'
    readonly routeId: string | null
  } | {
    readonly kind: 'journey'
  } | null = null
  let currentRouteSelection: MapRouteSelection = {
    route: null,
    overlappingRouteIds: EMPTY_ROUTE_OVERLAP,
  }
  let disposed = false

  const ready = lifecycle.ready.then(() => {
    if (!disposed) applyBasemapPresentation(map)
  })
  // The application observes `ready`; this handler also prevents an unobserved
  // style-load rejection when a session is disposed before consumers await it.
  void ready.catch(() => undefined)

  const clearVenueMarker = () => {
    selectedVenueMarker?.dispose()
    selectedVenueMarker = null
    if (pendingCameraFit?.kind === 'venue' || pendingCameraFit?.kind === 'building') pendingCameraFit = null
  }

  // MapLibre retains flyTo padding, so use a temporary offset for sheet-aware point focus.
  const getFitOffset = (): [number, number] => [
    (viewportInsets.left - viewportInsets.right) / 2,
    (viewportInsets.top - viewportInsets.bottom) / 2,
  ]

  const flyToStop = (stopId: string, zoom: number, popupOffset: number): void => {
    const stop = currentTransitIndex?.stopById.get(stopId)
    if (!stop) return
    pendingCameraFit = null
    const [offsetX, offsetY] = getFitOffset()
    map.flyTo({
      center: [stop.longitude, stop.latitude],
      zoom,
      duration: 500,
      offset: [offsetX, offsetY - popupOffset],
      essential: true,
    })
  }

  const fitVenue = (venue: VenueLocation): void => {
    const location = venue.location
    if (!location) return
    map.flyTo({
      center: [location.x, location.y],
      zoom: 17,
      duration: 500,
      offset: getFitOffset(),
      essential: true,
    })
  }

  const fitBuilding = (locations: readonly NonNullable<VenueLocation['location']>[]): void => {
    if (locations.length === 0) return
    if (locations.length === 1) {
      fitVenue({ roomName: '', location: locations[0] })
      return
    }
    const longitudes = locations.map(({ x }) => x)
    const latitudes = locations.map(({ y }) => y)
    map.fitBounds([
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ], {
      duration: 500,
      maxZoom: 17,
      padding: viewportInsets,
    })
  }

  const fitTripEndpoints = (coordinates: readonly (readonly [number, number])[]): void => {
    if (coordinates.length === 0) return
    if (coordinates.length === 1) {
      map.flyTo({
        center: [coordinates[0][0], coordinates[0][1]],
        zoom: 17,
        duration: 500,
        offset: getFitOffset(),
        essential: true,
      })
      return
    }
    const longitudes = coordinates.map(([longitude]) => longitude)
    const latitudes = coordinates.map(([, latitude]) => latitude)
    map.fitBounds([
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ], {
      duration: 500,
      maxZoom: 17,
      padding: viewportInsets,
    })
  }

  const fitJourneyOptions = (options: readonly MapJourneyOption[]): void => {
    const coordinates = options.flatMap(({ path }) => path.legs.flatMap((leg) => (
      leg.geometry.coordinates.filter(([longitude, latitude]) => (
        Number.isFinite(longitude) && Number.isFinite(latitude)
      ))
    )))
    if (coordinates.length === 0) return
    if (coordinates.length === 1) {
      map.flyTo({
        center: [coordinates[0][0], coordinates[0][1]],
        zoom: 17,
        duration: 500,
        offset: getFitOffset(),
        essential: true,
      })
      return
    }
    const longitudes = coordinates.map(([longitude]) => longitude)
    const latitudes = coordinates.map(([, latitude]) => latitude)
    const { clientWidth, clientHeight } = map.getContainer()
    map.fitBounds([
      [Math.min(...longitudes), Math.min(...latitudes)],
      [Math.max(...longitudes), Math.max(...latitudes)],
    ], {
      duration: 500,
      maxZoom: 17,
      padding: getJourneyFitInsets(viewportInsets, clientWidth, clientHeight),
    })
  }

  const getDisplayedJourneyOptions = (): readonly MapJourneyOption[] => (
    planLayersVisible ? currentJourneyOptions : []
  )

  const getDisplayedPath = (): Path | null => planLayersVisible ? currentPath : null

  const clearEndpointMarkers = () => {
    endpointMarkers?.dispose()
    endpointMarkers = null
  }

  const syncEndpointMarkers = (): void => {
    clearEndpointMarkers()
    if (!planLayersVisible || !currentTripRequest) return
    endpointMarkers = createTripEndpointMarkers(
      map,
      currentTripRequest,
      currentVenues,
      currentTransitIndex,
      currentBuildings,
    )
  }

  const clearTransitData = () => {
    shuttleStopMarkers?.dispose()
    shuttleStopMarkers = null
    transitRouteLayers?.dispose()
    transitRouteLayers = null
    transitData = null
  }

  const clearJourneyRouteLayers = (): void => {
    journeyRouteLayers?.dispose()
    journeyRouteLayers = null
  }

  const installJourneyRouteLayers = (): void => {
    const displayedOptions = getDisplayedJourneyOptions()
    if (displayedOptions.length === 0 || journeyRouteLayers) return
    const nextJourneyRouteLayers = createPathLayers(
      map,
      currentTransitIndex,
      options.onJourneyOptionSelected,
    )
    nextJourneyRouteLayers.setJourneyOptions(displayedOptions, selectedJourneyCandidateKey)
    journeyRouteLayers = nextJourneyRouteLayers
  }

  const applyJourneyRouteOptions = (): void => {
    const displayedOptions = getDisplayedJourneyOptions()
    if (displayedOptions.length === 0) {
      clearJourneyRouteLayers()
      return
    }
    if (!journeyRouteLayers) {
      installJourneyRouteLayers()
      return
    }
    journeyRouteLayers.setJourneyOptions(displayedOptions, selectedJourneyCandidateKey)
  }

  const getJourneyStopRoutes = (): ReadonlyMap<string, readonly JourneyStopRoute[]> | null => {
    const displayedPath = getDisplayedPath()
    if (displayedPath === null) return null
    const stopRoutes = new Map<string, JourneyStopRoute[]>()
    if (!currentTransitIndex) return stopRoutes

    for (const leg of displayedPath.legs) {
      if (leg.mode !== 'shuttle') continue
      const route = currentTransitIndex.routeById.get(leg.routeId) ?? null
      const stopIds = getBusPathLegStopIds(leg, route)
      if (!route || !stopIds) continue

      for (const stopId of stopIds) {
        const routes = stopRoutes.get(stopId) ?? []
        if (!routes.some(({ routeId }) => routeId === route.id)) {
          routes.push({ routeId: route.id, routeName: route.name, color: route.color })
        }
        stopRoutes.set(stopId, routes)
      }
    }
    return stopRoutes
  }

  const applyJourneyPresentation = (): void => {
    const journeyActive = getDisplayedPath() !== null
    transitRouteLayers?.setJourneyActive(journeyActive)
    shuttleStopMarkers?.setJourneyStops(getJourneyStopRoutes())
  }

  const reconcileRouteSelection = (selection: MapRouteSelection): MapRouteSelection => {
    const routeId = selection.route?.id
    const route = routeId && currentTransitIndex
      ? currentTransitIndex.routeById.get(routeId) ?? null
      : null
    if (!route) {
      return { route: null, overlappingRouteIds: EMPTY_ROUTE_OVERLAP }
    }

    const overlappingRouteIds = new Set<string>()
    for (const overlappingRouteId of selection.overlappingRouteIds) {
      if (currentTransitIndex?.routeById.has(overlappingRouteId)) {
        overlappingRouteIds.add(overlappingRouteId)
      }
    }
    return { route, overlappingRouteIds }
  }

  const applyRouteSelection = (selection: MapRouteSelection) => {
    transitRouteLayers?.setSelection(
      selection.route?.id ?? null,
      selection.overlappingRouteIds,
    )
    shuttleStopMarkers?.setSelection(
      selection.route?.stopIds ?? null,
      selection.route?.color ?? null,
    )
  }

  return {
    ready,

    loadTransitData(
      data: LoadedTransitData,
      selection: MapRouteSelection,
      onSetEndpoint?: (role: TripEndpointRole, endpoint: TripEndpoint) => void,
    ) {
      if (disposed) return

      const previousRouteId = currentRouteSelection.route?.id ?? null
      clearJourneyRouteLayers()
      clearTransitData()
      transitData = data
      currentTransitIndex = data.index
      if (stopsPinStopId && !data.index.stopById.has(stopsPinStopId)) stopsPinStopId = null
      transitRouteLayers = createTransitRouteLayers(map, data.geometry)
      const routeColors = new Map(data.index.routes.map(({ id, color }) => [id, color] as const))
      shuttleStopMarkers = createShuttleStopMarkers(
        map,
        data.index.stops,
        onSetEndpoint,
        options.onStopSelected,
        routeColors,
      )
      if (!shuttleStopMarkers.setStopsPin(stopsPinStopId, stopsPinVisible)) {
        stopsPinStopId = null
        shuttleStopMarkers.setStopsPin(null, stopsPinVisible)
      }
      currentRouteSelection = reconcileRouteSelection(selection)
      applyRouteSelection(currentRouteSelection)
      applyJourneyPresentation()
      syncEndpointMarkers()
      const nextRouteId = currentRouteSelection.route?.id ?? null
      if (nextRouteId !== previousRouteId) {
        pendingCameraFit = { kind: 'route', routeId: nextRouteId }
      }
      installJourneyRouteLayers()
    },

    setRouteSelection(selection: MapRouteSelection, fit = true) {
      if (disposed) return

      const previousRouteId = currentRouteSelection.route?.id ?? null
      currentRouteSelection = currentTransitIndex
        ? reconcileRouteSelection(selection)
        : {
            route: selection.route,
            overlappingRouteIds: new Set(selection.overlappingRouteIds),
          }
      const nextRouteId = currentRouteSelection.route?.id ?? null
      applyRouteSelection(currentRouteSelection)

      if (!fit) pendingCameraFit = null
      if (fit && nextRouteId !== previousRouteId && transitData && getDisplayedPath() === null) {
        pendingCameraFit = { kind: 'route', routeId: nextRouteId }
      }
    },

    refitRoute() {
      if (disposed || !transitData || !currentRouteSelection.route) return
      transitRouteLayers?.fitRoute(
        transitData.index,
        transitData.geometry,
        currentRouteSelection.route.id,
        viewportInsets,
      )
    },

    focusStop(stopId: string) {
      if (disposed) return
      const stop = currentTransitIndex?.stopById.get(stopId)
      if (!stop || !shuttleStopMarkers?.openStopPopup(stopId)) return
      flyToStop(stopId, Math.max(map.getZoom(), 16), 56)
    },

    focusStopInStopsTab(stopId: string) {
      if (disposed || !currentTransitIndex?.stopById.has(stopId)) return
      if (!shuttleStopMarkers?.setStopsPin(stopId, stopsPinVisible)) return
      stopsPinStopId = stopId
      flyToStop(stopId, 17, 0)
    },

    setStopsPinVisible(visible: boolean) {
      if (disposed) return
      stopsPinVisible = visible
      shuttleStopMarkers?.setStopsPin(stopsPinStopId, visible)
    },

    setTripRequest(
      request: TripRequest,
      venues: VenueLocationMap,
      transitIndex: TransitIndex | null,
      buildings: BuildingIndex | null = null,
    ) {
      if (disposed) return

      currentTripRequest = request
      currentVenues = venues
      currentTransitIndex = transitIndex
      currentBuildings = buildings
      syncEndpointMarkers()
    },

    setPlanLayersVisible(visible: boolean) {
      if (disposed || planLayersVisible === visible) return
      planLayersVisible = visible
      try {
        syncEndpointMarkers()
        applyJourneyPresentation()
        applyJourneyRouteOptions()
      } catch (error) {
        clearJourneyRouteLayers()
        options.onMapError(error)
      }
    },

    setJourneyOptions(
      journeyOptions: readonly MapJourneyOption[],
      selectedCandidateKey: string | null,
      fitOverview = false,
    ) {
      if (disposed) return
      currentJourneyOptions = [...journeyOptions]
      selectedJourneyCandidateKey = currentJourneyOptions.some(({ candidateKey }) => (
        candidateKey === selectedCandidateKey
      )) ? selectedCandidateKey : null
      currentPath = currentJourneyOptions.find(({ candidateKey }) => (
        candidateKey === selectedJourneyCandidateKey
      ))?.path ?? null
      if (currentPath !== null && pendingCameraFit?.kind === 'route') pendingCameraFit = null
      if (currentJourneyOptions.length === 0 && pendingCameraFit?.kind === 'journey') {
        pendingCameraFit = null
      }
      try {
        applyJourneyPresentation()
        applyJourneyRouteOptions()
        if (fitOverview && getDisplayedJourneyOptions().length > 0) {
          pendingCameraFit = { kind: 'journey' }
          if (viewportInsetsReady) {
            pendingCameraFit = null
            fitJourneyOptions(currentJourneyOptions)
          }
        }
      } catch (error) {
        currentJourneyOptions = []
        selectedJourneyCandidateKey = null
        currentPath = null
        clearJourneyRouteLayers()
        applyJourneyPresentation()
        options.onMapError(error)
      }
    },

    fitJourneyRoutes() {
      if (disposed || getDisplayedJourneyOptions().length === 0) return
      pendingCameraFit = null
      fitJourneyOptions(currentJourneyOptions)
    },

    setCurrentLocation(fix: DeviceLocationFix | null, visible: boolean) {
      if (disposed) return
      currentLocationMarker.setLocation(fix, visible)
    },

    focusCurrentLocation(fix: DeviceLocationFix) {
      if (disposed) return
      pendingCameraFit = null
      map.once('moveend', currentLocationMarker.pulse)
      map.flyTo({
        center: [fix.longitude, fix.latitude],
        zoom: 17,
        duration: 500,
        offset: getFitOffset(),
        essential: true,
      })
    },

    setViewportInsets(insets: MapViewportInsets) {
      if (disposed) return
      viewportInsets = { ...insets }
      viewportInsetsReady = true
      lifecycle.setViewportInsets(viewportInsets)
      const pendingFit = pendingCameraFit
      pendingCameraFit = null
      if (pendingFit?.kind === 'venue') {
        fitVenue(pendingFit.venue)
      } else if (pendingFit?.kind === 'building') {
        fitBuilding(pendingFit.locations as NonNullable<VenueLocation['location']>[])
      } else if (pendingFit?.kind === 'route' && transitData) {
        transitRouteLayers?.fitRoute(
          transitData.index,
          transitData.geometry,
          pendingFit.routeId,
          viewportInsets,
        )
      } else if (pendingFit?.kind === 'journey') {
        fitJourneyOptions(getDisplayedJourneyOptions())
      }
    },

    dismissStopPopup() {
      if (disposed) return false
      return shuttleStopMarkers?.dismissPopup() ?? false
    },

    dismissPopup() {
      if (disposed) return false
      if (shuttleStopMarkers?.dismissPopup()) return true
      const closeButton = map.getContainer().querySelector<HTMLButtonElement>(
        '.maplibregl-popup-close-button',
      )
      if (!closeButton) return false
      closeButton.click()
      return true
    },

    zoomIn() {
      if (disposed) return
      map.zoomIn({ duration: 200 })
    },

    zoomOut() {
      if (disposed) return
      map.zoomOut({ duration: 200 })
    },

    resetView(target: MapResetTarget) {
      if (disposed) return
      pendingCameraFit = null
      if (target.kind === 'venue' || target.kind === 'campus') {
        map.flyTo({
          center: [target.center[0], target.center[1]],
          zoom: target.zoom,
          duration: 500,
          offset: getFitOffset(),
          essential: true,
        })
        return
      }
      if (target.kind === 'trip') {
        fitTripEndpoints(target.coordinates)
        return
      }
      if (transitData) {
        transitRouteLayers?.fitRoute(
          transitData.index,
          transitData.geometry,
          target.routeId,
          viewportInsets,
        )
      }
    },

    selectVenue(venue: VenueLocation) {
      if (disposed) return

      clearVenueMarker()
      const marker = createVenueMarker(map, venue)
      if (!marker || !venue.location) return

      selectedVenueMarker = marker
      pendingCameraFit = { kind: 'venue', venue }
    },

    selectBuilding(building) {
      if (disposed) return

      clearVenueMarker()
      const markers = building.locations.flatMap((location) => {
        const marker = createVenueMarker(map, { roomName: building.name, location })
        return marker ? [marker] : []
      })
      if (markers.length === 0) return

      selectedVenueMarker = {
        dispose() {
          for (const marker of markers) marker.dispose()
        },
      }
      pendingCameraFit = { kind: 'building', locations: building.locations }
    },

    clearVenue() {
      clearVenueMarker()
    },

    dispose() {
      if (disposed) return
      disposed = true
      pendingCameraFit = null
      clearVenueMarker()
      clearEndpointMarkers()
      clearTransitData()
      currentPath = null
      clearJourneyRouteLayers()
      currentLocationMarker.dispose()
      lifecycle.dispose()
    },
  }
}
