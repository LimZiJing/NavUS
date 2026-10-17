// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTransitIndex } from '../domain/transit'
import { createValidTransitNetwork } from '../domain/transit/test-fixtures'
import type { Path } from '@navus/shared/routing/path'
import type { ScoredPathCandidate } from '@navus/shared/routing/path'
import App from './app'
import { createInitialNavigationSessionState } from './navigation-session'

const appHarness = vi.hoisted(() => {
  const noop = () => undefined
  const commandStubs = {
    navigateToEndpoint: vi.fn(),
    locateUser: vi.fn(),
    suspendMobileRoutes: vi.fn(),
  }
  return {
    state: null as unknown,
    onStopSelected: null as ((stopId: string) => boolean) | null,
    onMapStopInteraction: null as ((stopId: string) => void) | null,
    onMapStopDestinationSet: null as ((stopId: string) => void) | null,
    onMapJourneyOptionSelected: null as ((candidateKey: string) => void) | null,
    session: {
      locateUser: vi.fn(),
      enableLocationTracking: vi.fn(),
    },
    commands: new Proxy(commandStubs, {
      get: (target, property, receiver) => Reflect.get(target, property, receiver) ?? noop,
    }),
    arrivalsClient: {
      getArrivals: vi.fn(),
    },
    serviceHoursClient: {
      getServiceWindows: vi.fn(),
    },
  }
})

vi.mock('./navigation-session-mount', () => ({
  createNavigationSessionMount: (
    _container: HTMLElement,
    dependencies: {
      onStopSelected?: (stopId: string) => boolean
      onMapStopInteraction?: (stopId: string) => void
      onMapStopDestinationSet?: (stopId: string) => void
      onMapJourneyOptionSelected?: (candidateKey: string) => void
      onMapCenterChange?: (center: readonly [number, number]) => void
    },
  ) => {
    appHarness.onStopSelected = dependencies.onStopSelected ?? null
    appHarness.onMapStopInteraction = dependencies.onMapStopInteraction ?? null
    appHarness.onMapStopDestinationSet = dependencies.onMapStopDestinationSet ?? null
    appHarness.onMapJourneyOptionSelected = dependencies.onMapJourneyOptionSelected ?? null
    dependencies.onMapCenterChange?.([103, 1])
    return {
      session: appHarness.session,
      dispose: () => undefined,
    }
  },
  createNavigationSessionCommandAdapter: () => () => appHarness.commands,
}))

vi.mock('./use-navigation-session', () => ({
  useNavigationSession: () => appHarness.state,
}))

vi.mock('../infrastructure/map/session', () => ({
  createMapSession: vi.fn(),
}))

vi.mock('../infrastructure/shuttle-arrivals/client', () => ({
  createShuttleArrivalClient: () => appHarness.arrivalsClient,
}))

vi.mock('../infrastructure/shuttle-service-hours/client', () => ({
  createShuttleServiceHoursClient: () => appHarness.serviceHoursClient,
}))

function mockDesktopViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
}

function mockMobileViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  })
}

function createJourneySelectionState() {
  const baseState = createInitialNavigationSessionState()
  const path: Path = {
    origin: { kind: 'venue', id: 'ORIGIN' },
    destination: { kind: 'venue', id: 'DESTINATION' },
    legs: [{
      mode: 'walking',
      from: { kind: 'venue', id: 'ORIGIN' },
      to: { kind: 'venue', id: 'DESTINATION' },
      durationSeconds: 60,
      distanceMeters: 100,
      geometry: { type: 'LineString', coordinates: [[103, 1], [103.01, 1.01]] },
    }],
    totalDurationSeconds: 60,
    totalDistanceMeters: 100,
    estimateStatus: 'estimated',
    planningQuality: 'exact',
  }
  const selectedCandidate: ScoredPathCandidate = {
    candidateKey: 'option-a', path, adjustedDurationSeconds: 60, score: 1 / 60,
  }
  const otherCandidate: ScoredPathCandidate = {
    candidateKey: 'option-b',
    path: { ...path, totalDurationSeconds: 120 },
    adjustedDurationSeconds: 120,
    score: 1 / 120,
  }
  return {
    state: {
      ...baseState,
      transitIndex: createTransitIndex(createValidTransitNetwork()),
      path: {
        ...baseState.path,
        status: 'ready',
        path,
        candidates: [selectedCandidate, otherCandidate],
        displayedCandidates: [selectedCandidate, otherCandidate],
        selectedCandidateKey: selectedCandidate.candidateKey,
      },
    },
  }
}

