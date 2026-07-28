#!/usr/bin/env bun
/**
 * Companion instantiation of the portable validation cell.
 *
 * System under test: the real renderer in `./index.ts` (`renderSpatialAudioProof`). Nothing is
 * mocked or re-implemented here — the cell synthesizes a deterministic 48 kHz voice/foley scene,
 * drives the renderer twice, decodes the emitted WAV back to Float32 stereo, and scores it with a
 * numeric oracle that is independent of how the renderer generates sample values.
 *
 * Input note: at this revision `renderSpatialAudioProof` synthesizes each stem's Float32 samples
 * from its manifest descriptor (kind/role/timing) and never reads `stem.artifact.path`. The
 * deterministic inputs the cell owns are therefore the three manifests it writes; the declared
 * artifact paths stay absent on purpose so the cell exercises the renderer's own generators rather
 * than a recording the renderer would ignore.
 *
 * Proof integrity rules this module enforces, in the order a run applies them:
 *  1. Both caller-supplied roots are checked for repo containment, an allowed prefix, and for
 *     resolving to exactly where they lexically claim to, *before* any filesystem call, and must
 *     be disjoint. Nothing outside the two scratch trees can be created or removed.
 *  2. Exactly one run owns a proof root at a time. The claim on `.proof-lock` is taken before
 *     anything in that root is read, cleared, staged or published; a second run refuses with
 *     `ProofRootBusyError` rather than racing it, and a claim is stolen only from a holder this
 *     host can prove dead. Every later step re-reads the claim, so a run that lost the root
 *     publishes nothing and clears nothing.
 *  3. A previous verdict is deleted before the run starts, and the WAV and the receipt are staged
 *     and published together only once the receipt decodes and the scratch tree is provably gone.
 *  4. `bun run validate:cell` re-executes itself inside a systemd scope carrying the declared
 *     budget, or refuses. The receipt records the cgroup limits this process actually observed,
 *     never the command line that was supposed to impose them.
 *  5. The source binding covers the renderer, this cell, the resolved runtime packages (source
 *     tree plus version) and the install-root lockfile, so a receipt cannot claim an exact replay
 *     for a different dependency graph.
 */
import { createHash, randomBytes } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { hostname } from "node:os"
import path from "node:path"
import { Option, Schema, SchemaAST, SchemaIssue } from "effect"
import { renderSpatialAudioProof } from "./index"

export const COMPANION_VALIDATION_MANIFEST_VERSION = "spatial-audio-renderer.validation-cell.manifest.v1" as const
export const COMPANION_VALIDATION_RECEIPT_VERSION = "spatial-audio-renderer.validation-cell.receipt.v1" as const
export const COMPANION_VALIDATION_CELL_ID = "companion-spatial-trajectory" as const

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..")
const CELL_MODULE_PATH = "packages/spatial-audio-renderer/src/validation-cell.ts"
const WORKSPACE_TOKEN = "{workspace}"
const STRICT_DECODE = { errors: "all", onExcessProperty: "error" } as const
/** Repo-relative, no traversal, no leading slash. `@` is allowed: scoped packages live in paths. */
const REPO_RELATIVE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@/-]+$/
/**
 * The only repo-owned trees a run may create, write, or recursively remove. Every root is checked
 * against these before the first filesystem call, so no caller can aim the cleanup at the
 * repository, at `$HOME`, or through a symlink.
 */
const CELL_ROOT_PREFIXES = ["packages/spatial-audio-renderer/test-output", "local/proofs"] as const
/**
 * Both proof artifacts are written under this suffix and renamed into place together, so the two
 * published paths only ever hold a validated pair. Staged names are this run's private scratch:
 * they are overwritten before use and removed on both the success and the failure path.
 */
const PROOF_STAGING_SUFFIX = ".staging"
/**
 * Well-known name of the exclusive claim on a proof root, held for the whole of a run. Every path
 * the run clears, stages or publishes is a sibling of this file, so the claim is what makes those
 * mutations this run's to make and no concurrent run's to lose.
 */
export const COMPANION_VALIDATION_PROOF_LOCK_NAME = ".proof-lock"
/** Set by the bounded re-exec so a scope that still fails the budget refuses instead of looping. */
export const COMPANION_VALIDATION_BOUNDED_ENV = "COMPANION_VALIDATION_CELL_BOUNDED"

const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const FiniteNumber = Schema.Number.check(Schema.isFinite())
const NonNegativeNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const PositiveNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const Sha256Hex = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const Timestamp = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/))
const RepoRelativePath = Schema.String.check(Schema.isMaxLength(240), Schema.isPattern(REPO_RELATIVE_PATH_PATTERN))
const ArgvList = Schema.Array(NonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(32))

/** A trajectory waypoint in listener-relative metres: +x is right of the head, +z is in front. */
const TrajectoryWaypointSchema = Schema.Struct({
  timeSec: NonNegativeNumber,
  xMeters: FiniteNumber,
  zMeters: PositiveNumber,
})

const WindowSchema = Schema.Struct({
  startSec: NonNegativeNumber,
  endSec: PositiveNumber,
})

/** The two scene mutations the negative controls apply; `"none"` is the unmutated baseline. */
const MutationSchema = Schema.Union([
  Schema.Literal("reverse-voice-automation-positions"),
  Schema.Literal("remove-foley-stem-and-object"),
])

type Mutation = "none" | Schema.Schema.Type<typeof MutationSchema>

/** Resource ceiling the run must observe in its own cgroup; the bounded argv is derived from it. */
const BudgetSchema = Schema.Struct({
  memoryMaxBytes: PositiveInteger,
  cpuQuotaPercent: PositiveInteger,
  runtimeMaxSec: PositiveInteger,
})

