import { beforeAll, describe, expect, it } from "bun:test"
import * as fs from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import {
  ReplayTraceIntegrityError,
  runDifferentialReplay,
  type DifferentialReplayOptions,
} from "@agents/provider-testkit"
import {
  canonicalizeOmpObservation,
  createOmpReplayCandidate,
  loadOmpReplayFixture,
  OmpReplayReferenceAdapter,
  type LoadedOmpReplayFixture,
  type OmpReplayObservation,
} from "./omp-replay-adapter"

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "sanitized-child-session.jsonl",
)
const SOURCE_DIGEST = "sha256:c48c186188063df61948618b49950ece9b4ab8c410d42db060fc3753153dda12"

let fixture: LoadedOmpReplayFixture

beforeAll(async () => {
  fixture = await loadOmpReplayFixture(fixturePath)
})

const replayOptions: DifferentialReplayOptions<OmpReplayObservation> = {
  unknownEventPolicy: "reject",
  canonicalize: canonicalizeOmpObservation,
  invariants: [
    {
      name: "terminal-consistency",
      check: observation => {
        const projectedTerminal =
          observation.lifecycle?.state === "completed" ||
          observation.lifecycle?.state === "failed" ||
          observation.lifecycle?.state === "interrupted"
        return observation.terminal === projectedTerminal
          ? undefined
          : "terminal flag disagrees with the lifecycle projection"
      },
    },
  ],
  environment: { runtime: "bun", host: "nixbox", state: "tmpfs" },
}

const tempRoot = (): Promise<string> => fs.mkdtemp(path.join(os.tmpdir(), "omp-differential-replay-"))

describe("OMP historical differential replay", () => {
  it("matches the independent reducer after real journal reopen and sealed provider replay", async () => {
    const root = await tempRoot()
    const candidate = await createOmpReplayCandidate(fixture.trace, root)
    try {
      const result = await runDifferentialReplay(
        fixture.trace,
        new OmpReplayReferenceAdapter(),
        candidate,
        replayOptions,
      )

      expect(result.kind).toBe("match")
      expect(fixture.trace.sourceDigest).toBe(SOURCE_DIGEST)
      expect(result.receipt).toMatchObject({
        sourceDigest: SOURCE_DIGEST,
        environment: replayOptions.environment,
        trace: {
          schemaVersion: 1,
          traceId: "omp-sanitized-child-session",
          eventCount: 6,
          checkpointCount: 5,
          seed: 271828,
        },
      })
      expect(result.receipt.checkpoints.map(checkpoint => checkpoint.id)).toEqual([
        "user",
        "provider",
        "tool",
        "restart",
        "terminal",
      ])
      expect(result.receipt.checkpoints.find(checkpoint => checkpoint.id === "restart")?.reopened).toBe(true)
      expect(candidate.observe()).toEqual({
        messages: [
          { role: "user", text: "Run diagnostics." },
          { role: "assistant", text: "Diagnostics ready." },
          { role: "toolResult", text: '{"healthy":true}' },
        ],
        lifecycle: { entityId: "ReplayChild", state: "completed" },
        restart: { entityId: "ReplayChild", state: "running", status: "resumed", attemptId: "attempt-2" },
        terminal: true,
        reopens: 1,
      })

      const manifest = JSON.parse(await Bun.file(path.join(root, "cassette", "manifest.json")).text()) as {
        checksum?: unknown
        interactions?: unknown[]
      }
      expect(typeof manifest.checksum).toBe("string")
      expect(manifest.interactions).toHaveLength(1)
    } finally {
      await candidate.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("rejects non-finite message timestamps before appending journal entries", async () => {
    const root = await tempRoot()
    const candidate = await createOmpReplayCandidate(fixture.trace, root)
    try {
      await expect(
        candidate.apply({ type: "user", content: "invalid timestamp", at: "not-a-date" }, 0),
      ).rejects.toBeInstanceOf(ReplayTraceIntegrityError)
      await expect(
        candidate.apply(
          {
            type: "tool",
            callId: "call-invalid",
            name: "invalid",
            result: null,
            at: "also-not-a-date",
          },
          1,
        ),
      ).rejects.toBeInstanceOf(ReplayTraceIntegrityError)
      expect(candidate.observe().messages).toEqual([])
    } finally {
      await candidate.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("imports and replays distinct provider retry keys", async () => {
    const providerEvent = fixture.trace.events.find(event => event.type === "provider")
    if (providerEvent === undefined || providerEvent.type !== "provider") {
      throw new Error("sanitized fixture has no provider event")
    }

    const root = await tempRoot()
    const retryFixturePath = path.join(root, "provider-retries.jsonl")
    const retryRecords = [
      {
        type: "provider_replay",
        variant: "retry",
        attempt: 1,
        request: providerEvent.request,
        response: {
          text: "Retry one.",
          stopReason: providerEvent.expectedStopReason,
          usage: providerEvent.expectedUsage,
        },
      },
      {
        type: "provider_replay",
        variant: "retry",
        attempt: 2,
        request: providerEvent.request,
        response: {
          text: "Retry two.",
          stopReason: providerEvent.expectedStopReason,
          usage: providerEvent.expectedUsage,
        },
      },
      { type: "checkpoint", id: "after-retries" },
    ]
    await Bun.write(retryFixturePath, `${retryRecords.map(record => JSON.stringify(record)).join("\n")}\n`)
    const retries = await loadOmpReplayFixture(retryFixturePath)
    expect(
      retries.trace.events.map(event =>
        event.type === "provider" ? [event.variant, event.attempt, event.expectedText] : null,
      ),
    ).toEqual([
      ["retry", 1, "Retry one."],
      ["retry", 2, "Retry two."],
    ])

    const candidate = await createOmpReplayCandidate(retries.trace, root)
    try {
      const result = await runDifferentialReplay(
        retries.trace,
        new OmpReplayReferenceAdapter(),
        candidate,
        replayOptions,
      )
      expect(result.kind).toBe("match")

      const manifest = JSON.parse(await Bun.file(path.join(root, "cassette", "manifest.json")).text()) as {
        interactions: Array<{ variant: string; attempt: number }>
      }
      expect(manifest.interactions.map(interaction => [interaction.variant, interaction.attempt])).toEqual([
        ["retry", 1],
        ["retry", 2],
      ])
    } finally {
      await candidate.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("kills the wrong append-order resume mutant at the first restart checkpoint", async () => {
    const root = await tempRoot()
    const mutant = await createOmpReplayCandidate(fixture.trace, root, "wrong-restart-order")
    try {
      const result = await runDifferentialReplay(
        fixture.trace,
        new OmpReplayReferenceAdapter(),
        mutant,
        replayOptions,
      )

      expect(result.kind).toBe("diverged")
      if (result.kind !== "diverged") throw new Error("wrong-order resume mutant survived")
      expect(result.report).toMatchObject({
        reason: "observation",
        checkpointId: "restart",
        eventIndex: 4,
        prefixLength: 5,
      })
      expect(result.report.minimizedPrefix).toEqual(fixture.trace.events.slice(0, 5))
      expect(result.report.expected).toMatchObject({ restart: { status: "resumed", attemptId: "attempt-2" } })
      expect(result.report.actual).toMatchObject({ restart: { status: "pending", attemptId: null } })
      expect(result.report.expectedDigest).not.toBe(result.report.actualDigest)
      expect(result.receipt.checkpoints.map(checkpoint => checkpoint.id)).toEqual(["user", "provider", "tool"])
    } finally {
      await mutant.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
