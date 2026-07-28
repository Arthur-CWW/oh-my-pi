import { Schema } from "effect"
import type { SceneSpec } from "./schema"

export const VALIDATION_MANIFEST_VERSION = "scene-renderer.validation-cell.manifest.v1" as const
export const VALIDATION_RECEIPT_VERSION = "scene-renderer.validation-cell.receipt.v1" as const

// The proof location is fixed by the cell, not by the manifest: the runner must be able to
// invalidate a prior receipt before it has decoded (or failed to decode) any manifest at all.
export const VALIDATION_ARTIFACT_ROOT = "workflows/scene-lab/reports/2026-07-16-renderer-gaps/playground-validation-cell" as const
export const VALIDATION_RECEIPT_PATH = `${VALIDATION_ARTIFACT_ROOT}/receipt.json` as const
export const VALIDATION_ERRORS_PATH = `${VALIDATION_ARTIFACT_ROOT}/errors.log` as const
export const VALIDATION_MANIFEST_PATH = "packages/scene-renderer/validation/cells/two-beat-scene.v1.json" as const

const FiniteNumber = Schema.Number.check(Schema.isFinite())
const NonNegativeFiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const PositiveFiniteNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThan(0))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const Sha256 = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))
const EmptyStrings = Schema.Tuple([])
const SourceFile = Schema.Struct({ path: NonEmptyString, sha256: Sha256 })
const BeatCentroids = Schema.Tuple([
  FiniteNumber,
  FiniteNumber,
  FiniteNumber,
  FiniteNumber,
  FiniteNumber,
  FiniteNumber,
])

export const ValidationFrameMetricSchema = Schema.Struct({
  frame: NonNegativeInteger,
  bluePixels: NonNegativeInteger,
  blueCentroidX: Schema.NullOr(FiniteNumber),
  greenPixels: NonNegativeInteger,
  lumaMean: NonNegativeFiniteNumber,
  lumaMin: NonNegativeFiniteNumber,
  lumaMax: NonNegativeFiniteNumber,
  nonBlankPixels: NonNegativeInteger,
  alphaNonZeroPixels: NonNegativeInteger,
  finite: Schema.Boolean,
})

export type ValidationFrameMetric = Schema.Schema.Type<typeof ValidationFrameMetricSchema>

