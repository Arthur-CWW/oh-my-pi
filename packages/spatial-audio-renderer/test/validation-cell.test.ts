import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { inspectWav16Stereo } from "../src"
import {
  acquireProofRootLock,
  COMPANION_VALIDATION_BOUNDED_ENV,
  COMPANION_VALIDATION_MANIFEST,
  COMPANION_VALIDATION_PROOF_LOCK_NAME,
  decodeCompanionValidationManifest,
  decodeCompanionValidationReceipt,
  decodeCompanionValidationWav,
  parseCgroupCpuQuotaPercent,
  ProofRootBusyError,
  releaseProofRootLock,
  runCompanionValidationCell,
  type CompanionValidationManifest,
  type CompanionValidationReceipt,
} from "../src/validation-cell"

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..")
const PACKAGE_DIR = path.resolve(import.meta.dirname, "..")
const TEST_OUTPUT_ROOT = "packages/spatial-audio-renderer/test-output"
const MANIFEST = COMPANION_VALIDATION_MANIFEST
/** A read-only parent cannot be created when the suite runs as root, so those cases are skipped. */
const CAN_DENY_WRITE = process.getuid === undefined || process.getuid() !== 0
/** Decoded schema values are deeply readonly; negative cases patch a JSON clone of one. */
type Mutable<T> = T extends readonly (infer U)[] ? Array<Mutable<U>>
  : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> }
  : T
type ManifestDraft = Mutable<CompanionValidationManifest>

let receipt: CompanionValidationReceipt
/** Same contract, different scratch/proof roots: proves the receipt replays across checkouts. */
let replayReceipt: CompanionValidationReceipt
let workspaceRoot: string
let proofRoot: string
let scratchRoots: string[]

const scratch = (prefix: string): string =>
  path.relative(REPO_ROOT, mkdtempSync(path.join(path.resolve(REPO_ROOT, TEST_OUTPUT_ROOT), prefix)))

const rootsFor = (cellRoot: string) => ({
  workspaceRoot: path.posix.join(cellRoot, "workspace"),
  proofRoot: path.posix.join(cellRoot, "proof"),
})

beforeAll(() => {
  mkdirSync(path.resolve(REPO_ROOT, TEST_OUTPUT_ROOT), { recursive: true })
  scratchRoots = ["cell-", "cell-replay-"].map(scratch)
  const roots = scratchRoots.map(rootsFor)
  workspaceRoot = roots[0].workspaceRoot
  proofRoot = roots[0].proofRoot
  receipt = runCompanionValidationCell(roots[0])
  replayReceipt = runCompanionValidationCell(roots[1])
})

afterAll(() => {
  for (const scratchRoot of scratchRoots) {
    const absolutePath = path.resolve(REPO_ROOT, scratchRoot)
    if (existsSync(path.join(absolutePath, "locked"))) chmodSync(path.join(absolutePath, "locked"), 0o700)
    rmSync(absolutePath, { recursive: true, force: true })
  }
  rmSync(path.resolve(REPO_ROOT, TEST_OUTPUT_ROOT, "containment-canary.txt"), { force: true })
})

