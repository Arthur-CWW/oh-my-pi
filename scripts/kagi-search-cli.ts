#!/usr/bin/env bun

import { runKagiSearchCli } from "../src/effect/kagi-search.ts";

const exitCode = await runKagiSearchCli(process.argv.slice(2));
process.exit(exitCode);