export const ValidationManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(VALIDATION_MANIFEST_VERSION),
  cellId: Schema.Literal("two-beat-scene"),
  requiredLayers: Schema.Tuple([
    Schema.Literal("state"),
    Schema.Literal("process"),
    Schema.Literal("render"),
  ]),
  scene: Schema.Struct({
    path: Schema.Literal("packages/scene-renderer/validation/scenes/two-beat.scene.json"),
    schemaVersion: Schema.Literal("scene.v1"),
    width: Schema.Literal(320),
    height: Schema.Literal(180),
    fps: Schema.Literal(12),
    durationSeconds: Schema.Literal(1),
    frameCount: Schema.Literal(12),
    beatDurationSeconds: Schema.Literal(0.5),
    beatBoundaryFrame: Schema.Literal(6),
    beatBoundariesSeconds: Schema.Tuple([Schema.Literal(0), Schema.Literal(0.5), Schema.Literal(1)]),
    secondBeatObjectIds: Schema.Tuple([Schema.Literal("blue-clones-beat-2")]),
  }),
  sources: Schema.Struct({
    manifestPath: Schema.Literal(VALIDATION_MANIFEST_PATH),
    runtimePath: Schema.Literal("packages/scene-renderer/dist/runtime.js"),
    runtimeEntry: Schema.Literal("packages/scene-renderer/src/runtime/index.ts"),
    rendererRoot: Schema.Literal("packages/scene-renderer/src"),
    packagePath: Schema.Literal("packages/scene-renderer/package.json"),
    lockPath: Schema.Literal("bun.lock"),
    dependencies: Schema.Tuple([
      Schema.Struct({ name: Schema.Literal("effect"), declared: NonEmptyString }),
      Schema.Struct({ name: Schema.Literal("puppeteer"), declared: NonEmptyString }),
      Schema.Struct({ name: Schema.Literal("three"), declared: NonEmptyString }),
    ]),
  }),
  host: Schema.Struct({
    platform: Schema.Literal("linux"),
    hostname: Schema.Literal("nixbox"),
    cgroupVersion: Schema.Literal(2),
    requiredControllers: Schema.Tuple([Schema.Literal("memory"), Schema.Literal("pids")]),
    requireDedicatedCgroup: Schema.Literal(true),
    minimumProcessTreeSize: PositiveInteger,
  }),
  assertions: Schema.Struct({
    state: Schema.Struct({
      deterministicEntropy: Schema.Struct({
        required: Schema.Literal(true),
        cloneSeeds: Schema.Tuple([Schema.Literal(101), Schema.Literal(202)]),
        cloneCounts: Schema.Tuple([Schema.Literal(3), Schema.Literal(3)]),
        cloneLayouts: Schema.Tuple([Schema.Literal("line"), Schema.Literal("line")]),
        postPass: Schema.Literal("halftone"),
        postPassMutation: Schema.Literal("post-pass-removed"),
        cloneMutation: Schema.Literal("clone-count-collapsed"),
        collapsedCloneCount: Schema.Literal(1),
      }),
      motion: Schema.Struct({
        blueMinimumPixels: PositiveInteger,
        expectedLocalCentroidX: BeatCentroids,
        centroidTolerancePixels: PositiveFiniteNumber,
        resetFrame: Schema.Literal(6),
      }),
      caption: Schema.Struct({
        color: Schema.Literal("#00ff44"),
        visibleStartFrame: Schema.Literal(3),
        visibleEndFrame: Schema.Literal(8),
        greenMinimumPixels: PositiveInteger,
        absentMaximumPixels: NonNegativeInteger,
      }),
      finiteMetricsRequired: Schema.Literal(true),
    }),
    process: Schema.Struct({
      cleanupRequired: Schema.Literal(true),
      errorsMustBeEmpty: Schema.Literal(true),
      nixboxEnvironment: Schema.Literal("nixbox"),
      renderPasses: Schema.Literal(5),
    }),
    render: Schema.Struct({
      width: Schema.Literal(320),
      height: Schema.Literal(180),
      frameCount: Schema.Literal(12),
      minimumMeanLuma: NonNegativeFiniteNumber,
      maximumMeanLuma: PositiveFiniteNumber,
      minimumNonBlankPixels: PositiveInteger,
      minimumAlphaNonZeroPixels: PositiveInteger,
      deterministicFrameHashes: Schema.Literal(true),
      deterministicMp4Hash: Schema.Literal(true),
    }),
  }),
  budgets: Schema.Struct({
    maxRenderMilliseconds: PositiveInteger,
    maxPeakRssBytes: PositiveInteger,
    maxFrameBytes: PositiveInteger,
    maxMp4Bytes: PositiveInteger,
    maxArtifactCount: PositiveInteger,
  }),
  artifacts: Schema.Struct({
    root: Schema.Literal(VALIDATION_ARTIFACT_ROOT),
    framesDirectory: Schema.Literal("workflows/scene-lab/reports/2026-07-16-renderer-gaps/playground-validation-cell/frames"),
    mp4Path: Schema.Literal("workflows/scene-lab/reports/2026-07-16-renderer-gaps/playground-validation-cell/two-beat.mp4"),
    gifPath: Schema.Literal("workflows/scene-lab/reports/2026-07-16-renderer-gaps/playground-validation-cell/two-beat.gif"),
    contactSheetPath: Schema.Literal("workflows/scene-lab/reports/2026-07-16-renderer-gaps/playground-validation-cell/contact-sheet.png"),
    metricsPath: Schema.Literal("workflows/scene-lab/reports/2026-07-16-renderer-gaps/playground-validation-cell/frame-metrics.json"),
    receiptPath: Schema.Literal(VALIDATION_RECEIPT_PATH),
    errorsPath: Schema.Literal(VALIDATION_ERRORS_PATH),
  }),
  negativeControl: Schema.Struct({
    mutation: Schema.Literal("double-offset-second-beat"),
    shiftSeconds: Schema.Literal(0.5),
    expectedFirstBadFrame: Schema.Literal(6),
  }),
})