describe("companion spatial validation cell", () => {
  test("manifest rejects fields outside the versioned contract", () => {
    expect(decodeCompanionValidationManifest(MANIFEST)).toEqual(MANIFEST)
    expect(() => decodeCompanionValidationManifest({ ...MANIFEST, extraKnob: 1 })).toThrow()
    expect(() =>
      decodeCompanionValidationManifest({
        ...MANIFEST,
        artifacts: { ...MANIFEST.artifacts, proofRoot: "../escape" },
      })
    ).toThrow()
  })

  test("decodes the rendered WAV as exact 48 kHz stereo with finite samples", () => {
    const wav = receipt.metrics.wav
    expect(wav.bitsPerSample).toBe(16)
    expect(wav.channels).toBe(2)
    expect(wav.sampleRateHz).toBe(48_000)
    expect(wav.frames).toBe(192_000)
    expect(wav.durationSec).toBe(wav.frames / wav.sampleRateHz)
    expect(wav.allFinite).toBe(true)
    expect(wav.peak).toBeGreaterThan(0)
    expect(wav.peak).toBeLessThanOrEqual(1)
  })

  test("moves stereo energy left to right across the x/z trajectory", () => {
    const { blocks, firstBalance, lastBalance, minBlockStep } = receipt.metrics.trajectory
    const oracle = MANIFEST.oracle.trajectory
    expect(blocks).toHaveLength(oracle.blocks)
    expect(firstBalance).toBeLessThanOrEqual(-oracle.minEdgeBalance)
    expect(lastBalance).toBeGreaterThanOrEqual(oracle.minEdgeBalance)
    expect(minBlockStep).toBeGreaterThanOrEqual(oracle.minBlockStep)
    for (let index = 1; index < blocks.length; index += 1) {
      expect(blocks[index].balance).toBeGreaterThan(blocks[index - 1].balance)
      expect(blocks[index].startFrame).toBe(blocks[index - 1].endFrame)
    }
  })

  test("keeps voice and foley temporally separated by true silence", () => {
    const { voiceRms, foleyRms, gapPeak, gapRms, separationDb } = receipt.metrics.temporal
    const oracle = MANIFEST.oracle.temporal
    expect(gapPeak).toBe(0)
    expect(gapRms).toBe(0)
    expect(voiceRms).toBeGreaterThan(oracle.minActiveRms)
    expect(foleyRms).toBeGreaterThan(oracle.minActiveRms)
    expect(separationDb).toBeGreaterThan(oracle.minSeparationDb)
  })

  test("renders byte-identical PCM on both passes and passes every invariant", () => {
    const [first, second] = receipt.hashes.output.passes
    expect(receipt.hashes.output.passes).toHaveLength(2)
    expect(second.pcmSha256).toBe(first.pcmSha256)
    expect(second.wavSha256).toBe(first.wavSha256)
    expect(second.byteLength).toBe(first.byteLength)
    expect(receipt.outcome).toBe("passed")
    expect(receipt.invariants.filter((invariant) => !invariant.passed)).toEqual([])
    expect(receipt.invariants.map((invariant) => invariant.id).sort()).toEqual([
      "temporal.voice-foley-separation",
      "trajectory.pan-sweeps-left-to-right",
      "wav.stereo-48k-frame-exact",
    ])
    expect(receipt.errors).toEqual([])
  })

  test("kills each mutant on its own invariant at the declared first frame", () => {
    expect(receipt.negativeControls).toHaveLength(MANIFEST.negativeControls.length)
    for (const expected of MANIFEST.negativeControls) {
      const observed = receipt.negativeControls.find((control) => control.id === expected.id)
      expect(observed).toBeDefined()
      if (observed === undefined) continue
      expect(observed.mutation).toBe(expected.mutation)
      expect(observed.invariant).toBe(expected.expectedInvariant)
      expect(observed.firstBadFrame).toBe(expected.expectedFirstBadFrame)
      expect(observed.killed).toBe(true)
      expect(observed.differsFromBaseline).toBe(true)
      expect(observed.wavSha256).not.toBe(receipt.hashes.output.passes[0].wavSha256)
    }
  })

  test("preserves the validated render as a playable proof and removes the scratch workspace", () => {
    const proofAudioPath = path.resolve(REPO_ROOT, receipt.cleanup.preserved[0])
    const proofBytes = readFileSync(proofAudioPath)
    expect(createHash("sha256").update(proofBytes).digest("hex")).toBe(receipt.hashes.output.passes[0].wavSha256)

    const playable = inspectWav16Stereo(proofAudioPath)
    expect(playable.channels).toBe(2)
    expect(playable.sampleRateHz).toBe(48_000)
    expect(playable.durationSec).toBe(4)
    expect(playable.nonSilent).toBe(true)

    expect(readFileSync(path.resolve(REPO_ROOT, proofRoot, ".gitignore"), "utf8")).toBe("*\n")
    expect(receipt.cleanup.removed).toBe(true)
    expect(existsSync(path.resolve(REPO_ROOT, workspaceRoot))).toBe(false)
  })

  test("records replayable provenance for the exact sources it exercised", () => {
    const sha256 = (repoRelativePath: string) =>
      createHash("sha256").update(readFileSync(path.resolve(REPO_ROOT, repoRelativePath))).digest("hex")
    expect(receipt.hashes.source.renderer.sha256).toBe(sha256(receipt.hashes.source.renderer.path))
    expect(receipt.hashes.source.cell.sha256).toBe(sha256(receipt.hashes.source.cell.path))
    expect(receipt.hashes.schema).toBe(createHash("sha256").update(JSON.stringify(MANIFEST)).digest("hex"))
    expect(replayReceipt.hashes.input).toEqual(receipt.hashes.input)
    expect(replayReceipt.hashes.source.digest).toBe(receipt.hashes.source.digest)
    expect(replayReceipt.hashes.output.passes[0].pcmSha256).toBe(receipt.hashes.output.passes[0].pcmSha256)
    expect(replayReceipt.metrics).toEqual(receipt.metrics)
    expect(replayReceipt.cleanup.workspaceRoot).not.toBe(receipt.cleanup.workspaceRoot)
    expect(receipt.replay.command).toEqual(MANIFEST.execution.command)
    expect(receipt.replay.environment.bunVersion).toBe(process.versions.bun ?? "unknown")
  })
})

