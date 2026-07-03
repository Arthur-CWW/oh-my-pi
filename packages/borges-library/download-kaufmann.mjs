#!/usr/bin/env bun

// Compatibility entry point for the old one-off Kaufmann downloader.
// `bun ./download-kaufmann.mjs <outDir>` still works; all new batch options
// are handled by download-batch.ts.
const args = process.argv.slice(2)
if (args[0] && !args[0].startsWith("-")) {
  process.argv = [process.argv[0], process.argv[1], "--out-dir", args[0], ...args.slice(1)]
}

await import("./download-batch.ts")
