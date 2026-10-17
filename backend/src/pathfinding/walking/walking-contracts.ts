import type { WalkingConnection } from '@navus/shared/routing/walking-connection'
export type { WalkingConnection } from '@navus/shared/routing/walking-connection'

export interface RoutingCoordinate {
  readonly longitude: number
  readonly latitude: number
}

export interface WalkingRouteRequest {
  readonly origin: RoutingCoordinate
  readonly destination: RoutingCoordinate
}

export interface WalkingRoute {
  readonly distanceMeters: number
  readonly durationSeconds: number
  readonly geometry: {
    readonly type: 'LineString'
    readonly coordinates: readonly (readonly [number, number])[]
  }
}

export interface WalkingMatrixRequest {
  readonly sources: readonly RoutingCoordinate[]
  readonly targets: readonly RoutingCoordinate[]
}

export interface WalkingMatrixConnection {
  readonly fromIndex: number
  readonly toIndex: number
  readonly distanceMeters: number
  readonly durationSeconds: number
}

export interface WalkingConnectionLocation {
  readonly key: string
  readonly coordinate: RoutingCoordinate
  readonly stopId?: string
}

export interface WalkingConnectionRequest {
  readonly origin: WalkingConnectionLocation
  readonly destination: WalkingConnectionLocation
  readonly stops: readonly WalkingConnectionLocation[]
}


export interface WalkingConnectionProvider {
  getWalkingConnections(
    request: WalkingConnectionRequest,
    signal: AbortSignal,
  ): Promise<readonly WalkingConnection[]>
}

export interface WalkingRouteEngine {
  routeWalking(
    request: WalkingRouteRequest,
    signal: AbortSignal,
  ): Promise<WalkingRoute>
  matrixWalking(
    request: WalkingMatrixRequest,
    signal: AbortSignal,
  ): Promise<readonly WalkingMatrixConnection[]>
}