beforeEach(() => {
  mockDesktopViewport()
  appHarness.arrivalsClient.getArrivals.mockResolvedValue({
    observedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    stops: {},
  })
  appHarness.serviceHoursClient.getServiceWindows.mockResolvedValue({})
  appHarness.state = {
    ...createInitialNavigationSessionState(),
    transitIndex: createTransitIndex(createValidTransitNetwork()),
  }
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  appHarness.onStopSelected = null
  appHarness.onMapStopInteraction = null
  appHarness.onMapStopDestinationSet = null
  appHarness.onMapJourneyOptionSelected = null
  appHarness.session.locateUser.mockReset()
  appHarness.session.enableLocationTracking.mockReset()
  appHarness.arrivalsClient.getArrivals.mockReset()
  appHarness.serviceHoursClient.getServiceWindows.mockReset()
  appHarness.commands.navigateToEndpoint.mockReset()
  appHarness.commands.locateUser.mockReset()
  appHarness.commands.suspendMobileRoutes.mockReset()
})

describe('desktop shared navigation shell', () => {
  it('shows Fit routes only while Plan is active for a retained Journey', async () => {
    const user = userEvent.setup()
    const baseState = createInitialNavigationSessionState()
    const path: Path = {
      origin: { kind: 'venue', id: 'ORIGIN' },
      destination: { kind: 'venue', id: 'DESTINATION' },
      legs: [{
        mode: 'walking',
        from: { kind: 'venue', id: 'ORIGIN' },
        to: { kind: 'venue', id: 'DESTINATION' },
        durationSeconds: 60,
        distanceMeters: 100,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.01, 1.01]] },
      }],
      totalDurationSeconds: 60,
      totalDistanceMeters: 100,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }
    const candidate: ScoredPathCandidate = {
      candidateKey: 'retained-journey',
      path,
      adjustedDurationSeconds: 60,
      score: 1 / 60,
    }
    appHarness.state = {
      ...baseState,
      transitIndex: createTransitIndex(createValidTransitNetwork()),
      path: {
        ...baseState.path,
        status: 'ready',
        path,
        candidates: [candidate],
        displayedCandidates: [candidate],
        selectedCandidateKey: candidate.candidateKey,
      },
    }
    render(<App />)

    expect(screen.queryByRole('button', { name: 'Fit routes' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByRole('button', { name: 'Fit routes' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Explore' }))
    expect(screen.queryByRole('button', { name: 'Fit routes' })).toBeNull()
  })

  it('preserves the selected option when switching tabs with the same Journey results', async () => {
    const user = userEvent.setup()
    const baseState = createInitialNavigationSessionState()
    const path: Path = {
      origin: { kind: 'venue', id: 'ORIGIN' },
      destination: { kind: 'venue', id: 'DESTINATION' },
      legs: [{
        mode: 'walking',
        from: { kind: 'venue', id: 'ORIGIN' },
        to: { kind: 'venue', id: 'DESTINATION' },
        durationSeconds: 60,
        distanceMeters: 100,
        geometry: { type: 'LineString', coordinates: [[103, 1], [103.01, 1.01]] },
      }],
      totalDurationSeconds: 60,
      totalDistanceMeters: 100,
      estimateStatus: 'estimated',
      planningQuality: 'exact',
    }
    const first: ScoredPathCandidate = {
      candidateKey: 'option-a', path, adjustedDurationSeconds: 60, score: 1 / 60,
    }
    const second: ScoredPathCandidate = {
      candidateKey: 'option-b',
      path: { ...path, totalDurationSeconds: 120 },
      adjustedDurationSeconds: 120,
      score: 1 / 120,
    }
    appHarness.state = {
      ...baseState,
      transitIndex: createTransitIndex(createValidTransitNetwork()),
      path: {
        ...baseState.path,
        status: 'ready',
        path: second.path,
        candidates: [first, second],
        displayedCandidates: [first, second],
        selectedCandidateKey: second.candidateKey,
      },
    }
    render(<App />)

    const expectSecondSelected = (): void => {
      const summaries = Array.from(document.querySelectorAll('.journey-option-summary'))
      expect(summaries).toHaveLength(2)
      expect(summaries[0]?.getAttribute('aria-current')).toBeNull()
      expect(summaries[1]?.getAttribute('aria-current')).toBe('true')
    }
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    expectSecondSelected()
    await user.click(screen.getByRole('button', { name: 'Explore' }))
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    expectSecondSelected()
  })

  it('uses the shared Navigate command from venue details and opens Plan', async () => {
    const user = userEvent.setup()
    const venue = { roomName: 'Computing 1', location: { x: 103.7, y: 1.3 } }
    appHarness.state = {
      ...createInitialNavigationSessionState(),
      transitIndex: createTransitIndex(createValidTransitNetwork()),
      venues: { COM1: venue },
      exploreState: {
        mode: 'venue-detail',
        query: '',
        selectedVenue: { code: 'COM1', venue },
        history: [],
      },
    }
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Explore' }))
    appHarness.commands.navigateToEndpoint.mockClear()
    appHarness.commands.locateUser.mockClear()
    await user.click(screen.getByRole('button', { name: 'Navigate' }))

    expect(appHarness.commands.navigateToEndpoint).toHaveBeenCalledWith({ kind: 'venue', id: 'COM1' })
    expect(appHarness.commands.locateUser).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Plan' }).getAttribute('aria-current')).toBe('page')
  })

  it('starts on Stops and renders one active view at a time', () => {
    render(<App />)

    const navigation = screen.getByRole('navigation', { name: 'Map navigation tabs' })
    expect(within(navigation).getByRole('button', { name: 'Stops' }).getAttribute('aria-current'))
      .toBe('page')
    expect(screen.getByRole('region', { name: 'Stops' })).toBeTruthy()
    expect(document.getElementById('explore-panel')?.hasAttribute('hidden')).toBe(true)
    expect(document.getElementById('plan-panel')?.hasAttribute('hidden')).toBe(true)
    expect(document.getElementById('explore-panel')?.hasAttribute('inert')).toBe(true)
    expect(document.getElementById('plan-panel')?.hasAttribute('inert')).toBe(true)
  })

  it('switches to the unified Explore tab from the shared navigation', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Explore' }))

    expect(screen.getByRole('region', { name: 'Find a venue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bus routes' })).toBeTruthy()
    expect(document.getElementById('stops-panel')?.hasAttribute('hidden')).toBe(true)
  })

  it('requests location on initial desktop Stops activation', async () => {
    render(<App />)

    await waitFor(() => expect(appHarness.session.locateUser).toHaveBeenCalledOnce())
  })

  it('loads Stops timing data only while Stops is active', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => expect(appHarness.arrivalsClient.getArrivals).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: 'Explore' }))

    expect(appHarness.arrivalsClient.getArrivals).toHaveBeenCalledTimes(1)
  })

  it('opens an Explore map stop in Stops and returns keyboard focus to its marker', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Explore' }))
    const mapMarker = document.createElement('button')
    document.body.append(mapMarker)
    mapMarker.focus()

    act(() => {
      expect(appHarness.onStopSelected?.('STOP-A')).toBe(true)
    })

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Stop A, bus stop' })).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Stops' }).getAttribute('aria-current')).toBe('page')

    await user.click(screen.getByRole('button', { name: 'Back to stops' }))
    await waitFor(() => expect(document.activeElement).toBe(mapMarker))
    expect(screen.getByRole('button', { name: 'Explore' }).getAttribute('aria-current')).toBe('page')
    mapMarker.remove()
  })

  it('switches to Stops for a map popup origin action', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Explore' }))
    act(() => {
      appHarness.onMapStopInteraction?.('STOP-A')
    })

    await waitFor(() => expect(screen.getByRole('region', { name: 'Stops' })).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Stop A, bus stop' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stops' }).getAttribute('aria-current')).toBe('page')
  })

  it('opens Plan after a map popup sets the destination', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Explore' }))
    act(() => {
      appHarness.onMapStopDestinationSet?.('STOP-A')
    })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Plan' }).getAttribute('aria-current'))
      .toBe('page'))
    expect(screen.getByRole('region', { name: 'Trip endpoints' })).toBeTruthy()
  })

  it('preserves Stops view state while switching views', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Favourites' }))
    await user.click(screen.getByRole('button', { name: 'Explore' }))
    await user.click(screen.getByRole('button', { name: 'Stops' }))

    expect(screen.getByRole('button', { name: 'Favourites' }).getAttribute('aria-pressed'))
      .toBe('true')
  })
})