const CompanionValidationManifestFields = Schema.Struct({
  schemaVersion: Schema.Literal(COMPANION_VALIDATION_MANIFEST_VERSION),
  cellId: Schema.Literal(COMPANION_VALIDATION_CELL_ID),
  sut: Schema.Struct({
    module: RepoRelativePath,
    entryPoint: Schema.Literal("renderSpatialAudioProof"),
    stemSource: Schema.Literal("renderer-procedural"),
    /** Runtime packages whose resolved source or version changes what the renderer emits. */
    packages: Schema.Array(NonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
    /** Lockfiles pinning those packages, resolved by walking up from the repository root. */
    lockfiles: Schema.Array(NonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
  }),
  clock: Schema.Struct({
    startedAt: Timestamp,
    stepMs: PositiveInteger,
  }),
  scene: Schema.Struct({
    sampleRateHz: Schema.Literal(48_000),
    channels: Schema.Literal(2),
    durationSec: Schema.Literal(4),
    voice: Schema.Struct({
      stemId: NonEmptyString,
      startSec: NonNegativeNumber,
      durationSec: PositiveNumber,
      fadeSec: NonNegativeNumber,
      gainDb: FiniteNumber,
      trajectory: Schema.Array(TrajectoryWaypointSchema).check(Schema.isMinLength(3), Schema.isMaxLength(16)),
    }),
    foley: Schema.Struct({
      stemId: NonEmptyString,
      startSec: NonNegativeNumber,
      durationSec: PositiveNumber,
      fadeSec: NonNegativeNumber,
      gainDb: FiniteNumber,
      xMeters: FiniteNumber,
      zMeters: PositiveNumber,
    }),
  }),
  oracle: Schema.Struct({
    wav: Schema.Struct({
      channels: Schema.Literal(2),
      sampleRateHz: Schema.Literal(48_000),
      bitsPerSample: Schema.Literal(16),
      frames: Schema.Literal(192_000),
      durationSec: Schema.Literal(4),
      maxPeak: Schema.Literal(1),
      minPeak: PositiveNumber,
    }),
    trajectory: Schema.Struct({
      window: WindowSchema,
      blocks: PositiveInteger,
      minEdgeBalance: PositiveNumber,
      minBlockStep: PositiveNumber,
    }),
    temporal: Schema.Struct({
      voiceWindow: WindowSchema,
      gapWindow: WindowSchema,
      foleyWindow: WindowSchema,
      minActiveRms: PositiveNumber,
      maxGapPeak: NonNegativeNumber,
      minSeparationDb: PositiveNumber,
    }),
    determinism: Schema.Struct({
      renderPasses: Schema.Literal(2),
    }),
  }),
  negativeControls: Schema.Array(Schema.Struct({
    id: NonEmptyString,
    mutation: MutationSchema,
    expectedInvariant: NonEmptyString,
    expectedFirstBadFrame: NonNegativeInteger,
  })).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
  execution: Schema.Struct({
    packageDirectory: RepoRelativePath,
    command: ArgvList,
    budget: BudgetSchema,
  }),
  artifacts: Schema.Struct({
    workspaceRoot: RepoRelativePath,
    proofRoot: RepoRelativePath,
    proofAudioName: NonEmptyString,
    receiptName: NonEmptyString,
  }),
})

type ManifestShape = Schema.Schema.Type<typeof CompanionValidationManifestFields>

export const CompanionValidationManifestSchema = CompanionValidationManifestFields.check(
  crossFieldCheck("companion-validation-manifest.cross-field", manifestCrossFieldReport),
)

export type CompanionValidationManifest = Schema.Schema.Type<typeof CompanionValidationManifestSchema>

const HashedSourceSchema = Schema.Struct({ path: RepoRelativePath, sha256: Sha256Hex })

/**
 * One artifact the run's behaviour depends on. `path` is null for artifacts outside the repository
 * (a hoisted package, an install-root lockfile): their host paths are not portable, so identity is
 * carried by `id` + `version` + `sha256` instead.
 */
const SourceBindingSchema = Schema.Struct({
  id: NonEmptyString,
  kind: Schema.Union([Schema.Literal("repo-source"), Schema.Literal("package"), Schema.Literal("lockfile")]),
  path: Schema.NullOr(RepoRelativePath),
  version: Schema.NullOr(NonEmptyString),
  sha256: Sha256Hex,
})

type SourceBinding = Schema.Schema.Type<typeof SourceBindingSchema>

const RenderPassSchema = Schema.Struct({
  index: PositiveInteger,
  wavSha256: Sha256Hex,
  pcmSha256: Sha256Hex,
  byteLength: PositiveInteger,
})

const InvariantSchema = Schema.Struct({
  id: NonEmptyString,
  passed: Schema.Boolean,
  detail: NonEmptyString,
  firstBadFrame: Schema.NullOr(NonNegativeInteger),
})

const CompanionValidationReceiptFields = Schema.Struct({
  schemaVersion: Schema.Literal(COMPANION_VALIDATION_RECEIPT_VERSION),
  manifestVersion: Schema.Literal(COMPANION_VALIDATION_MANIFEST_VERSION),
  cellId: Schema.Literal(COMPANION_VALIDATION_CELL_ID),
  outcome: Schema.Literal("passed"),
  clock: Schema.Struct({
    startedAt: Timestamp,
    stepMs: PositiveInteger,
    ticks: Schema.Array(Timestamp).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  }),
  hashes: Schema.Struct({
    /** sha256 of the canonical manifest JSON: the versioned contract this receipt answers to. */
    schema: Sha256Hex,
    source: Schema.Struct({
      renderer: HashedSourceSchema,
      cell: HashedSourceSchema,
      /** Renderer, cell, resolved runtime packages and lockfiles, sorted by id. */
      bindings: Schema.Array(SourceBindingSchema).check(Schema.isMinLength(4), Schema.isMaxLength(16)),
      /** Order-independent digest over `bindings`; the single value a replay has to match. */
      digest: Sha256Hex,
    }),
    /** Workspace-independent digests of the three synthesized input manifests. */
    input: Schema.Struct({ voiceAssets: Sha256Hex, stems: Sha256Hex, spatial: Sha256Hex }),
    output: Schema.Struct({
      passes: Schema.Array(RenderPassSchema).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
      wavIdentical: Schema.Literal(true),
      pcmIdentical: Schema.Literal(true),
    }),
  }),
  metrics: Schema.Struct({
    wav: Schema.Struct({
      channels: PositiveInteger,
      sampleRateHz: PositiveInteger,
      bitsPerSample: PositiveInteger,
      frames: PositiveInteger,
      durationSec: PositiveNumber,
      byteLength: PositiveInteger,
      peak: PositiveNumber,
      allFinite: Schema.Boolean,
    }),
    trajectory: Schema.Struct({
      blocks: Schema.Array(Schema.Struct({
        index: NonNegativeInteger,
        startFrame: NonNegativeInteger,
        endFrame: PositiveInteger,
        balance: FiniteNumber,
      })).check(Schema.isMinLength(2), Schema.isMaxLength(64)),
      firstBalance: FiniteNumber,
      lastBalance: FiniteNumber,
      minBlockStep: FiniteNumber,
    }),
    temporal: Schema.Struct({
      voiceRms: NonNegativeNumber,
      gapRms: NonNegativeNumber,
      gapPeak: NonNegativeNumber,
      foleyRms: NonNegativeNumber,
      separationDb: FiniteNumber,
    }),
  }),
  invariants: Schema.Array(InvariantSchema).check(Schema.isMinLength(2), Schema.isMaxLength(16)),
  negativeControls: Schema.Array(Schema.Struct({
    id: NonEmptyString,
    mutation: NonEmptyString,
    killed: Schema.Literal(true),
    invariant: NonEmptyString,
    firstBadFrame: NonNegativeInteger,
    detail: NonEmptyString,
    wavSha256: Sha256Hex,
    differsFromBaseline: Schema.Literal(true),
  })).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
  replay: Schema.Struct({
    packageDirectory: RepoRelativePath,
    command: ArgvList,
    /** Derived from `budget.declared`, never authored: the argv that imposes the declared bound. */
    boundedCommand: ArgvList,
    budget: Schema.Struct({
      declared: BudgetSchema,
      /** What this process read out of its own cgroup. `enforced` is not a claim, it is a check. */
      observed: Schema.Struct({
        enforced: Schema.Boolean,
        cgroup: Schema.NullOr(NonEmptyString),
        unit: Schema.NullOr(NonEmptyString),
        memoryMaxBytes: Schema.NullOr(PositiveInteger),
        cpuQuotaPercent: Schema.NullOr(PositiveNumber),
        runtimeMaxSec: Schema.NullOr(PositiveNumber),
        violations: Schema.Array(NonEmptyString).check(Schema.isMaxLength(8)),
      }),
    }),
    environment: Schema.Struct({
      platform: NonEmptyString,
      arch: NonEmptyString,
      bunVersion: NonEmptyString,
    }),
  }),
  cleanup: Schema.Struct({
    workspaceRoot: RepoRelativePath,
    removed: Schema.Literal(true),
    preserved: Schema.Array(RepoRelativePath).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  }),
  errors: Schema.Array(NonEmptyString).check(Schema.isMaxLength(32)),
})

type ReceiptShape = Schema.Schema.Type<typeof CompanionValidationReceiptFields>

export const CompanionValidationReceiptSchema = CompanionValidationReceiptFields.check(
  crossFieldCheck("companion-validation-receipt.cross-field", receiptCrossFieldReport),
)

export type CompanionValidationReceipt = Schema.Schema.Type<typeof CompanionValidationReceiptSchema>

export function decodeCompanionValidationManifest(input: unknown): CompanionValidationManifest {
  return Schema.decodeUnknownSync(CompanionValidationManifestSchema)(input, STRICT_DECODE)
}

export function decodeCompanionValidationReceipt(input: unknown): CompanionValidationReceipt {
  return Schema.decodeUnknownSync(CompanionValidationReceiptSchema)(input, STRICT_DECODE)
}

/**
 * Frozen cell contract. The voice trajectory is five x/z waypoints on a 1 m arc sweeping
 * -70deg (left) to +70deg (right); azimuth is linear in time, so the equal-power pan law makes the
 * per-block lateral balance strictly increasing. Foley sits still, later, with a silent gap between
 * the two so temporal separation is a hard zero rather than a ratio.
 */
export const COMPANION_VALIDATION_MANIFEST: CompanionValidationManifest = decodeCompanionValidationManifest({
  schemaVersion: COMPANION_VALIDATION_MANIFEST_VERSION,
  cellId: COMPANION_VALIDATION_CELL_ID,
  sut: {
    module: "packages/spatial-audio-renderer/src/index.ts",
    entryPoint: "renderSpatialAudioProof",
    stemSource: "renderer-procedural",
    packages: ["@wirebabel/media-contracts", "effect"],
    lockfiles: ["bun.lock"],
  },
  clock: { startedAt: "2026-01-01T00:00:00.000Z", stepMs: 1000 },
  scene: {
    sampleRateHz: 48_000,
    channels: 2,
    durationSec: 4,
    voice: {
      stemId: "companion-cell-voice-001",
      startSec: 0,
      durationSec: 1.6,
      fadeSec: 0.05,
      gainDb: -6,
      trajectory: [
        { timeSec: 0, xMeters: -0.939693, zMeters: 0.34202 },
        { timeSec: 0.4, xMeters: -0.573576, zMeters: 0.819152 },
        { timeSec: 0.8, xMeters: 0, zMeters: 1 },
        { timeSec: 1.2, xMeters: 0.573576, zMeters: 0.819152 },
        { timeSec: 1.6, xMeters: 0.939693, zMeters: 0.34202 },
      ],
    },
    foley: {
      stemId: "companion-cell-foley-001",
      startSec: 2,
      durationSec: 1.6,
      fadeSec: 0.05,
      gainDb: -9,
      xMeters: 0.25,
      zMeters: 0.2,
    },
  },
  oracle: {
    wav: {
      channels: 2,
      sampleRateHz: 48_000,
      bitsPerSample: 16,
      frames: 192_000,
      durationSec: 4,
      maxPeak: 1,
      minPeak: 0.01,
    },
    trajectory: {
      window: { startSec: 0.1, endSec: 1.5 },
      blocks: 8,
      minEdgeBalance: 0.6,
      minBlockStep: 0.05,
    },
    temporal: {
      voiceWindow: { startSec: 0.1, endSec: 1.5 },
      gapWindow: { startSec: 1.7, endSec: 1.9 },
      foleyWindow: { startSec: 2.1, endSec: 3.5 },
      minActiveRms: 0.01,
      maxGapPeak: 0,
      minSeparationDb: 40,
    },
    determinism: { renderPasses: 2 },
  },
  negativeControls: [
    {
      id: "reversed-trajectory",
      mutation: "reverse-voice-automation-positions",
      expectedInvariant: "trajectory.pan-sweeps-left-to-right",
      expectedFirstBadFrame: 4_800,
    },
    {
      id: "dropped-foley-stem",
      mutation: "remove-foley-stem-and-object",
      expectedInvariant: "temporal.voice-foley-separation",
      expectedFirstBadFrame: 100_800,
    },
  ],
  execution: {
    packageDirectory: "packages/spatial-audio-renderer",
    command: ["bun", "run", "validate:cell"],
    budget: { memoryMaxBytes: 2_147_483_648, cpuQuotaPercent: 200, runtimeMaxSec: 300 },
  },
  artifacts: {
    workspaceRoot: "packages/spatial-audio-renderer/test-output/validation-cell",
    proofRoot: "local/proofs/companion-validation-cell",
    proofAudioName: "companion-spatial-trajectory.wav",
    receiptName: "receipt.json",
  },
})

/** The bounded invocation of `execution.command`, derived from the declared budget. */
export function boundedValidationCommand(
  manifest: CompanionValidationManifest = COMPANION_VALIDATION_MANIFEST,
): string[] {
  const { memoryMaxBytes, cpuQuotaPercent, runtimeMaxSec } = manifest.execution.budget
  return [
    "systemd-run",
    "--user",
    "--scope",
    "--quiet",
    ...[`MemoryMax=${memoryMaxBytes}`, `CPUQuota=${cpuQuotaPercent}%`, `RuntimeMaxSec=${runtimeMaxSec}`]
      .flatMap((property) => ["-p", property]),
    "--",
    ...manifest.execution.command,
  ]
}

export interface RunCompanionValidationCellOptions {
  /** Repo-relative scratch root below an allowed prefix; wiped before the run and in a `finally`. */
  workspaceRoot?: string
  /** Repo-relative directory that keeps the playable WAV and the receipt; disjoint from the above. */
  proofRoot?: string
}

export interface DecodedWav {
  channels: number
  sampleRateHz: number
  bitsPerSample: number
  frames: number
  durationSec: number
  byteLength: number
  peak: number
  allFinite: boolean
  left: Float32Array
  right: Float32Array
  pcmSha256: string
  wavSha256: string
}

type Metrics = ReceiptShape["metrics"]
type TrajectoryBlock = Metrics["trajectory"]["blocks"][number]
type Invariant = ReceiptShape["invariants"][number]

export function runCompanionValidationCell(
  options: RunCompanionValidationCellOptions = {},
): CompanionValidationReceipt {
  const manifest = COMPANION_VALIDATION_MANIFEST
  // Containment, allowed prefix, symlink escape and disjointness, all before the first fs call.
  const { workspaceRoot, proofRoot } = resolveCellRoots(
    options.workspaceRoot ?? manifest.artifacts.workspaceRoot,
    options.proofRoot ?? manifest.artifacts.proofRoot,
  )
  const proofAudioPath = path.posix.join(proofRoot, manifest.artifacts.proofAudioName)
  const receiptPath = path.posix.join(proofRoot, manifest.artifacts.receiptName)
  // Staged siblings, so the artifact and the verdict that vouches for it are published together.
  const stagedAudioPath = `${proofAudioPath}${PROOF_STAGING_SUFFIX}`
  const stagedReceiptPath = `${receiptPath}${PROOF_STAGING_SUFFIX}`
  const proofPaths = [stagedAudioPath, stagedReceiptPath, proofAudioPath, receiptPath] as const

  // Nothing in the proof root is read, cleared, staged or published outside this claim. A second
  // run refuses here rather than racing this one through the same four paths, and every mutation
  // below re-checks that the claim is still this run's before it touches a byte.
  const lock = acquireProofRootLock(proofRoot)

  try {
    // Self-ignoring proof directory, matching the existing untracked `local/proofs/.gitignore`.
    writeFileSync(path.join(absolute(proofRoot), ".gitignore"), "*\n")
    // Invalidate the previous verdict first: a run that dies anywhere below must not leave a passed
    // receipt or its playable artifact claiming validation for source this run never scored. Only
    // the published pair is cleared here; a staged entry this run cannot overwrite is a real fault.
    const stale = discardProof(lock, [proofAudioPath, receiptPath])
    if (stale.length > 0) {
      throw new Error(`validation cell cannot invalidate the previous verdict: ${stale.join(", ")}`)
    }

    const clockStart = Date.parse(manifest.clock.startedAt)
    const clockTicks = [0, 1, 2].map((tick) => new Date(clockStart + tick * manifest.clock.stepMs).toISOString())

    rmSync(absolute(workspaceRoot), { recursive: true, force: true })
    const baselineScene = writeScene(manifest, workspaceRoot, clockTicks, "none")
    const passes = [1, 2].map((index) => renderPass(baselineScene, workspaceRoot, `baseline-${index}`, index))
    const baseline = passes[0]
    const metrics = measure(manifest, baseline)
    const invariants = evaluate(manifest, metrics)

    const negativeControls = manifest.negativeControls.map((control) => {
      const mutantScene = writeScene(manifest, workspaceRoot, clockTicks, control.mutation)
      const mutant = renderPass(mutantScene, workspaceRoot, control.id, 1)
      const failures = evaluate(manifest, measure(manifest, mutant)).filter((invariant) => !invariant.passed)
      const failure = failures[0]
      if (failures.length !== 1 || failure === undefined || failure.id !== control.expectedInvariant) {
        throw new Error(
          `negative control ${control.id} did not isolate ${control.expectedInvariant}: ` +
            `observed [${failures.map((entry) => entry.id).join(", ") || "none"}]`,
        )
      }
      if (failure.firstBadFrame !== control.expectedFirstBadFrame) {
        throw new Error(
          `negative control ${control.id} failed at frame ${String(failure.firstBadFrame)}, ` +
            `expected ${control.expectedFirstBadFrame}`,
        )
      }
      if (mutant.wavSha256 === baseline.wavSha256) {
        throw new Error(`negative control ${control.id} produced a byte-identical render`)
      }
      return {
        id: control.id,
        mutation: control.mutation,
        killed: true as const,
        invariant: failure.id,
        firstBadFrame: control.expectedFirstBadFrame,
        detail: failure.detail,
        wavSha256: mutant.wavSha256,
        differsFromBaseline: true as const,
      }
    })

    const failed = invariants.filter((invariant) => !invariant.passed)
    if (failed.length > 0) {
      throw new Error(`validation cell invariants failed: ${failed.map((entry) => entry.detail).join("; ")}`)
    }

    const source = bindSources(manifest)
    const observed = observeBudget()
    const violations = budgetViolations(observed, manifest.execution.budget)

    copyFileSync(absolute(baseline.audioPath), absolute(stagedAudioPath))

    const receipt: ReceiptShape = {
      schemaVersion: COMPANION_VALIDATION_RECEIPT_VERSION,
      manifestVersion: COMPANION_VALIDATION_MANIFEST_VERSION,
      cellId: COMPANION_VALIDATION_CELL_ID,
      outcome: "passed",
      clock: { startedAt: manifest.clock.startedAt, stepMs: manifest.clock.stepMs, ticks: clockTicks },
      hashes: {
        schema: sha256(JSON.stringify(manifest)),
        source,
        input: baselineScene.hashes,
        output: {
          passes: passes.map((pass) => ({
            index: pass.index,
            wavSha256: pass.wavSha256,
            pcmSha256: pass.pcmSha256,
            byteLength: pass.byteLength,
          })),
          wavIdentical: assertTrue(passes[0].wavSha256 === passes[1].wavSha256, "render passes differ in WAV bytes"),
          pcmIdentical: assertTrue(passes[0].pcmSha256 === passes[1].pcmSha256, "render passes differ in PCM bytes"),
        },
      },
      metrics,
      invariants,
      negativeControls,
      replay: {
        packageDirectory: manifest.execution.packageDirectory,
        command: manifest.execution.command,
        boundedCommand: boundedValidationCommand(manifest),
        budget: {
          declared: manifest.execution.budget,
          observed: { enforced: violations.length === 0, ...observed, violations },
        },
        environment: {
          platform: process.platform,
          arch: process.arch,
          bunVersion: process.versions.bun ?? "unknown",
        },
      },
      cleanup: {
        workspaceRoot,
        removed: removeWorkspace(workspaceRoot),
        preserved: [proofAudioPath, receiptPath],
      },
      errors: [],
    }

    writeFileSync(absolute(stagedReceiptPath), `${JSON.stringify(receipt, null, 2)}\n`)
    const decoded = decodeCompanionValidationReceipt(
      JSON.parse(readFileSync(absolute(stagedReceiptPath), "utf8")) as unknown,
    )
    // Publishing is the last thing a run does. The scratch tree is already removed and verified
    // above; re-checking it here is what makes "validated, then swept, then published" an order
    // rather than a hope. The artifact lands before the verdict that vouches for it, so an
    // interrupted publish can leave an unclaimed WAV but never a verdict without its artifact.
    if (existsSync(absolute(workspaceRoot))) {
      throw new Error(`validation cell workspace reappeared before publish: ${workspaceRoot}`)
    }
    // The claim is re-read rather than remembered: publishing is the one step that hands bytes to
    // the next reader, and a run that no longer owns the root must not be the one to hand them over.
    if (!holdsProofRootLock(lock)) {
      throw new Error(`validation cell lost the ${lock.path} claim before publishing ${proofRoot}`)
    }
    renameSync(absolute(stagedAudioPath), absolute(proofAudioPath))
    renameSync(absolute(stagedReceiptPath), absolute(receiptPath))
    return decoded
  } catch (runError) {
    // Copy, receipt write, decode, sweep, publish: any of them failing invalidates the whole
    // proof, so the staged pair and any published remnant go together — unless the claim was lost,
    // in which case those four paths are the new owner's and this run reports them instead.
    const residue = discardProof(lock, proofPaths)
    if (residue.length > 0) {
      const detail = holdsProofRootLock(lock)
        ? `could not remove ${residue.join(", ")}`
        : `lost the ${lock.path} claim and left ${residue.join(", ")} to its new owner`
      throw new Error(`validation cell failed and ${detail}`, { cause: runError })
    }
    throw runError
  } finally {
    try {
      rmSync(absolute(workspaceRoot), { recursive: true, force: true })
    } catch (sweepError) {
      // The success path already removed and verified the workspace, so this can only fire while
      // unwinding, and the failure being unwound is the one worth propagating.
      console.error(`validation cell could not sweep ${workspaceRoot}: ${String(sweepError)}`)
    }
    // Releasing last: everything above is a mutation of the claimed root. A claim that is no longer
    // this run's was taken by a run that proved this one dead, which is a fact worth printing.
    if (!releaseProofRootLock(lock)) {
      console.error(`validation cell no longer held ${lock.path} at release`)
    }
  }
}

interface Scene {
  voiceAssetsPath: string
  stemsPath: string
  spatialManifestPath: string
  hashes: { voiceAssets: string; stems: string; spatial: string }
}

function writeScene(
  manifest: CompanionValidationManifest,
  workspaceRoot: string,
  ticks: readonly string[],
  mutation: Mutation,
): Scene {
  const sceneRoot = path.posix.join(workspaceRoot, mutation === "none" ? "baseline" : mutation)
  mkdirSync(absolute(sceneRoot), { recursive: true })
  const { voice, foley } = manifest.scene
  const stemArtifacts = path.posix.join(sceneRoot, "stems")

  const voiceAssets = {
    schemaVersion: "voice-assets.v1",
    manifestId: "companion-validation-cell-voices",
    createdAt: ticks[0],
    voices: [{
      voiceAssetId: "companion-cell-voice-asset-001",
      displayName: "Companion validation cell whisper",
      provider: "local-deterministic",
      model: "companion-validation-cell",
      consent: { status: "synthetic", sourceRecord: "synthetic deterministic generator; no human recording" },
      deliveryStyle: { language: "en", pace: "slow", affect: "close whisper", asmrStyle: ["close-mic"] },
      preview: { path: path.posix.join(stemArtifacts, "voice.wav"), mediaType: "audio/wav" },
    }],
  }

  const stems = {
    schemaVersion: "asmr-stems.v1",
    manifestId: "companion-validation-cell-stems",
    createdAt: ticks[1],
    timeline: { durationSec: manifest.scene.durationSec, sampleRateHz: manifest.scene.sampleRateHz, frameRate: 60 },
    stems: [
      {
        stemId: voice.stemId,
        kind: "voice",
        role: "close whisper travelling left to right",
        artifact: { path: path.posix.join(stemArtifacts, "voice.wav"), mediaType: "audio/wav" },
        timing: {
          startSec: voice.startSec,
          durationSec: voice.durationSec,
          fadeInSec: voice.fadeSec,
          fadeOutSec: voice.fadeSec,
          loop: false,
        },
        channels: "mono",
        provenance: {
          generator: "companion-validation-cell-deterministic-voice",
          sourceVoiceAssetId: "companion-cell-voice-asset-001",
        },
      },
      {
        stemId: foley.stemId,
        kind: "foley",
        role: "fingertip brush and tap",
        artifact: { path: path.posix.join(stemArtifacts, "foley.wav"), mediaType: "audio/wav" },
        timing: {
          startSec: foley.startSec,
          durationSec: foley.durationSec,
          fadeInSec: foley.fadeSec,
          fadeOutSec: foley.fadeSec,
          loop: false,
        },
        channels: "mono",
        provenance: { generator: "companion-validation-cell-deterministic-foley" },
      },
    ].filter((stem) => !(mutation === "remove-foley-stem-and-object" && stem.stemId === foley.stemId)),
  }

  const waypoints = mutation === "reverse-voice-automation-positions"
    ? [...manifest.scene.voice.trajectory].reverse()
    : manifest.scene.voice.trajectory
  const voiceAutomation = manifest.scene.voice.trajectory.map((point, index) => ({
    timeSec: point.timeSec,
    gainDb: voice.gainDb,
    position: spatialPosition(waypoints[index].xMeters, waypoints[index].zMeters),
  }))

  const stemsPath = path.posix.join(sceneRoot, "asmr-stems.v1.json")
  const stemsJson = `${JSON.stringify(stems, null, 2)}\n`
  const spatial = {
    schemaVersion: "spatial-audio-manifest.v1",
    manifestId: "companion-validation-cell-scene",
    createdAt: ticks[2],
    stemsManifestPath: stemsPath,
    durationSec: manifest.scene.durationSec,
    renderer: { engine: "offline-audio-context", version: "companion-validation-cell-v1" },
    mix: {
      outputPath: path.posix.join(sceneRoot, manifest.artifacts.proofAudioName),
      loudnessTargetLufs: -18,
      truePeakDb: -1,
    },
    objects: [
      { stemId: voice.stemId, bus: "voice", automation: voiceAutomation },
      {
        stemId: foley.stemId,
        bus: "foley",
        automation: [foley.startSec, foley.startSec + foley.durationSec].map((timeSec) => ({
          timeSec,
          gainDb: foley.gainDb,
          position: spatialPosition(foley.xMeters, foley.zMeters),
        })),
      },
    ].filter((object) => !(mutation === "remove-foley-stem-and-object" && object.stemId === foley.stemId)),
    provenance: {
      // Digest of the workspace-independent stems manifest, so the receipt replays across checkouts.
      stemsManifestHash: { algorithm: "sha256", value: sha256(canonical(stemsJson, workspaceRoot)) },
      renderRunId: "companion-validation-cell-001",
    },
  }

  const voiceAssetsPath = path.posix.join(sceneRoot, "voice-assets.v1.json")
  const spatialManifestPath = path.posix.join(sceneRoot, "spatial-audio-manifest.v1.json")
  const voiceAssetsJson = `${JSON.stringify(voiceAssets, null, 2)}\n`
  const spatialJson = `${JSON.stringify(spatial, null, 2)}\n`
  writeFileSync(absolute(voiceAssetsPath), voiceAssetsJson)
  writeFileSync(absolute(stemsPath), stemsJson)
  writeFileSync(absolute(spatialManifestPath), spatialJson)

  return {
    voiceAssetsPath,
    stemsPath,
    spatialManifestPath,
    hashes: {
      voiceAssets: sha256(canonical(voiceAssetsJson, workspaceRoot)),
      stems: sha256(canonical(stemsJson, workspaceRoot)),
      spatial: sha256(canonical(spatialJson, workspaceRoot)),
    },
  }
}

interface RenderedPass extends DecodedWav {
  index: number
  audioPath: string
}

function renderPass(scene: Scene, workspaceRoot: string, label: string, index: number): RenderedPass {
  const outDir = path.posix.join(workspaceRoot, "renders", label)
  const audioPath = path.posix.join(outDir, "render.wav")
  mkdirSync(absolute(outDir), { recursive: true })
  const result = renderSpatialAudioProof({
    voiceAssetsPath: scene.voiceAssetsPath,
    stemsPath: scene.stemsPath,
    spatialManifestPath: scene.spatialManifestPath,
    outputPath: audioPath,
  })
  return {
    ...decodeCompanionValidationWav(readFileSync(absolute(result.audioPath))),
    index,
    audioPath: result.audioPath,
  }
}

/**
 * Minimal RIFF/WAVE reader: the cell never trusts the renderer's own report of its output, and it
 * never rounds a malformed artifact into a well-formed one. Every declared length must close
 * exactly on a frame boundary and on the end of the file, so a truncated or padded render is a
 * decode error rather than a slightly shorter proof.
 */
export function decodeCompanionValidationWav(bytes: Buffer): DecodedWav {
  if (bytes.length < 44) throw new Error(`rendered artifact is ${bytes.length} bytes, too short for a WAV`)
  const riff = bytes.toString("ascii", 0, 4)
  const wave = bytes.toString("ascii", 8, 12)
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error(`rendered artifact is not RIFF/WAVE: ${riff}/${wave}`)
  const riffLength = bytes.readUInt32LE(4)
  if (riffLength !== bytes.length - 8) {
    throw new Error(`RIFF declares ${riffLength} bytes, artifact carries ${bytes.length - 8}`)
  }

  let audioFormat = 0
  let channels = 0
  let sampleRateHz = 0
  let bitsPerSample = 0
  let blockAlign = 0
  let byteRate = 0
  let dataOffset = -1
  let dataLength = 0
  let cursor = 12
  let sawFmt = false
  while (cursor + 8 <= bytes.length) {
    const chunkId = bytes.toString("ascii", cursor, cursor + 4)
    const chunkLength = bytes.readUInt32LE(cursor + 4)
    const body = cursor + 8
    if (body + chunkLength > bytes.length) {
      throw new Error(`WAV chunk "${chunkId}" declares ${chunkLength} bytes, ${bytes.length - body} remain`)
    }
    if (chunkId === "fmt ") {
      if (chunkLength < 16) throw new Error(`WAV fmt chunk is ${chunkLength} bytes, expected at least 16`)
      audioFormat = bytes.readUInt16LE(body)
      channels = bytes.readUInt16LE(body + 2)
      sampleRateHz = bytes.readUInt32LE(body + 4)
      byteRate = bytes.readUInt32LE(body + 8)
      blockAlign = bytes.readUInt16LE(body + 12)
      bitsPerSample = bytes.readUInt16LE(body + 14)
      sawFmt = true
    } else if (chunkId === "data") {
      if (!sawFmt) throw new Error("WAV data chunk precedes its fmt chunk")
      dataOffset = body
      dataLength = chunkLength
      break
    }
    cursor = body + chunkLength + (chunkLength % 2)
  }
  if (dataOffset < 0) throw new Error("rendered artifact has no data chunk")
  if (audioFormat !== 1 || bitsPerSample !== 16 || channels !== 2) {
    throw new Error(`expected 16-bit stereo PCM, got format ${audioFormat}, ${bitsPerSample}-bit, ${channels}ch`)
  }
  if (blockAlign !== channels * (bitsPerSample / 8)) {
    throw new Error(`WAV blockAlign ${blockAlign} contradicts ${channels}ch of ${bitsPerSample}-bit samples`)
  }
  // A zero rate satisfies `byteRate === sampleRateHz * blockAlign` and would decode to an infinite
  // duration, so the positivity is checked before the relation that would otherwise absorb it.
  if (sampleRateHz <= 0 || byteRate <= 0) {
    throw new Error(`WAV declares ${sampleRateHz} Hz and ${byteRate} bytes per second; both must be positive`)
  }
  if (byteRate !== sampleRateHz * blockAlign) {
    throw new Error(`WAV byteRate ${byteRate} contradicts ${sampleRateHz} Hz at ${blockAlign} bytes per frame`)
  }
  if (dataLength === 0 || dataLength % blockAlign !== 0) {
    throw new Error(`WAV data chunk of ${dataLength} bytes is not whole ${blockAlign}-byte frames`)
  }
  const dataEnd = dataOffset + dataLength + (dataLength % 2)
  if (dataEnd !== bytes.length) {
    throw new Error(`WAV carries ${bytes.length - dataEnd} bytes past its data chunk`)
  }

  const frames = dataLength / blockAlign
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  let peak = 0
  let allFinite = true
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = dataOffset + frame * blockAlign
    const l = bytes.readInt16LE(offset) / 32_768
    const r = bytes.readInt16LE(offset + 2) / 32_768
    left[frame] = l
    right[frame] = r
    if (!Number.isFinite(l) || !Number.isFinite(r)) allFinite = false
    const magnitude = Math.max(Math.abs(l), Math.abs(r))
    if (magnitude > peak) peak = magnitude
  }

  return {
    channels,
    sampleRateHz,
    bitsPerSample,
    frames,
    durationSec: frames / sampleRateHz,
    byteLength: bytes.byteLength,
    peak,
    allFinite,
    left,
    right,
    pcmSha256: sha256(bytes.subarray(dataOffset, dataOffset + dataLength)),
    wavSha256: sha256(bytes),
  }
}

function measure(manifest: CompanionValidationManifest, wav: DecodedWav): Metrics {
  const rate = wav.sampleRateHz
  const { trajectory, temporal } = manifest.oracle
  const windowStart = Math.round(trajectory.window.startSec * rate)
  const windowEnd = Math.round(trajectory.window.endSec * rate)
  const blockFrames = Math.floor((windowEnd - windowStart) / trajectory.blocks)

  const blocks: TrajectoryBlock[] = []
  for (let index = 0; index < trajectory.blocks; index += 1) {
    const startFrame = windowStart + index * blockFrames
    const endFrame = startFrame + blockFrames
    blocks.push({ index, startFrame, endFrame, balance: lateralBalance(wav, startFrame, endFrame) })
  }
  let minBlockStep = Number.POSITIVE_INFINITY
  for (let index = 1; index < blocks.length; index += 1) {
    minBlockStep = Math.min(minBlockStep, blocks[index].balance - blocks[index - 1].balance)
  }

  const gapStart = frameOf(temporal.gapWindow.startSec, rate)
  const gapEnd = frameOf(temporal.gapWindow.endSec, rate)
  const gapPeak = windowPeak(wav, gapStart, gapEnd)
  const gapRms = windowRms(wav, gapStart, gapEnd)
  const voiceRms = windowRms(
    wav,
    frameOf(temporal.voiceWindow.startSec, rate),
    frameOf(temporal.voiceWindow.endSec, rate),
  )
  const foleyRms = windowRms(
    wav,
    frameOf(temporal.foleyWindow.startSec, rate),
    frameOf(temporal.foleyWindow.endSec, rate),
  )
  // One 16-bit LSB is the strongest silence claim a decoded WAV can support.
  const noiseFloor = Math.max(gapRms, 1 / 32_768)

  return {
    wav: {
      channels: wav.channels,
      sampleRateHz: wav.sampleRateHz,
      bitsPerSample: wav.bitsPerSample,
      frames: wav.frames,
      durationSec: wav.durationSec,
      byteLength: wav.byteLength,
      peak: wav.peak,
      allFinite: wav.allFinite,
    },
    trajectory: {
      blocks,
      firstBalance: blocks[0].balance,
      lastBalance: blocks[blocks.length - 1].balance,
      minBlockStep,
    },
    temporal: {
      voiceRms,
      gapRms,
      gapPeak,
      foleyRms,
      separationDb: 20 * Math.log10(Math.min(voiceRms, foleyRms) / noiseFloor),
    },
  }
}

function evaluate(manifest: CompanionValidationManifest, metrics: Metrics): Invariant[] {
  const { wav, trajectory, temporal } = manifest.oracle
  const rate = manifest.scene.sampleRateHz
  const structure = metrics.wav
  const structureFailures = [
    structure.channels === wav.channels ? null : `channels ${structure.channels}`,
    structure.sampleRateHz === wav.sampleRateHz ? null : `sampleRateHz ${structure.sampleRateHz}`,
    structure.bitsPerSample === wav.bitsPerSample ? null : `bitsPerSample ${structure.bitsPerSample}`,
    structure.frames === wav.frames ? null : `frames ${structure.frames}`,
    structure.durationSec === wav.durationSec ? null : `durationSec ${structure.durationSec}`,
    structure.allFinite ? null : "non-finite samples",
    structure.peak <= wav.maxPeak ? null : `peak ${structure.peak}`,
    structure.peak >= wav.minPeak ? null : `silent output, peak ${structure.peak}`,
  ].filter((entry): entry is string => entry !== null)

  const balances = metrics.trajectory.blocks
  const firstBadBlock = balances.find((block, index) => {
    if (index === 0) return block.balance > -trajectory.minEdgeBalance
    if (index === balances.length - 1 && block.balance < trajectory.minEdgeBalance) return true
    return block.balance - balances[index - 1].balance < trajectory.minBlockStep
  })

  const separation = metrics.temporal
  const temporalFailures: Array<{ detail: string; frame: number }> = []
  if (separation.voiceRms < temporal.minActiveRms) {
    temporalFailures.push({
      detail: `voice window RMS ${separation.voiceRms.toFixed(6)} < ${temporal.minActiveRms}`,
      frame: frameOf(temporal.voiceWindow.startSec, rate),
    })
  }
  if (separation.gapPeak > temporal.maxGapPeak) {
    temporalFailures.push({
      detail: `gap window peak ${separation.gapPeak.toFixed(6)} > ${temporal.maxGapPeak}`,
      frame: frameOf(temporal.gapWindow.startSec, rate),
    })
  }
  if (separation.foleyRms < temporal.minActiveRms) {
    temporalFailures.push({
      detail: `foley window RMS ${separation.foleyRms.toFixed(6)} < ${temporal.minActiveRms}`,
      frame: frameOf(temporal.foleyWindow.startSec, rate),
    })
  }
  if (separation.separationDb < temporal.minSeparationDb) {
    temporalFailures.push({
      detail: `stem/gap separation ${separation.separationDb.toFixed(2)} dB < ${temporal.minSeparationDb} dB`,
      frame: frameOf(temporal.gapWindow.startSec, rate),
    })
  }

  return [
    {
      id: "wav.stereo-48k-frame-exact",
      passed: structureFailures.length === 0,
      detail: structureFailures.length === 0
        ? `RIFF/WAVE 16-bit stereo, ${structure.frames} frames, ${structure.durationSec}s, peak ${structure.peak.toFixed(6)}`
        : `WAV structure violations: ${structureFailures.join(", ")}`,
      firstBadFrame: structureFailures.length === 0 ? null : 0,
    },
    {
      id: "trajectory.pan-sweeps-left-to-right",
      passed: firstBadBlock === undefined,
      detail: firstBadBlock === undefined
        ? `lateral balance ${balances[0].balance.toFixed(4)} to ${balances[balances.length - 1].balance.toFixed(4)}, min step ${metrics.trajectory.minBlockStep.toFixed(4)}`
        : `block ${firstBadBlock.index} balance ${firstBadBlock.balance.toFixed(4)} breaks the left-to-right sweep`,
      firstBadFrame: firstBadBlock?.startFrame ?? null,
    },
    {
      id: "temporal.voice-foley-separation",
      passed: temporalFailures.length === 0,
      detail: temporalFailures.length === 0
        ? `voice ${separation.voiceRms.toFixed(6)}, gap ${separation.gapRms.toFixed(6)}, foley ${separation.foleyRms.toFixed(6)}, separation ${separation.separationDb.toFixed(2)} dB`
        : temporalFailures.map((entry) => entry.detail).join("; "),
      firstBadFrame: temporalFailures[0]?.frame ?? null,
    },
  ]
}

/**
 * Energy-weighted stereo balance in [-1, 1]: -1 is hard left, +1 is hard right. Distance, envelope
 * and source amplitude scale both channels equally, so they cancel and only the pan law survives.
 */
function lateralBalance(wav: DecodedWav, startFrame: number, endFrame: number): number {
  let leftEnergy = 0
  let rightEnergy = 0
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    leftEnergy += wav.left[frame] * wav.left[frame]
    rightEnergy += wav.right[frame] * wav.right[frame]
  }
  const total = leftEnergy + rightEnergy
  return total === 0 ? 0 : (rightEnergy - leftEnergy) / total
}

