import type { LoadedTransitData, LoadedVenueData } from './contracts/data'
import type { LocationTracker } from './contracts/location'
import type { MapSession, MapSessionOptions } from './contracts/map'
import type { MapViewportInsets } from './contracts/map'
import type { JourneyPlanningClient } from '../infrastructure/pathfinding/client.ts'
import type {
  NavigationSession,
  NavigationSessionDependencies,
} from './navigation-session'

export interface NavigationSessionMountDependencies {
  readonly createMapSession: (options: MapSessionOptions) => MapSession
  readonly createNavigationSession: (
    dependencies: NavigationSessionDependencies,
  ) => NavigationSession
  readonly loadVenues: (signal: AbortSignal) => Promise<LoadedVenueData>
  readonly loadTransit: (signal: AbortSignal) => Promise<LoadedTransitData>
  readonly pathfinder: JourneyPlanningClient
  readonly locationTracker: LocationTracker
  readonly onStopSelected?: (stopId: string) => boolean
  readonly onMapStopInteraction?: (stopId: string) => void
  readonly onMapStopDestinationSet?: (stopId: string) => void
  readonly onMapJourneyOptionSelected?: (candidateKey: string) => void
  readonly onMapCenterChange?: MapSessionOptions['onMapCenterChange']
}

export interface NavigationSessionMount {
  readonly session: NavigationSession
  dispose(): void
}

export function createNavigationSessionMount(
  container: HTMLElement,
  dependencies: NavigationSessionMountDependencies,
): NavigationSessionMount {
  let session: NavigationSession | null = null
  const map = dependencies.createMapSession({
    container,
    onMapError: (error) => session?.reportMapError(error),
    onEmptyMapClick: () => session?.handleMapClick(),
    onStopSelected: dependencies.onStopSelected,
    onJourneyOptionSelected: (candidateKey) => {
      if (!session) return
      const isDisplayed = session.getState().path.displayedCandidates.some(({ candidateKey: key }) => (
        key === candidateKey
      ))
      if (!isDisplayed) return
      session.selectJourneyOption(candidateKey)
      dependencies.onMapJourneyOptionSelected?.(candidateKey)
    },
    onMapCenterChange: dependencies.onMapCenterChange,
  })
  session = dependencies.createNavigationSession({
    map,
    loadVenues: dependencies.loadVenues,
    loadTransit: dependencies.loadTransit,
    pathfinder: dependencies.pathfinder,
    locationTracker: dependencies.locationTracker,
    onMapStopInteraction: dependencies.onMapStopInteraction,
    onMapStopDestinationSet: dependencies.onMapStopDestinationSet,
  })

  const controller = new AbortController()
  void session.start(controller.signal).catch((error: unknown) => {
    if (error instanceof Error && error.name === 'AbortError') return
    console.error('Navigation session startup failed:', error)
    try {
      session?.reportStartupFailure()
    } catch (reportError) {
      console.error('Navigation session startup failure state update failed:', reportError)
    }
  })

  return {
    session,
    dispose() {
      controller.abort()
      session?.dispose()
      session = null
    },
  }
}

export interface NavigationSessionCommands {
  readonly swapTripEndpoints: () => void
  readonly selectOriginEndpoint: (
    endpoint: Parameters<NavigationSession['setTripEndpoint']>[1],
  ) => void
  readonly clearOriginEndpoint: () => void
  readonly selectDestinationEndpoint: (
    endpoint: Parameters<NavigationSession['setTripEndpoint']>[1],
  ) => void
  readonly navigateToEndpoint: (
    endpoint: Parameters<NavigationSession['navigateTo']>[0],
  ) => void
  readonly clearDestinationEndpoint: () => void
  readonly clearTrip: () => void
  readonly searchPaths: () => void
  readonly selectJourneyOption: (candidateKey: string) => void
  readonly setExploreQuery: (query: string) => void
  readonly selectVenue: (result: Parameters<NavigationSession['selectVenue']>[0]) => void
  readonly selectBuilding: (buildingId: string) => void
  readonly back: () => void
  readonly closeToRoot: () => void
  readonly escape: () => void
  readonly enterMobileRoutes: () => void
  readonly suspendMobileRoutes: () => void
  readonly leaveMobileRoutes: () => void
  readonly selectMobileRoute: (routeId: string) => void
  readonly focusStop: (stopId: string) => void
  readonly focusStopInStopsTab: (stopId: string) => void
  readonly setStopsPinVisible: (visible: boolean) => void
  readonly setPlanLayersVisible: (visible: boolean) => void
  readonly enableLocationTracking: () => void
  readonly locateUser: () => void
  readonly useCurrentLocationForOrigin: () => void
  readonly cancelOriginLocationRequest: () => void
  readonly disableLocationTracking: () => void
  readonly hideLocationMarker: () => void
  readonly showLocationMarker: () => void
  readonly setViewportInsets: (insets: MapViewportInsets) => void
  readonly dismissStopPopup: () => boolean
  readonly dismissMapPopup: () => boolean
  readonly zoomIn: () => void
  readonly zoomOut: () => void
  readonly fitJourneyRoutes: () => void
  readonly resetView: () => void
}