export type ValidationManifest = Schema.Schema.Type<typeof ValidationManifestSchema>

export const ValidationReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal(VALIDATION_RECEIPT_VERSION),
  manifestVersion: Schema.Literal(VALIDATION_MANIFEST_VERSION),
  cellId: Schema.Literal("two-beat-scene"),
  outcome: Schema.Literal("passed"),
  proof: Schema.Struct({
    state: Schema.Struct({
      metrics: Schema.Array(ValidationFrameMetricSchema),
      entropy: Schema.Struct({
        cloneSeeds: Schema.Tuple([NonNegativeInteger, NonNegativeInteger]),
        cloneCounts: Schema.Tuple([PositiveInteger, PositiveInteger]),
        cloneLayouts: Schema.Tuple([NonEmptyString, NonEmptyString]),
        postPass: NonEmptyString,
        postPassApplied: Schema.Boolean,
        postPassMutation: Schema.Struct({
          mutation: NonEmptyString,
          firstDifferingFrame: NonNegativeInteger,
          differingFrameCount: NonNegativeInteger,
        }),
        cloneCountApplied: Schema.Boolean,
        cloneMutation: Schema.Struct({
          mutation: NonEmptyString,
          firstDifferingFrame: NonNegativeInteger,
          differingFrameCount: NonNegativeInteger,
          canonicalMinimumBluePixels: NonNegativeInteger,
          mutantMaximumBluePixels: NonNegativeInteger,
        }),
        deterministic: Schema.Boolean,
      }),
      motion: Schema.Struct({
        bluePresentEveryFrame: Schema.Boolean,
        beatResetFrame: NonNegativeInteger,
        beatResetObserved: Schema.Boolean,
      }),
      caption: Schema.Struct({
        visibleStartFrame: NonNegativeInteger,
        visibleEndFrame: NonNegativeInteger,
        onlyInExpectedInterval: Schema.Boolean,
      }),
      finiteMetrics: Schema.Boolean,
      negativeControl: Schema.Struct({
        mutation: Schema.Literal("double-offset-second-beat"),
        firstBadFrame: NonNegativeInteger,
      }),
    }),
    process: Schema.Struct({
      cleanupComplete: Schema.Boolean,
      priorReceiptRemoved: Schema.Boolean,
      errorsLogRead: Schema.Boolean,
      errorsLogBytes: NonNegativeInteger,
      processStarts: PositiveInteger,
      renderPasses: PositiveInteger,
      rendererPids: Schema.Array(PositiveInteger),
      peakProcessTreeSize: NonNegativeInteger,
      ownedProcessesRemaining: NonNegativeInteger,
      errors: EmptyStrings,
    }),
    render: Schema.Struct({
      dimensions: Schema.Struct({ width: PositiveInteger, height: PositiveInteger }),
      frameCount: PositiveInteger,
      luma: Schema.Struct({ minimum: NonNegativeFiniteNumber, maximum: NonNegativeFiniteNumber, mean: NonNegativeFiniteNumber }),
      nonBlank: Schema.Struct({ minimumPixels: NonNegativeInteger }),
      alpha: Schema.Struct({ minimumNonZeroPixels: NonNegativeInteger }),
      frameHashes: Schema.Struct({ firstRun: Schema.Array(Sha256), secondRun: Schema.Array(Sha256), equal: Schema.Boolean }),
      mp4Hashes: Schema.Struct({ firstRun: Sha256, secondRun: Sha256, equal: Schema.Boolean }),
      playableArtifacts: Schema.Struct({
        mp4Bytes: PositiveInteger,
        gifBytes: PositiveInteger,
        contactSheetBytes: PositiveInteger,
      }),
    }),
    budgets: Schema.Struct({
      renderMilliseconds: NonNegativeFiniteNumber,
      peakRssBytes: NonNegativeInteger,
      largestFrameBytes: NonNegativeInteger,
      mp4Bytes: NonNegativeInteger,
      artifactCount: NonNegativeInteger,
      withinLimits: Schema.Boolean,
    }),
    artifacts: Schema.Struct({
      root: NonEmptyString,
      framesDirectory: NonEmptyString,
      mp4Path: NonEmptyString,
      gifPath: NonEmptyString,
      contactSheetPath: NonEmptyString,
      metricsPath: NonEmptyString,
      receiptPath: NonEmptyString,
      errorsPath: NonEmptyString,
    }),
    sources: Schema.Struct({
      manifest: SourceFile,
      scene: SourceFile,
      runtime: Schema.Struct({ path: NonEmptyString, sha256: Sha256, bytes: PositiveInteger }),
      renderer: Schema.Struct({ root: NonEmptyString, fileCount: PositiveInteger, sha256: Sha256 }),
      package: SourceFile,
      lock: SourceFile,
      dependencies: Schema.Array(Schema.Struct({
        name: NonEmptyString,
        declared: NonEmptyString,
        resolved: NonEmptyString,
      })),
      digest: Sha256,
    }),
    host: Schema.Struct({
      platform: NonEmptyString,
      hostname: NonEmptyString,
      architecture: NonEmptyString,
      cgroupVersion: PositiveInteger,
      cgroupPath: NonEmptyString,
      controllers: Schema.Array(NonEmptyString),
      memoryMaxBytes: Schema.NullOr(PositiveInteger),
      memoryPeakBytes: PositiveInteger,
      memoryCurrentBytes: NonNegativeInteger,
      cpuQuotaMicroseconds: Schema.NullOr(PositiveInteger),
      cpuPeriodMicroseconds: PositiveInteger,
      pidsMax: Schema.NullOr(PositiveInteger),
      pidsPeak: PositiveInteger,
      cgroupProcessCount: PositiveInteger,
      foreignProcessCount: NonNegativeInteger,
    }),
    nixbox: Schema.Struct({
      environment: NonEmptyString,
      browserVersion: NonEmptyString,
      ffmpegVersion: NonEmptyString,
      bunVersion: NonEmptyString,
      frameFileCount: NonNegativeInteger,
      mp4FileCount: NonNegativeInteger,
      gifFileCount: NonNegativeInteger,
      contactSheetFileCount: NonNegativeInteger,
      metricsFileCount: NonNegativeInteger,
      errorsFileCount: NonNegativeInteger,
      receiptFileCount: NonNegativeInteger,
    }),
  }),
})

