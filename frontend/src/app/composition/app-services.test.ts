import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAppServices } from './app-services'

const adapters = vi.hoisted(() => ({
  loadTransit: vi.fn(),
  loadVenues: vi.fn(),
  createLocationTracker: vi.fn(),
  createShuttleArrivalClient: vi.fn(),
  createPublicBusArrivalClient: vi.fn(),
  createShuttleServiceHoursClient: vi.fn(),
  createJourneyPlanningClient: vi.fn(),
  locationTracker: {},
  shuttleArrivalClient: {},
  publicBusArrivalClient: {},
  shuttleServiceHoursClient: {},
  pathfinder: vi.fn(),
}))

vi.mock('../../infrastructure/data/loaders', () => ({
  loadTransitMapData: adapters.loadTransit,
  loadVenueData: adapters.loadVenues,
}))
vi.mock('../../infrastructure/location/browser', () => ({
  createBrowserLocationTracker: adapters.createLocationTracker,
}))
vi.mock('../../infrastructure/shuttle-arrivals/client', () => ({
  createShuttleArrivalClient: adapters.createShuttleArrivalClient,
}))
vi.mock('../../infrastructure/lta-datamall/client', () => ({
  createPublicBusArrivalClient: adapters.createPublicBusArrivalClient,
}))
vi.mock('../../infrastructure/shuttle-service-hours/client', () => ({
  createShuttleServiceHoursClient: adapters.createShuttleServiceHoursClient,
}))
vi.mock('../../infrastructure/pathfinding/client', () => ({
  createJourneyPlanningClient: adapters.createJourneyPlanningClient,
}))

describe('createAppServices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adapters.createLocationTracker.mockReturnValue(adapters.locationTracker)
    adapters.createShuttleArrivalClient.mockReturnValue(adapters.shuttleArrivalClient)
    adapters.createPublicBusArrivalClient.mockReturnValue(adapters.publicBusArrivalClient)
    adapters.createShuttleServiceHoursClient.mockReturnValue(adapters.shuttleServiceHoursClient)
    adapters.createJourneyPlanningClient.mockReturnValue(adapters.pathfinder)
  })

  it('creates the server-backed planner and passes the development clock only in development', () => {
    const journeyTestClock = { get: vi.fn(() => 1_800_000_000_000) }

    const services = createAppServices({ journeyTestClock, isDevelopment: true })

    expect(services.shuttleArrivalClient).toBe(adapters.shuttleArrivalClient)
    expect(services.shuttleServiceHoursClient).toBe(adapters.shuttleServiceHoursClient)
    expect(adapters.createJourneyPlanningClient).toHaveBeenCalledOnce()
    const options = adapters.createJourneyPlanningClient.mock.calls[0][0]
    expect(options.getSimulatedDepartureMs).toBe(journeyTestClock.get)
    expect(services.pathfinder).toBe(adapters.pathfinder)
  })

  it('does not send a simulated departure clock in production', () => {
    const services = createAppServices({
      journeyTestClock: { get: () => 1_800_000_000_000 },
      isDevelopment: false,
    })
    const options = adapters.createJourneyPlanningClient.mock.calls[0][0]

    expect(options.getSimulatedDepartureMs()).toBeNull()
    expect(services.pathfinder).toBe(adapters.pathfinder)
  })

  it('includes the default data loaders, public arrivals client and browser location tracker factory', () => {
    const services = createAppServices({ journeyTestClock: { get: () => null } })

    expect(services.loadTransit).toBe(adapters.loadTransit)
    expect(services.loadVenues).toBe(adapters.loadVenues)
    expect(services.publicBusArrivalClient).toBe(adapters.publicBusArrivalClient)
    expect(services.createLocationTracker).toBe(adapters.createLocationTracker)
  })
})
