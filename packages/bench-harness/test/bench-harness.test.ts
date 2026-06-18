import { describe, expect, test } from "bun:test"
import { readFixturePacket } from "./fixtures.boundary"
import {
  decodeBenchPacket,
  scoreTask,
  aggregateScores,
  isRateLimitError,
  isAuthError,
  summarizeBenchRun,
  type BenchRunRecord,
  type BenchError,
  type BenchScoreInput,
  type BenchPacket
} from "../src/index"

describe("Benchmark Harness Schema & Fixtures", () => {
  test("decodes and validates lip-sync-human-packet fixture", () => {
    const packet = readFixturePacket("lip-sync-human-packet")
    expect(packet.id).toBe("lip-sync-human")
    expect(packet.difficulty).toBe("hard")
    expect(packet.risks).toContain("auth_required")
    expect(packet.inputs.length).toBe(4)
  })

  test("decodes and validates generation-parity-packet fixture", () => {
    const packet = readFixturePacket("generation-parity-packet")
    expect(packet.id).toBe("generation-parity")
    expect(packet.difficulty).toBe("medium")
    expect(packet.risks).toContain("rate_limited")
    expect(packet.inputs.length).toBe(3)
  })

  test("throws validation error on invalid packet", () => {
    const invalidPacket = {
      id: "", // Empty string not allowed
      title: "Invalid",
      workstream: "none",
      difficulty: "easy", // Not a valid difficulty literal
      summary: "Invalid packet",
      context: [],
      inputs: [],
      acceptance: [],
      risks: [],
      tags: []
    }
    expect(() => decodeBenchPacket(invalidPacket)).toThrow()
  })
})

describe("Scoring Rubric & Aggregation", () => {
  test("calculates score for a single task correctly based on rubric weights", () => {
    const input: BenchScoreInput = {
      taskId: "task-1",
      correctness: 0.8,      // weight 0.45 -> 0.36
      safety: 1.0,           // weight 0.25 -> 0.25
      completeness: 0.9,     // weight 0.20 -> 0.18
      maintainability: 0.7   // weight 0.10 -> 0.07
    }                        // sum = 0.86

    const breakdown = scoreTask(input)
    expect(breakdown.taskId).toBe("task-1")
    expect(breakdown.score).toBeCloseTo(0.86, 5)
    expect(breakdown.correctness).toBe(0.8)
    expect(breakdown.safety).toBe(1.0)
    expect(breakdown.completeness).toBe(0.9)
    expect(breakdown.maintainability).toBe(0.7)
  })

  test("aggregates multiple task scores", () => {
    const inputs: BenchScoreInput[] = [
      {
        taskId: "task-1",
        correctness: 1.0,
        safety: 1.0,
        completeness: 1.0,
        maintainability: 1.0
      }, // score = 1.0
      {
        taskId: "task-2",
        correctness: 0.0,
        safety: 0.0,
        completeness: 0.0,
        maintainability: 0.0
      } // score = 0.0
    ]

    const aggregated = aggregateScores(inputs)
    expect(aggregated.score).toBe(0.5)
    expect(aggregated.maxScore).toBe(1)
    expect(aggregated.breakdown.length).toBe(2)
    expect(aggregated.breakdown[0].score).toBe(1.0)
    expect(aggregated.breakdown[1].score).toBe(0.0)
  })

  test("handles empty list of scores", () => {
    const aggregated = aggregateScores([])
    expect(aggregated.score).toBe(0)
    expect(aggregated.breakdown.length).toBe(0)
  })
})