describe("source binding", () => {
  test("binds every dependency the renderer resolves, not just the two entry files", () => {
    const bindings = receipt.hashes.source.bindings
    const byId = new Map(bindings.map((entry) => [entry.id, entry]))
    for (const id of [MANIFEST.sut.module, ...MANIFEST.sut.packages, ...MANIFEST.sut.lockfiles]) {
      expect(byId.get(id)).toBeDefined()
    }
    expect(byId.get(receipt.hashes.source.cell.path)?.sha256).toBe(receipt.hashes.source.cell.sha256)

    const contracts = byId.get("@wirebabel/media-contracts")
    expect(contracts?.kind).toBe("package")
    expect(contracts?.path).toBe("packages/media-contracts")
    const contractsPackageJson = JSON.parse(
      readFileSync(path.resolve(REPO_ROOT, "packages/media-contracts/package.json"), "utf8"),
    ) as { version: string }
    expect(contracts?.version).toBe(contractsPackageJson.version)

    const lockfile = byId.get("bun.lock")
    expect(lockfile?.kind).toBe("lockfile")
    expect(lockfile?.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  test("a digest that does not cover its bindings is not a decodable receipt", () => {
    const tampered = JSON.parse(JSON.stringify(receipt)) as Mutable<CompanionValidationReceipt>
    tampered.hashes.source.bindings[0].sha256 = "0".repeat(64)
    expect(() => decodeCompanionValidationReceipt(tampered)).toThrow(/source digest/)

    const reordered = JSON.parse(JSON.stringify(receipt)) as Mutable<CompanionValidationReceipt>
    reordered.hashes.source.bindings.reverse()
    expect(() => decodeCompanionValidationReceipt(reordered)).toThrow()
  })
})

describe("resource budget", () => {
  test("records the cgroup limits it observed rather than the command that should impose them", () => {
    const { declared, observed } = receipt.replay.budget
    expect(declared).toEqual(MANIFEST.execution.budget)
    expect(receipt.replay.boundedCommand).toContain(`MemoryMax=${declared.memoryMaxBytes}`)
    expect(receipt.replay.boundedCommand).toContain(`CPUQuota=${declared.cpuQuotaPercent}%`)
    expect(receipt.replay.boundedCommand).toContain(`RuntimeMaxSec=${declared.runtimeMaxSec}`)
    expect(receipt.replay.boundedCommand.slice(-MANIFEST.execution.command.length)).toEqual([
      ...MANIFEST.execution.command,
    ])
    expect(observed.enforced).toBe(observed.violations.length === 0)
    if (observed.enforced) {
      expect(observed.memoryMaxBytes).toBeLessThanOrEqual(declared.memoryMaxBytes)
      expect(observed.cpuQuotaPercent).toBeLessThanOrEqual(declared.cpuQuotaPercent)
      expect(observed.runtimeMaxSec).toBeLessThanOrEqual(declared.runtimeMaxSec)
      expect(observed.cgroup).not.toBeNull()
    } else {
      expect(observed.violations.length).toBeGreaterThan(0)
    }
  })

  test("a receipt cannot claim an enforced budget it did not observe", () => {
    const forged = JSON.parse(JSON.stringify(receipt)) as Mutable<CompanionValidationReceipt>
    forged.replay.budget.observed.enforced = !forged.replay.budget.observed.enforced
    expect(() => decodeCompanionValidationReceipt(forged)).toThrow(/budget enforced/)
  })

  test("the documented entry point refuses to run outside its declared budget", () => {
    if (receipt.replay.budget.observed.enforced) {
      expect(receipt.replay.budget.observed.violations).toEqual([])
      return
    }
    const run = Bun.spawnSync(["bun", "src/validation-cell.ts"], {
      cwd: PACKAGE_DIR,
      env: { ...process.env, [COMPANION_VALIDATION_BOUNDED_ENV]: "1" },
    })
    expect(run.exitCode).toBe(1)
    expect(run.stderr.toString()).toContain("refuses to run outside its declared budget")
    expect(run.stderr.toString()).toContain("systemd-run --user --scope")
  })

  test("a fractional CPU quota is never rounded down into the declared ceiling", () => {
    const declared = MANIFEST.execution.budget.cpuQuotaPercent
    // 200.4% of one CPU. Rounding the quotient reported this as exactly the declared ceiling, and
    // `budgetViolations` compares with `>`, so the run passed a budget it was over.
    const overage = parseCgroupCpuQuotaPercent(`${declared * 1000 + 400} 100000`)
    expect(overage).not.toBeNull()
    expect(overage).toBeGreaterThan(declared)
    // Whole percentages stay exact, so a quota at the ceiling is not turned into a violation.
    expect(parseCgroupCpuQuotaPercent(`${declared * 1000} 100000\n`)).toBe(declared)
    expect(parseCgroupCpuQuotaPercent("50000 100000")).toBe(50)
    for (const unbounded of ["max 100000", "0 100000", "100000 0", "", "max"]) {
      expect(parseCgroupCpuQuotaPercent(unbounded)).toBeNull()
    }
  })
})

describe("root containment", () => {
  const canary = () => path.resolve(REPO_ROOT, TEST_OUTPUT_ROOT, "containment-canary.txt")

  test("refuses roots that could delete the repository or escape the trees it owns", () => {
    writeFileSync(canary(), "canary\n")
    const destructive: Array<[string, string]> = [
      [".", proofRoot],
      ["", proofRoot],
      ["packages", proofRoot],
      ["/tmp/companion-cell", proofRoot],
      ["packages/spatial-audio-renderer/../../../escape", proofRoot],
      [`${TEST_OUTPUT_ROOT}/../..`, proofRoot],
      [TEST_OUTPUT_ROOT, proofRoot],
      [workspaceRoot, "local/proofs"],
      [workspaceRoot, "data/somewhere-else"],
    ]
    for (const [unsafeWorkspace, unsafeProof] of destructive) {
      expect(() => runCompanionValidationCell({ workspaceRoot: unsafeWorkspace, proofRoot: unsafeProof }))
        .toThrow(/validation cell (workspaceRoot|proofRoot)/)
    }
    expect(existsSync(canary())).toBe(true)
    expect(existsSync(path.resolve(REPO_ROOT, "package.json"))).toBe(true)
    expect(existsSync(path.resolve(REPO_ROOT, TEST_OUTPUT_ROOT))).toBe(true)
  })

  test("refuses overlapping roots so the proof is never inside the wiped workspace", () => {
    const cellRoot = scratchRoots[0]
    const nested: Array<[string, string]> = [
      [`${cellRoot}/shared`, `${cellRoot}/shared`],
      [`${cellRoot}/shared`, `${cellRoot}/shared/proof`],
      [`${cellRoot}/shared/workspace`, `${cellRoot}/shared`],
    ]
    for (const [unsafeWorkspace, unsafeProof] of nested) {
      expect(() => runCompanionValidationCell({ workspaceRoot: unsafeWorkspace, proofRoot: unsafeProof }))
        .toThrow(/must be disjoint/)
    }
  })

  test("refuses a root whose existing ancestor is a symlink out of the repository", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "companion-cell-outside-"))
    const linkRoot = scratch("cell-link-")
    scratchRoots.push(linkRoot)
    symlinkSync(outside, path.resolve(REPO_ROOT, linkRoot, "escape"))
    try {
      expect(() =>
        runCompanionValidationCell({
          workspaceRoot: `${linkRoot}/escape/workspace`,
          proofRoot: `${linkRoot}/proof`,
        })
      ).toThrow(/escapes the repository|resolves through a link/)
      expect(existsSync(outside)).toBe(true)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  test("refuses a root that resolves onto an ancestor of the tree it is allowed to write", () => {
    const linkRoot = scratch("cell-ancestor-link-")
    scratchRoots.push(linkRoot)
    // The shape a prefix-only check accepts in both directions: the link lands on an ancestor of
    // `packages/spatial-audio-renderer/test-output`, so the resolved path is a prefix of the
    // allowed prefix rather than below it. Every file the run then writes lands in the package.
    symlinkSync(PACKAGE_DIR, path.resolve(REPO_ROOT, linkRoot, "up"))
    // Files a run through that link deletes on its very first filesystem call, outside both trees.
    const escapedReceipt = path.join(PACKAGE_DIR, MANIFEST.artifacts.receiptName)
    const escapedAudio = path.join(PACKAGE_DIR, MANIFEST.artifacts.proofAudioName)
    const escapedIgnore = path.join(PACKAGE_DIR, ".gitignore")
    const hadIgnore = existsSync(escapedIgnore)
    writeFileSync(escapedReceipt, "canary\n")
    writeFileSync(escapedAudio, "canary\n")
    try {
      expect(() =>
        runCompanionValidationCell({ workspaceRoot: `${linkRoot}/workspace`, proofRoot: `${linkRoot}/up` })
      ).toThrow(/proofRoot resolves through a link/)
      expect(() =>
        runCompanionValidationCell({ workspaceRoot: `${linkRoot}/up`, proofRoot: `${linkRoot}/proof` })
      ).toThrow(/workspaceRoot resolves through a link/)
      expect(readFileSync(escapedReceipt, "utf8")).toBe("canary\n")
      expect(readFileSync(escapedAudio, "utf8")).toBe("canary\n")
      expect(existsSync(escapedIgnore)).toBe(hadIgnore)
      expect(existsSync(path.resolve(REPO_ROOT, linkRoot, "proof"))).toBe(false)
    } finally {
      rmSync(escapedReceipt, { force: true })
      rmSync(escapedAudio, { force: true })
      // A run that escaped writes the cell's self-ignoring marker into the package: clearing it
      // keeps one failure from following the suite into every later run.
      if (!hadIgnore) rmSync(escapedIgnore, { force: true })
    }
  })
})

describe("stale proof invalidation", () => {
  test.skipIf(!CAN_DENY_WRITE)("a failed run leaves no receipt, no artifact and no scratch behind", () => {
    const cellRoot = scratch("cell-stale-")
    scratchRoots.push(cellRoot)
    const roots = rootsFor(cellRoot)
    const passed = runCompanionValidationCell(roots)
    const receiptPath = path.resolve(REPO_ROOT, passed.cleanup.preserved[1])
    const audioPath = path.resolve(REPO_ROOT, passed.cleanup.preserved[0])
    expect(existsSync(receiptPath)).toBe(true)
    expect(existsSync(audioPath)).toBe(true)

    const lockedParent = path.resolve(REPO_ROOT, cellRoot, "locked")
    mkdirSync(lockedParent)
    chmodSync(lockedParent, 0o500)
    expect(() =>
      runCompanionValidationCell({ workspaceRoot: `${cellRoot}/locked/workspace`, proofRoot: roots.proofRoot })
    ).toThrow()

    expect(existsSync(receiptPath)).toBe(false)
    expect(existsSync(audioPath)).toBe(false)
    expect(existsSync(path.resolve(REPO_ROOT, cellRoot, "locked", "workspace"))).toBe(false)

    chmodSync(lockedParent, 0o700)
    const recovered = runCompanionValidationCell(roots)
    expect(recovered.outcome).toBe("passed")
    expect(existsSync(receiptPath)).toBe(true)
  })

  test("a failure after the proof is copied publishes neither the artifact nor the receipt", () => {
    const cellRoot = scratch("cell-post-copy-")
    scratchRoots.push(cellRoot)
    const roots = rootsFor(cellRoot)
    const passed = runCompanionValidationCell(roots)
    const proofDir = path.resolve(REPO_ROOT, roots.proofRoot)
    expect(passed.outcome).toBe("passed")
    expect(readdirSync(proofDir).sort()).toEqual(
      [".gitignore", MANIFEST.artifacts.proofAudioName, MANIFEST.artifacts.receiptName].sort(),
    )

    // A directory where the staged receipt has to be written. The only write to that path happens
    // after the validated render has already been copied to its own staged path, so this fails the
    // run strictly between the copy and the publish.
    mkdirSync(path.join(proofDir, `${MANIFEST.artifacts.receiptName}.staging`))
    let failure: unknown
    try {
      runCompanionValidationCell(roots)
    } catch (error) {
      failure = error
    }
    expect(String(failure)).toContain(`${MANIFEST.artifacts.receiptName}.staging`)
    // Nothing staged, nothing published, and the previous verdict is gone with it.
    expect(readdirSync(proofDir)).toEqual([".gitignore"])
    expect(existsSync(path.resolve(REPO_ROOT, roots.workspaceRoot))).toBe(false)

    const recovered = runCompanionValidationCell(roots)
    expect(recovered.outcome).toBe("passed")
    expect(readdirSync(proofDir).sort()).toEqual(
      [".gitignore", MANIFEST.artifacts.proofAudioName, MANIFEST.artifacts.receiptName].sort(),
    )
  })
})

describe("proof-root exclusivity", () => {
  const CELL_MODULE = JSON.stringify(path.join(PACKAGE_DIR, "src/validation-cell.ts"))
  const LOCK = COMPANION_VALIDATION_PROOF_LOCK_NAME

  /** Holds a claim until it is killed, so a live holder can be observed rather than inferred. */
  const HOLDER_SOURCE = `
import { writeFileSync } from "node:fs"
import { acquireProofRootLock } from ${CELL_MODULE}
const [proofRoot, notifyPath] = process.argv.slice(2)
acquireProofRootLock(proofRoot)
writeFileSync(notifyPath, "held")
for (;;) Bun.sleepSync(50)
`

  /** Parks on a barrier file, so both racers enter the claim together instead of in sequence. */
  const RACE_SOURCE = `
import { existsSync, writeFileSync } from "node:fs"
import { runCompanionValidationCell } from ${CELL_MODULE}
const [workspaceRoot, proofRoot, readyPath, goPath, resultPath] = process.argv.slice(2)
writeFileSync(readyPath, "ready")
while (!existsSync(goPath)) Bun.sleepSync(1)
try {
  const receipt = runCompanionValidationCell({ workspaceRoot, proofRoot })
  writeFileSync(resultPath, JSON.stringify({ ok: true, workspaceRoot: receipt.cleanup.workspaceRoot }))
} catch (error) {
  writeFileSync(resultPath, JSON.stringify({
    ok: false,
    workspaceRoot,
    name: error instanceof Error ? error.name : "unknown",
    reason: (error as { reason?: string }).reason ?? null,
    message: String(error),
    cause: String((error as { cause?: unknown }).cause ?? ""),
  }))
}
`

  type RaceOutcome =
    | { ok: true; workspaceRoot: string }
    | {
      ok: false
      workspaceRoot: string
      name: string
      reason: string | null
      message: string
      cause: string
    }

  /** The cell is synchronous, so two simultaneous runs are two processes and nothing less. */
  const driver = (cellRoot: string, name: string, source: string): string => {
    const file = path.resolve(REPO_ROOT, cellRoot, `${name}.ts`)
    writeFileSync(file, source)
    return file
  }

  const launch = (file: string, args: readonly string[]) =>
    Bun.spawn({ cmd: ["bun", file, ...args], cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" })

  const waitFor = async (
    target: string,
    child: ReturnType<typeof launch>,
    what: string,
  ): Promise<void> => {
    for (let waited = 0; waited < 30_000; waited += 5) {
      if (existsSync(target)) return
      if (child.exitCode !== null) {
        throw new Error(`${what} exited with ${child.exitCode}: ${await new Response(child.stderr).text()}`)
      }
      await Bun.sleep(5)
    }
    throw new Error(`timed out waiting for ${what} at ${target}`)
  }

  test("a live holder is refused and never disturbed; its corpse is taken over", async () => {
    const cellRoot = scratch("cell-lock-")
    scratchRoots.push(cellRoot)
    const roots = rootsFor(cellRoot)
    const published = runCompanionValidationCell(roots)
    const audioPath = path.resolve(REPO_ROOT, published.cleanup.preserved[0])
    const receiptPath = path.resolve(REPO_ROOT, published.cleanup.preserved[1])
    const publishedAudio = createHash("sha256").update(readFileSync(audioPath)).digest("hex")
    const publishedReceipt = readFileSync(receiptPath, "utf8")

    const notify = path.resolve(REPO_ROOT, cellRoot, "held")
    const holder = launch(driver(cellRoot, "holder", HOLDER_SOURCE), [roots.proofRoot, notify])
    const contender = { workspaceRoot: `${cellRoot}/contender`, proofRoot: roots.proofRoot }
    let refusal: unknown
    try {
      await waitFor(notify, holder, "proof-root holder")
      // Its own scratch root: the claim is the only resource the two runs contend for.
      try {
        runCompanionValidationCell(contender)
      } catch (error) {
        refusal = error
      }
    } finally {
      // `Subprocess.kill` does not deliver an arbitrary signal in this Bun; `process.kill` does.
      process.kill(holder.pid, "SIGKILL")
      await holder.exited
    }

    expect(refusal).toBeInstanceOf(ProofRootBusyError)
    const busy = refusal as ProofRootBusyError
    expect(busy.reason).toBe("held")
    expect(busy.holder?.pid).toBe(holder.pid)
    // Refused before the first mutation: no scratch tree, and the holder's proof byte-for-byte.
    expect(existsSync(path.resolve(REPO_ROOT, contender.workspaceRoot))).toBe(false)
    expect(createHash("sha256").update(readFileSync(audioPath)).digest("hex")).toBe(publishedAudio)
    expect(readFileSync(receiptPath, "utf8")).toBe(publishedReceipt)

    // The killed holder left a complete claim naming a pid that is now gone.
    const proofDir = path.resolve(REPO_ROOT, roots.proofRoot)
    const stale = JSON.parse(readFileSync(path.join(proofDir, LOCK), "utf8")) as { pid: number; token: string }
    expect(stale.pid).toBe(holder.pid)
    expect(existsSync(path.join(proofDir, `${LOCK}.${stale.token}`))).toBe(true)

    const recovered = runCompanionValidationCell(roots)
    expect(recovered.outcome).toBe("passed")
    expect(recovered.hashes.output.passes[0].wavSha256).toBe(published.hashes.output.passes[0].wavSha256)
    // The takeover removed the dead claim and its handle, and released the one it made.
    expect(readdirSync(proofDir).sort()).toEqual(
      [".gitignore", MANIFEST.artifacts.proofAudioName, MANIFEST.artifacts.receiptName].sort(),
    )
  }, 60_000)

  test("two simultaneous runs leave exactly one whole proof and one typed refusal", async () => {
    const cellRoot = scratch("cell-race-")
    scratchRoots.push(cellRoot)
    const proofRoot = path.posix.join(cellRoot, "proof")
    const barrier = path.resolve(REPO_ROOT, cellRoot, "go")
    const file = driver(cellRoot, "race", RACE_SOURCE)
    const racers = [0, 1].map((index) => {
      const ready = path.resolve(REPO_ROOT, cellRoot, `ready-${index}`)
      const result = path.resolve(REPO_ROOT, cellRoot, `result-${index}.json`)
      const workspaceRoot = path.posix.join(cellRoot, `workspace-${index}`)
      return {
        result,
        child: launch(file, [workspaceRoot, proofRoot, ready, barrier, result]),
        ready,
      }
    })
    for (const racer of racers) await waitFor(racer.ready, racer.child, "race driver")
    // Both are parked on the barrier: releasing it makes the claim contended, not sequential.
    writeFileSync(barrier, "go")
    for (const racer of racers) {
      await racer.child.exited
      if (!existsSync(racer.result)) {
        throw new Error(`race driver wrote no result: ${await new Response(racer.child.stderr).text()}`)
      }
    }

    const outcomes = racers.map((racer) => JSON.parse(readFileSync(racer.result, "utf8")) as RaceOutcome)
    const winners = outcomes.filter((outcome): outcome is Extract<RaceOutcome, { ok: true }> => outcome.ok)
    const losers = outcomes.filter((outcome): outcome is Extract<RaceOutcome, { ok: false }> => !outcome.ok)
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expect(losers[0].name).toBe("ProofRootBusyError")
    expect(losers[0].reason).toBe("held")
    // The loser stopped at the claim, so it never built a scratch tree to sweep.
    expect(existsSync(path.resolve(REPO_ROOT, losers[0].workspaceRoot))).toBe(false)

    const proofDir = path.resolve(REPO_ROOT, proofRoot)
    expect(readdirSync(proofDir).sort()).toEqual(
      [".gitignore", MANIFEST.artifacts.proofAudioName, MANIFEST.artifacts.receiptName].sort(),
    )
    const winner = decodeCompanionValidationReceipt(
      JSON.parse(readFileSync(path.join(proofDir, MANIFEST.artifacts.receiptName), "utf8")) as unknown,
    )
    // Both runs render identical bytes, so only the receipt says whose proof survived.
    expect(winner.cleanup.workspaceRoot).toBe(winners[0].workspaceRoot)
    expect(winner.outcome).toBe("passed")
    const audio = decodeCompanionValidationWav(readFileSync(path.join(proofDir, MANIFEST.artifacts.proofAudioName)))
    expect(audio.wavSha256).toBe(winner.hashes.output.passes[0].wavSha256)
  }, 60_000)

  test("a run whose claim is taken away clears nothing that is no longer its own", async () => {
    const cellRoot = scratch("cell-yank-")
    scratchRoots.push(cellRoot)
    const proofRoot = path.posix.join(cellRoot, "proof")
    const proofDir = path.resolve(REPO_ROOT, proofRoot)
    const victimWorkspace = path.posix.join(cellRoot, "victim")
    const result = path.resolve(REPO_ROOT, cellRoot, "victim.json")
    const go = path.resolve(REPO_ROOT, cellRoot, "go")
    writeFileSync(go, "go")
    const victim = launch(driver(cellRoot, "victim", RACE_SOURCE), [
      victimWorkspace,
      proofRoot,
      path.resolve(REPO_ROOT, cellRoot, "ready"),
      go,
      result,
    ])

    // Freeze the run between staging its artifact and publishing it. Spinning rather than sleeping:
    // that window is milliseconds wide, and the point of the test is to be inside it.
    const staged = path.join(proofDir, `${MANIFEST.artifacts.proofAudioName}.staging`)
    const deadline = Date.now() + 20_000
    while (!existsSync(staged)) {
      if (Date.now() > deadline) {
        process.kill(victim.pid, "SIGKILL")
        throw new Error(`victim never staged its artifact: ${await new Response(victim.stderr).text()}`)
      }
    }
    process.kill(victim.pid, "SIGSTOP")
    await Bun.sleep(20)
    expect(victim.exitCode).toBeNull()
    expect(existsSync(staged)).toBe(true)

    // What an operator clearing a lock by hand does, and the one event a claim cannot rule out:
    // from here the frozen run is holding staged bytes in a root somebody else owns.
    rmSync(path.join(proofDir, LOCK), { force: true })
    const owner = acquireProofRootLock(proofRoot)
    const audioPath = path.join(proofDir, MANIFEST.artifacts.proofAudioName)
    const receiptPath = path.join(proofDir, MANIFEST.artifacts.receiptName)
    // Whatever the new owner has at the published pair, the frozen run may neither replace nor
    // remove it. Sentinels rather than a real proof: the point is the bytes, not their meaning.
    writeFileSync(audioPath, "owned by the claim holder\n")
    writeFileSync(receiptPath, "owned by the claim holder\n")

    process.kill(victim.pid, "SIGCONT")
    await victim.exited
    const outcome = JSON.parse(readFileSync(result, "utf8")) as RaceOutcome
    expect(outcome.ok).toBe(false)
    const failure = outcome as Extract<RaceOutcome, { ok: false }>
    expect(failure.cause).toContain("before publishing")
    expect(failure.message).toContain("lost the")
    // Neither published over nor cleared, and its own staged pair left for the owner to handle.
    expect(readFileSync(audioPath, "utf8")).toBe("owned by the claim holder\n")
    expect(readFileSync(receiptPath, "utf8")).toBe("owned by the claim holder\n")
    expect(existsSync(staged)).toBe(true)
    expect(existsSync(path.join(proofDir, `${MANIFEST.artifacts.receiptName}.staging`))).toBe(true)
    // Its own scratch tree still goes: that one it can still prove is its own.
    expect(existsSync(path.resolve(REPO_ROOT, victimWorkspace))).toBe(false)

    // The abandoned staging is scratch the owner overwrites, not a root that needs a human.
    expect(releaseProofRootLock(owner)).toBe(true)
    const recovered = runCompanionValidationCell({ workspaceRoot: `${cellRoot}/after`, proofRoot })
    expect(recovered.outcome).toBe("passed")
    expect(readdirSync(proofDir).sort()).toEqual(
      [".gitignore", MANIFEST.artifacts.proofAudioName, MANIFEST.artifacts.receiptName].sort(),
    )
  }, 60_000)

  test("a claim it cannot prove dead is refused, however stale it looks", async () => {
    const cellRoot = scratch("cell-foreign-")
    scratchRoots.push(cellRoot)
    const proofRoot = path.posix.join(cellRoot, "proof")
    const proofDir = path.resolve(REPO_ROOT, proofRoot)
    const workspaceRoot = `${cellRoot}/workspace`
    // A pid that has certainly exited, so only the identity under test can decide the outcome.
    const gone = Bun.spawn({ cmd: [process.execPath, "-e", ""], stdout: "ignore", stderr: "ignore" })
    await gone.exited

    // The production writer produces the bytes; each case edits only the field it is about.
    const claim = acquireProofRootLock(proofRoot)
    const lockFile = path.join(proofDir, LOCK)
    const handleFile = path.join(proofDir, `${LOCK}.${claim.token}`)
    const identity = JSON.parse(readFileSync(lockFile, "utf8")) as Record<string, unknown>
    const rewrite = (patch: Record<string, unknown>): void => {
      rmSync(lockFile, { force: true })
      writeFileSync(lockFile, `${JSON.stringify({ ...identity, ...patch })}\n`)
    }
    const refuse = (): ProofRootBusyError => {
      try {
        runCompanionValidationCell({ workspaceRoot, proofRoot })
      } catch (error) {
        return error as ProofRootBusyError
      }
      throw new Error("the run took over a claim whose holder it could not prove dead")
    }

    // A dead pid on another host is not a corpse this host is entitled to bury: the number means
    // nothing here, and a proof root reachable from two machines must not be raced across them.
    rewrite({ pid: gone.pid, hostname: `${identity.hostname as string}-elsewhere` })
    const foreign = refuse()
    expect(foreign).toBeInstanceOf(ProofRootBusyError)
    expect(foreign.reason).toBe("unassessable")
    expect(foreign.message).toContain("-elsewhere")
    expect(existsSync(lockFile)).toBe(true)

    // A dead local holder with no takeover handle: the removal cannot be serialised against another
    // run doing the same, so it is refused rather than guessed at.
    rewrite({ pid: gone.pid })
    rmSync(handleFile, { force: true })
    const unhandled = refuse()
    expect(unhandled.reason).toBe("contended")
    expect(existsSync(lockFile)).toBe(true)
    expect(existsSync(path.resolve(REPO_ROOT, workspaceRoot))).toBe(false)

    // Handle restored, same dead identity: now it is a corpse, and the root comes back.
    writeFileSync(handleFile, readFileSync(lockFile))
    const recovered = runCompanionValidationCell({ workspaceRoot, proofRoot })
    expect(recovered.outcome).toBe("passed")
    expect(readdirSync(proofDir).sort()).toEqual(
      [".gitignore", MANIFEST.artifacts.proofAudioName, MANIFEST.artifacts.receiptName].sort(),
    )
  }, 60_000)
})

describe("WAV decoder strictness", () => {
  const renderedWav = (): Buffer => readFileSync(path.resolve(REPO_ROOT, receipt.cleanup.preserved[0]))

  test("accepts the renderer's own artifact and reports its exact frame count", () => {
    const decoded = decodeCompanionValidationWav(renderedWav())
    expect(decoded.frames).toBe(MANIFEST.oracle.wav.frames)
    expect(decoded.wavSha256).toBe(receipt.hashes.output.passes[0].wavSha256)
  })

  test("rejects a data chunk that is not a whole number of stereo frames", () => {
    const bytes = renderedWav()
    expect(bytes.toString("ascii", 36, 40)).toBe("data")
    const padded = Buffer.concat([bytes, Buffer.from([0])])
    padded.writeUInt32LE(padded.readUInt32LE(4) + 1, 4)
    padded.writeUInt32LE(padded.readUInt32LE(40) + 1, 40)
    expect(() => decodeCompanionValidationWav(padded)).toThrow(/not whole 4-byte frames/)
  })

  test("rejects truncated, over-declared and trailing-byte artifacts", () => {
    const bytes = renderedWav()

    const truncated = bytes.subarray(0, bytes.length - 8)
    expect(() => decodeCompanionValidationWav(truncated)).toThrow(/RIFF declares/)

    const overDeclared = Buffer.from(truncated)
    overDeclared.writeUInt32LE(overDeclared.length - 8, 4)
    expect(() => decodeCompanionValidationWav(overDeclared)).toThrow(/declares .* bytes, .* remain/)

    const trailing = Buffer.concat([bytes, Buffer.alloc(4)])
    trailing.writeUInt32LE(trailing.readUInt32LE(4) + 4, 4)
    expect(() => decodeCompanionValidationWav(trailing)).toThrow(/past its data chunk/)

    const wrongBlockAlign = Buffer.from(bytes)
    wrongBlockAlign.writeUInt16LE(3, 32)
    expect(() => decodeCompanionValidationWav(wrongBlockAlign)).toThrow(/blockAlign/)

    const wrongByteRate = Buffer.from(bytes)
    wrongByteRate.writeUInt32LE(1, 28)
    expect(() => decodeCompanionValidationWav(wrongByteRate)).toThrow(/byteRate/)
  })

  test("rejects a zero sample rate instead of decoding an infinite duration", () => {
    const bytes = renderedWav()
    const zeroRate = Buffer.from(bytes)
    // Both fields zeroed, so `byteRate === sampleRateHz * blockAlign` still holds and only the
    // positivity of the rate itself is left to catch the artifact.
    zeroRate.writeUInt32LE(0, 24)
    zeroRate.writeUInt32LE(0, 28)
    expect(() => decodeCompanionValidationWav(zeroRate)).toThrow(/both must be positive/)
    expect(decodeCompanionValidationWav(bytes).durationSec).toBe(receipt.metrics.wav.durationSec)
  })
})

describe("manifest cross-field invariants", () => {
  const mutate = (patch: (draft: ManifestDraft) => void): unknown => {
    const draft = JSON.parse(JSON.stringify(MANIFEST)) as ManifestDraft
    patch(draft)
    return draft
  }

  test("rejects windows that do not advance, leave the scene, or leave their stem", () => {
    const cases: Array<[string, (draft: ManifestDraft) => void]> = [
      ["reversed gap window", (draft) => {
        Object.assign(draft.oracle.temporal.gapWindow, { startSec: 1.9, endSec: 1.7 })
      }],
      ["empty trajectory window", (draft) => {
        Object.assign(draft.oracle.trajectory.window, { startSec: 0.5, endSec: 0.5 })
      }],
      ["foley window past the scene", (draft) => {
        Object.assign(draft.oracle.temporal.foleyWindow, { startSec: 2.1, endSec: 4.5 })
      }],
      ["gap window overlapping the voice", (draft) => {
        Object.assign(draft.oracle.temporal.gapWindow, { startSec: 1.5, endSec: 1.9 })
      }],
      ["voice window outside the voice stem", (draft) => {
        Object.assign(draft.oracle.temporal.voiceWindow, { startSec: 0.1, endSec: 1.9 })
      }],
    ]
    for (const [label, patch] of cases) {
      expect(() => decodeCompanionValidationManifest(mutate(patch)), label).toThrow()
    }
  })

  test("rejects scenes, oracles and controls that contradict each other", () => {
    const cases: Array<[string, (draft: ManifestDraft) => void]> = [
      ["stems overlapping in time", (draft) => {
        Object.assign(draft.scene.foley, { startSec: 1.2 })
      }],
      ["stem running past the scene", (draft) => {
        Object.assign(draft.scene.foley, { durationSec: 2.5 })
      }],
      ["non-advancing trajectory", (draft) => {
        draft.scene.voice.trajectory[2].timeSec = draft.scene.voice.trajectory[1].timeSec
      }],
      ["blocks that do not divide the window", (draft) => {
        Object.assign(draft.oracle.trajectory, { blocks: 9 })
      }],
      ["duplicate negative control id", (draft) => {
        draft.negativeControls[1].id = draft.negativeControls[0].id
      }],
      ["first bad frame past the render", (draft) => {
        draft.negativeControls[0].expectedFirstBadFrame = draft.oracle.wav.frames
      }],
      ["overlapping declared roots", (draft) => {
        Object.assign(draft.artifacts, {
          workspaceRoot: "local/proofs/cell",
          proofRoot: "local/proofs/cell/inner",
        })
      }],
      ["declared root at a tree root", (draft) => {
        Object.assign(draft.artifacts, { proofRoot: "local/proofs" })
      }],
    ]
    for (const [label, patch] of cases) {
      expect(() => decodeCompanionValidationManifest(mutate(patch)), label).toThrow()
    }
  })
})