export type ValidationReceipt = Schema.Schema.Type<typeof ValidationReceiptSchema>
export type ValidationStateAssertions = ValidationManifest["assertions"]["state"]
export type ValidationProcessAssertions = ValidationManifest["assertions"]["process"]
export type ValidationRenderAssertions = ValidationManifest["assertions"]["render"]
export type ValidationStateProof = ValidationReceipt["proof"]["state"]
export type ValidationProcessProof = ValidationReceipt["proof"]["process"]
export type ValidationRenderProof = ValidationReceipt["proof"]["render"]
export type ValidationBudgetProof = ValidationReceipt["proof"]["budgets"]
export type ValidationArtifactProof = ValidationReceipt["proof"]["artifacts"]
export type ValidationNixboxProof = ValidationReceipt["proof"]["nixbox"]

const STRICT_DECODE_OPTIONS = { errors: "all", onExcessProperty: "error" } as const

export function decodeValidationManifest(input: unknown): ValidationManifest {
  return Schema.decodeUnknownSync(ValidationManifestSchema)(input, STRICT_DECODE_OPTIONS)
}

export function decodeValidationReceipt(input: unknown, manifest: ValidationManifest): ValidationReceipt {
  const receipt = Schema.decodeUnknownSync(ValidationReceiptSchema)(input, STRICT_DECODE_OPTIONS)
  assertReceiptInvariants(receipt, manifest)
  return receipt
}

export type BoundedExecutionPlan =
  | { readonly kind: "run" }
  | { readonly kind: "scope"; readonly memoryMaxBytes: number }
  | { readonly kind: "refuse"; readonly reason: string }

/**
 * Decides how `--bounded` executes. The flag is a promise that the render happens inside a
 * kernel-enforced cgroup, so a manifest the caller could not decode into a budget is a refusal: a
 * preflight that fails here must never degrade into the unbounded run the operator did not ask for.
 */
