import type {
  FilterSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  Map,
  MapMouseEvent,
} from 'maplibre-gl'
import type { MapJourneyOption } from '../../app/contracts/map'
import type { Path } from '@navus/shared/routing/path'
import type { TransitIndex } from '../../domain/transit'
import { createJourneyDurationMarkers, type JourneyDurationMarkers } from './path-duration-markers'
import {
  SELECTED_ROUTE_LANE_STOPS,
  DIRECTION_IMAGE_PIXEL_RATIO,
  createDirectionChevronImage,
  type LineWidthSpecification,
} from './route-lanes'

export const JOURNEY_ROUTE_SOURCE_ID = 'journey-route-geometry'
export const JOURNEY_ALTERNATIVE_CASING_LAYER_ID = 'journey-alternative-casing'
export const JOURNEY_ALTERNATIVE_WALKING_LAYER_ID = 'journey-alternative-walking-lines'
export const JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID = 'journey-alternative-shuttle-lines'
export const JOURNEY_SELECTED_CASING_LAYER_ID = 'journey-selected-casing'
export const JOURNEY_SELECTED_WALKING_LAYER_ID = 'journey-selected-walking-lines'
export const JOURNEY_SELECTED_SHUTTLE_LAYER_ID = 'journey-selected-shuttle-lines'
export const JOURNEY_SELECTED_DIRECTION_LAYER_ID = 'journey-selected-shuttle-directions'

const JOURNEY_DIRECTION_IMAGE_ID = 'journey-route-direction-chevron'
const SELECTED_FILTER_SENTINEL = '__no_selected_journey_option__'
const JOURNEY_ALTERNATIVE_COLOR = '#64748b'
const JOURNEY_ALTERNATIVE_WALKING_COLOR = '#94a3b8'
const JOURNEY_SELECTED_WALKING_COLOR = '#2563eb'
const JOURNEY_SHUTTLE_FALLBACK_COLOR = '#d97706'

interface JourneyRouteProperties {
  readonly featureKind: 'route'
  readonly candidateKey: string
  readonly legIndex: number
  readonly mode: Path['legs'][number]['mode']
  readonly routeId: string | null
  readonly routeColor: string | null
}

type JourneyRouteFeature = {
  readonly type: 'Feature'
  readonly properties: JourneyRouteProperties
  readonly geometry: {
    readonly type: 'LineString'
    readonly coordinates: Array<[number, number]>
  }
}

interface JourneyRouteGeometry {
  readonly type: 'FeatureCollection'
  readonly features: JourneyRouteFeature[]
}

function getRouteModeFilter(mode: Path['legs'][number]['mode']): FilterSpecification {
  return ['all', ['==', ['get', 'featureKind'], 'route'], ['==', ['get', 'mode'], mode]]
}

function getCandidateFilter(
  mode: Path['legs'][number]['mode'],
  candidateKey: string,
): FilterSpecification {
  return [
    'all',
    ['==', ['get', 'featureKind'], 'route'],
    ['==', ['get', 'mode'], mode],
    ['==', ['get', 'candidateKey'], candidateKey],
  ]
}

function getAlternativeFilter(
  mode: Path['legs'][number]['mode'],
  selectedCandidateKey: string | null,
): FilterSpecification {
  return selectedCandidateKey === null
      ? getRouteModeFilter(mode)
      : [
          'all',
          ['==', ['get', 'featureKind'], 'route'],
          ['==', ['get', 'mode'], mode],
          ['!=', ['get', 'candidateKey'], selectedCandidateKey],
        ]
}

function getLineLayout(): LineLayerSpecification['layout'] {
  return {
    'line-cap': 'round',
    'line-join': 'round',
  }
}

function laneStops(key: 'width' | 'arrowWidth' | 'casingWidth' | 'offset'): LineWidthSpecification {
  return [
    'interpolate',
    ['linear'],
    ['zoom'],
    ...SELECTED_ROUTE_LANE_STOPS.flatMap((stop) => [stop.zoom, stop[key]]),
  ] as LineWidthSpecification
}