function windowRms(wav: DecodedWav, startFrame: number, endFrame: number): number {
  let energy = 0
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    energy += wav.left[frame] * wav.left[frame] + wav.right[frame] * wav.right[frame]
  }
  const samples = (endFrame - startFrame) * 2
  return samples === 0 ? 0 : Math.sqrt(energy / samples)
}

function windowPeak(wav: DecodedWav, startFrame: number, endFrame: number): number {
  let peak = 0
  for (let frame = startFrame; frame < endFrame; frame += 1) {
    peak = Math.max(peak, Math.abs(wav.left[frame]), Math.abs(wav.right[frame]))
  }
  return peak
}

/**
 * Listener-relative x/z metres to the manifest's azimuth/elevation/distance position, rounded to
 * micro-degree / micrometre precision. `Math.atan2` and `Math.hypot` are allowed to differ by an
 * ULP between platforms, and an unrounded scene would give the same trajectory a host-dependent
 * input digest; rounding keeps the receipt comparable across hosts at inaudible cost.
 */
function spatialPosition(xMeters: number, zMeters: number): {
  azimuthDeg: number
  elevationDeg: number
  distanceMeters: number
} {
  const micro = 1e6
  return {
    azimuthDeg: Math.round(((Math.atan2(xMeters, zMeters) * 180) / Math.PI) * micro) / micro,
    elevationDeg: 0,
    distanceMeters: Math.round(Math.hypot(xMeters, zMeters) * micro) / micro,
  }
}