function createNavigationSessionCommands(
  session: NavigationSession | null,
): NavigationSessionCommands {
  return {
    swapTripEndpoints: () => session?.swapTripEndpoints(),
    selectOriginEndpoint: (endpoint) => session?.setTripEndpoint('origin', endpoint),
    clearOriginEndpoint: () => session?.clearTripEndpoint('origin'),
    selectDestinationEndpoint: (endpoint) => session?.setTripEndpoint('destination', endpoint),
    navigateToEndpoint: (endpoint) => session?.navigateTo(endpoint),
    clearDestinationEndpoint: () => session?.clearTripEndpoint('destination'),
    clearTrip: () => session?.clearTrip(),
    searchPaths: () => session?.searchPaths(),
    selectJourneyOption: (candidateKey) => session?.selectJourneyOption(candidateKey),
    setExploreQuery: (query) => session?.setExploreQuery(query),
    selectVenue: (result) => session?.selectVenue(result),
    selectBuilding: (buildingId) => session?.selectBuilding(buildingId),
    back: () => session?.back(),
    closeToRoot: () => session?.closeToRoot(),
    escape: () => session?.escape(),
    enterMobileRoutes: () => session?.enterMobileRoutes(),
    suspendMobileRoutes: () => session?.suspendMobileRoutes(),
    leaveMobileRoutes: () => session?.leaveMobileRoutes(),
    selectMobileRoute: (routeId) => session?.selectMobileRoute(routeId),
    focusStop: (stopId) => session?.focusStop(stopId),
    focusStopInStopsTab: (stopId) => session?.focusStopInStopsTab(stopId),
    setStopsPinVisible: (visible) => session?.setStopsPinVisible(visible),
    setPlanLayersVisible: (visible) => session?.setPlanLayersVisible(visible),
    enableLocationTracking: () => session?.enableLocationTracking(),
    locateUser: () => session?.locateUser(),
    useCurrentLocationForOrigin: () => session?.useCurrentLocationForOrigin(),
    cancelOriginLocationRequest: () => session?.cancelOriginLocationRequest(),
    disableLocationTracking: () => session?.disableLocationTracking(),
    hideLocationMarker: () => session?.hideLocationMarker(),
    showLocationMarker: () => session?.showLocationMarker(),
    setViewportInsets: (insets) => session?.setViewportInsets(insets),
    dismissStopPopup: () => session?.dismissStopPopup() ?? false,
    dismissMapPopup: () => session?.dismissMapPopup() ?? false,
    zoomIn: () => session?.zoomIn(),
    zoomOut: () => session?.zoomOut(),
    fitJourneyRoutes: () => session?.fitJourneyRoutes(),
    resetView: () => session?.resetView(),
  }
}

export function createNavigationSessionCommandAdapter(): (
  session: NavigationSession | null,
) => NavigationSessionCommands {
  let initialized = false
  let currentSession: NavigationSession | null = null
  let currentCommands: NavigationSessionCommands

  return (session) => {
    if (initialized && session === currentSession) return currentCommands
    initialized = true
    currentSession = session
    currentCommands = createNavigationSessionCommands(session)
    return currentCommands
  }
}