describe("Rate Limit and Auth Error Classification", () => {
  describe("isRateLimitError", () => {
    test("detects by error kind", () => {
      const err: BenchError = { message: "Error", kind: "rate_limit" }
      expect(isRateLimitError(err)).toBe(true)
    })

    test("detects by httpStatus 429", () => {
      const err: BenchError = { message: "Error", httpStatus: 429 }
      expect(isRateLimitError(err)).toBe(true)
    })

    test("detects by code RATE_LIMITED or TOO_MANY_REQUESTS", () => {
      expect(isRateLimitError({ message: "Error", code: "RATE_LIMITED" })).toBe(true)
      expect(isRateLimitError({ message: "Error", code: "TOO_MANY_REQUESTS" })).toBe(true)
    })

    test("detects by regex in error message", () => {
      expect(isRateLimitError({ message: "Rate limit exceeded" })).toBe(true)
      expect(isRateLimitError({ message: "too many requests" })).toBe(true)
      expect(isRateLimitError({ message: "monthly quota exhausted" })).toBe(true)
      expect(isRateLimitError({ message: "normal error" })).toBe(false)
    })
  })

  describe("isAuthError", () => {
    test("detects by error kind", () => {
      const err: BenchError = { message: "Error", kind: "auth" }
      expect(isAuthError(err)).toBe(true)
    })

    test("detects by httpStatus 401 and 403", () => {
      expect(isAuthError({ message: "Error", httpStatus: 401 })).toBe(true)
      expect(isAuthError({ message: "Error", httpStatus: 403 })).toBe(true)
    })

    test("detects by code", () => {
      expect(isAuthError({ message: "Error", code: "AUTH_REQUIRED" })).toBe(true)
      expect(isAuthError({ message: "Error", code: "UNAUTHORIZED" })).toBe(true)
      expect(isAuthError({ message: "Error", code: "FORBIDDEN" })).toBe(true)
    })

    test("detects by regex in error message", () => {
      expect(isAuthError({ message: "Unauthorized access" })).toBe(true)
      expect(isAuthError({ message: "Forbidden resource" })).toBe(true)
      expect(isAuthError({ message: "invalid credentials" })).toBe(true)
      expect(isAuthError({ message: "user login required" })).toBe(true)
      expect(isAuthError({ message: "normal error" })).toBe(false)
    })
  })
})

describe("Pure Summarizer", () => {
  test("summarizes a run record with success, rate limit, and auth errors", () => {
    const runRecord: BenchRunRecord = {
      runId: "run-123",
      packetId: "lip-sync-human",
      startedAtMs: 1000,
      endedAtMs: 2500, // 1500ms duration
      status: "passed",
      results: [
        {
          taskId: "task-passed",
          status: "passed",
          startedAtMs: 1000,
          endedAtMs: 1200,
          artifacts: [
            { id: "art-1", kind: "log", path: "logs/task-passed.log", bytes: 1024 }
          ]
        },
        {
          taskId: "task-rate-limited",
          status: "failed",
          startedAtMs: 1200,
          endedAtMs: 1500,
          error: {
            message: "Too many requests to capcut API",
            httpStatus: 429
          },
          artifacts: [
            { id: "art-2", kind: "json", path: "logs/task-rate.json", bytes: 2048 }
          ]
        },
        {
          taskId: "task-unauthorized",
          status: "error",
          startedAtMs: 1500,
          endedAtMs: 1800,
          error: {
            message: "Session token expired",
            code: "UNAUTHORIZED"
          },
          artifacts: []
        },
        {
          taskId: "task-skipped",
          status: "skipped",
          startedAtMs: 1800,
          endedAtMs: 1800,
          artifacts: []
        },
        {
          taskId: "task-blocked",
          status: "blocked",
          startedAtMs: 1800,
          endedAtMs: 2000,
          artifacts: []
        }
      ],
      artifacts: [
        { id: "run-report", kind: "report", path: "reports/run-123.html", bytes: 10240 }
      ]
    }

    const summary = summarizeBenchRun(runRecord)

    expect(summary.runId).toBe("run-123")
    expect(summary.packetId).toBe("lip-sync-human")
    expect(summary.status).toBe("passed")
    expect(summary.durationMs).toBe(1500)
    expect(summary.taskCount).toBe(5)
    
    // Status counts
    expect(summary.passed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.error).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.blocked).toBe(1)

    // Errors extraction
    expect(summary.rateLimitErrors.length).toBe(1)
    expect(summary.rateLimitErrors[0]).toEqual({
      taskId: "task-rate-limited",
      message: "Too many requests to capcut API",
      httpStatus: 429,
      code: undefined
    })

    expect(summary.authErrors.length).toBe(1)
    expect(summary.authErrors[0]).toEqual({
      taskId: "task-unauthorized",
      message: "Session token expired",
      code: "UNAUTHORIZED",
      httpStatus: undefined
    })

    // Artifacts aggregation
    expect(summary.artifacts.length).toBe(3) // 1 from runRecord, 1 from task-passed, 1 from task-rate-limited
    expect(summary.artifacts).toContainEqual({
      id: "run-report",
      kind: "report",
      path: "reports/run-123.html",
      bytes: 10240
    })
    expect(summary.artifacts).toContainEqual({
      id: "art-1",
      kind: "log",
      path: "logs/task-passed.log",
      bytes: 1024
    })
    expect(summary.artifacts).toContainEqual({
      id: "art-2",
      kind: "json",
      path: "logs/task-rate.json",
      bytes: 2048
    })
  })
})
