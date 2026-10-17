import { access } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { toViteFsModuleId } from './benchmark/vite-module-id.mjs'

const DEFAULT_SAMPLES = 2
const DEFAULT_WARMUPS = 10
const MAX_RUNS = 1000

function parseCount(value, label, allowZero = false) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < (allowZero ? 0 : 1) || parsed > MAX_RUNS) {
    const lowerBound = allowZero ? '0' : '1'
    throw new Error(`${label} must be an integer from ${lowerBound} to ${MAX_RUNS}`)
  }
  return parsed
}

function validateLocalValhallaUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('valhalla-url must be a valid local HTTP URL')
  }
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('valhalla-url must use HTTP on localhost, 127.0.0.1, or ::1 without credentials')
  }
  return url.toString().replace(/\/$/, '')
}

function parseArguments(args) {
  const options = {
    mode: 'all',
    samples: DEFAULT_SAMPLES,
    warmups: DEFAULT_WARMUPS,
    valhallaUrl: 'http://127.0.0.1:8002',
    adapterPaths: [],
  }
  for (const argument of args) {
    const equalsIndex = argument.indexOf('=')
    const key = equalsIndex < 0 ? argument : argument.slice(0, equalsIndex)
    const value = equalsIndex < 0 ? undefined : argument.slice(equalsIndex + 1)
    if (key === '--mode') options.mode = value
    else if (key === '--samples') options.samples = parseCount(value, 'samples')
    else if (key === '--warmups') options.warmups = parseCount(value, 'warmups', true)
    else if (key === '--valhalla-url') options.valhallaUrl = validateLocalValhallaUrl(value)
    else if (key === '--adapter') {
      if (!value || !isAbsolute(value)) throw new Error('--adapter requires an absolute TypeScript file path')
      options.adapterPaths.push(resolve(value))
    } else throw new Error(`Unknown benchmark option: ${key}`)
  }
  if (!['all', 'offline', 'local'].includes(options.mode)) {
    throw new Error('mode must be all, offline, or local')
  }
  if (options.adapterPaths.length === 0) {
    options.adapterPaths.push(resolve(process.cwd(), 'scripts/benchmark/adapters/current.ts'))
  }
  if (new Set(options.adapterPaths).size !== options.adapterPaths.length) {
    throw new Error('adapter paths must be unique')
  }
  return options
}

function getGitIdentity() {
  const dotGitPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.git')
  const dotGitContent = readFileSync(dotGitPath, 'utf8')
  const gitDirectory = dotGitContent.startsWith('gitdir: ')
    ? resolve(dirname(dotGitPath), dotGitContent.slice('gitdir: '.length).trim())
    : dotGitPath
  let commonDirectory = gitDirectory
  try {
    commonDirectory = resolve(gitDirectory, readFileSync(resolve(gitDirectory, 'commondir'), 'utf8').trim())
  } catch {
    // A regular checkout stores refs directly in .git.
  }
  const head = readFileSync(resolve(gitDirectory, 'HEAD'), 'utf8').trim()
  if (!head.startsWith('ref: ')) return { commit: head, branch: null }
  const branch = head.slice('ref: refs/heads/'.length)
  const refPath = resolve(commonDirectory, 'refs', 'heads', branch)
  try {
    return { commit: readFileSync(refPath, 'utf8').trim(), branch }
  } catch {
    const packedRefs = readFileSync(resolve(commonDirectory, 'packed-refs'), 'utf8')
    const packedRef = packedRefs.split('\n').find((line) => line.endsWith(` refs/heads/${branch}`))
    return { commit: packedRef?.split(' ')[0] ?? null, branch }
  }
}

function createCaseDefinitions(fixtures, modules, manifest) {
  return modules.createPathfindingBenchmarkCases(manifest, fixtures)
}