function frameOf(timeSec: number, sampleRateHz: number): number {
  return Math.round(timeSec * sampleRateHz)
}

// ---------------------------------------------------------------------------
// Root containment
// ---------------------------------------------------------------------------

interface CellRoots {
  workspaceRoot: string
  proofRoot: string
}

/** Full containment check for both roots. Throws before any filesystem call if either is unsafe. */
function resolveCellRoots(workspaceRoot: string, proofRoot: string): CellRoots {
  const workspace = assertRootShape("workspaceRoot", workspaceRoot)
  const proof = assertRootShape("proofRoot", proofRoot)
  assertRootsDisjoint(workspace, proof)
  assertNoSymlinkEscape("workspaceRoot", workspace)
  assertNoSymlinkEscape("proofRoot", proof)
  return { workspaceRoot: workspace.join("/"), proofRoot: proof.join("/") }
}

/**
 * Pure shape check: repo-relative, no traversal, strictly below one allowed prefix. Rejects the
 * repository root, absolute paths, and anything outside the two trees the cell owns.
 */
function assertRootShape(role: string, value: string): string[] {
  if (value.length > 240 || !REPO_RELATIVE_PATH_PATTERN.test(value)) {
    throw new Error(`validation cell ${role} must be a repo-relative path without "..": ${JSON.stringify(value)}`)
  }
  const segments = value.split("/").filter((segment) => segment.length > 0 && segment !== ".")
  const prefix = CELL_ROOT_PREFIXES.find((candidate) => isPathPrefix(candidate.split("/"), segments))
  if (prefix === undefined || segments.length <= prefix.split("/").length) {
    throw new Error(
      `validation cell ${role} must be strictly below one of [${CELL_ROOT_PREFIXES.join(", ")}]: ${JSON.stringify(value)}`,
    )
  }
  return segments
}