function createAlternativeCasingLayer(): LineLayerSpecification {
  return {
    id: JOURNEY_ALTERNATIVE_CASING_LAYER_ID,
    type: 'line',
    source: JOURNEY_ROUTE_SOURCE_ID,
    filter: getAlternativeFilter('shuttle', null),
    layout: getLineLayout(),
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.45,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 4, 15, 6, 18, 8],
    },
  }
}

function createAlternativeWalkingLayer(): LineLayerSpecification {
  return {
    id: JOURNEY_ALTERNATIVE_WALKING_LAYER_ID,
    type: 'line',
    source: JOURNEY_ROUTE_SOURCE_ID,
    filter: getAlternativeFilter('walking', null),
    layout: getLineLayout(),
    paint: {
      'line-color': JOURNEY_ALTERNATIVE_WALKING_COLOR,
      'line-opacity': 0.6,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 15, 4, 18, 5],
      'line-dasharray': [1, 1.5],
    },
  }
}

function createAlternativeShuttleLayer(): LineLayerSpecification {
  return {
    id: JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID,
    type: 'line',
    source: JOURNEY_ROUTE_SOURCE_ID,
    filter: getAlternativeFilter('shuttle', null),
    layout: getLineLayout(),
    paint: {
      'line-color': JOURNEY_ALTERNATIVE_COLOR,
      'line-opacity': 0.68,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 15, 3, 18, 4.5],
    },
  }
}

function createSelectedCasingLayer(selectedCandidateKey: string | null): LineLayerSpecification {
  return {
    id: JOURNEY_SELECTED_CASING_LAYER_ID,
    type: 'line',
    source: JOURNEY_ROUTE_SOURCE_ID,
    filter: getCandidateFilter('shuttle', selectedCandidateKey ?? SELECTED_FILTER_SENTINEL),
    layout: getLineLayout(),
    paint: {
      'line-color': '#ffffff',
      'line-opacity': 0.98,
      'line-width': laneStops('casingWidth'),
      'line-offset': laneStops('offset'),
    },
  }
}

function createSelectedWalkingLayer(selectedCandidateKey: string | null): LineLayerSpecification {
  return {
    id: JOURNEY_SELECTED_WALKING_LAYER_ID,
    type: 'line',
    source: JOURNEY_ROUTE_SOURCE_ID,
    filter: getCandidateFilter('walking', selectedCandidateKey ?? SELECTED_FILTER_SENTINEL),
    layout: getLineLayout(),
    paint: {
      'line-color': JOURNEY_SELECTED_WALKING_COLOR,
      'line-opacity': 0.98,
      'line-width': ['interpolate', ['linear'], ['zoom'], 12, 5, 15, 7, 18, 9],
      'line-dasharray': [1, 1.5],
    },
  }
}

function createSelectedShuttleLayer(selectedCandidateKey: string | null): LineLayerSpecification {
  return {
    id: JOURNEY_SELECTED_SHUTTLE_LAYER_ID,
    type: 'line',
    source: JOURNEY_ROUTE_SOURCE_ID,
    filter: getCandidateFilter('shuttle', selectedCandidateKey ?? SELECTED_FILTER_SENTINEL),
    layout: getLineLayout(),
    paint: {
      'line-color': ['coalesce', ['get', 'routeColor'], JOURNEY_SHUTTLE_FALLBACK_COLOR],
      'line-opacity': 1,
      'line-width': laneStops('width'),
      'line-offset': laneStops('offset'),
    },
  }
}

function createSelectedDirectionLayer(selectedCandidateKey: string | null): LineLayerSpecification {
  return {
    id: JOURNEY_SELECTED_DIRECTION_LAYER_ID,
    type: 'line',
    source: JOURNEY_ROUTE_SOURCE_ID,
    filter: getCandidateFilter('shuttle', selectedCandidateKey ?? SELECTED_FILTER_SENTINEL),
    layout: {
      'line-cap': 'butt',
      'line-join': 'round',
    },
    paint: {
      'line-pattern': JOURNEY_DIRECTION_IMAGE_ID,
      'line-width': laneStops('arrowWidth'),
      'line-offset': laneStops('offset'),
    },
  }
}

function createJourneyLayers(
  selectedCandidateKey: string | null,
): LineLayerSpecification[] {
  return [
    createAlternativeCasingLayer(),
    createAlternativeWalkingLayer(),
    createAlternativeShuttleLayer(),
    createSelectedCasingLayer(selectedCandidateKey),
    createSelectedWalkingLayer(selectedCandidateKey),
    createSelectedShuttleLayer(selectedCandidateKey),
    createSelectedDirectionLayer(selectedCandidateKey),
  ]
}

