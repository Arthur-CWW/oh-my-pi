import { describe, expect, test } from "bun:test"
import { decodeSceneSpec } from "../src/schema"
import {
  VALIDATION_MANIFEST_VERSION,
  VALIDATION_RECEIPT_VERSION,
  collapseCloneCounts,
  decodeValidationManifest,
  decodeValidationReceipt,
  findFirstBadBeatLocalFrame,
  observeSceneEntropy,
  removePostPasses,
  shiftSecondBeatKeyframes,
  type ValidationFrameMetric,
} from "../src/validation-cell"

const manifestInput: unknown = await Bun.file(new URL("../validation/cells/two-beat-scene.v1.json", import.meta.url)).json()
const sceneInput: unknown = await Bun.file(new URL("../validation/scenes/two-beat.scene.json", import.meta.url)).json()
const manifest = decodeValidationManifest(manifestInput)
const scene = decodeSceneSpec(sceneInput)
const canonicalMetrics: readonly ValidationFrameMetric[] = Array.from({ length: 12 }, (_, frame) => ({
  frame,
  bluePixels: 300,
  blueCentroidX: manifest.assertions.state.motion.expectedLocalCentroidX[frame % 6] ?? null,
  greenPixels: frame >= 3 && frame <= 8 ? 80 : 0,
  lumaMean: 16,
  lumaMin: 0,
  lumaMax: 255,
  nonBlankPixels: 300,
  alphaNonZeroPixels: 57_600,
  finite: true,
}))

const frameHash = "a".repeat(64)
const mp4Hash = "b".repeat(64)
const validReceipt = {
  schemaVersion: VALIDATION_RECEIPT_VERSION,
  manifestVersion: VALIDATION_MANIFEST_VERSION,
  cellId: "two-beat-scene",
  outcome: "passed",
  proof: {
    state: {
      metrics: canonicalMetrics,
      entropy: {
        cloneSeeds: [101, 202],
        cloneCounts: [3, 3],
        cloneLayouts: ["line", "line"],
        postPass: "halftone",
        postPassApplied: true,
        postPassMutation: { mutation: "post-pass-removed", firstDifferingFrame: 0, differingFrameCount: 12 },
        cloneCountApplied: true,
        cloneMutation: {
          mutation: "clone-count-collapsed",
          firstDifferingFrame: 0,
          differingFrameCount: 12,
          canonicalMinimumBluePixels: 300,
          mutantMaximumBluePixels: 112,
        },
        deterministic: true,
      },
      motion: { bluePresentEveryFrame: true, beatResetFrame: 6, beatResetObserved: true },
      caption: { visibleStartFrame: 3, visibleEndFrame: 8, onlyInExpectedInterval: true },
      finiteMetrics: true,
      negativeControl: { mutation: "double-offset-second-beat", firstBadFrame: 6 },
    },
    process: {
      cleanupComplete: true,
      priorReceiptRemoved: true,
      errorsLogRead: true,
      errorsLogBytes: 0,
      processStarts: 15,
      renderPasses: 5,
      rendererPids: [41_001, 41_002, 41_003, 41_004, 41_005],
      peakProcessTreeSize: 9,
      ownedProcessesRemaining: 0,
      errors: [],
    },
    render: {
      dimensions: { width: 320, height: 180 },
      frameCount: 12,
      luma: { minimum: 0, maximum: 255, mean: 16 },
      nonBlank: { minimumPixels: 300 },
      alpha: { minimumNonZeroPixels: 57_600 },
      frameHashes: { firstRun: Array(12).fill(frameHash), secondRun: Array(12).fill(frameHash), equal: true },
      mp4Hashes: { firstRun: mp4Hash, secondRun: mp4Hash, equal: true },
      playableArtifacts: { mp4Bytes: 1_000_000, gifBytes: 500_000, contactSheetBytes: 100_000 },
    },
    budgets: {
      renderMilliseconds: 1_000,
      peakRssBytes: 100_000_000,
      largestFrameBytes: 100_000,
      mp4Bytes: 1_000_000,
      artifactCount: 18,
      withinLimits: true,
    },
    artifacts: { ...manifest.artifacts },
    sources: {
      manifest: { path: manifest.sources.manifestPath, sha256: "1".repeat(64) },
      scene: { path: manifest.scene.path, sha256: "2".repeat(64) },
      runtime: { path: manifest.sources.runtimePath, sha256: "3".repeat(64), bytes: 1_400_000 },
      renderer: { root: manifest.sources.rendererRoot, fileCount: 28, sha256: "4".repeat(64) },
      package: { path: manifest.sources.packagePath, sha256: "5".repeat(64) },
      lock: { path: manifest.sources.lockPath, sha256: "6".repeat(64) },
      dependencies: manifest.sources.dependencies.map((dependency) => ({ ...dependency, resolved: "1.2.3" })),
      digest: "7".repeat(64),
    },
    host: {
      platform: "linux",
      hostname: "nixbox",
      architecture: "x64",
      cgroupVersion: 2,
      cgroupPath: "/user.slice/user-1000.slice/user@1000.service/app.slice/run-p1.scope",
      controllers: ["cpu", "memory", "pids"],
      memoryMaxBytes: 1_610_612_736,
      memoryPeakBytes: 900_000_000,
      memoryCurrentBytes: 8_000_000,
      cpuQuotaMicroseconds: 400_000,
      cpuPeriodMicroseconds: 100_000,
      pidsMax: null,
      pidsPeak: 42,
      cgroupProcessCount: 3,
      foreignProcessCount: 0,
    },
    nixbox: {
      environment: "nixbox",
      browserVersion: "Chromium 150.0.7871.124",
      ffmpegVersion: "ffmpeg version 8.1.1",
      bunVersion: "1.3.13",
      frameFileCount: 12,
      mp4FileCount: 1,
      gifFileCount: 1,
      contactSheetFileCount: 1,
      metricsFileCount: 1,
      errorsFileCount: 1,
      receiptFileCount: 1,
    },
  },
}