/** Neither root may contain the other: a nested proof root would be wiped with the workspace. */
function assertRootsDisjoint(workspace: string[], proof: string[]): void {
  if (isPathPrefix(workspace, proof) || isPathPrefix(proof, workspace)) {
    throw new Error(
      `validation cell roots must be disjoint: ${workspace.join("/")} overlaps ${proof.join("/")}`,
    )
  }
}

/**
 * The deepest existing ancestor is the only component a symlink can redirect — everything below it
 * is created by this run — so resolving that one path decides whether the root stays in its tree.
 */
function assertNoSymlinkEscape(role: string, segments: string[]): void {
  const repoRelative = segments.join("/")
  let ancestor = path.resolve(REPO_ROOT, repoRelative)
  while (!pathExists(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) throw new Error(`validation cell ${role} has no existing ancestor: ${repoRelative}`)
    ancestor = parent
  }
  let realAncestor: string
  let realRepoRoot: string
  try {
    realAncestor = realpathSync(ancestor)
    realRepoRoot = realpathSync(REPO_ROOT)
  } catch {
    throw new Error(`validation cell ${role} resolves through a broken link: ${repoRelative}`)
  }
  if (realAncestor !== realRepoRoot && !realAncestor.startsWith(realRepoRoot + path.sep)) {
    throw new Error(`validation cell ${role} escapes the repository: ${repoRelative} -> ${realAncestor}`)
  }
  // The deepest existing ancestor must be exactly where it lexically claims to be. Comparing the
  // resolved path against the allowed prefix instead would accept a link that lands on an ancestor
  // of that prefix — `test-output` pointing at its own package, say — and every mkdir below it
  // would follow the link out of the tree this cell may delete. It would equally accept a link
  // onto a sibling inside the prefix, which makes the lexical disjointness of the two roots
  // meaningless: both could name the same directory, and the sweep would take the proof with it.
  const realSegments = relativeSegments(realRepoRoot, realAncestor)
  const lexicalSegments = relativeSegments(REPO_ROOT, ancestor)
  if (realSegments.length !== lexicalSegments.length || realSegments.some((s, i) => s !== lexicalSegments[i])) {
    throw new Error(
      `validation cell ${role} resolves through a link: ${repoRelative} at ` +
        `${lexicalSegments.join("/")} -> ${realSegments.join("/")}`,
    )
  }
}

