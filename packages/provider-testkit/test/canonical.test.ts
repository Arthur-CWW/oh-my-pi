import { describe, expect, it } from "bun:test"
import { componentDigests, diffComponentDigests, requestDigest } from "../src/canonical"
import { exampleRequest } from "./support/fixtures"

describe("canonical request digest", () => {
  it("ignores volatile host-local observations", () => {
    const withTrace = exampleRequest()
    const withoutTrace = exampleRequest({ volatile: undefined })
    const differentTrace = exampleRequest({
      volatile: { traceId: "trace-zzz", requestId: "req-999", wallClockIso: "2030-01-01T00:00:00.000Z" },
    })

    expect(requestDigest(withoutTrace)).toBe(requestDigest(withTrace))
    expect(requestDigest(differentTrace)).toBe(requestDigest(withTrace))
  })

  it("changes when the prompt contract version changes", () => {
    const base = exampleRequest()
    const bumped = exampleRequest({ contract: { ...base.contract, promptVersion: "annotate/v4" } })

    expect(requestDigest(bumped)).not.toBe(requestDigest(base))
    expect(diffComponentDigests(componentDigests(base), componentDigests(bumped))).toEqual([
      {
        component: "contract",
        expected: componentDigests(base).contract,
        actual: componentDigests(bumped).contract,
      },
    ])
  })

  it("changes when the tool contract version or a tool schema changes", () => {
    const base = exampleRequest()
    const bumpedVersion = exampleRequest({ contract: { ...base.contract, toolContractVersion: "tools/v3" } })
    const changedSchema = exampleRequest({
      tools: [{ ...(base.tools[0] as (typeof base.tools)[number]), description: "Resolve a source id. Now stricter." }],
    })

    expect(requestDigest(bumpedVersion)).not.toBe(requestDigest(base))
    expect(requestDigest(changedSchema)).not.toBe(requestDigest(base))
    expect(diffComponentDigests(componentDigests(base), componentDigests(changedSchema)).map(m => m.component)).toEqual([
      "tools",
    ])
  })

  it("is insensitive to object key order but sensitive to array order", () => {
    const base = exampleRequest()
    const reorderedKeys = exampleRequest({
      generation: { seed: 7, stopSequences: ["</done>"], maxOutputTokens: 512, temperature: 0 },
    })
    const reorderedSystem = exampleRequest({ system: [base.system[1] as string, base.system[0] as string] })

    expect(requestDigest(reorderedKeys)).toBe(requestDigest(base))
    expect(requestDigest(reorderedSystem)).not.toBe(requestDigest(base))
  })

  it("treats NFC and CRLF variants of the same text as equal, and nothing else", () => {
    const composed = exampleRequest({ system: ["café\nline"] })
    const decomposed = exampleRequest({ system: ["cafe\u0301\r\nline"] })
    const trimmed = exampleRequest({ system: ["café\nline "] })

    expect(requestDigest(decomposed)).toBe(requestDigest(composed))
    expect(requestDigest(trimmed)).not.toBe(requestDigest(composed))
  })

  it("separates every identity dimension so a mismatch names the changed one", () => {
    const base = exampleRequest()
    const changedRoute = exampleRequest({ route: { providerApi: "openai.responses.v1", model: "claude-example-4" } })
    const changedGeneration = exampleRequest({ generation: { ...base.generation, temperature: 0.7 } })
    const changedConversation = exampleRequest({
      messages: [{ role: "user", parts: [{ kind: "text", text: "Annotate something else." }] }],
    })

    expect(diffComponentDigests(componentDigests(base), componentDigests(changedRoute)).map(m => m.component)).toEqual([
      "route",
    ])
    expect(
      diffComponentDigests(componentDigests(base), componentDigests(changedGeneration)).map(m => m.component),
    ).toEqual(["generation"])
    expect(
      diffComponentDigests(componentDigests(base), componentDigests(changedConversation)).map(m => m.component),
    ).toEqual(["conversation"])
  })
})