describe.each(['Stops', 'Explore'] as const)('map Journey selection from %s', (priorTab) => {
  it('activates Plan and reveals the selected card on desktop without moving focus', async () => {
    mockDesktopViewport()
    const { state } = createJourneySelectionState()
    appHarness.state = priorTab === 'Explore'
      ? { ...state, exploreState: { ...state.exploreState, mode: 'bus-routes' } }
      : state
    render(<App />)
    if (priorTab === 'Explore') await userEvent.setup().click(screen.getByRole('button', { name: 'Explore' }))

    const focused = document.createElement('button')
    document.body.append(focused)
    focused.focus()
    act(() => {
      appHarness.state = {
        ...appHarness.state as object,
        path: {
          ...(appHarness.state as { path: object }).path,
          selectedCandidateKey: 'option-b',
        },
      }
      appHarness.onMapJourneyOptionSelected?.('option-b')
    })

    expect(screen.getByRole('button', { name: 'Plan' }).getAttribute('aria-current')).toBe('page')
    expect(document.querySelector('[data-candidate-key="option-b"]')?.getAttribute('aria-current'))
      .toBe('true')
    expect(document.activeElement).toBe(focused)
    if (priorTab === 'Explore') {
      expect(appHarness.commands.suspendMobileRoutes).toHaveBeenCalledOnce()
    } else {
      expect(appHarness.commands.suspendMobileRoutes).not.toHaveBeenCalled()
    }
    focused.remove()
  })

  it('scrolls the selected option header inside Plan without focusing or resizing its mobile sheet', async () => {
    mockMobileViewport()
    const user = userEvent.setup()
    const { state } = createJourneySelectionState()
    appHarness.state = priorTab === 'Explore'
      ? { ...state, exploreState: { ...state.exploreState, mode: 'bus-routes' } }
      : state
    const { rerender } = render(<App />)
    if (priorTab === 'Explore') await user.click(screen.getByRole('button', { name: 'Explore' }))
    const content = document.querySelector<HTMLElement>('.plan-content-panel')
    const target = document.querySelector<HTMLElement>('[data-candidate-key="option-b"]')
    expect(content).toBeTruthy()
    expect(target).toBeTruthy()
    if (!content || !target) throw new Error('Plan option header was not rendered')

    Object.defineProperty(content, 'scrollTop', { configurable: true, writable: true, value: 0 })
    content.getBoundingClientRect = () => ({
      top: 100, bottom: 300, left: 0, right: 300, width: 300, height: 200, x: 0, y: 100,
      toJSON: () => ({}),
    })
    target.getBoundingClientRect = () => ({
      top: 320, bottom: 350, left: 0, right: 300, width: 300, height: 30, x: 0, y: 320,
      toJSON: () => ({}),
    })
    const focused = document.createElement('button')
    document.body.append(focused)
    focused.focus()
    const sheet = content.closest<HTMLElement>('[data-mobile-sheet]')
    const initialDetent = sheet?.dataset.detent

    act(() => appHarness.onMapJourneyOptionSelected?.('option-b'))
    appHarness.state = {
      ...appHarness.state as object,
      path: {
        ...(appHarness.state as { path: object }).path,
        selectedCandidateKey: 'option-b',
      },
    }
    act(() => rerender(<App />))

    expect(content.scrollTop).toBe(50)
    expect(document.activeElement).toBe(focused)
    expect(sheet?.dataset.detent).toBe(initialDetent)
    expect(screen.getByRole('button', { name: 'Plan' }).getAttribute('aria-current')).toBe('page')
    if (priorTab === 'Explore') {
      expect(appHarness.commands.suspendMobileRoutes).toHaveBeenCalledOnce()
    } else {
      expect(appHarness.commands.suspendMobileRoutes).not.toHaveBeenCalled()
    }
    focused.remove()
  })

  it('reopens a collapsed Plan sheet at its last detent for a map selection', async () => {
    mockMobileViewport()
    const user = userEvent.setup()
    const { state } = createJourneySelectionState()
    appHarness.state = state
    const { rerender } = render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    await user.click(screen.getByRole('button', { name: 'Expand Plan trip panel' }))
    await user.click(screen.getByRole('button', { name: 'Reduce Plan trip panel' }))
    await user.keyboard('{ArrowDown}')
    const sheet = document.querySelector<HTMLElement>('.plan-sheet')
    expect(sheet?.dataset.detent).toBe('collapsed')
    await user.click(screen.getByRole('button', { name: 'Stops' }))

    const focused = document.createElement('button')
    document.body.append(focused)
    focused.focus()
    act(() => {
      appHarness.state = {
        ...appHarness.state as object,
        path: {
          ...(appHarness.state as { path: object }).path,
          selectedCandidateKey: 'option-b',
        },
      }
      appHarness.onMapJourneyOptionSelected?.('option-b')
    })
    act(() => rerender(<App />))

    expect(screen.getByRole('button', { name: 'Plan' }).getAttribute('aria-current')).toBe('page')
    expect(sheet?.dataset.detent).toBe('partial')
    expect(document.querySelector('[data-candidate-key="option-b"]')?.getAttribute('aria-current'))
      .toBe('true')
    expect(document.activeElement).toBe(focused)
    focused.remove()
  })
})

