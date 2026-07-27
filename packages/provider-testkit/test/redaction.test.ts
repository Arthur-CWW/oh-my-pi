import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { componentDigests, requestDigest } from "../src/canonical"
import { sealCassette, type DraftInteraction } from "../src/cassette"
import { RedactionViolationError } from "../src/errors"
import { DEFAULT_REDACTION_POLICY, REDACTION_POLICIES, findRedactionResidue } from "../src/redaction"
import { scriptedFrames } from "../src/scripted"
import {
  LEAKED_BEARER,
  LEAKED_HOME_PATH,
  REDACTED_REASONING_TEXT,
  exampleRequest,
  leakySteps,
} from "./support/fixtures"

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const leakyDraft = (): DraftInteraction => {
  const request = exampleRequest()
  return {
    interactionId: "leaky",
    requestDigest: requestDigest(request),
    componentDigests: componentDigests(request),
    variant: "default",
    attempt: 1,
    frames: scriptedFrames(leakySteps),
  }
}

describe("redaction at write time", () => {
  it("applies the declared policy and records a privacy receipt", async () => {
    const sealed = await Effect.runPromise(
      sealCassette({
        cassetteId: "redaction-ok",
        interactions: [leakyDraft()],
        policy: DEFAULT_REDACTION_POLICY,
        createdAt: "2026-07-27T00:00:00.000Z",
      }),
    )

    const bytes = sealed.files.get("interactions/leaky.jsonl") as string
    expect(bytes).toContain(REDACTED_REASONING_TEXT)
    expect(bytes).not.toContain(LEAKED_BEARER)
    expect(bytes).not.toContain(LEAKED_HOME_PATH)
    expect(sealed.manifest.privacyReceipt.redactionsApplied).toBeGreaterThan(0)
    expect(sealed.manifest.privacyReceipt.residueFindings).toBe(0)
  })

  it("refuses to produce bytes when the policy leaves sensitive material behind", async () => {
    const underSpecified = REDACTION_POLICIES["api-keys-only/v1"]
    expect(underSpecified).toBeDefined()

    const exit = await Effect.runPromiseExit(
      sealCassette({
        cassetteId: "redaction-violation",
        interactions: [leakyDraft()],
        policy: underSpecified as (typeof REDACTION_POLICIES)[string],
        createdAt: "2026-07-27T00:00:00.000Z",
      }),
    )

    expect(exit._tag).toBe("Failure")
    const failure = exit._tag === "Failure" ? exit.cause : undefined
    const rendered = JSON.stringify(failure)
    expect(rendered).toContain("RedactionViolationError")
    expect(rendered).toContain("absoluteHomePath")
    // The error names the rule and a JSON pointer, never the offending value.
    expect(rendered).not.toContain("operator")
    expect(RedactionViolationError.name).toBe("RedactionViolationError")
  })

  it("reports findings as rule plus pointer plus count only", () => {
    const findings = findRedactionResidue(
      DEFAULT_REDACTION_POLICY,
      { note: `${LEAKED_HOME_PATH} and ${LEAKED_HOME_PATH}` },
      "/root",
    )
    expect(findings).toEqual([{ rule: "absoluteHomePath", pointer: "/root/note", occurrences: 2 }])
  })
})

describe("the committed example cassette", () => {
  it("carries no credential material on disk", async () => {
    const directory = join(packageRoot, "fixtures", "cassettes", "example")
    const manifest = await readFile(join(directory, "manifest.json"), "utf8")
    const frames = await readFile(join(directory, "interactions", "annotate-passage-success.jsonl"), "utf8")

    for (const bytes of [manifest, frames]) {
      expect(findRedactionResidue(DEFAULT_REDACTION_POLICY, JSON.parse(bytes.split("\n")[0] as string))).toEqual([])
      expect(bytes).not.toContain(LEAKED_BEARER)
      expect(bytes).not.toContain("/home/operator")
    }
    expect(frames).toContain(REDACTED_REASONING_TEXT)
  })
})