async function loadBenchmarkModules(vite) {
  const [valhalla, outcomeValidator, manifest, fixturesModule, report, instrumentation, identity] = await Promise.all([
    vite.ssrLoadModule(toViteFsModuleId(resolve(dirname(fileURLToPath(import.meta.url)), '../../backend/src/pathfinding/walking/valhalla-walking-client.ts'))),
    vite.ssrLoadModule('/scripts/benchmark/outcome.ts'),
    vite.ssrLoadModule('/scripts/benchmark/manifest.ts'),
    vite.ssrLoadModule('/scripts/benchmark/fixtures.ts'),
    vite.ssrLoadModule('/scripts/benchmark/report.ts'),
    vite.ssrLoadModule('/scripts/benchmark/instrumentation.ts'),
    vite.ssrLoadModule('/scripts/benchmark/identity.ts'),
  ])
  return {
    createValhallaRouteEngine: valhalla.createValhallaRouteEngine,
    validateOutcome: outcomeValidator.validatePathfindingBenchmarkOutcome,
    loadPathfindingBenchmarkManifest: manifest.loadPathfindingBenchmarkManifest,
    loadPathfindingBenchmarkFixtures: fixturesModule.loadPathfindingBenchmarkFixtures,
    createPathfindingBenchmarkCases: fixturesModule.createPathfindingBenchmarkCases,
    createBenchmarkServiceHoursClient: fixturesModule.createBenchmarkServiceHoursClient,
    createPathfindingBenchmarkModeReport: report.createPathfindingBenchmarkModeReport,
    shouldFailBenchmarkRun: report.shouldFailBenchmarkRun,
    compareBenchmarkCaseResults: report.compareBenchmarkCaseResults,
    createMeasuredRouteEngine: instrumentation.createMeasuredRouteEngine,
    assertUniqueAdapterIds: identity.assertUniqueAdapterIds,
  }
}

async function loadFixtures(modules) {
  return modules.loadPathfindingBenchmarkFixtures()
}

async function findProjectRoot(adapterPath) {
  let current = dirname(adapterPath)
  while (true) {
    try {
      await Promise.all([access(resolve(current, 'package.json')), access(resolve(current, 'src'))])
      return current
    } catch {
      const parent = dirname(current)
      if (parent === current) throw new Error(`Could not find the project root for adapter: ${adapterPath}`)
      current = parent
    }
  }
}

async function loadAdapters(vite, paths, context) {
  const loaded = []
  for (const path of paths) {
    const module = await vite.ssrLoadModule(toViteFsModuleId(path))
    if (typeof module.createPathfindingBenchmarkAdapter !== 'function') {
      throw new Error(`${path} must export createPathfindingBenchmarkAdapter(context)`)
    }
    const adapter = await module.createPathfindingBenchmarkAdapter(context)
    if (
      !adapter ||
      typeof adapter.id !== 'string' || adapter.id.trim().length === 0 ||
      typeof adapter.label !== 'string' || adapter.label.trim().length === 0 ||
      typeof adapter.createSearchRunner !== 'function' ||
      typeof adapter.createPathRunner !== 'function'
    ) {
      throw new Error(`${path} returned an invalid Path benchmark adapter`)
    }
    loaded.push({ path, adapter })
  }
  const ids = loaded.map(({ adapter }) => adapter.id)
  if (new Set(ids).size !== ids.length) throw new Error('Adapter IDs must be unique in one benchmark run')
  return loaded
}

function createArrivalClient(benchmarkCase) {
  const snapshot = benchmarkCase.arrivalSnapshot
  return { getArrivals: async () => snapshot }
}

function createAdapterContext(fixtures, routeEngine, caseDefs, fixedNowMs, modules) {
  return {
    transit: fixtures.transit,
    venues: fixtures.venues,
    walkingGraph: fixtures.walkingGraph,
    routeEngine,
    now: () => fixedNowMs,
    createArrivalClient,
    createServiceHoursClient: (benchmarkCase) => modules.createBenchmarkServiceHoursClient(benchmarkCase, fixedNowMs),
    cases: caseDefs,
  }
}

function createCaseContext(adapterContext, benchmarkCase) {
  return {
    ...adapterContext,
    ...(benchmarkCase.transit ? { transit: benchmarkCase.transit } : {}),
    benchmarkCase,
  }
}