function relativeSegments(from: string, to: string): string[] {
  return path.relative(from, to).split(path.sep).filter((entry) => entry.length > 0)
}

function isPathPrefix(prefix: readonly string[], full: readonly string[]): boolean {
  return prefix.length <= full.length && prefix.every((segment, index) => full[index] === segment)
}

/** Removes the scratch tree and proves it is gone; the caller records the observed result. */
function removeWorkspace(workspaceRoot: string): true {
  rmSync(absolute(workspaceRoot), { recursive: true, force: true })
  if (existsSync(absolute(workspaceRoot))) {
    throw new Error(`validation cell workspace survived cleanup: ${workspaceRoot}`)
  }
  return true
}

/**
 * Removes every proof path it can and reports the ones that survived. It never throws: it runs
 * while another failure is already unwinding, and a path it cannot clear has to be reported
 * alongside that failure rather than replace it.
 *
 * Ownership is what makes these removals this run's to make. Every path is a sibling of the claim,
 * so a run that no longer holds it removes nothing and reports whatever is still there: those bytes
 * are the next owner's staged or published proof, and clearing them is the exact damage the claim
 * exists to prevent.
 */
function discardProof(lock: ProofRootLock, paths: readonly string[]): string[] {
  if (!holdsProofRootLock(lock)) return paths.filter((target) => pathExists(absolute(target)))
  const residue: string[] = []
  for (const target of paths) {
    try {
      rmSync(absolute(target), { recursive: true, force: true })
      if (pathExists(absolute(target))) residue.push(target)
    } catch {
      residue.push(target)
    }
  }
  return residue
}

// ---------------------------------------------------------------------------
// Proof-root ownership
// ---------------------------------------------------------------------------

/**
 * The run holding a proof root. A pid alone cannot decide liveness, because the kernel reuses pid
 * numbers, so the holder also records that pid's start stamp and the host it was read on: a
 * takeover needs all three before it may call the holder dead. `token` separates two claims made by
 * one process, which pid and start stamp cannot.
 */
const ProofRootLockHolderSchema = Schema.Struct({
  pid: PositiveInteger,
  startedAt: Schema.NullOr(NonEmptyString),
  hostname: NonEmptyString,
  token: Schema.String.check(Schema.isPattern(/^[0-9a-f]{32}$/)),
  claimedAt: Timestamp,
})

export type ProofRootLockHolder = Schema.Schema.Type<typeof ProofRootLockHolderSchema>

/** A live claim on one proof root. Repo-relative, like every other path the cell carries. */
export interface ProofRootLock {
  /** The well-known path whose existence is the claim. */
  readonly path: string
  /**
   * A second name for the same inode, kept for the life of the claim. It is both the complete
   * identity written before the claim was made and the handle a takeover renames, and it is the
   * reason a takeover can be serialised at all.
   */
  readonly handlePath: string
  readonly token: string
}

/**
 * A proof root is claimed by a run other than this one. Raised before the refused run reads or
 * changes a single path another run could own: it may create the directory and write and remove its
 * own token-named handle, and that is all it ever touches.
 */
export class ProofRootBusyError extends Error {
  constructor(
    readonly proofRoot: string,
    /** `held`: the holder is alive. `unassessable`: it cannot be proven dead. `contended`: lost a race. */
    readonly reason: "held" | "unassessable" | "contended",
    readonly holder: ProofRootLockHolder | null,
    detail: string,
  ) {
    super(`validation cell proof root ${proofRoot} is busy (${reason}): ${detail}`)
    this.name = "ProofRootBusyError"
  }
}

/**
 * Claims `proofRoot` for this run, creating the directory if it does not exist yet.
 *
 * The claim is a hard link of a file this run already wrote in full, so the well-known path is
 * either absent or carries a complete identity. An `O_EXCL` create followed by a separate write has
 * a window in which a crash leaves a nameless claim that no later run could ever assess, and a
 * proof root wedged by a crash is worse than one that refuses a race. `link` fails with `EEXIST`
 * while another run owns the root, and this run refuses there instead of waiting.
 *
 * That file is written before the root is known to be free, and its name carries this run's token:
 * a run that turns out to be the loser has still only ever created and removed a path no other run
 * can name.
 */
export function acquireProofRootLock(proofRoot: string): ProofRootLock {
  const root = resolveProofRoot(proofRoot)
  mkdirSync(absolute(root), { recursive: true })
  const lockPath = path.posix.join(root, COMPANION_VALIDATION_PROOF_LOCK_NAME)
  const token = randomBytes(16).toString("hex")
  const handlePath = `${lockPath}.${token}`
  const holder: ProofRootLockHolder = {
    pid: process.pid,
    startedAt: processStartStamp(process.pid),
    hostname: hostname(),
    token,
    claimedAt: new Date().toISOString(),
  }
  writeFileSync(absolute(handlePath), `${JSON.stringify(holder)}\n`, { flag: "wx" })
  const lock: ProofRootLock = { path: lockPath, handlePath, token }
  try {
    if (linkClaim(handlePath, lockPath)) return lock
    // Returns only when the claim it found is gone: either released under it, or removed because
    // its holder was proven dead. Every other outcome throws.
    stealDeadClaim(root, lockPath, token)
    if (linkClaim(handlePath, lockPath)) return lock
    throw new ProofRootBusyError(
      root,
      "contended",
      readLockHolder(lockPath),
      "another run claimed the root while this one was clearing a dead holder",
    )
  } catch (claimError) {
    rmSync(absolute(handlePath), { force: true })
    throw claimError
  }
}

/**
 * Drops a claim and reports whether this run still owned it. The well-known name goes first: a
 * crash between the two removals has to leave a claim that a later run can still assess and steal,
 * never one whose takeover handle is already gone.
 */
export function releaseProofRootLock(lock: ProofRootLock): boolean {
  const held = holdsProofRootLock(lock)
  if (held) rmSync(absolute(lock.path), { force: true })
  rmSync(absolute(lock.handlePath), { force: true })
  return held
}

/** True only while the well-known path still carries this run's token. */
function holdsProofRootLock(lock: ProofRootLock): boolean {
  return readLockHolder(lock.path)?.token === lock.token
}

function linkClaim(handlePath: string, lockPath: string): boolean {
  try {
    linkSync(absolute(handlePath), absolute(lockPath))
    return true
  } catch (linkError) {
    if ((linkError as NodeJS.ErrnoException).code === "EEXIST") return false
    throw linkError
  }
}

/**
 * Removes a claim whose holder is provably dead, and only such a claim. Renaming the dead holder's
 * handle into a name unique to this run is the whole of the serialisation: a source name exists
 * once, so exactly one run can win that rename, and a run that loses it never reaches the unlink.
 * Without it, two runs assessing the same corpse could both unlink, and the loser's unlink would
 * fall on the winner's fresh claim.
 */
function stealDeadClaim(proofRoot: string, lockPath: string, token: string): void {
  const holder = readLockHolder(lockPath)
  if (holder === null) {
    // A claim released between the failed link and this read is not a fault, it is a free root.
    if (!pathExists(absolute(lockPath))) return
    throw new ProofRootBusyError(
      proofRoot,
      "unassessable",
      null,
      `${lockPath} carries no readable holder identity; clear it by hand once no run is using the root`,
    )
  }
  const state = assessHolder(holder)
  if (state !== "dead") {
    throw new ProofRootBusyError(
      proofRoot,
      state === "alive" ? "held" : "unassessable",
      holder,
      `held since ${holder.claimedAt} by pid ${holder.pid} on ${holder.hostname}` +
        (state === "alive" ? " and still running" : ", whose liveness this host cannot decide"),
    )
  }
  const stolenPath = `${lockPath}.${token}.stolen`
  try {
    renameSync(absolute(`${lockPath}.${holder.token}`), absolute(stolenPath))
  } catch (stealError) {
    throw new ProofRootBusyError(
      proofRoot,
      "contended",
      holder,
      `the takeover handle of dead pid ${holder.pid} is gone: another run is taking the root over, ` +
        `or the handle was removed by hand (${String(stealError)})`,
    )
  }
  rmSync(absolute(lockPath), { force: true })
  rmSync(absolute(stolenPath), { force: true })
}

function readLockHolder(lockPath: string): ProofRootLockHolder | null {
  try {
    const raw = JSON.parse(readFileSync(absolute(lockPath), "utf8")) as unknown
    return Schema.decodeUnknownSync(ProofRootLockHolderSchema)(raw, STRICT_DECODE)
  } catch {
    return null
  }
}

type HolderState = "alive" | "dead" | "unassessable"

