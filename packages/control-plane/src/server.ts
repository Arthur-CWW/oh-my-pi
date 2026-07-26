import { Effect } from "effect"

import { makeControlPlaneApiService, type ControlPlaneApiOptions } from "./http-api"

export interface ControlPlaneServerOptions extends ControlPlaneApiOptions {
  readonly hostname?: string
  readonly port?: number
}

export interface ControlPlaneServer {
  readonly port: number
  readonly stop: (closeActiveConnections?: boolean) => void
}

export function startControlPlaneServer(options: ControlPlaneServerOptions) {
  const api = Effect.runSync(makeControlPlaneApiService(options))
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    fetch: api.fetch,
  })
  return { port: server.port, stop: (closeActiveConnections = true) => server.stop(closeActiveConnections) }
}