export function planBoundedExecution(
  manifest: ValidationManifest | null,
  argv: readonly string[],
  alreadyBounded: boolean,
): BoundedExecutionPlan {
  if (alreadyBounded || !argv.includes("--bounded")) return { kind: "run" }
  if (manifest === null) {
    return {
      kind: "refuse",
      reason: `--bounded requires the memory budget declared in ${VALIDATION_MANIFEST_PATH}, and it could not be read or decoded; refusing to run the cell outside the cgroup the flag promises`,
    }
  }
  return { kind: "scope", memoryMaxBytes: manifest.budgets.maxPeakRssBytes }
}

export function shiftSecondBeatKeyframes(scene: SceneSpec, manifest: ValidationManifest): SceneSpec {
  const cloned = structuredClone(scene)
  return {
    ...cloned,
    objects: cloned.objects.map((object) => manifest.scene.secondBeatObjectIds.some((id) => id === object.id)
      ? {
          ...object,
          tracks: object.tracks.map((track) => ({
            ...track,
            keyframes: track.keyframes?.map((keyframe) => ({
              ...keyframe,
              t: keyframe.t + manifest.scene.beatDurationSeconds,
            })),
          })),
        }
      : object),
  }
}

export function findFirstBadBeatLocalFrame(
  metrics: readonly ValidationFrameMetric[],
  manifest: ValidationManifest,
): number | null {
  const { frameCount, beatBoundaryFrame } = manifest.scene
  const { motion, caption } = manifest.assertions.state
  for (let frame = 0; frame < frameCount; frame += 1) {
    const metric = metrics[frame]
    if (metric === undefined || metric.frame !== frame || !metricIsFinite(metric)) return frame
    if (metric.bluePixels < motion.blueMinimumPixels || metric.blueCentroidX === null) return frame
    const localFrame = frame < beatBoundaryFrame ? frame : frame - beatBoundaryFrame
    const expectedCentroid = motion.expectedLocalCentroidX[localFrame]
    if (expectedCentroid === undefined || Math.abs(metric.blueCentroidX - expectedCentroid) > motion.centroidTolerancePixels) return frame
    const captionExpected = frame >= caption.visibleStartFrame && frame <= caption.visibleEndFrame
    if (captionExpected ? metric.greenPixels < caption.greenMinimumPixels : metric.greenPixels > caption.absentMaximumPixels) return frame
  }
  return metrics.length === frameCount ? null : frameCount
}

function metricIsFinite(metric: ValidationFrameMetric): boolean {
  return metric.finite
    && Number.isFinite(metric.frame)
    && Number.isFinite(metric.bluePixels)
    && (metric.blueCentroidX === null || Number.isFinite(metric.blueCentroidX))
    && Number.isFinite(metric.greenPixels)
    && Number.isFinite(metric.lumaMean)
    && Number.isFinite(metric.lumaMin)
    && Number.isFinite(metric.lumaMax)
    && Number.isFinite(metric.nonBlankPixels)
    && Number.isFinite(metric.alphaNonZeroPixels)
}