describe('mobile drawer tab switches', () => {
  it('keeps every drawer open at the destination tab detent and hides inactive panels', async () => {
    mockMobileViewport()
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Expand Stops panel' }))
    await user.click(screen.getByRole('button', { name: 'Reduce Stops panel' }))
    await user.keyboard('{ArrowDown}')
    expect(document.querySelector('.stops-sheet')?.getAttribute('data-detent')).toBe('collapsed')

    await user.click(screen.getByRole('button', { name: 'Explore' }))
    const viewports = Array.from(document.querySelectorAll<HTMLElement>('.mobile-sheet-viewport'))
    expect(viewports).toHaveLength(3)
    expect(viewports.every((viewport) => viewport.hasAttribute('data-open'))).toBe(true)
    expect(document.querySelector('.stops-sheet')?.getAttribute('data-detent')).toBe('collapsed')
    expect(document.querySelector('.explore-sheet')?.getAttribute('data-detent')).toBe('partial')
    expect(document.querySelector('.plan-sheet')?.getAttribute('data-detent')).toBe('partial')
    const exploreViewport = document.querySelector<HTMLElement>('.explore-sheet')
      ?.closest<HTMLElement>('.mobile-sheet-viewport')
    expect(exploreViewport?.dataset.active).toBe('true')
    expect(viewports.filter((viewport) => viewport !== exploreViewport).every(
      (viewport) => viewport.hasAttribute('inert') && viewport.getAttribute('aria-hidden') === 'true',
    )).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Plan' }))
    expect(document.querySelector('.plan-sheet')?.closest('.mobile-sheet-viewport')?.getAttribute('data-active'))
      .toBe('true')
    await user.click(screen.getByRole('button', { name: 'Stops' }))
    expect(document.querySelector('.stops-sheet')?.getAttribute('data-detent')).toBe('collapsed')
    expect(document.querySelector('.explore-sheet')?.getAttribute('data-detent')).toBe('partial')
    expect(document.querySelector('.plan-sheet')?.getAttribute('data-detent')).toBe('partial')
    expect(viewports.every((viewport) => viewport.hasAttribute('data-open'))).toBe(true)
  })
})
