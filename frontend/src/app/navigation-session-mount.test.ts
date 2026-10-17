import { describe, expect, it, vi } from 'vitest'
import type { LoadedTransitData } from './contracts/data'
import type { LocationTracker } from './contracts/location'
import { INITIAL_LOCATION_TRACKING_STATE } from '../domain/location/types'
import type { MapSession, MapSessionOptions } from './contracts/map'
import {
  createInitialNavigationSessionState,
  type NavigationSession,
} from './navigation-session'
import {
  createNavigationSessionCommandAdapter,
  createNavigationSessionMount,
} from './navigation-session-mount'

function createMapDouble(): MapSession {
  return {
    ready: Promise.resolve(),
    loadTransitData: vi.fn(),
    setRouteSelection: vi.fn(),
    refitRoute: vi.fn(),
    focusStop: vi.fn(),
    focusStopInStopsTab: vi.fn(),
    setStopsPinVisible: vi.fn(),
    setPlanLayersVisible: vi.fn(),
    setTripRequest: vi.fn(),
    setJourneyOptions: vi.fn(),
    fitJourneyRoutes: vi.fn(),
    setCurrentLocation: vi.fn(),
    focusCurrentLocation: vi.fn(),
    setViewportInsets: vi.fn(),
    dismissStopPopup: vi.fn(() => false),
    dismissPopup: vi.fn(() => false),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetView: vi.fn(),
    selectVenue: vi.fn(),
    selectBuilding: vi.fn(),
    clearVenue: vi.fn(),
    dispose: vi.fn(),
  }
}

function createSessionDouble(overrides: Partial<NavigationSession> = {}): NavigationSession {
  return {
    getState: vi.fn(() => createInitialNavigationSessionState()),
    subscribe: vi.fn(() => () => undefined),
    start: vi.fn(async () => undefined),
    setViewportInsets: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    fitJourneyRoutes: vi.fn(),
    resetView: vi.fn(),
    setTripEndpoint: vi.fn(),
    navigateTo: vi.fn(),
    replanPath: vi.fn(),
    searchPaths: vi.fn(),
    selectJourneyOption: vi.fn(),
    clearTripEndpoint: vi.fn(),
    swapTripEndpoints: vi.fn(),
    clearTrip: vi.fn(),
    setExploreQuery: vi.fn(),
    selectVenue: vi.fn(),
    selectBuilding: vi.fn(),
    enterMobileRoutes: vi.fn(),
    suspendMobileRoutes: vi.fn(),
    leaveMobileRoutes: vi.fn(),
    selectMobileRoute: vi.fn(),
    focusStop: vi.fn(),
    focusStopInStopsTab: vi.fn(),
    setStopsPinVisible: vi.fn(),
    setPlanLayersVisible: vi.fn(),
    enableLocationTracking: vi.fn(),
    locateUser: vi.fn(),
    useCurrentLocationForOrigin: vi.fn(),
    cancelOriginLocationRequest: vi.fn(),
    disableLocationTracking: vi.fn(),
    hideLocationMarker: vi.fn(),
    showLocationMarker: vi.fn(),
    back: vi.fn(),
    escape: vi.fn(),
    closeToRoot: vi.fn(),
    handleMapClick: vi.fn(),
    dismissStopPopup: vi.fn(() => false),
    dismissMapPopup: vi.fn(() => false),
    reportMapError: vi.fn(),
    reportStartupFailure: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  }
}

function createMountDependencies(
  map: MapSession,
  session: NavigationSession,
) {
  let mapOptions: MapSessionOptions | null = null
  const locationTracker: LocationTracker = {
    getState: () => INITIAL_LOCATION_TRACKING_STATE,
    subscribe: vi.fn(() => () => undefined),
    enable: vi.fn(),
    disable: vi.fn(),
    dispose: vi.fn(),
  }
  return {
    createMapSession: vi.fn((options: MapSessionOptions) => {
      mapOptions = options
      return map
    }),
    createNavigationSession: vi.fn(() => session),
    loadVenues: vi.fn(async () => ({ venues: {}, venueCount: 0 })),
    loadTransit: vi.fn(async () => new Promise<LoadedTransitData>(() => undefined)),
    pathfinder: vi.fn(async () => ({ outcome: 'no-path' as const })),
    locationTracker,
    getMapOptions: () => mapOptions,
  }
}