function createJourneyRouteGeometry(
  options: readonly MapJourneyOption[],
  transitIndex: TransitIndex | null,
): JourneyRouteGeometry {
  const features: JourneyRouteGeometry['features'] = []
  options.forEach(({ candidateKey, path }) => {
    path.legs.forEach((leg, legIndex) => {
      features.push({
        type: 'Feature',
        properties: {
          featureKind: 'route',
          candidateKey,
          legIndex,
          mode: leg.mode,
          routeId: leg.mode === 'shuttle' ? leg.routeId : null,
          routeColor: leg.mode === 'shuttle'
            ? transitIndex?.routeById.get(leg.routeId)?.color ?? null
            : null,
        },
        geometry: {
          type: 'LineString',
          coordinates: leg.geometry.coordinates.map(([longitude, latitude]) => [longitude, latitude]),
        },
      })
    })

  })

  return { type: 'FeatureCollection', features }
}

function haveOptionsChanged(
  current: readonly MapJourneyOption[],
  next: readonly MapJourneyOption[],
): boolean {
  return current.length !== next.length || current.some((option, index) => (
    option.candidateKey !== next[index]?.candidateKey || option.path !== next[index]?.path
  ))
}

export interface JourneyRouteLayers {
  setJourneyOptions(options: readonly MapJourneyOption[], selectedCandidateKey: string | null): void
  dispose(): void
}

