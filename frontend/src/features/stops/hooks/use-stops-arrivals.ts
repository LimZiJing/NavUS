import { useEffect, useRef, useState } from 'react'
import {
  isOlderShuttleArrivalSnapshot,
  SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS,
  type ShuttleArrivalSnapshot,
} from '../../../domain/transit/arrivals'

export interface StopsArrivalStopRequest {
  readonly stopId: string
  readonly stopName: string
}

export type StopsArrivalLoader<TSnapshot = ShuttleArrivalSnapshot> = (
  stops: readonly StopsArrivalStopRequest[],
  signal: AbortSignal,
) => Promise<TSnapshot>

export type StopsArrivalsStatus = 'idle' | 'loading' | 'refreshing' | 'ready' | 'error'

export interface StopsArrivalsState<TSnapshot = ShuttleArrivalSnapshot> {
  readonly status: StopsArrivalsStatus
  readonly snapshot: TSnapshot | null
  readonly nowMs: number
}

interface ArrivalRequestState<TSnapshot> {
  readonly stopKey: string | null
  readonly status: StopsArrivalsStatus
  readonly snapshot: TSnapshot | null
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

const STOP_SET_DEBOUNCE_MS = 150

export function useStopsArrivals<TSnapshot = ShuttleArrivalSnapshot>(
  loadArrivals: StopsArrivalLoader<TSnapshot>,
  active: boolean,
  stops: readonly StopsArrivalStopRequest[],
  isOlderSnapshot: (candidate: TSnapshot, current: TSnapshot) => boolean = isOlderShuttleArrivalSnapshot as (
    candidate: TSnapshot,
    current: TSnapshot,
  ) => boolean,
): StopsArrivalsState<TSnapshot> {
  const [state, setState] = useState<ArrivalRequestState<TSnapshot>>(() => ({
    stopKey: null,
    status: 'idle',
    snapshot: null,
  }))
  const [nowMs, setNowMs] = useState(() => Date.now())
  const requestedStopKey = stops
    .map(({ stopId, stopName }) => `${stopId}\u0000${stopName}`)
    .sort()
    .join('\u0001')
  // The polled stop set only follows the request while the view is active, so polling keeps
  // running in the background after the user leaves without chasing map pans elsewhere.
  const [polled, setPolled] = useState(() => active
    ? { stopKey: requestedStopKey, stops }
    : { stopKey: null as string | null, stops: [] as readonly StopsArrivalStopRequest[] })
  if (active && polled.stopKey !== requestedStopKey) {
    setPolled({ stopKey: requestedStopKey, stops })
  }
  const stopKey = polled.stopKey ?? ''
  const hasActiveStops = polled.stops.length > 0
  // Location updates can recreate this array without changing the request.
  const latestStopsRef = useRef(polled.stops)
  const previousStopKeyRef = useRef<string | null>(null)

  useEffect(() => {
    latestStopsRef.current = polled.stops
  }, [polled.stops])

  useEffect(() => {
    if (!hasActiveStops) return

    let disposed = false
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let stopSetTimer: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null

    const load = async (): Promise<void> => {
      controller?.abort()
      controller = new AbortController()
      setState((previous) => ({
        stopKey,
        status: previous.stopKey === stopKey && previous.snapshot ? 'refreshing' : 'loading',
        snapshot: previous.stopKey === stopKey ? previous.snapshot : null,
      }))

      try {
        const snapshot = await loadArrivals(latestStopsRef.current, controller.signal)
        if (disposed) return
        setState((previous) => ({
          stopKey,
          status: 'ready',
          snapshot: previous.stopKey === stopKey && previous.snapshot &&
            isOlderSnapshot(snapshot, previous.snapshot)
            ? previous.snapshot
            : snapshot,
        }))
      } catch (error: unknown) {
        if (disposed || isAbortError(error)) return
        setState((previous) => ({
          stopKey,
          status: 'error',
          snapshot: previous.stopKey === stopKey ? previous.snapshot : null,
        }))
      }

      if (!disposed) {
        refreshTimer = setTimeout(() => { void load() }, SHUTTLE_ARRIVAL_REFRESH_INTERVAL_MS)
      }
    }

    const shouldDebounce = previousStopKeyRef.current !== null && previousStopKeyRef.current !== stopKey
    previousStopKeyRef.current = stopKey
    if (shouldDebounce) {
      stopSetTimer = setTimeout(() => { void load() }, STOP_SET_DEBOUNCE_MS)
    } else {
      void load()
    }
    return () => {
      disposed = true
      controller?.abort()
      if (stopSetTimer) clearTimeout(stopSetTimer)
      if (refreshTimer) clearTimeout(refreshTimer)
    }
  }, [hasActiveStops, isOlderSnapshot, loadArrivals, stopKey])

  useEffect(() => {
    if (!active) return
    const clock = setInterval(() => setNowMs(Date.now()), 1_000)
    return () => clearInterval(clock)
  }, [active])

  const visibleState: ArrivalRequestState<TSnapshot> = hasActiveStops
    ? state
    : { stopKey: null, status: 'idle', snapshot: null }

  return { status: visibleState.status, snapshot: visibleState.snapshot, nowMs }
}
