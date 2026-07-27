#!/usr/bin/env bun
/**
 * Regenerates `fixtures/cassettes/example/` through the real record -> seal
 * path: a scripted upstream stands in for a live provider, `RecordingProvider`
 * captures the neutral stream, and `sealCassette` performs the reviewed
 * redaction + checksum step. The committed bundle is therefore an artifact of
 * the production code path, not hand-written JSON.
 *
 * Usage: bun run scripts/make-example-cassette.ts [outputDirectory]
 */
import { Effect, Stream } from "effect"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { sealCassette, writeSealedCassette } from "../src/cassette"
import { makeMemorySink, makeRecordingProvider } from "../src/recording"
import { DEFAULT_REDACTION_POLICY } from "../src/redaction"
import { makeScriptedProvider } from "../src/scripted"
import {
  EXAMPLE_CASSETTE_ID,
  EXAMPLE_INTERACTION_ID,
  exampleRequest,
  leakySteps,
} from "../test/support/fixtures"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const target = process.argv[2] ?? join(packageRoot, "fixtures", "cassettes", "example")

const program = Effect.gen(function* () {
  const upstream = makeScriptedProvider({
    scriptId: "example-recorder",
    interactions: [{ name: "success", when: () => true, steps: leakySteps, terminal: { kind: "complete" } }],
  })
  const sink = makeMemorySink()
  const recording = makeRecordingProvider(upstream, sink, { interactionId: () => EXAMPLE_INTERACTION_ID })

  yield* Stream.runDrain(recording.stream(exampleRequest()))
  const drafts = yield* sink.drafts

  const sealed = yield* sealCassette({
    cassetteId: EXAMPLE_CASSETTE_ID,
    interactions: drafts,
    policy: DEFAULT_REDACTION_POLICY,
    // Fixed so regeneration is byte-reproducible and diffs stay reviewable.
    createdAt: "2026-07-27T00:00:00.000Z",
  })
  yield* writeSealedCassette(target, sealed)
  return sealed.manifest
})

const manifest = await Effect.runPromise(program)
process.stdout.write(
  `sealed ${manifest.cassetteId} -> ${target}\n` +
    `  interactions: ${manifest.interactions.length}\n` +
    `  redaction policy: ${manifest.redaction.policyVersion}\n` +
    `  redactions applied: ${manifest.privacyReceipt.redactionsApplied}\n` +
    `  checksum: ${manifest.checksum}\n`,
)
