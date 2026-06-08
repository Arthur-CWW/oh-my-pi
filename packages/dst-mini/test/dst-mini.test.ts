import { describe, expect, test } from "bun:test"

import { runReplicatedLogSimulation, searchReplicatedLog, XorShift32 } from "../src"

describe("XorShift32", () => {
  test("replays the same pseudo-random stream from a seed", () => {
    const a = new XorShift32(42)
    const b = new XorShift32(42)
    expect(Array.from({ length: 10 }, () => a.nextUint32())).toEqual(Array.from({ length: 10 }, () => b.nextUint32()))
  })
})

describe("replicated log simulation", () => {
  test("finds the injected pre-durable ack bug and replays it by seed", () => {
    const search = searchReplicatedLog({ mode: "buggy", seeds: 50, steps: 60 })
    expect(search.ok).toBe(false)
    expect(search.firstFailure).toBeDefined()

    const replay = runReplicatedLogSimulation({ mode: "buggy", seed: search.firstFailure!.seed, steps: 60 })
    expect(replay.ok).toBe(false)
    expect(replay.violations).toEqual(search.firstFailure!.violations)
  })

  test("the quorum-ack implementation survives the same desktop fuzz budget", () => {
    const search = searchReplicatedLog({ mode: "fixed", seeds: 100, steps: 80 })
    expect(search.ok).toBe(true)
  })
})