function withState(state: Record<string, unknown>): unknown {
  return { ...validReceipt, proof: { ...validReceipt.proof, state: { ...validReceipt.proof.state, ...state } } }
}

function withProcess(processProof: Record<string, unknown>): unknown {
  return { ...validReceipt, proof: { ...validReceipt.proof, process: { ...validReceipt.proof.process, ...processProof } } }
}

function withHost(host: Record<string, unknown>): unknown {
  return { ...validReceipt, proof: { ...validReceipt.proof, host: { ...validReceipt.proof.host, ...host } } }
}

function withSources(sources: Record<string, unknown>): unknown {
  return { ...validReceipt, proof: { ...validReceipt.proof, sources: { ...validReceipt.proof.sources, ...sources } } }
}

describe("validation cell contract", () => {
  test("strictly decodes the versioned manifest and real scene spec", () => {
    expect(manifest.schemaVersion).toBe(VALIDATION_MANIFEST_VERSION)
    expect(manifest.requiredLayers).toEqual(["state", "process", "render"])
    expect(manifest.host.platform).toBe("linux")
    expect(manifest.sources.dependencies.map((dependency) => dependency.name)).toEqual(["effect", "puppeteer", "three"])
    expect(scene.schemaVersion).toBe("scene.v1")
    expect(scene.timeline.beats).toEqual([0, 0.5, 1])
    expect(scene.objects.map((object) => object.id)).toEqual([
      "blue-clones-beat-1",
      "blue-clones-beat-2",
      "beat-caption",
    ])
    expect(() => decodeValidationManifest({ ...manifest, extra: true })).toThrow()
    expect(() => decodeValidationManifest({ ...manifest, schemaVersion: "scene-renderer.validation-cell.manifest.v2" })).toThrow()
    expect(() => decodeSceneSpec({ ...scene, schemaVersion: "scene.v2" })).toThrow()
  })

  test("accepts a complete receipt only when its cross-field proof agrees", () => {
    const receipt = decodeValidationReceipt(validReceipt, manifest)
    expect(receipt.outcome).toBe("passed")
    expect(receipt.proof.render.frameHashes.firstRun).toEqual(receipt.proof.render.frameHashes.secondRun)

    expect(() => decodeValidationReceipt(withState({
      negativeControl: { mutation: "double-offset-second-beat", firstBadFrame: 7 },
    }), manifest)).toThrow(/negative control/)
  })

  test("deeply clones the scene and shifts every second-beat keyframe exactly once", () => {
    const originalSecond = scene.objects.find((object) => object.id === "blue-clones-beat-2")
    const originalTimes = originalSecond?.tracks.flatMap((track) => track.keyframes?.map((keyframe) => keyframe.t) ?? [])
    const shifted = shiftSecondBeatKeyframes(scene, manifest)
    const shiftedSecond = shifted.objects.find((object) => object.id === "blue-clones-beat-2")
    const shiftedTimes = shiftedSecond?.tracks.flatMap((track) => track.keyframes?.map((keyframe) => keyframe.t) ?? [])

    expect(shifted).not.toBe(scene)
    expect(shifted.objects[0]).not.toBe(scene.objects[0])
    expect(shiftedSecond).not.toBe(originalSecond)
    expect(originalTimes).toEqual([0.5, 0.9166666666666666, 0, 0.4166666666666667, 0.5, 0.9166666666666666])
    expect(shiftedTimes).toEqual([1, 1.4166666666666665, 0.5, 0.9166666666666667, 1, 1.4166666666666665])
    expect(scene.objects.find((object) => object.id === "blue-clones-beat-2")?.tracks.flatMap((track) => track.keyframes?.map((keyframe) => keyframe.t) ?? [])).toEqual(originalTimes)
  })

  test("finds frame 6 as the double-offset mutant's first bad beat-local frame", () => {
    expect(findFirstBadBeatLocalFrame(canonicalMetrics, manifest)).toBeNull()
    const mutantMetrics = canonicalMetrics.map((metric) => metric.frame === 6
      ? { ...metric, bluePixels: 0, blueCentroidX: null }
      : metric)
    expect(findFirstBadBeatLocalFrame(mutantMetrics, manifest)).toBe(6)
  })

  test("reads clone seeds, counts, layouts, and the post chain out of the scene source", () => {
    const entropy = observeSceneEntropy(scene)
    expect(entropy.cloneSeeds).toEqual([...manifest.assertions.state.deterministicEntropy.cloneSeeds])
    expect(entropy.cloneCounts).toEqual([...manifest.assertions.state.deterministicEntropy.cloneCounts])
    expect(entropy.cloneLayouts).toEqual([...manifest.assertions.state.deterministicEntropy.cloneLayouts])
    expect(entropy.postPasses).toEqual([manifest.assertions.state.deterministicEntropy.postPass])
  })

  test("builds entropy mutants without mutating the canonical scene", () => {
    const withoutPost = removePostPasses(scene)
    const collapsed = collapseCloneCounts(scene, manifest)

    expect(withoutPost.post).toEqual([])
    expect(observeSceneEntropy(collapsed).cloneCounts).toEqual([1, 1])
    expect(observeSceneEntropy(collapsed).cloneSeeds).toEqual([...manifest.assertions.state.deterministicEntropy.cloneSeeds])
    expect(collapsed.objects[0]).not.toBe(scene.objects[0])
    expect(observeSceneEntropy(scene).cloneCounts).toEqual([3, 3])
    expect(scene.post.map((entry) => entry.pass)).toEqual(["halftone"])
  })

  test("rejects entropy proofs that are copied rather than observed", () => {
    expect(() => decodeValidationReceipt(withState({
      entropy: { ...validReceipt.proof.state.entropy, cloneSeeds: [1, 2] },
    }), manifest)).toThrow(/entropy proof must match manifest/)
    expect(() => decodeValidationReceipt(withState({
      entropy: { ...validReceipt.proof.state.entropy, cloneCounts: [1, 1] },
    }), manifest)).toThrow(/entropy proof must match manifest/)
    expect(() => decodeValidationReceipt(withState({
      entropy: { ...validReceipt.proof.state.entropy, postPassApplied: false },
    }), manifest)).toThrow(/post pass must measurably alter/)
    expect(() => decodeValidationReceipt(withState({
      entropy: {
        ...validReceipt.proof.state.entropy,
        postPassMutation: { mutation: "post-pass-removed", firstDifferingFrame: 12, differingFrameCount: 0 },
      },
    }), manifest)).toThrow(/post pass must measurably alter/)
    expect(() => decodeValidationReceipt(withState({
      entropy: {
        ...validReceipt.proof.state.entropy,
        cloneMutation: { ...validReceipt.proof.state.entropy.cloneMutation, mutantMaximumBluePixels: 300 },
      },
    }), manifest)).toThrow(/remove rendered clone pixels/)
  })

  test("rejects receipts that cannot be bound to the validated source tree", () => {
    expect(() => decodeValidationReceipt(withSources({
      scene: { path: "packages/scene-renderer/validation/scenes/other.scene.json", sha256: "2".repeat(64) },
    }), manifest)).toThrow(/source digests must cover/)
    expect(() => decodeValidationReceipt(withSources({
      runtime: { path: "packages/scene-renderer/dist/other.js", sha256: "3".repeat(64), bytes: 10 },
    }), manifest)).toThrow(/source digests must cover/)
    expect(() => decodeValidationReceipt(withSources({
      dependencies: manifest.sources.dependencies.map((dependency, index) => ({
        ...dependency,
        declared: index === 0 ? "^5.0.0" : dependency.declared,
        resolved: "1.2.3",
      })),
    }), manifest)).toThrow(/dependency closure/)
  })

  test("rejects process proofs that claim unobserved ownership or cleanup", () => {
    expect(() => decodeValidationReceipt(withProcess({ peakProcessTreeSize: 1 }), manifest)).toThrow(/process tree must be observed/)
    expect(() => decodeValidationReceipt(withProcess({ ownedProcessesRemaining: 2 }), manifest)).toThrow(/surviving owned process/)
    expect(() => decodeValidationReceipt(withProcess({ renderPasses: 3, rendererPids: [1, 2, 3] }), manifest)).toThrow(/bounded render passes/)
  })

  test("rejects receipts produced outside the declared bounded host", () => {
    expect(() => decodeValidationReceipt(withHost({ platform: "darwin" }), manifest)).toThrow(/declared host/)
    expect(() => decodeValidationReceipt(withHost({ hostname: "macbook" }), manifest)).toThrow(/declared host/)
    expect(() => decodeValidationReceipt(withHost({ controllers: ["cpu"] }), manifest)).toThrow(/cgroup controllers/)
    expect(() => decodeValidationReceipt(withHost({ foreignProcessCount: 3 }), manifest)).toThrow(/only the validated process tree/)
    expect(() => decodeValidationReceipt(withHost({
      memoryPeakBytes: manifest.budgets.maxPeakRssBytes + 1,
    }), manifest)).toThrow(/within the manifest budget/)
    expect(() => decodeValidationReceipt(withHost({
      memoryMaxBytes: manifest.budgets.maxPeakRssBytes * 2,
    }), manifest)).toThrow(/within the manifest budget/)
  })
})
