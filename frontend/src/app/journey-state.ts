import type { Path } from '@navus/shared/routing/path'
import type { ScoredPathCandidate } from '@navus/shared/routing/path'

export type JourneyStatus = 'idle' | 'loading' | 'ready' | 'no-route' | 'failed'

export interface JourneyState {
  readonly status: JourneyStatus
  readonly path: Path | null
  readonly candidates: readonly ScoredPathCandidate[]
  readonly displayedCandidates: readonly ScoredPathCandidate[]
  readonly selectedCandidateKey: string | null
  readonly error: string | null
}

export function createInitialJourneyState(): JourneyState {
  return {
    status: 'idle',
    path: null,
    candidates: [],
    displayedCandidates: [],
    selectedCandidateKey: null,
    error: null,
  }
}

export function createJourneyStateWithStatus(status: JourneyStatus): JourneyState {
  return { ...createInitialJourneyState(), status }
}
