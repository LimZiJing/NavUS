import { describe, expect, it } from 'vitest'
import { searchPathsWithinBudget } from '../../../backend/src/pathfinding/search/search-path-candidates'
import { loadPathfindingBenchmarkManifest } from './manifest'
import { createPathfindingBenchmarkCases, loadPathfindingBenchmarkFixtures } from './fixtures'
import { validatePathfindingBenchmarkOutcome } from './outcome'

describe('manifest Path correctness cases', () => {
  it('runs and validates all 50 cases with fixed local fixtures', async () => {
    const [manifest, fixtures] = await Promise.all([
      loadPathfindingBenchmarkManifest(),
      loadPathfindingBenchmarkFixtures(),
    ])
    const cases = createPathfindingBenchmarkCases(manifest, fixtures)
    const results = await Promise.all(cases.map(async (benchmarkCase) => {
      let clockTicks = 0
      const result = await searchPathsWithinBudget(benchmarkCase.searchInput, {
        maxExpandedPaths: 10_000,
        now: () => clockTicks++,
        yieldEvery: 0,
      })
      const validations = result.candidates.map(({ path }) => validatePathfindingBenchmarkOutcome(
        { kind: 'path', path },
        benchmarkCase,
        benchmarkCase.transit,
        fixtures.venues,
        { mode: 'offline', valhallaRequestCounts: { matrix: 0, route: 0 } },
      ))
      const validation = validations.find((candidate) => candidate.valid) ?? (
        result.candidates.length === 0
          ? validatePathfindingBenchmarkOutcome(
            { kind: 'no-route', reason: 'No path was found for the fixed case.' },
            benchmarkCase,
            benchmarkCase.transit,
            fixtures.venues,
            { mode: 'offline', valhallaRequestCounts: { matrix: 0, route: 0 } },
          )
          : validations[0]!
      )
      return {
        id: benchmarkCase.id,
        validation,
      }
    }))

    expect(cases).toHaveLength(50)
    expect(results.filter(({ validation }) => !validation.valid).map(({ id, validation }) => ({
      id,
      errors: validation.errors,
    }))).toEqual([])
    expect(results.filter(({ validation }) => validation.valid)).toHaveLength(50)
  }, 120_000)
})