async function measureRun(runner, mode, routeEngine, benchmarkCase, fixtures, modules) {
  routeEngine.reset()
  const startedAt = performance.now()
  let outcome
  try {
    outcome = await runner(new AbortController().signal)
  } catch (error) {
    const counts = routeEngine.requestCounts
    const message = error instanceof Error ? error.message : 'Adapter run failed'
    if (mode === 'offline' && (counts.matrix > 0 || counts.route > 0)) {
      throw new Error(`${message}; offline benchmark attempted ${counts.matrix} Valhalla matrix and ${counts.route} route requests`)
    }
    throw error
  }
  const elapsedMs = performance.now() - startedAt
  const transit = benchmarkCase.transit ?? fixtures.transit
  const validation = modules.validateOutcome(outcome, benchmarkCase, transit, fixtures.venues, {
    mode,
    matrixRequests: mode === 'local' ? routeEngine.matrixRequests : [],
    walkingStopGraph: fixtures.walkingGraph,
    valhallaRequestCounts: routeEngine.requestCounts,
  })
  const result = { elapsedMs, validation }
  if (mode === 'local') {
    const requestCounts = routeEngine.requestCounts
    result.valhallaMs = routeEngine.elapsedMs
    result.valhallaMatrixMs = routeEngine.matrixElapsedMs
    result.valhallaRouteMs = routeEngine.routeElapsedMs
    result.valhallaMatrixRequests = requestCounts.matrix
    result.valhallaRouteRequests = requestCounts.route
  }
  return result
}

function createBenchmarkProgress(totalCases) {
  const isInteractive = Boolean(process.stderr.isTTY && totalCases > 0)
  const barWidth = 12
  let completedCases = 0
  let currentStatus = 'Preparing benchmark'
  let hasRendered = false
  let finished = false

  function render() {
    if (!isInteractive || finished) return

    const ratio = Math.min(1, completedCases / totalCases)
    const filledWidth = Math.floor(ratio * barWidth)
    const bar = `${'#'.repeat(filledWidth)}${'-'.repeat(barWidth - filledWidth)}`
    const percentage = Math.floor(ratio * 100)
    const summary = `[${bar}] ${percentage}% ${completedCases}/${totalCases}`
    const terminalWidth = process.stderr.columns ?? 80
    const statusWidth = Math.max(0, terminalWidth - summary.length - 1)
    const status = currentStatus.length > statusWidth
      ? statusWidth > 1
        ? `${currentStatus.slice(0, statusWidth - 1)}…`
        : ''
      : currentStatus

    process.stderr.write(`\r\x1B[2K${summary}${status ? ` ${status}` : ''}`)
    hasRendered = true
  }

  return {
    update(status) {
      currentStatus = status
      render()
    },
    completeCase(outcome) {
      completedCases = Math.min(totalCases, completedCases + 1)
      currentStatus = `${currentStatus} | ${outcome}`
      render()
    },
    skipCases(count, reason) {
      completedCases = Math.min(totalCases, completedCases + count)
      currentStatus = reason
      render()
    },
    finish() {
      if (finished) return
      finished = true
      if (isInteractive && hasRendered) process.stderr.write('\r\x1B[2K\n')
    },
  }
}

async function benchmarkMode(loadedAdapter, mode, caseDefs, adapterContext, fixtures, modules, options, progress) {
  const isSearch = mode === 'offline'
  const makeRunnerName = isSearch ? 'createSearchRunner' : 'createPathRunner'
  const caseRuns = []
  const adapterId = loadedAdapter.adapter.id.length > 14
    ? `${loadedAdapter.adapter.id.slice(0, 13)}…`
    : loadedAdapter.adapter.id

  for (const [caseIndex, benchmarkCase] of caseDefs.entries()) {
    const casePosition = `${caseIndex + 1}/${caseDefs.length}`
    progress.update(`${adapterId} | ${mode} | case ${casePosition} | setup`)
    let runner
    let failure = null
    adapterContext.routeEngine.reset()
    try {
      runner = await loadedAdapter.adapter[makeRunnerName](createCaseContext(adapterContext, benchmarkCase))
      if (typeof runner !== 'function') throw new Error(`${makeRunnerName} must return a runner function`)
    } catch (error) {
      failure = error instanceof Error ? error.message : 'Adapter setup failed'
    }
    const setupRequests = adapterContext.routeEngine.requestCounts
    if (mode === 'offline' && (setupRequests.matrix > 0 || setupRequests.route > 0)) {
      const requestError = `offline benchmark adapter setup attempted ${setupRequests.matrix} Valhalla matrix and ${setupRequests.route} route requests`
      failure = failure ? `${failure}; ${requestError}` : requestError
      runner = undefined
    }

    const measuredSamples = []
    if (runner) {
      for (let index = 0; index < options.warmups + options.samples; index += 1) {
        const runPosition = index < options.warmups
          ? `warmup ${index + 1}/${options.warmups}`
          : `sample ${index - options.warmups + 1}/${options.samples}`
        progress.update(`${adapterId} | ${mode} | case ${casePosition} | ${runPosition}`)
        try {
          const record = await measureRun(runner, mode, adapterContext.routeEngine, benchmarkCase, fixtures, modules)
          if (!record.validation.valid) {
            failure = record.validation.errors.join('; ')
            if (index >= options.warmups) measuredSamples.push(record)
            break
          }
          if (index >= options.warmups) measuredSamples.push(record)
        } catch (error) {
          failure = error instanceof Error ? error.message : 'Adapter run failed'
          break
        }
      }
    }
    caseRuns.push({
      benchmarkCase,
      samples: measuredSamples,
      ...(failure ? { setupError: failure } : {}),
    })
    progress.completeCase(failure ? 'failed' : 'complete')
  }

  const report = modules.createPathfindingBenchmarkModeReport(caseRuns, options.samples)
  const equalWeightHeadline = report.overall.statistics?.meanMs ?? null
  return {
    ...report,
    sampleCountPerCase: options.samples,
    warmupsPerCase: options.warmups,
    headline: isSearch
      ? {
        definition: 'equal-weight average of the per-case mean search times',
        meanMs: equalWeightHeadline,
        sampleCountPerCase: options.samples,
      }
      : {
        endToEnd: {
          definition: 'equal-weight average of the per-case mean end-to-end times',
          meanMs: equalWeightHeadline,
          sampleCountPerCase: options.samples,
        },
        valhalla: {
          definition: 'equal-weight average of the per-case mean Valhalla request times',
          meanMs: report.overall.valhalla?.meanMs ?? null,
          sampleCountPerCase: options.samples,
        },
      },
  }
}

