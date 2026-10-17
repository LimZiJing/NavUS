export { parseApiOrigin, parseCorsOrigins } from './http/api-origin.ts'
export { LOCAL_DATA_VERSION, parseDataVersion, assertCompatibleDataVersion } from './http/data-version.ts'
export type {
  ApiHealthResponse,
  ApiReadyResponse,
  ApiNotReadyResponse,
  ApiReadinessResponse,
  ApiErrorResponse,
  ApiErrorCode,
} from './http/api-contracts.ts'
export type {
  ApiStopSelection,
  ApiShuttleArrivalsRequest,
  ApiShuttleArrivalsResponse,
  ApiPublicBusArrivalsRequest,
  ApiPublicBusArrivalsResponse,
  ApiShuttleServiceWindowsRequest,
  ApiShuttleServiceWindowsResponse,
  ApiRequestOptions,
} from './http/live-data-contracts.ts'

export {
  TransitValidationError,
  validateTransitNetwork,
  validateTransitVerificationManifest,
} from './transit/model.ts'
export { validateBusRouteGeometry } from './transit/geometry.ts'
export { validateTransitMapData } from './transit/map-data.ts'
export {
  generateShuttleTimingData,
  SHUTTLE_TIMING_DATA_VERSION,
  SHUTTLE_TIMING_METHOD,
  SHUTTLE_TIMING_METHOD_VERSION,
  SHUTTLE_TIMING_SOURCE,
  SHUTTLE_TIMING_WAITING_POLICY,
  TransitTimingValidationError,
  validateShuttleTimingData,
} from './transit/timing.ts'
export type {
  TransitGeoJsonPosition,
  TransitNetwork,
  TransitNetworkMetadata,
  BusRoute,
  BusRouteGeometry,
  BusRouteGeometryFeature,
  BusRouteGeometryProperties,
  TransitStop,
  TransitVerificationManifest,
} from './transit/types.ts'
export type { ShuttleTimingData, ShuttleTimingMetadata, ShuttleTimingRecord } from './transit/timing.ts'
export {
  validateVenueLocationMap,
  validateBuildingCatalogue,
  getVenueCount,
  VenueValidationError,
} from './venue/validation.ts'
export type { VenueLocation, VenueLocationMap } from './venue/types.ts'
export type {
  Building,
  BuildingCatalogue,
  BuildingCatalogueSource,
  BuildingSourceRef,
} from './venue/buildings.ts'
export { WALKING_STOP_GRAPH_VERSION, validateWalkingStopGraph } from './routing/walking-stop-graph.ts'
export type { WalkingStopGraph } from './routing/walking-stop-graph.ts'
export type { WalkingConnection } from './routing/walking-connection.ts'
export type {
  DataFreshness,
  ShuttleArrivalObservation,
  ShuttleHeadwaySeconds,
  ShuttleRouteArrivalData,
  ShuttleArrivalSnapshot,
} from './transit/live-arrivals.ts'
export {
  SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS,
  SHUTTLE_ARRIVAL_FRESHNESS_MS,
  SHUTTLE_ARRIVAL_MAX_AGE_MS,
} from './transit/live-arrivals.ts'
export type {
  PublicBusServiceArrivalStatus,
  PublicBusEstimatedArrival,
  PublicBusServiceArrival,
  PublicBusStopArrivalData,
  PublicBusArrivalSnapshot,
} from './transit/public-bus-arrivals.ts'
export {
  PUBLIC_BUS_ARRIVAL_REFRESH_INTERVAL_MS,
  PUBLIC_BUS_ARRIVAL_FRESHNESS_MS,
  PUBLIC_BUS_ARRIVAL_MAX_AGE_MS,
} from './transit/public-bus-arrivals.ts'
export type { ShuttleServiceWindow } from './transit/service-hours.ts'

export type {
  TripCoordinate,
  TripEndpoint,
  ApiJourneyPlanningRequest,
  ApiJourneyPlanningResponse,
  ApiJourneyPlanningError,
  ApiJourneyPlanningErrorCode,
  PathGeometry,
  PathLeg,
  WalkingPathLeg,
  BusPathLeg,
  PathQuality,
  Path,
  ScoredPathCandidate,
  PathEndpointLocation,
} from './routing/path.ts'
export { parseApiJourneyPlanningResponse } from './routing/validation.ts'

export { createTransitIndex, createTransitNetworkIndex, TransitIndexPreconditionError } from './transit/index.ts'
export type { TransitIndex, TransitNetworkIndex } from './transit/index.ts'
export {
  SHUTTLE_SERVICE_START_GRACE_MINUTES,
  SHUTTLE_SERVICE_HOURS_REFRESH_INTERVAL_MS,
  getNextShuttleServiceStart,
  evaluateShuttleService,
  describeShuttleServiceUnavailable,
} from './transit/service-hours-policy.ts'
export type {
  ShuttleServiceStatus,
  ShuttleServiceEvaluation,
  ShuttleServiceStart,
} from './transit/service-hours-policy.ts'
