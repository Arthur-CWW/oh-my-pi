import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  executeChineseReadingReviewCell,
  ValidationCellBudgetExceededError,
  ValidationCellLayerNotImplementedError,
} from "../src/chinese-reading-review-cell"
import { runValidationCell } from "../src/validation-cell-runner"

import {
  VALIDATION_CELL_MANIFEST_VERSION,
  VALIDATION_CELL_RECEIPT_VERSION,
  decodeValidationCellManifest,
  decodeValidationCellReceipt,
} from "../src/validation-cell-contract"

const manifestPath = new URL("../validation/cells/chinese-reading-review.v1.json", import.meta.url)
const receiptSchemaPath = new URL("../validation/receipt.schema.json", import.meta.url)
const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const committedManifestPath = fileURLToPath(manifestPath)

function readJson(path: URL): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown
}

function validReceipt(): Record<string, unknown> {
  return {
    schemaVersion: VALIDATION_CELL_RECEIPT_VERSION,
    manifest: {
      schemaVersion: VALIDATION_CELL_MANIFEST_VERSION,
      cellId: "chinese-reading-review",
      cellVersion: 1,
    },
    scenario: {
      id: "chinese-reading-review.sqlite-http-restart",
      startedAt: "2026-01-15T12:00:00.000Z",
      completedAt: "2026-01-15T12:00:12.000Z",
    },
    outcome: "passed",
    layers: {
      state: {
        status: "passed",
        assertions: [{ id: "scheduler-row", status: "passed", detail: "The scheduler row survived restart." }],
      },
      process: {
        status: "passed",
        assertions: [{ id: "new-pid", status: "passed", detail: "The restarted server has a different pid." }],
      },
      browser: {
        status: "skipped",
        assertions: [],
        reason: "The package has no browser dependency.",
        nextLayer: "receipt",
      },
    },
    counts: {
      httpRequests: 9,
      sqliteWrites: 5,
      processStarts: 2,
      restarts: 1,
      assertionsPassed: 2,
      assertionsFailed: 0,
    },
    restartProof: {
      beforePid: 41001,
      afterPid: 41002,
      databasePath: "state/primer.sqlite",
      persistedSchedulerDueAt: "2026-01-16T12:00:00.000Z",
      observedSchedulerDueAt: "2026-01-16T12:00:00.000Z",
    },
    negativeControl: {
      id: "scheduler-persistence-without-state-write",
      executed: true,
      expectedOutcome: "invariant-failure",
      expectedInvariantFailure: "The scheduler due timestamp is absent after restart.",
      observedInvariantFailure: "The restarted review session returned no persisted scheduler due timestamp.",
    },
    artifacts: [
      { kind: "errors", path: "errors.log", bytes: 0 },
      { kind: "network", path: "network.log", bytes: 912 },
      { kind: "server-stdout", path: "server.stdout.log", bytes: 241 },
      { kind: "server-stderr", path: "server.stderr.log", bytes: 0 },
      { kind: "receipt", path: "receipt.json", bytes: 2048 },
    ],
    errors: [],
  }
}

function writeTemporaryManifest(root: string, manifest: Record<string, unknown>): string {
  const path = join(root, "manifest.json")
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  return path
}

function withManifestBudget(budget: Record<string, number>): Record<string, unknown> {
  const manifest = readJson(manifestPath) as Record<string, unknown>
  return {
    ...manifest,
    budget: {
      ...(manifest.budget as Record<string, number>),
      ...budget,
    },
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === "ESRCH") return false
    throw error
  }
}