function unavailableMode(reason, mode, options) {
  return {
    status: 'not-run',
    reason,
    sampleCountPerCase: options.samples,
    mode,
  }
}

function formatStatistics(statistics) {
  if (!statistics) return 'unavailable'
  return `mean ${statistics.meanMs} ms, median ${statistics.medianMs} ms, p95 ${statistics.p95Ms} ms, n=${statistics.sampleCount}`
}

function formatCountStatistics(statistics) {
  if (!statistics) return 'unavailable'
  return `mean ${statistics.mean}, median ${statistics.median}, p95 ${statistics.p95}, n=${statistics.sampleCount}`
}

function formatNetworkPhases(report) {
  return `matrix wait ${formatStatistics(report.valhallaMatrixMs)} (${formatCountStatistics(report.valhallaMatrixRequests)} requests); routed geometry wait ${formatStatistics(report.valhallaRouteMs)} (${formatCountStatistics(report.valhallaRouteRequests)} requests)`
}

function formatQuality(quality) {
  return `paths ${quality.paths} (exact ${quality.exact}, bounded ${quality.bounded}), no-route ${quality.noRoutes}, invalid ${quality.invalid}`
}

function formatMode(name, modeReport, local = false) {
  const lines = [`  ${name}: ${modeReport.status}`]
  if (modeReport.status !== 'available' && modeReport.status !== 'partial') {
    if (modeReport.reason) lines.push(`    ${modeReport.reason}`)
    return lines
  }
  for (const benchmarkCase of modeReport.cases) {
    const result = benchmarkCase.planning?.kind ?? 'invalid'
    const boardings = benchmarkCase.planning?.shuttleBoardings
    lines.push(`    ${benchmarkCase.id} [${benchmarkCase.group}/${benchmarkCase.scenario}]: ${formatStatistics(benchmarkCase.statistics)}; ${result}${boardings === undefined ? '' : `, ${boardings} shuttle boardings`}; ${formatQuality(benchmarkCase.resultQuality)}; validation ${benchmarkCase.validation.status}`)
    const work = benchmarkCase.planningWork
    if (work.expandedPathCount || work.budgetHitSamples > 0) {
      const paths = work.expandedPathCount
      const indexBuild = work.indexBuildDurationMs
      const search = work.searchDurationMs
      const searchCpu = work.searchCpuMs
      const yieldWait = work.searchYieldWaitMs
      const maxChunk = work.maxSearchChunkDurationMs
      const resolution = work.candidateResolutionDurationMs
      lines.push(`      Planner work: search median ${search?.median ?? 'unavailable'} ms, CPU ${searchCpu?.median ?? 'unavailable'} ms, yield wait ${yieldWait?.median ?? 'unavailable'} ms, max sync chunk ${maxChunk?.p95 ?? 'unavailable'} ms p95 / ${maxChunk?.max ?? 'unavailable'} ms max; index build ${indexBuild?.median ?? 'unavailable'} ms median, candidate resolution ${resolution?.median ?? 'unavailable'} ms median; expanded paths ${paths?.median ?? 'unavailable'} median, p95 ${paths?.p95 ?? 'unavailable'}; budget-hit samples ${work.budgetHitSamples}/${work.sampleCount}.`)
    }
    if (local) {
      lines.push(`      Valhalla total: ${formatStatistics(benchmarkCase.valhalla)}`)
      lines.push(`      Network phases: ${formatNetworkPhases(benchmarkCase)}`)
    }
    if (benchmarkCase.validation.errors.length) lines.push(`      validation: ${benchmarkCase.validation.errors.join('; ')}`)
  }
  for (const [category, aggregate] of Object.entries(modeReport.categories)) {
    lines.push(`    ${category}: ${formatStatistics(aggregate.statistics)}; Valhalla ${formatStatistics(aggregate.valhalla)}; ${formatQuality(aggregate.resultQuality)}; validation ${aggregate.validation.status}; cases ${aggregate.caseCount}; samples ${aggregate.sampleCount}`)
    if (local) lines.push(`      Network phases: ${formatNetworkPhases(aggregate)}`)
  }
  lines.push(`    overall (equal weight per case): ${formatStatistics(modeReport.overall.statistics)}; Valhalla ${formatStatistics(modeReport.overall.valhalla)}; ${formatQuality(modeReport.overall.resultQuality)}; validation ${modeReport.overall.validation.status}; cases ${modeReport.overall.caseCount}; samples ${modeReport.overall.sampleCount}`)
  if (local) lines.push(`      Network phases: ${formatNetworkPhases(modeReport.overall)}`)
  return lines
}