function assertReceiptInvariants(receipt: ValidationReceipt, manifest: ValidationManifest): void {
  const { state, process, render, budgets, artifacts, sources, host, nixbox } = receipt.proof
  invariant(receipt.outcome === "passed", "outcome must be passed")
  invariant(render.dimensions.width === manifest.scene.width && render.dimensions.height === manifest.scene.height, "dimensions must match manifest")
  invariant(render.frameCount === manifest.scene.frameCount && state.metrics.length === manifest.scene.frameCount, "frame count must match manifest")
  invariant(findFirstBadBeatLocalFrame(state.metrics, manifest) === null, "canonical frame metrics must satisfy beat-local rules")
  const declaredEntropy = manifest.assertions.state.deterministicEntropy
  invariant(state.entropy.cloneSeeds.every((seed, index) => seed === declaredEntropy.cloneSeeds[index])
    && state.entropy.cloneCounts.every((count, index) => count === declaredEntropy.cloneCounts[index])
    && state.entropy.cloneLayouts.every((layout, index) => layout === declaredEntropy.cloneLayouts[index])
    && state.entropy.postPass === declaredEntropy.postPass
    && state.entropy.deterministic, "entropy proof must match manifest")
  invariant(state.entropy.postPassApplied
    && state.entropy.postPassMutation.mutation === declaredEntropy.postPassMutation
    && state.entropy.postPassMutation.differingFrameCount > 0, "the manifest post pass must measurably alter rendered frames")
  invariant(state.entropy.cloneCountApplied
    && state.entropy.cloneMutation.mutation === declaredEntropy.cloneMutation
    && state.entropy.cloneMutation.differingFrameCount > 0
    && state.entropy.cloneMutation.mutantMaximumBluePixels < state.entropy.cloneMutation.canonicalMinimumBluePixels,
    "collapsing the manifest clone counts must remove rendered clone pixels")
  invariant(state.motion.bluePresentEveryFrame && state.motion.beatResetObserved
    && state.motion.beatResetFrame === manifest.scene.beatBoundaryFrame, "motion proof must include the beat reset")
  invariant(state.caption.onlyInExpectedInterval
    && state.caption.visibleStartFrame === manifest.assertions.state.caption.visibleStartFrame
    && state.caption.visibleEndFrame === manifest.assertions.state.caption.visibleEndFrame, "caption proof must match manifest")
  invariant(state.finiteMetrics && state.metrics.every(metricIsFinite), "all frame metrics must be finite")
  invariant(state.negativeControl.mutation === manifest.negativeControl.mutation
    && state.negativeControl.firstBadFrame === manifest.negativeControl.expectedFirstBadFrame
    && state.negativeControl.firstBadFrame === manifest.scene.beatBoundaryFrame, "negative control must first fail at the beat boundary")
  invariant(process.cleanupComplete && process.ownedProcessesRemaining === 0, "process cleanup must complete with no surviving owned process")
  invariant(process.peakProcessTreeSize >= manifest.host.minimumProcessTreeSize, "the renderer process tree must be observed, not self-reported")
  invariant(process.errorsLogRead && process.errorsLogBytes === 0
    && process.processStarts > 0
    && process.renderPasses === manifest.assertions.process.renderPasses
    && process.rendererPids.length === process.renderPasses, "process proof must include bounded render passes and an empty read errors log")
  invariant(process.errors.length === 0, "errors log must be empty")
  invariant(render.luma.minimum <= render.luma.mean && render.luma.mean <= render.luma.maximum
    && render.luma.mean >= manifest.assertions.render.minimumMeanLuma
    && render.luma.mean <= manifest.assertions.render.maximumMeanLuma, "luma proof must satisfy manifest bounds")
  invariant(render.nonBlank.minimumPixels >= manifest.assertions.render.minimumNonBlankPixels, "nonblank proof must satisfy manifest minimum")
  invariant(render.alpha.minimumNonZeroPixels >= manifest.assertions.render.minimumAlphaNonZeroPixels, "alpha proof must satisfy manifest minimum")
  invariant(render.frameHashes.equal
    && render.frameHashes.firstRun.length === manifest.scene.frameCount
    && render.frameHashes.secondRun.length === manifest.scene.frameCount
    && render.frameHashes.firstRun.every((hash, index) => hash === render.frameHashes.secondRun[index]), "frame hashes must be deterministic")
  invariant(render.mp4Hashes.equal && render.mp4Hashes.firstRun === render.mp4Hashes.secondRun, "MP4 hashes must be deterministic")
  invariant(render.playableArtifacts.mp4Bytes > 0
    && render.playableArtifacts.gifBytes > 0
    && render.playableArtifacts.contactSheetBytes > 0, "playable MP4, GIF, and contact sheet must be nonempty")
  invariant(budgets.withinLimits
    && budgets.renderMilliseconds <= manifest.budgets.maxRenderMilliseconds
    && budgets.peakRssBytes <= manifest.budgets.maxPeakRssBytes
    && budgets.largestFrameBytes <= manifest.budgets.maxFrameBytes
    && budgets.mp4Bytes <= manifest.budgets.maxMp4Bytes
    && budgets.artifactCount <= manifest.budgets.maxArtifactCount, "measured budgets must be within manifest limits")
  invariant(artifacts.root === manifest.artifacts.root
    && artifacts.framesDirectory === manifest.artifacts.framesDirectory
    && artifacts.gifPath === manifest.artifacts.gifPath
    && artifacts.contactSheetPath === manifest.artifacts.contactSheetPath
    && artifacts.mp4Path === manifest.artifacts.mp4Path
    && artifacts.metricsPath === manifest.artifacts.metricsPath
    && artifacts.receiptPath === manifest.artifacts.receiptPath
    && artifacts.errorsPath === manifest.artifacts.errorsPath, "artifact paths must match manifest")
  invariant(nixbox.environment === manifest.assertions.process.nixboxEnvironment
    && nixbox.frameFileCount === manifest.scene.frameCount
    && nixbox.mp4FileCount === 1
    && nixbox.gifFileCount === 1
    && nixbox.contactSheetFileCount === 1
    && nixbox.metricsFileCount === 1
    && nixbox.errorsFileCount === 1
    && nixbox.receiptFileCount === 1, "Nixbox environment and artifact counts must match manifest")
  invariant(host.platform === manifest.host.platform && host.hostname === manifest.host.hostname,
    "receipt must be produced on the declared host")
  invariant(host.cgroupVersion === manifest.host.cgroupVersion
    && manifest.host.requiredControllers.every((controller) => host.controllers.includes(controller)),
    "cgroup controllers must be observed on the validated host")
  invariant(!manifest.host.requireDedicatedCgroup || host.foreignProcessCount === 0,
    "the observed cgroup must hold only the validated process tree")
  invariant(host.memoryPeakBytes <= manifest.budgets.maxPeakRssBytes
    && (host.memoryMaxBytes === null || host.memoryMaxBytes <= manifest.budgets.maxPeakRssBytes),
    "observed cgroup memory must stay within the manifest budget")
  invariant(sources.manifest.path === manifest.sources.manifestPath
    && sources.scene.path === manifest.scene.path
    && sources.runtime.path === manifest.sources.runtimePath
    && sources.renderer.root === manifest.sources.rendererRoot
    && sources.package.path === manifest.sources.packagePath
    && sources.lock.path === manifest.sources.lockPath, "source digests must cover the manifest-declared paths")
  invariant(sources.renderer.fileCount > 0 && sources.runtime.bytes > 0, "renderer sources and runtime bundle must be non-empty")
  invariant(sources.dependencies.length === manifest.sources.dependencies.length
    && manifest.sources.dependencies.every((dependency, index) => sources.dependencies[index]?.name === dependency.name
      && sources.dependencies[index]?.declared === dependency.declared
      && (sources.dependencies[index]?.resolved.length ?? 0) > 0),
    "resolved dependency versions must match the declared dependency closure")
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`invalid validation receipt: ${message}`)
}

export interface SceneEntropyObservation {
  readonly cloneSeeds: readonly number[]
  readonly cloneCounts: readonly number[]
  readonly cloneLayouts: readonly string[]
  readonly postPasses: readonly string[]
}

export function observeSceneEntropy(scene: SceneSpec): SceneEntropyObservation {
  const clones = scene.objects.flatMap((object) => object.clone === undefined ? [] : [object.clone])
  return {
    cloneSeeds: clones.map((clone) => clone.seed),
    cloneCounts: clones.map((clone) => clone.count),
    cloneLayouts: clones.map((clone) => clone.layout),
    postPasses: scene.post.map((entry) => entry.pass),
  }
}

export function removePostPasses(scene: SceneSpec): SceneSpec {
  return { ...structuredClone(scene), post: [] }
}

export function collapseCloneCounts(scene: SceneSpec, manifest: ValidationManifest): SceneSpec {
  const cloned = structuredClone(scene)
  return {
    ...cloned,
    objects: cloned.objects.map((object) => object.clone === undefined
      ? object
      : { ...object, clone: { ...object.clone, count: manifest.assertions.state.deterministicEntropy.collapsedCloneCount } }),
  }
}