export function createPathLayers(
  map: Map,
  transitIndex: TransitIndex | null,
  onJourneyOptionSelected?: (candidateKey: string) => void,
): JourneyRouteLayers {
  const durationMarkers: JourneyDurationMarkers = createJourneyDurationMarkers(
    map,
    onJourneyOptionSelected,
  )
  let disposed = false
  let installed = false
  let routeClickListenerInstalled = false
  let currentOptions: readonly MapJourneyOption[] = []
  let currentSelectedCandidateKey: string | null = null

  const routeInteractionLayerIds = [
    JOURNEY_ALTERNATIVE_CASING_LAYER_ID,
    JOURNEY_ALTERNATIVE_WALKING_LAYER_ID,
    JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID,
    JOURNEY_SELECTED_CASING_LAYER_ID,
    JOURNEY_SELECTED_WALKING_LAYER_ID,
    JOURNEY_SELECTED_SHUTTLE_LAYER_ID,
    JOURNEY_SELECTED_DIRECTION_LAYER_ID,
  ]

  const handleRouteClick = (event: MapMouseEvent): void => {
    if (disposed || !installed || currentOptions.length === 0) return
    const target = event.originalEvent.target
    if (typeof Element !== 'undefined' && target instanceof Element && target.closest(
      '.maplibregl-marker, .maplibregl-popup, .maplibregl-ctrl',
    )) {
      return
    }

    const matchingKeys = new Set(
      map.queryRenderedFeatures(event.point, { layers: routeInteractionLayerIds })
        .map(({ properties }) => properties?.candidateKey)
        .filter((key): key is string => typeof key === 'string'),
    )
    const candidateKey = currentSelectedCandidateKey !== null
      && matchingKeys.has(currentSelectedCandidateKey)
      ? currentSelectedCandidateKey
      : currentOptions.find(({ candidateKey: key }) => matchingKeys.has(key))?.candidateKey
    if (candidateKey) {
      event.originalEvent.stopPropagation()
      onJourneyOptionSelected?.(candidateKey)
    }
  }

  const attachRouteClickListener = (): void => {
    if (routeClickListenerInstalled) return
    map.on('click', handleRouteClick)
    routeClickListenerInstalled = true
  }

  const detachRouteClickListener = (): void => {
    if (!routeClickListenerInstalled) return
    map.off('click', handleRouteClick)
    routeClickListenerInstalled = false
  }

  const clearInstalledJourney = (): void => {
    detachRouteClickListener()
    const layerIds = [
      JOURNEY_SELECTED_DIRECTION_LAYER_ID,
      JOURNEY_SELECTED_SHUTTLE_LAYER_ID,
      JOURNEY_SELECTED_WALKING_LAYER_ID,
      JOURNEY_SELECTED_CASING_LAYER_ID,
      JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID,
      JOURNEY_ALTERNATIVE_WALKING_LAYER_ID,
      JOURNEY_ALTERNATIVE_CASING_LAYER_ID,
    ]
    layerIds.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id)
    })
    if (map.hasImage(JOURNEY_DIRECTION_IMAGE_ID)) map.removeImage(JOURNEY_DIRECTION_IMAGE_ID)
    if (map.getSource(JOURNEY_ROUTE_SOURCE_ID)) map.removeSource(JOURNEY_ROUTE_SOURCE_ID)
    durationMarkers.setJourneyOptions([], null)
    installed = false
    currentOptions = []
  }

  const updateSelectedFilters = (selectedCandidateKey: string | null): void => {
    const selectedKey = selectedCandidateKey ?? SELECTED_FILTER_SENTINEL
    map.setFilter(
      JOURNEY_ALTERNATIVE_CASING_LAYER_ID,
      getAlternativeFilter('shuttle', selectedCandidateKey),
    )
    map.setFilter(
      JOURNEY_ALTERNATIVE_WALKING_LAYER_ID,
      getAlternativeFilter('walking', selectedCandidateKey),
    )
    map.setFilter(
      JOURNEY_ALTERNATIVE_SHUTTLE_LAYER_ID,
      getAlternativeFilter('shuttle', selectedCandidateKey),
    )
    map.setFilter(
      JOURNEY_SELECTED_CASING_LAYER_ID,
      getCandidateFilter('shuttle', selectedKey),
    )
    map.setFilter(
      JOURNEY_SELECTED_WALKING_LAYER_ID,
      getCandidateFilter('walking', selectedKey),
    )
    map.setFilter(
      JOURNEY_SELECTED_SHUTTLE_LAYER_ID,
      getCandidateFilter('shuttle', selectedKey),
    )
    map.setFilter(
      JOURNEY_SELECTED_DIRECTION_LAYER_ID,
      getCandidateFilter('shuttle', selectedKey),
    )

    durationMarkers.setJourneyOptions(currentOptions, selectedCandidateKey)
  }

  const install = (
    options: readonly MapJourneyOption[],
    selectedCandidateKey: string | null,
  ): void => {
    const data = createJourneyRouteGeometry(options, transitIndex)
    map.addSource(JOURNEY_ROUTE_SOURCE_ID, { type: 'geojson', data })
    if (!map.hasImage(JOURNEY_DIRECTION_IMAGE_ID)) {
      map.addImage(JOURNEY_DIRECTION_IMAGE_ID, createDirectionChevronImage(), {
        pixelRatio: DIRECTION_IMAGE_PIXEL_RATIO,
      })
    }
    for (const layer of createJourneyLayers(selectedCandidateKey)) {
      map.addLayer(layer)
    }
    durationMarkers.setJourneyOptions(options, selectedCandidateKey)
    installed = true
    attachRouteClickListener()
  }

  return {
    setJourneyOptions(options, selectedCandidateKey) {
      if (disposed) return
      if (options.length === 0) {
        clearInstalledJourney()
        currentSelectedCandidateKey = null
        return
      }

      const optionsChanged = haveOptionsChanged(currentOptions, options)
      currentOptions = [...options]
      const selectedChanged = currentSelectedCandidateKey !== selectedCandidateKey
      currentSelectedCandidateKey = selectedCandidateKey

      try {
        if (!installed) {
          install(options, selectedCandidateKey)
        } else if (optionsChanged) {
          const source = map.getSource(JOURNEY_ROUTE_SOURCE_ID) as GeoJSONSource | undefined
          if (!source) throw new Error('Journey route source is missing')
          source.setData(createJourneyRouteGeometry(options, transitIndex))
          durationMarkers.setJourneyOptions(options, selectedCandidateKey)
        }
        if (selectedChanged || optionsChanged) updateSelectedFilters(selectedCandidateKey)
      } catch (error) {
        clearInstalledJourney()
        throw error
      }
    },

    dispose() {
      if (disposed) return
      disposed = true
      clearInstalledJourney()
      durationMarkers.dispose()
    },
  }
}