function printReport(report) {
  const lines = [
    `NavUS Path benchmark baseline ${report.baseline.commit ?? 'unknown'} (${report.baseline.branch ?? 'detached'})`,
    `Runtime: Node ${report.configuration.runtime.node}; ${report.configuration.runtime.platform}/${report.configuration.runtime.architecture}.`,
    `Cases: ${report.configuration.caseCount}; ${report.configuration.samplesPerCase} samples and ${report.configuration.warmupsPerCase} warmups per case; fixed clock ${report.configuration.fixedNow}.`,
  ]
  for (const adapter of report.adapters) {
    lines.push(`\n${adapter.label} [${adapter.id}]`)
    if (adapter.loadError) {
      lines.push(`  adapter: unavailable (${adapter.loadError})`)
      continue
    }
    lines.push(...formatMode('Search-only offline', adapter.searchOnlyOffline))
    lines.push(...formatMode('End-to-end local Valhalla', adapter.endToEndLocalValhalla, true))
  }
  console.log(lines.join('\n'))
  console.log('\n--- JSON REPORT ---')
  console.log(JSON.stringify(report, null, 2))
  console.log('--- END JSON REPORT ---')
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const adapterRoots = await Promise.all(options.adapterPaths.map(findProjectRoot))
  const backendRoot = resolve(process.cwd(), '../backend')
  const vite = await createServer({
    appType: 'custom',
    configFile: false,
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: [] },
    root: process.cwd(),
    server: {
      fs: { allow: [...new Set([process.cwd(), backendRoot, ...adapterRoots])] },
      hmr: false,
      middlewareMode: true,
      ws: false,
    },
  })
  let loadedAdapters = []
  let progress
  const report = {
    benchmark: 'NavUS Pathfinding benchmark',
    baseline: getGitIdentity(),
    configuration: {
      mode: options.mode,
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
      },
      samplesPerCase: options.samples,
      warmupsPerCase: options.warmups,
      adapterPaths: options.adapterPaths,
      caseCount: 50,
      fixedClock: true,
      fixedNow: null,
      valhallaUrl: options.valhallaUrl,
    },
  }

  try {
    const modules = await loadBenchmarkModules(vite)
    const manifest = await modules.loadPathfindingBenchmarkManifest()
    const fixedNowMs = Date.parse(manifest.fixedNow)
    const fixtures = await loadFixtures(modules)
    const caseDefs = createCaseDefinitions(fixtures, modules, manifest)
    const rawRouteEngine = modules.createValhallaRouteEngine({ baseUrl: options.valhallaUrl })
    const routeEngine = modules.createMeasuredRouteEngine(rawRouteEngine)
    const adapterContext = createAdapterContext(fixtures, routeEngine, caseDefs, fixedNowMs, modules)
    report.configuration.caseCount = caseDefs.length
    report.configuration.fixedNow = manifest.fixedNow
    report.fixtures = {
      transitStops: fixtures.transit.index.stops.length,
      walkingConnections: fixtures.walkingGraph.connections.length,
      cases: caseDefs.map(({ id, label, group, scenario, timingProfile, arrivalRouteIds, origin, destination, expected, durationBoundsSeconds }) => ({
        id,
        label,
        group,
        scenario,
        timingProfile: timingProfile.id,
        arrivalRouteIds: arrivalRouteIds ?? 'all routes',
        origin,
        destination,
        expected,
        durationBoundsSeconds,
      })),
    }

    const adapterLoadResults = []
    for (const path of options.adapterPaths) {
      try {
        const [loaded] = await loadAdapters(vite, [path], adapterContext)
        loadedAdapters.push(loaded)
        adapterLoadResults.push({ loaded, path })
      } catch (error) {
        adapterLoadResults.push({ error: error instanceof Error ? error.message : 'Adapter loading failed', path })
      }
    }

    modules.assertUniqueAdapterIds(adapterLoadResults.flatMap((entry) => (
      entry.loaded ? [{ id: entry.loaded.adapter.id, path: entry.loaded.path }] : []
    )))

    const selectedModeCount = options.mode === 'all' ? 2 : 1
    const totalCases = adapterLoadResults.length * selectedModeCount * caseDefs.length
    progress = createBenchmarkProgress(totalCases)
    progress.update('Starting benchmark cases')

    report.adapters = []
    for (const entry of adapterLoadResults) {
      if (entry.error) {
        const skippedCases = selectedModeCount * caseDefs.length
        progress.skipCases(skippedCases, `adapter load failed; skipped ${skippedCases} cases`)
        report.adapters.push({
          id: entry.path,
          label: entry.path,
          path: entry.path,
          loadError: entry.error,
          searchOnlyOffline: unavailableMode('Adapter could not be loaded.', 'offline', options),
          endToEndLocalValhalla: unavailableMode('Adapter could not be loaded.', 'local', options),
        })
        process.exitCode = 2
        continue
      }
      const { adapter, path } = entry.loaded
      const adapterReport = { id: adapter.id, label: adapter.label, path }
      adapterReport.searchOnlyOffline = options.mode === 'all' || options.mode === 'offline'
        ? await benchmarkMode(entry.loaded, 'offline', caseDefs, adapterContext, fixtures, modules, options, progress)
        : unavailableMode('Excluded by --mode=local.', 'offline', options)
      adapterReport.endToEndLocalValhalla = options.mode === 'all' || options.mode === 'local'
        ? await benchmarkMode(entry.loaded, 'local', caseDefs, adapterContext, fixtures, modules, options, progress)
        : unavailableMode('Excluded by --mode=offline.', 'local', options)
      if (
        adapterReport.searchOnlyOffline.status === 'partial' ||
        adapterReport.endToEndLocalValhalla.status === 'partial'
      ) process.exitCode = 2
      report.adapters.push(adapterReport)
    }
    report.comparison = {
      offline: modules.compareBenchmarkCaseResults(report.adapters
        .filter((adapter) => adapter.searchOnlyOffline?.status === 'available' || adapter.searchOnlyOffline?.status === 'partial')
        .map((adapter) => ({ id: adapter.id, cases: adapter.searchOnlyOffline.cases }))),
      local: modules.compareBenchmarkCaseResults(report.adapters
        .filter((adapter) => adapter.endToEndLocalValhalla?.status === 'available' || adapter.endToEndLocalValhalla?.status === 'partial')
        .map((adapter) => ({ id: adapter.id, cases: adapter.endToEndLocalValhalla.cases }))),
    }
    if (modules.shouldFailBenchmarkRun(report)) process.exitCode = 2
    progress.finish()
    printReport(report)
  } finally {
    progress?.finish()
    for (const { adapter } of loadedAdapters) await adapter.dispose?.()
    await vite.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Pathfinding benchmark failed')
  process.exitCode = 1
})