/** Only `dead` licenses a takeover, so every case that cannot be decided answers `unassessable`. */
function assessHolder(holder: ProofRootLockHolder): HolderState {
  if (holder.hostname !== hostname()) return "unassessable"
  let running: boolean
  try {
    process.kill(holder.pid, 0)
    running = true
  } catch (signalError) {
    // `EPERM` says the pid exists and belongs to another user; only `ESRCH` proves it is gone.
    running = (signalError as NodeJS.ErrnoException).code !== "ESRCH"
  }
  if (!running) return "dead"
  const current = processStartStamp(holder.pid)
  if (current === null || holder.startedAt === null) return "unassessable"
  // A running pid whose start stamp moved is a different process wearing a recycled number.
  return current === holder.startedAt ? "alive" : "dead"
}

/**
 * An opaque, host-local stamp that changes when a pid is handed to a new process. Linux reads the
 * boot-relative start tick straight out of `/proc`; macOS has no `/proc`, so the start time comes
 * from `ps`. It is only ever compared for equality, never parsed.
 */
function processStartStamp(pid: number): string | null {
  if (process.platform === "linux") {
    const statFile = `/proc/${pid}/stat`
    if (!pathExists(statFile)) return null
    let raw: string
    try {
      raw = readFileSync(statFile, "utf8")
    } catch {
      return null
    }
    // `comm` is parenthesised and may itself contain spaces and parentheses, so the fields are
    // counted from the last ')': `starttime` is field 22, the 20th of those that follow it.
    const fields = raw.slice(raw.lastIndexOf(")") + 2).split(" ")
    const startTicks = fields[19]
    return startTicks !== undefined && /^\d+$/.test(startTicks) ? startTicks : null
  }
  if (process.platform === "darwin") {
    const shown = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)])
    if (!shown.success) return null
    const stamp = shown.stdout.toString().trim()
    return stamp.length > 0 ? stamp : null
  }
  return null
}

/** The proof-root half of `resolveCellRoots`, for a caller that claims a root without running. */
function resolveProofRoot(proofRoot: string): string {
  const segments = assertRootShape("proofRoot", proofRoot)
  assertNoSymlinkEscape("proofRoot", segments)
  return segments.join("/")
}

// ---------------------------------------------------------------------------
// Source binding
// ---------------------------------------------------------------------------

/**
 * Everything whose bytes decide what the renderer emits: the renderer, this cell, each declared
 * runtime package (its resolved tree and version) and each lockfile pinning them. `digest` is the
 * one value a replay compares, and it moves whenever any bound artifact moves.
 */
function bindSources(manifest: CompanionValidationManifest): ReceiptShape["hashes"]["source"] {
  const renderer = { path: manifest.sut.module, sha256: sha256(readFileSync(absolute(manifest.sut.module))) }
  const cell = { path: CELL_MODULE_PATH, sha256: sha256(readFileSync(absolute(CELL_MODULE_PATH))) }
  const bindings: SourceBinding[] = [
    { id: renderer.path, kind: "repo-source" as const, path: renderer.path, version: null, sha256: renderer.sha256 },
    { id: cell.path, kind: "repo-source" as const, path: cell.path, version: null, sha256: cell.sha256 },
    ...manifest.sut.packages.map(bindPackage),
    ...manifest.sut.lockfiles.map(bindLockfile),
  ]
  bindings.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
  return { renderer, cell, bindings, digest: bindingsDigest(bindings) }
}

function bindingsDigest(bindings: readonly SourceBinding[]): string {
  return sha256(
    bindings.map((entry) => `${entry.kind}\u0000${entry.id}\u0000${entry.version ?? ""}\u0000${entry.sha256}`)
      .join("\n"),
  )
}

/**
 * Resolve the package the renderer actually loads, then digest its manifest plus — when it lives in
 * this repository — every `.ts` file under its `src/`. A hoisted external package contributes its
 * `package.json` (name, version, exports); the lockfile binding pins its contents.
 */
function bindPackage(name: string): SourceBinding {
  // Resolve exactly as the `import` at the top of this module does, not from the repository root:
  // a workspace link only exists on the paths the loader actually walks.
  const entry = Bun.resolveSync(name, import.meta.dirname)
  const packageJsonPath = findPackageJson(entry, name)
  const directory = path.dirname(packageJsonPath)
  const inRepo = directory === REPO_ROOT || directory.startsWith(REPO_ROOT + path.sep)
  const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown }
  const files = [packageJsonPath, ...(inRepo ? listTypeScriptFiles(path.join(directory, "src")) : [])]
  const digest = createHash("sha256")
  for (const file of files) {
    digest.update(`${path.relative(directory, file).split(path.sep).join("/")}\u0000`)
    digest.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    digest.update("\u0000")
  }
  return {
    id: name,
    kind: "package",
    path: inRepo ? path.relative(REPO_ROOT, directory).split(path.sep).join("/") : null,
    version: typeof parsed.version === "string" && parsed.version.length > 0 ? parsed.version : null,
    sha256: digest.digest("hex"),
  }
}

function findPackageJson(entry: string, name: string): string {
  let directory = path.dirname(entry)
  for (;;) {
    const candidate = path.join(directory, "package.json")
    if (pathExists(candidate)) {
      const parsed = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown }
      if (parsed.name === name) return candidate
    }
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error(`cannot bind package ${name}: no package.json above ${entry}`)
    directory = parent
  }
}

/** Lockfiles are resolved by walking up from the repo root, since a worktree shares an install. */
function bindLockfile(name: string): SourceBinding {
  let directory = REPO_ROOT
  for (;;) {
    const candidate = path.join(directory, name)
    if (pathExists(candidate) && statSync(candidate).isFile()) {
      const inRepo = candidate.startsWith(REPO_ROOT + path.sep)
      return {
        id: name,
        kind: "lockfile",
        path: inRepo ? path.relative(REPO_ROOT, candidate).split(path.sep).join("/") : null,
        version: null,
        sha256: sha256(readFileSync(candidate)),
      }
    }
    const parent = path.dirname(directory)
    if (parent === directory) throw new Error(`cannot bind lockfile ${name}: not found at or above ${REPO_ROOT}`)
    directory = parent
  }
}

function listTypeScriptFiles(directory: string): string[] {
  if (!pathExists(directory) || !statSync(directory).isDirectory()) return []
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true, recursive: true })) {
    const child = path.join(entry.parentPath, entry.name)
    if (entry.isFile() && child.endsWith(".ts")) found.push(child)
  }
  return found.sort()
}

// ---------------------------------------------------------------------------
// Resource budget
// ---------------------------------------------------------------------------

type Budget = Schema.Schema.Type<typeof BudgetSchema>

interface ObservedBudget {
  cgroup: string | null
  unit: string | null
  memoryMaxBytes: number | null
  cpuQuotaPercent: number | null
  runtimeMaxSec: number | null
}

/** Reads the limits this process is actually subject to. Nothing here trusts a command line. */
function observeBudget(): ObservedBudget {
  const cgroup = process.platform === "linux" ? readCgroupPath() : null
  if (cgroup === null) {
    return { cgroup: null, unit: null, memoryMaxBytes: null, cpuQuotaPercent: null, runtimeMaxSec: null }
  }
  const unit = path.posix.basename(cgroup)
  const scoped = unit.endsWith(".scope") || unit.endsWith(".service") ? unit : null
  return {
    cgroup,
    unit: scoped,
    memoryMaxBytes: readCgroupLimit(`/sys/fs/cgroup${cgroup}/memory.max`),
    cpuQuotaPercent: readCpuQuotaPercent(`/sys/fs/cgroup${cgroup}/cpu.max`),
    runtimeMaxSec: scoped === null ? null : readRuntimeMaxSec(scoped),
  }
}

function budgetViolations(observed: ObservedBudget, declared: Budget): string[] {
  const violations: string[] = []
  if (observed.cgroup === null) violations.push("no cgroup v2 membership observed")
  if (observed.memoryMaxBytes === null || observed.memoryMaxBytes > declared.memoryMaxBytes) {
    violations.push(`MemoryMax ${observed.memoryMaxBytes ?? "unbounded"} exceeds ${declared.memoryMaxBytes}`)
  }
  if (observed.cpuQuotaPercent === null || observed.cpuQuotaPercent > declared.cpuQuotaPercent) {
    violations.push(`CPUQuota ${observed.cpuQuotaPercent ?? "unbounded"}% exceeds ${declared.cpuQuotaPercent}%`)
  }
  if (observed.runtimeMaxSec === null || observed.runtimeMaxSec > declared.runtimeMaxSec) {
    violations.push(`RuntimeMaxSec ${observed.runtimeMaxSec ?? "unbounded"} exceeds ${declared.runtimeMaxSec}`)
  }
  return violations
}

function readCgroupPath(): string | null {
  const file = "/proc/self/cgroup"
  if (!pathExists(file) || !statSync(file).isFile()) return null
  const line = readFileSync(file, "utf8").split("\n").find((entry) => entry.startsWith("0::"))
  const cgroup = line?.slice(3) ?? ""
  return cgroup.startsWith("/") ? cgroup : null
}