describe('navigation session application seam', () => {
  it('installs one map/session pair per mount and disposes it on unmount', () => {
    const map = createMapDouble()
    const session = createSessionDouble()
    const dependencies = createMountDependencies(map, session)
    const container = {} as HTMLElement

    const mount = createNavigationSessionMount(container, dependencies)
    const mapOptions = dependencies.getMapOptions()
    const mapError = new Error('tile failure')
    mapOptions?.onMapError(mapError)
    mapOptions?.onEmptyMapClick()
    expect(session.reportMapError).toHaveBeenCalledWith(mapError)
    expect(session.handleMapClick).toHaveBeenCalledOnce()

    expect(dependencies.createMapSession).toHaveBeenCalledOnce()
    expect(dependencies.createMapSession).toHaveBeenCalledWith(expect.objectContaining({ container }))
    expect(dependencies.createNavigationSession).toHaveBeenCalledOnce()
    expect(dependencies.createNavigationSession).toHaveBeenCalledWith({
      map,
      loadVenues: dependencies.loadVenues,
      loadTransit: dependencies.loadTransit,
      pathfinder: dependencies.pathfinder,
      locationTracker: dependencies.locationTracker,
    })
    expect(session.start).toHaveBeenCalledOnce()

    const startSignal = vi.mocked(session.start).mock.calls[0]?.[0]
    expect(startSignal).toBeInstanceOf(AbortSignal)
    mount.dispose()

    expect(startSignal?.aborted).toBe(true)
    expect(session.dispose).toHaveBeenCalledOnce()
    mapOptions?.onMapError(new Error('late tile failure'))
    mapOptions?.onEmptyMapClick()
    expect(session.reportMapError).toHaveBeenCalledOnce()
    expect(session.handleMapClick).toHaveBeenCalledOnce()
    mount.dispose()
    expect(session.dispose).toHaveBeenCalledOnce()
  })

  it('routes map option selection through the shared session and reports its source', () => {
    const map = createMapDouble()
    const state = createInitialNavigationSessionState()
    const session = createSessionDouble({
      getState: vi.fn(() => ({
        ...state,
        path: {
          ...state.path,
          displayedCandidates: [{ candidateKey: 'option-b' }] as never,
        },
      })),
    })
    const onMapJourneyOptionSelected = vi.fn()
    const dependencies = createMountDependencies(map, session)
    const mount = createNavigationSessionMount({} as HTMLElement, {
      ...dependencies,
      onMapJourneyOptionSelected,
    })
    const mapOptions = dependencies.getMapOptions()

    mapOptions?.onJourneyOptionSelected?.('option-b')

    expect(session.selectJourneyOption).toHaveBeenCalledWith('option-b')
    expect(onMapJourneyOptionSelected).toHaveBeenCalledWith('option-b')
    mapOptions?.onJourneyOptionSelected?.('stale-option')
    expect(session.selectJourneyOption).toHaveBeenCalledOnce()
    expect(onMapJourneyOptionSelected).toHaveBeenCalledOnce()
    mount.dispose()
    mapOptions?.onJourneyOptionSelected?.('option-c')
    expect(session.selectJourneyOption).toHaveBeenCalledOnce()
    expect(onMapJourneyOptionSelected).toHaveBeenCalledOnce()
  })

  it('surfaces a safe startup failure after a non-abort rejection', async () => {
    const startupError = new Error('map effect failed')
    let state = createInitialNavigationSessionState()
    const reportStartupFailure = vi.fn(() => {
      state = {
        ...state,
        startupFailure: { message: 'Unable to start map navigation' },
        status: 'Unable to start map navigation',
      }
    })
    const session = createSessionDouble({
      getState: vi.fn(() => state),
      start: vi.fn(async () => {
        throw startupError
      }),
      reportStartupFailure,
    })
    const dependencies = createMountDependencies(createMapDouble(), session)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const mount = createNavigationSessionMount({} as HTMLElement, dependencies)
      await vi.waitFor(() => expect(reportStartupFailure).toHaveBeenCalledOnce())
      expect(session.getState().status).toBe('Unable to start map navigation')
      expect(session.getState().status).not.toBe('Loading map data…')
      expect(consoleError).toHaveBeenCalledWith(
        'Navigation session startup failed:',
        startupError,
      )
      mount.dispose()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('keeps command callbacks stable for the mounted session', () => {
    const session = createSessionDouble()
    const adapter = createNavigationSessionCommandAdapter()

    const firstCommands = adapter(session)
    const secondCommands = adapter(session)

    expect(secondCommands).toBe(firstCommands)
    expect(secondCommands.selectOriginEndpoint).toBe(firstCommands.selectOriginEndpoint)
    firstCommands.selectOriginEndpoint({ kind: 'venue', id: 'COM1' })
    expect(session.setTripEndpoint).toHaveBeenCalledWith('origin', { kind: 'venue', id: 'COM1' })
    firstCommands.navigateToEndpoint({ kind: 'stop', id: 'STOP-A' })
    expect(session.navigateTo).toHaveBeenCalledWith({ kind: 'stop', id: 'STOP-A' })
    firstCommands.searchPaths()
    expect(session.searchPaths).toHaveBeenCalledOnce()
    firstCommands.selectJourneyOption('option-a')
    expect(session.selectJourneyOption).toHaveBeenCalledWith('option-a')
    firstCommands.fitJourneyRoutes()
    expect(session.fitJourneyRoutes).toHaveBeenCalledOnce()
    expect(firstCommands.dismissMapPopup()).toBe(false)
    expect(session.dismissMapPopup).toHaveBeenCalledOnce()
    expect(firstCommands.dismissStopPopup()).toBe(false)
    expect(session.dismissStopPopup).toHaveBeenCalledOnce()
    firstCommands.focusStopInStopsTab('STOP-A')
    firstCommands.setStopsPinVisible(true)
    expect(session.focusStopInStopsTab).toHaveBeenCalledWith('STOP-A')
    expect(session.setStopsPinVisible).toHaveBeenCalledWith(true)
    firstCommands.setPlanLayersVisible(false)
    expect(session.setPlanLayersVisible).toHaveBeenCalledWith(false)
    firstCommands.enableLocationTracking()
    firstCommands.locateUser()
    firstCommands.disableLocationTracking()
    firstCommands.hideLocationMarker()
    firstCommands.showLocationMarker()
    expect(session.enableLocationTracking).toHaveBeenCalledOnce()
    expect(session.locateUser).toHaveBeenCalledOnce()
    expect(session.disableLocationTracking).toHaveBeenCalledOnce()
    expect(session.hideLocationMarker).toHaveBeenCalledOnce()
    expect(session.showLocationMarker).toHaveBeenCalledOnce()

    const replacement = createSessionDouble()
    expect(adapter(replacement)).not.toBe(firstCommands)
  })
})
