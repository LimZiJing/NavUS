import { Marker, type Map } from 'maplibre-gl'
import type { MapJourneyOption } from '../../app/contracts/map'
import { formatDuration } from '../../domain/trip/duration-format'
import type { Path } from '@navus/shared/routing/path'

const JOURNEY_DURATION_MARKER_Z_INDEX = 4
const JOURNEY_DURATION_MARKER_SPACING = 32

interface JourneyDurationMarker {
  readonly candidateKey: string
  readonly marker: Marker
  readonly element: HTMLButtonElement
  readonly onClick: (event: MouseEvent) => void
}

function haveOptionsChanged(
  current: readonly MapJourneyOption[],
  next: readonly MapJourneyOption[],
): boolean {
  return current.length !== next.length || current.some((option, index) => (
    option.candidateKey !== next[index]?.candidateKey || option.path !== next[index]?.path
  ))
}

function getJourneyLabelPoint(path: Path): [number, number] | null {
  const segments: Array<{
    readonly from: readonly [number, number]
    readonly to: readonly [number, number]
    readonly length: number
  }> = []
  let totalLength = 0

  for (const leg of path.legs) {
    const coordinates = leg.geometry.coordinates
    for (let index = 1; index < coordinates.length; index += 1) {
      const from = coordinates[index - 1]
      const to = coordinates[index]
      const latitudeRadians = ((from[1] + to[1]) / 2) * Math.PI / 180
      const longitudeDistance = (to[0] - from[0]) * Math.cos(latitudeRadians)
      const latitudeDistance = to[1] - from[1]
      const length = Math.hypot(longitudeDistance, latitudeDistance)
      if (length <= 0) continue
      segments.push({ from, to, length })
      totalLength += length
    }
  }

  if (segments.length === 0) {
    const coordinate = path.legs[0]?.geometry.coordinates[0]
    return coordinate ? [coordinate[0], coordinate[1]] : null
  }

  let distanceToMidpoint = totalLength / 2
  for (const segment of segments) {
    if (distanceToMidpoint <= segment.length) {
      const ratio = distanceToMidpoint / segment.length
      return [
        segment.from[0] + (segment.to[0] - segment.from[0]) * ratio,
        segment.from[1] + (segment.to[1] - segment.from[1]) * ratio,
      ]
    }
    distanceToMidpoint -= segment.length
  }

  const lastSegment = segments.at(-1)
  return lastSegment ? [lastSegment.to[0], lastSegment.to[1]] : null
}

function createDurationLabelElement(
  durationLabel: string,
  candidateKey: string,
  optionNumber: number,
): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'journey-duration-marker'
  element.textContent = durationLabel
  element.dataset.candidateKey = candidateKey
  element.setAttribute('aria-label', `Select journey option ${optionNumber}, ${durationLabel}`)
  element.style.zIndex = String(JOURNEY_DURATION_MARKER_Z_INDEX)
  return element
}

function updateMarkerSelection(
  markers: readonly JourneyDurationMarker[],
  selectedCandidateKey: string | null,
): void {
  for (const { candidateKey, element } of markers) {
    const selected = candidateKey === selectedCandidateKey
    element.classList.toggle('journey-duration-marker-selected', selected)
    element.classList.toggle('journey-duration-marker-alternative', !selected)
    element.setAttribute('aria-pressed', String(selected))
  }
}

function createMarkers(
  map: Map,
  options: readonly MapJourneyOption[],
  onJourneyOptionSelected?: (candidateKey: string) => void,
): JourneyDurationMarker[] {
  const markers: JourneyDurationMarker[] = []
  try {
    options.forEach(({ candidateKey, path }, candidateIndex) => {
      const coordinate = getJourneyLabelPoint(path)
      if (!coordinate) return

      const element = createDurationLabelElement(
        formatDuration(path.totalDurationSeconds),
        candidateKey,
        candidateIndex + 1,
      )
      const verticalOffset = (
        candidateIndex - (options.length - 1) / 2
      ) * JOURNEY_DURATION_MARKER_SPACING
      const onClick = (event: MouseEvent): void => {
        event.stopPropagation()
        onJourneyOptionSelected?.(candidateKey)
      }
      element.addEventListener('click', onClick)
      const marker = new Marker({
        anchor: 'center',
        element,
        offset: [0, verticalOffset],
      }).setLngLat(coordinate)
      markers.push({ candidateKey, marker, element, onClick })
      marker.addTo(map)
    })
  } catch (error) {
    markers.forEach(({ marker, element, onClick }) => {
      element.removeEventListener('click', onClick)
      marker.remove()
    })
    throw error
  }
  return markers
}

export interface JourneyDurationMarkers {
  setJourneyOptions(options: readonly MapJourneyOption[], selectedCandidateKey: string | null): void
  dispose(): void
}

export function createJourneyDurationMarkers(
  map: Map,
  onJourneyOptionSelected?: (candidateKey: string) => void,
): JourneyDurationMarkers {
  let disposed = false
  let currentOptions: readonly MapJourneyOption[] = []
  let markers: JourneyDurationMarker[] = []

  const clearMarkers = (): void => {
    markers.forEach(({ marker, element, onClick }) => {
      element.removeEventListener('click', onClick)
      marker.remove()
    })
    markers = []
    currentOptions = []
  }

  return {
    setJourneyOptions(options, selectedCandidateKey) {
      if (disposed) return
      if (haveOptionsChanged(currentOptions, options)) {
        clearMarkers()
        markers = createMarkers(map, options, onJourneyOptionSelected)
        currentOptions = [...options]
      }
      updateMarkerSelection(markers, selectedCandidateKey)
    },

    dispose() {
      if (disposed) return
      disposed = true
      clearMarkers()
    },
  }
}