function readCgroupLimit(file: string): number | null {
  if (!pathExists(file)) return null
  const raw = readFileSync(file, "utf8").trim()
  if (raw === "max" || raw.length === 0) return null
  const value = Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

function readCpuQuotaPercent(file: string): number | null {
  if (!pathExists(file)) return null
  return parseCgroupCpuQuotaPercent(readFileSync(file, "utf8"))
}

/**
 * `cpu.max` as a percentage, with no rounding anywhere: `Math.round` on the quotient would report
 * a 250.4% quota as 250 and let it pass a declared ceiling of 250. Scaling the microsecond
 * numerator before dividing keeps every integer percentage exact, and anything between two
 * integers stays between them, so the comparison in `budgetViolations` can never be permissive.
 * Exported for the negative test that pins that behaviour.
 */
export function parseCgroupCpuQuotaPercent(raw: string): number | null {
  const [quota, period] = raw.trim().split(/\s+/)
  if (quota === undefined || period === undefined || quota === "max") return null
  const quotaUsec = Number.parseInt(quota, 10)
  const periodUsec = Number.parseInt(period, 10)
  if (!Number.isSafeInteger(quotaUsec) || !Number.isSafeInteger(periodUsec) || quotaUsec <= 0 || periodUsec <= 0) {
    return null
  }
  const scaled = quotaUsec * 100
  return Number.isSafeInteger(scaled) ? scaled / periodUsec : null
}

/** `RuntimeMaxSec` is a unit property, not a cgroup file, so it is read back from systemd. */
function readRuntimeMaxSec(unit: string): number | null {
  if (Bun.which("systemctl") === null) return null
  const shown = Bun.spawnSync(["systemctl", "--user", "show", "-p", "RuntimeMaxUSec", "--value", unit])
  if (!shown.success) return null
  return parseSystemdTimespanSec(shown.stdout.toString().trim())
}

const SYSTEMD_TIMESPAN_SECONDS: Record<string, number> = {
  us: 1e-6,
  ms: 1e-3,
  s: 1,
  min: 60,
  h: 3_600,
  d: 86_400,
  w: 604_800,
}

/** systemd prints durations as concatenated unit groups ("5min", "1h 30min"); "infinity" is null. */
function parseSystemdTimespanSec(value: string): number | null {
  if (value.length === 0 || value === "infinity") return null
  let total = 0
  let matched = false
  for (const match of value.matchAll(/(\d+)\s*(us|ms|min|s|h|d|w)/g)) {
    const scale = SYSTEMD_TIMESPAN_SECONDS[match[2]]
    if (scale === undefined) return null
    total += Number(match[1]) * scale
    matched = true
  }
  return matched && total > 0 ? total : null
}

// ---------------------------------------------------------------------------
// Cross-field schema invariants
// ---------------------------------------------------------------------------

/**
 * A struct-level check that reports every cross-field violation of a decoded value in one message,
 * instead of the single per-field expectation the built-in checks can express.
 */
function crossFieldCheck<T>(title: string, report: (value: T) => true | string): SchemaAST.Filter<T> {
  return new SchemaAST.Filter<T>((value) => {
    const problems = report(value)
    return problems === true ? undefined : new SchemaIssue.InvalidValue(Option.some(value), { message: problems })
  }, { title })
}

/**
 * Everything the per-field checks cannot see: window ordering, scene bounds, non-overlap, block
 * granularity, negative-control uniqueness, and the containment of the two declared roots.
 */
function manifestCrossFieldReport(manifest: ManifestShape): true | string {
  const problems: string[] = []
  const { scene, oracle } = manifest
  const voiceEnd = scene.voice.startSec + scene.voice.durationSec
  const foleyEnd = scene.foley.startSec + scene.foley.durationSec

  if (voiceEnd > scene.durationSec) problems.push(`voice ends at ${voiceEnd}s past the ${scene.durationSec}s scene`)
  if (foleyEnd > scene.durationSec) problems.push(`foley ends at ${foleyEnd}s past the ${scene.durationSec}s scene`)
  if (voiceEnd > scene.foley.startSec) problems.push(`voice ends at ${voiceEnd}s after foley starts`)
  if (scene.voice.fadeSec * 2 > scene.voice.durationSec) problems.push("voice fades overlap each other")
  if (scene.foley.fadeSec * 2 > scene.foley.durationSec) problems.push("foley fades overlap each other")

  let previousTime = Number.NEGATIVE_INFINITY
  for (const point of scene.voice.trajectory) {
    if (point.timeSec <= previousTime) problems.push(`trajectory time ${point.timeSec}s does not advance`)
    if (point.timeSec < scene.voice.startSec || point.timeSec > voiceEnd) {
      problems.push(`trajectory time ${point.timeSec}s falls outside the voice stem`)
    }
    previousTime = point.timeSec
  }

  const windows = [
    ["oracle.trajectory.window", oracle.trajectory.window, scene.voice.startSec, voiceEnd],
    ["oracle.temporal.voiceWindow", oracle.temporal.voiceWindow, scene.voice.startSec, voiceEnd],
    ["oracle.temporal.gapWindow", oracle.temporal.gapWindow, voiceEnd, scene.foley.startSec],
    ["oracle.temporal.foleyWindow", oracle.temporal.foleyWindow, scene.foley.startSec, foleyEnd],
  ] as const
  for (const [label, window, lowerSec, upperSec] of windows) {
    if (window.endSec <= window.startSec) {
      problems.push(`${label} ends at ${window.endSec}s at or before its ${window.startSec}s start`)
    }
    if (window.endSec > scene.durationSec) {
      problems.push(`${label} ends at ${window.endSec}s past the ${scene.durationSec}s scene`)
    }
    if (window.startSec < lowerSec || window.endSec > upperSec) {
      problems.push(`${label} [${window.startSec}, ${window.endSec}] leaves [${lowerSec}, ${upperSec}]`)
    }
  }

  const windowFrames = Math.round(
    (oracle.trajectory.window.endSec - oracle.trajectory.window.startSec) * scene.sampleRateHz,
  )
  if (windowFrames % oracle.trajectory.blocks !== 0) {
    problems.push(`trajectory window of ${windowFrames} frames does not split into ${oracle.trajectory.blocks} blocks`)
  }
  if (oracle.wav.frames !== scene.durationSec * scene.sampleRateHz) {
    problems.push(`oracle expects ${oracle.wav.frames} frames for a ${scene.durationSec}s ${scene.sampleRateHz} Hz scene`)
  }
  if (oracle.wav.minPeak > oracle.wav.maxPeak) problems.push("oracle minPeak exceeds maxPeak")
  if (oracle.trajectory.minEdgeBalance > 1) problems.push("oracle minEdgeBalance exceeds the balance range")

  const controlIds = new Set<string>()
  const controlMutations = new Set<string>()
  for (const control of manifest.negativeControls) {
    if (controlIds.has(control.id)) problems.push(`duplicate negative control id ${control.id}`)
    if (controlMutations.has(control.mutation)) problems.push(`duplicate negative control mutation ${control.mutation}`)
    if (control.expectedFirstBadFrame >= oracle.wav.frames) {
      problems.push(`negative control ${control.id} expects frame ${control.expectedFirstBadFrame} past the render`)
    }
    controlIds.add(control.id)
    controlMutations.add(control.mutation)
  }

  try {
    assertRootsDisjoint(
      assertRootShape("artifacts.workspaceRoot", manifest.artifacts.workspaceRoot),
      assertRootShape("artifacts.proofRoot", manifest.artifacts.proofRoot),
    )
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error))
  }

  return problems.length === 0 ? true : problems.join("; ")
}

/** A receipt may not claim an enforced budget without the observations that prove it. */
function receiptCrossFieldReport(receipt: ReceiptShape): true | string {
  const problems: string[] = []
  const { observed } = receipt.replay.budget
  if (observed.enforced !== (observed.violations.length === 0)) {
    problems.push(`budget enforced=${observed.enforced} contradicts ${observed.violations.length} violations`)
  }
  const ids = receipt.hashes.source.bindings.map((entry) => entry.id)
  if (new Set(ids).size !== ids.length) problems.push("source bindings repeat an id")
  if (ids.some((id, index) => index > 0 && ids[index - 1] > id)) problems.push("source bindings are not sorted by id")
  if (bindingsDigest(receipt.hashes.source.bindings) !== receipt.hashes.source.digest) {
    problems.push("source digest does not cover the recorded bindings")
  }
  for (const preserved of receipt.cleanup.preserved) {
    if (preserved === receipt.cleanup.workspaceRoot || preserved.startsWith(`${receipt.cleanup.workspaceRoot}/`)) {
      problems.push(`preserved artifact ${preserved} lives in the removed workspace`)
    }
  }
  return problems.length === 0 ? true : problems.join("; ")
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Strip the scratch-directory prefix so digests compare across checkouts and hosts. */
function canonical(text: string, workspaceRoot: string): string {
  return text.split(workspaceRoot).join(WORKSPACE_TOKEN)
}

function sha256(value: string | Buffer | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex")
}

function absolute(repoRelativePath: string): string {
  return path.resolve(REPO_ROOT, repoRelativePath)
}

function assertTrue(condition: boolean, message: string): true {
  if (!condition) throw new Error(message)
  return true
}

/** `lstat`, not `exists`: a dangling symlink is present, and it is exactly what must be caught. */
function pathExists(candidate: string): boolean {
  try {
    lstatSync(candidate)
    return true
  } catch {
    return false
  }
}

/**
 * Bounded entry point. It runs the cell only inside a cgroup that already satisfies the declared
 * budget; otherwise it re-executes itself under `systemd-run --user --scope` carrying that budget,
 * and refuses when no such scope can be created.
 */
function main(): void {
  const manifest = COMPANION_VALIDATION_MANIFEST
  const violations = budgetViolations(observeBudget(), manifest.execution.budget)
  const bounded = boundedValidationCommand(manifest)

  if (violations.length === 0) {
    const receipt = runCompanionValidationCell()
    console.log(JSON.stringify({
      outcome: receipt.outcome,
      schema: receipt.hashes.schema,
      source: receipt.hashes.source.digest,
      pcm: receipt.hashes.output.passes[0].pcmSha256,
      deterministic: receipt.hashes.output.pcmIdentical,
      balance: [receipt.metrics.trajectory.firstBalance, receipt.metrics.trajectory.lastBalance],
      separationDb: receipt.metrics.temporal.separationDb,
      killed: receipt.negativeControls.map((control) => `${control.id}@${control.firstBadFrame}`),
      budget: receipt.replay.budget.observed,
      proof: receipt.cleanup.preserved,
    }))
    return
  }

  const alreadyBounded = process.env[COMPANION_VALIDATION_BOUNDED_ENV] === "1"
  if (alreadyBounded || process.platform !== "linux" || Bun.which("systemd-run") === null) {
    console.error(
      `validation cell refuses to run outside its declared budget (${violations.join("; ")}). ` +
        `Rerun from ${manifest.execution.packageDirectory} as: ${bounded.join(" ")}`,
    )
    process.exit(1)
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    [COMPANION_VALIDATION_BOUNDED_ENV]: "1",
  }
  if (env.XDG_RUNTIME_DIR === undefined) {
    const runtimeDir = `/run/user/${process.getuid?.() ?? -1}`
    if (pathExists(runtimeDir)) env.XDG_RUNTIME_DIR = runtimeDir
  }
  const child = Bun.spawnSync(bounded, {
    cwd: absolute(manifest.execution.packageDirectory),
    env,
    stdio: ["inherit", "inherit", "inherit"],
  })
  process.exit(child.exitCode ?? 1)
}

if (import.meta.main) main()
