import { createServer, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createApp } from './http/app.ts'
import { loadBackendConfig } from './config.ts'
import { loadCanonicalData } from './canonical-data.ts'
import { createBackendLiveData } from './live-data/runtime.ts'
import { createPathfindingService } from './pathfinding/service.ts'
import type { BackendConfig } from './config.ts'

export function listenHttpServer(
  app: ReturnType<typeof createApp>,
  host: string,
  port: number,
): Promise<Server> {
  return new Promise((resolveServer, reject) => {
    const server = createServer(app)
    const onError = (error: Error) => reject(error)
    server.once('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolveServer(server)
    })
  })
}

export function closeHttpServer(server: Server, timeoutMs = 10_000): Promise<void> {
  if (!server.listening) return Promise.resolve()

  return new Promise((resolveClose, reject) => {
    const timeout = setTimeout(() => server.closeAllConnections(), timeoutMs)
    timeout.unref()
    server.close((error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolveClose()
    })
  })
}

async function startBackend(): Promise<void> {
  const config: BackendConfig = loadBackendConfig()
  const data = await loadCanonicalData(config.dataDirectory, config.dataVersion)
  const liveData = await createBackendLiveData(config, data)
  const pathfinding = createPathfindingService(data, liveData, config)
  const server = await listenHttpServer(createApp(config, data, liveData, pathfinding), config.host, config.port)
  liveData.start()
  console.info('NavUS Express API is listening.', {
    host: config.host,
    port: config.port,
    dataVersion: data.dataVersion,
  })

  let shuttingDown = false
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return
    shuttingDown = true
    console.info(`NavUS Express API received ${signal}; closing gracefully.`)
    void Promise.all([closeHttpServer(server), liveData.stop()]).catch((error: unknown) => {
      console.error('NavUS Express API shutdown failed.', error instanceof Error ? error.name : typeof error)
      process.exitCode = 1
    })
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

const entryPath = process.argv[1]
if (entryPath && resolve(entryPath) === fileURLToPath(import.meta.url)) {
  void startBackend().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown startup error'
    console.error('NavUS Express API failed to start.', message)
    process.exitCode = 1
  })
}
