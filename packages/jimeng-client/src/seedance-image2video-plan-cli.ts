#!/usr/bin/env bun
import { JimengError } from "./errors"
import { runJimengBrowserProxyCli } from "./browser-proxy-cli"

runJimengBrowserProxyCli(["seedance-image2video-plan", ...process.argv.slice(2)]).catch((error) => {
  if (error instanceof JimengError) {
    console.error(JSON.stringify(error.toJSON(), null, 2))
    process.exit(error.retryable ? 2 : 1)
  }
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