describe("Primer validation cell contract", () => {
  test("decodes the committed Chinese reading/review manifest", () => {
    const manifest = decodeValidationCellManifest(readJson(manifestPath))

    expect(manifest.schemaVersion).toBe(VALIDATION_CELL_MANIFEST_VERSION)
    expect(manifest.scenario.database).toEqual({ engine: "sqlite", path: "state/primer.sqlite", mode: "real" })
    expect(manifest.layers.process.status).toBe("required")
    expect(manifest.layers.browser).toMatchObject({ status: "skipped", nextLayer: "receipt" })
    expect(manifest.entropyControls).toMatchObject({ provider: "reject", network: "loopback-only" })
    expect(manifest.negativeControl.expectedOutcome).toBe("invariant-failure")
  })

  test("decodes a complete receipt and keeps runner-facing proof fields", () => {
    const receipt = decodeValidationCellReceipt(validReceipt())

    expect(receipt.schemaVersion).toBe(VALIDATION_CELL_RECEIPT_VERSION)
    expect(receipt.layers.state.assertions[0]?.status).toBe("passed")
    expect(receipt.restartProof.beforePid).not.toBe(receipt.restartProof.afterPid)
    expect(receipt.artifacts.map(({ path }) => path)).toContain("receipt.json")
  })

  test("commits a strict receipt JSON schema with the TypeScript version", () => {
    const schema = readJson(receiptSchemaPath) as {
      additionalProperties?: unknown
      properties?: { schemaVersion?: { const?: unknown } }
      required?: unknown[]
    }

    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties?.schemaVersion?.const).toBe(VALIDATION_CELL_RECEIPT_VERSION)
    expect(schema.required).toEqual([
      "schemaVersion",
      "manifest",
      "scenario",
      "outcome",
      "layers",
      "counts",
      "restartProof",
      "negativeControl",
      "artifacts",
      "errors",
    ])
  })

  test("rejects malformed manifest and receipt versions", () => {
    const manifest = readJson(manifestPath) as Record<string, unknown>
    expect(() => decodeValidationCellManifest({ ...manifest, schemaVersion: "primer.validation-cell-manifest.v2" })).toThrow()
    expect(() => decodeValidationCellReceipt({ ...validReceipt(), schemaVersion: "primer.validation-cell-receipt.v2" })).toThrow()
  })

  test("rejects malformed or incomplete layer declarations", () => {
    const manifest = readJson(manifestPath) as Record<string, unknown>
    expect(() =>
      decodeValidationCellManifest({
        ...manifest,
        layers: {
          ...(manifest.layers as Record<string, unknown>),
          browser: { layer: "browser", status: "skipped", reason: "No dependency." },
        },
      }),
    ).toThrow()

    const receipt = validReceipt()
    expect(() =>
      decodeValidationCellReceipt({
        ...receipt,
        layers: {
          ...(receipt.layers as Record<string, unknown>),
          state: { status: "skipped", assertions: [] },
        },
      }),
    ).toThrow()
  })

  test("rejects malformed negative controls", () => {
    const manifest = readJson(manifestPath) as Record<string, unknown>
    expect(() =>
      decodeValidationCellManifest({
        ...manifest,
        negativeControl: {
          ...(manifest.negativeControl as Record<string, unknown>),
          expectedOutcome: "passed",
        },
      }),
    ).toThrow()

    const receipt = validReceipt()
    expect(() =>
      decodeValidationCellReceipt({
        ...receipt,
        negativeControl: {
          ...(receipt.negativeControl as Record<string, unknown>),
          executed: false,
        },
      }),
    ).toThrow()
  })
  test("allows a zero restart cap so execution can prove the negative budget", () => {
    const manifest = decodeValidationCellManifest(withManifestBudget({ maxRestarts: 0 }))
    expect(manifest.budget.maxRestarts).toBe(0)
  })

  test("unlinks a stale receipt before logs and leaves it absent when the executor fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "primer-validation-runner-test-"))
    const outputRoot = join(root, "artifacts")
    const receiptPath = join(outputRoot, "receipt.json")
    let receiptExistedAtExecutor = true
    try {
      mkdirSync(dirname(receiptPath), { recursive: true })
      writeFileSync(receiptPath, "stale successful receipt\n")

      await expect(
        runValidationCell({
          manifestPath: committedManifestPath,
          repositoryRoot: packageRoot,
          outputRoot,
          executor: async ({ artifacts }) => {
            receiptExistedAtExecutor = existsSync(artifacts.receipt)
            throw new Error("executor failed before producing a receipt")
          },
        }),
      ).rejects.toThrow("executor failed before producing a receipt")

      expect(receiptExistedAtExecutor).toBe(false)
      expect(existsSync(receiptPath)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("fails a required browser layer with a typed error before starting a process", async () => {
    const root = mkdtempSync(join(tmpdir(), "primer-validation-browser-test-"))
    const outputRoot = join(root, "artifacts")
    try {
      const manifest = readJson(manifestPath) as Record<string, unknown>
      const manifestPathForTest = writeTemporaryManifest(root, {
        ...manifest,
        layers: {
          ...(manifest.layers as Record<string, unknown>),
          browser: {
            layer: "browser",
            status: "required",
            assertions: ["A real browser layer must execute."],
          },
        },
      })

      let failure: unknown
      try {
        await runValidationCell({
          manifestPath: manifestPathForTest,
          repositoryRoot: packageRoot,
          outputRoot,
          executor: executeChineseReadingReviewCell,
        })
      } catch (error) {
        failure = error
      }

      expect(failure).toBeInstanceOf(ValidationCellLayerNotImplementedError)
      expect((failure as ValidationCellLayerNotImplementedError).layer).toBe("browser")
      expect(statSync(join(outputRoot, "server.stdout.log")).size).toBe(0)
      expect(existsSync(join(outputRoot, "receipt.json"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("rejects the real process restart when maxRestarts is zero", async () => {
    const root = mkdtempSync(join(tmpdir(), "primer-validation-restart-test-"))
    const outputRoot = join(root, "artifacts")
    try {
      const manifestPathForTest = writeTemporaryManifest(root, withManifestBudget({ maxRestarts: 0 }))
      let failure: unknown
      try {
        await runValidationCell({
          manifestPath: manifestPathForTest,
          repositoryRoot: packageRoot,
          outputRoot,
          executor: executeChineseReadingReviewCell,
        })
      } catch (error) {
        failure = error
      }

      expect(failure).toBeInstanceOf(ValidationCellBudgetExceededError)
      expect(failure).toMatchObject({ budget: "maxRestarts", limit: 0, observed: 1 })
      expect(existsSync(join(outputRoot, "receipt.json"))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  test("reaps the real server and settles streams after the total deadline expires", async () => {
    const root = mkdtempSync(join(tmpdir(), "primer-validation-timeout-test-"))
    const outputRoot = join(root, "artifacts")
    const stdoutPath = join(outputRoot, "server.stdout.log")
    const stderrPath = join(outputRoot, "server.stderr.log")
    const errorsPath = join(outputRoot, "errors.log")
    try {
      const manifestPathForTest = writeTemporaryManifest(root, withManifestBudget({ timeoutMs: 500 }))
      let failure: unknown
      try {
        await runValidationCell({
          manifestPath: manifestPathForTest,
          repositoryRoot: packageRoot,
          outputRoot,
          executor: executeChineseReadingReviewCell,
        })
      } catch (error) {
        failure = error
      }

      expect(failure).toBeInstanceOf(ValidationCellBudgetExceededError)
      expect(failure).toMatchObject({ budget: "timeoutMs", limit: 500 })
      const stdoutAtReturn = readFileSync(stdoutPath)
      const stderrAtReturn = readFileSync(stderrPath)
      const pids = [...stdoutAtReturn.toString("utf8").matchAll(/"pid":(\d+)/g)].map((match) => Number(match[1]))
      expect(pids.length).toBeGreaterThan(0)
      for (const pid of pids) expect(processIsAlive(pid)).toBe(false)
      expect(existsSync(join(outputRoot, "receipt.json"))).toBe(false)
      expect(statSync(errorsPath).size).toBeGreaterThan(0)
      expect(readFileSync(errorsPath, "utf8")).toContain("ValidationCellBudgetExceededError")

      await Bun.sleep(100)
      expect(readFileSync(stdoutPath)).toEqual(stdoutAtReturn)
      expect(readFileSync(stderrPath)).toEqual(stderrAtReturn)
      for (const pid of pids) expect(processIsAlive(pid)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

})
