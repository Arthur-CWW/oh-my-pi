import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import {
  appendFile,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { hostname, tmpdir } from "node:os"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { decodeSceneSpec, parseJsonText, type SceneSpec } from "./schema"
import {
  collapseCloneCounts,
  decodeValidationManifest,
  decodeValidationReceipt,
  findFirstBadBeatLocalFrame,
  observeSceneEntropy,
  removePostPasses,
  shiftSecondBeatKeyframes,
  VALIDATION_ARTIFACT_ROOT,
  VALIDATION_ERRORS_PATH,
  VALIDATION_MANIFEST_VERSION,
  VALIDATION_RECEIPT_PATH,
  VALIDATION_RECEIPT_VERSION,
  type SceneEntropyObservation,
  type ValidationFrameMetric,
  type ValidationManifest,
  type ValidationReceipt,
} from "./validation-cell"

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../..")
const DEFAULT_MANIFEST_PATH = join(PACKAGE_ROOT, "validation/cells/two-beat-scene.v1.json")
const CGROUP_ROOT = "/sys/fs/cgroup"
const MAX_TEXT_OUTPUT_BYTES = 1024 * 1024
const RAW_FRAME_OUTPUT_BYTES = 8 * 1024 * 1024
const RECEIPT_STAGING_SUFFIX = ".staging"

interface CommandResult {
  readonly pid: number
  readonly stdout: Buffer
  readonly stderr: Buffer
  readonly elapsedMilliseconds: number
  readonly peakRssBytes: number
  readonly peakProcessCount: number
}

interface CommandOptions {
  readonly cwd: string
  readonly env?: NodeJS.ProcessEnv
  readonly timeoutMilliseconds: number
  readonly maxStdoutBytes?: number
  readonly maxStderrBytes?: number
  readonly runId?: string
}

interface ValidationCellRunOptions {
  readonly manifestPath?: string
  readonly repositoryRoot?: string
  readonly runtimePath?: string
  readonly environment?: string
}

interface FrameSetAnalysis {
  readonly metrics: readonly ValidationFrameMetric[]
  readonly rawBytes: number
}

interface ProbeStream {
  readonly width: number
  readonly height: number
  readonly nb_read_frames?: string
  readonly nb_frames?: string
}

interface ProbeOutput {
  readonly streams?: readonly ProbeStream[]
}

interface ProcessInfo {
  readonly pid: number
  readonly parentPid: number
  readonly rssBytes: number
}

interface ProcessTreeMeasurement {
  readonly rssBytes: number
  readonly processCount: number
}

interface FrameHashDifference {
  readonly firstDifferingFrame: number
  readonly differingFrameCount: number
}

export interface HostFacts {
  readonly platform: string
  readonly hostname: string
  readonly architecture: string
  readonly cgroupVersion: number
  readonly cgroupPath: string
  readonly controllers: readonly string[]
  readonly memoryMaxBytes: number | null
  readonly memoryPeakBytes: number
  readonly memoryCurrentBytes: number
  readonly cpuQuotaMicroseconds: number | null
  readonly cpuPeriodMicroseconds: number
  readonly pidsMax: number | null
  readonly pidsPeak: number
  readonly cgroupProcessCount: number
  readonly foreignProcessCount: number
}

export interface SourceDigestProof {
  readonly manifest: { readonly path: string; readonly sha256: string }
  readonly scene: { readonly path: string; readonly sha256: string }
  readonly runtime: { readonly path: string; readonly sha256: string; readonly bytes: number }
  readonly renderer: { readonly root: string; readonly fileCount: number; readonly sha256: string }
  readonly package: { readonly path: string; readonly sha256: string }
  readonly lock: { readonly path: string; readonly sha256: string }
  readonly dependencies: readonly { readonly name: string; readonly declared: string; readonly resolved: string }[]
  readonly digest: string
}

export interface StagedSource {
  /** Declared repository-relative path, or the mutation label for a generated scene. */
  readonly label: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export async function runSceneValidationCell(options: ValidationCellRunOptions = {}): Promise<ValidationReceipt> {
  const repositoryRoot = resolve(options.repositoryRoot ?? REPOSITORY_ROOT)
  const artifactRoot = resolveContained(repositoryRoot, VALIDATION_ARTIFACT_ROOT)
  const receiptArtifactPath = resolveContained(repositoryRoot, VALIDATION_RECEIPT_PATH)
  const errorsPath = resolveContained(repositoryRoot, VALIDATION_ERRORS_PATH)
  assertArtifactRootSafe(repositoryRoot, artifactRoot)

  // The proof location is a cell constant rather than a manifest field, so the prior receipt dies
  // before this invocation has read — or failed to decode — a single manifest byte.
  const priorReceiptRemoved = await revokePublishedReceipt("", repositoryRoot)

  // Chromium's process-singleton Unix socket must remain below the platform path limit.
  const workspace = await mkdtemp(join(tmpdir(), "srv-"))
  const processTmp = join(workspace, "p")
  const firstOut = join(workspace, "canonical-a")
  const secondOut = join(workspace, "canonical-b")
  const beatMutantOut = join(workspace, "double-offset-mutant")
  const postMutantOut = join(workspace, "post-pass-removed-mutant")
  const cloneMutantOut = join(workspace, "clone-count-collapsed-mutant")
  const beatMutantSceneName = "double-offset.scene.json"
  const postMutantSceneName = "post-pass-removed.scene.json"
  const cloneMutantSceneName = "clone-count-collapsed.scene.json"
  const activeRunIds = new Set<string>()
  const allRunIds: string[] = []
  const rendererPids: number[] = []
  let peakRssBytes = 0
  let peakProcessTreeSize = 0
  let processStarts = 0
  const startedAt = performance.now()

  const runCommand = async (command: string, args: readonly string[], commandOptions: Omit<CommandOptions, "cwd"> & { readonly cwd?: string }): Promise<CommandResult> => {
    processStarts += 1
    const result = await runBoundedCommand(command, args, { ...commandOptions, cwd: commandOptions.cwd ?? PACKAGE_ROOT })
    peakRssBytes = Math.max(peakRssBytes, result.peakRssBytes)
    peakProcessTreeSize = Math.max(peakProcessTreeSize, result.peakProcessCount)
    return result
  }

  try {
    const manifestPath = resolve(options.manifestPath ?? DEFAULT_MANIFEST_PATH)
    const manifestBytes = await readFile(manifestPath)
    const manifest = decodeValidationManifest(parseJsonText(manifestBytes.toString("utf8")))
    if (resolveContained(repositoryRoot, manifest.sources.manifestPath) !== manifestPath) {
      throw new Error(`manifest ${manifestPath} is not the cell source declared by the manifest (${manifest.sources.manifestPath})`)
    }
    const declaredRuntimePath = resolveContained(repositoryRoot, manifest.sources.runtimePath)
    if (options.runtimePath !== undefined && resolve(options.runtimePath) !== declaredRuntimePath) {
      throw new Error(`runtime ${resolve(options.runtimePath)} is not the runtime bundle declared by the manifest (${manifest.sources.runtimePath})`)
    }
    const rendererRoot = resolveContained(repositoryRoot, manifest.sources.rendererRoot)
    const rendererPackageRoot = dirname(rendererRoot)

    // Render only from immutable copies digested in place: the bytes hashed into the receipt are the
    // same bytes every render opens, so a declared source replaced after preflight can never be
    // certified by this run.
    const declaredScenePath = resolveContained(repositoryRoot, manifest.scene.path)
    const stagedScene = await stageRenderInput(declaredScenePath, manifest.scene.path, workspace, "canonical.scene.json")
    const stagedRuntime = await stageRenderInput(declaredRuntimePath, manifest.sources.runtimePath, workspace, "runtime.js")
    const sceneText = await readFile(stagedScene.path, "utf8")
    const scene = decodeSceneSpec(parseJsonText(sceneText))
    const entropy = observeSceneEntropy(scene)
    assertSceneMatchesManifest(scene, entropy, manifest)
    const sources = await digestSources(repositoryRoot, manifest, manifestBytes, stagedScene, stagedRuntime)
    assertSupportedHost(await observeHost(), manifest)

    const browserExecutable = process.env.PUPPETEER_EXECUTABLE_PATH
    if (!browserExecutable || !isAbsolute(browserExecutable)) {
      throw new Error("PUPPETEER_EXECUTABLE_PATH must name the absolute Chromium executable from the Nix closure")
    }
    await stat(browserExecutable)

    await rm(artifactRoot, { recursive: true, force: true })
    await mkdir(processTmp, { recursive: true })
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(errorsPath, "")

    const declaredEntropy = manifest.assertions.state.deterministicEntropy
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      TMPDIR: processTmp,
      PUPPETEER_EXECUTABLE_PATH: browserExecutable,
    }
    const render = async (spec: StagedSource, outDir: string, label: string): Promise<void> => {
      // The renderer verifies the digest of the bytes it just read, in the process that renders them:
      // check-then-open here would leave a window for a same-user process to swap the file in between.
      const runId = `scene-validation-${process.pid}-${label}`
      activeRunIds.add(runId)
      allRunIds.push(runId)
      const result = await runCommand(
        process.execPath,
        [
          "src/render.ts",
          "--scene", spec.path,
          "--scene-sha256", spec.sha256,
          "--out", outDir,
          "--runtime", stagedRuntime.path,
          "--runtime-sha256", stagedRuntime.sha256,
          "--keep-frames",
        ],
        {
          cwd: rendererPackageRoot,
          env: { ...baseEnv, SCENE_VALIDATION_RUN_ID: runId },
          timeoutMilliseconds: Math.min(60_000, manifest.budgets.maxRenderMilliseconds),
          runId,
        },
      )
      rendererPids.push(result.pid)
      const stderr = result.stderr.toString("utf8").trim()
      if (stderr.length > 0) throw new Error(`${label} renderer wrote stderr:\n${stderr}`)
      await waitForOwnedProcessesToExit(runId, 5_000)
      activeRunIds.delete(runId)
    }
    const renderMutant = async (mutantScene: SceneSpec, name: string, outDir: string, label: string): Promise<void> => {
      const staged = await writeStagedScene(workspace, name, `${JSON.stringify(mutantScene, null, 2)}\n`, `${label} mutant scene`)
      await render(staged, outDir, label)
    }

    await render(stagedScene, firstOut, "canonical-a")
    await render(stagedScene, secondOut, "canonical-b")
    await renderMutant(shiftSecondBeatKeyframes(scene, manifest), beatMutantSceneName, beatMutantOut, manifest.negativeControl.mutation)
    await renderMutant(removePostPasses(scene), postMutantSceneName, postMutantOut, declaredEntropy.postPassMutation)
    await renderMutant(collapseCloneCounts(scene, manifest), cloneMutantSceneName, cloneMutantOut, declaredEntropy.cloneMutation)

    // The receipt names declared repository paths for every byte it certifies. Prove all of them still
    // hold exactly those bytes now the last frame has landed, so the provenance a later reader
    // re-hashes is the provenance this run rendered.
    await assertSourcesUnchanged(repositoryRoot, sources)

    const firstFrames = await framePaths(join(firstOut, "frames"), manifest.scene.frameCount)
    const secondFrames = await framePaths(join(secondOut, "frames"), manifest.scene.frameCount)
    const postMutantFrames = await framePaths(join(postMutantOut, "frames"), manifest.scene.frameCount)
    const cloneMutantFrames = await framePaths(join(cloneMutantOut, "frames"), manifest.scene.frameCount)
    const firstFrameHashes = await Promise.all(firstFrames.map(sha256File))
    const secondFrameHashes = await Promise.all(secondFrames.map(sha256File))
    const postMutantFrameHashes = await Promise.all(postMutantFrames.map(sha256File))
    const cloneMutantFrameHashes = await Promise.all(cloneMutantFrames.map(sha256File))
    const postPassDifference = compareFrameHashes(firstFrameHashes, postMutantFrameHashes)
    const cloneDifference = compareFrameHashes(firstFrameHashes, cloneMutantFrameHashes)
    if (postPassDifference.differingFrameCount === 0) {
      throw new Error(`removing the ${entropy.postPasses.join(", ")} post chain left every frame byte-identical: the runtime does not apply the scene post pass`)
    }
    if (cloneDifference.differingFrameCount === 0) {
      throw new Error(`collapsing scene clone counts to ${declaredEntropy.collapsedCloneCount} left every frame byte-identical: the runtime does not apply the scene clone spec`)
    }
    const firstMp4 = join(firstOut, "scene.mp4")
    const secondMp4 = join(secondOut, "scene.mp4")
    const firstMp4Hash = await sha256File(firstMp4)
    const secondMp4Hash = await sha256File(secondMp4)

    const probeResult = await runCommand(
      "ffprobe",
      ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames,nb_frames", "-of", "json", firstMp4],
      { timeoutMilliseconds: 15_000 },
    )
    assertEmptyStderr("ffprobe", probeResult)
    const probe = JSON.parse(probeResult.stdout.toString("utf8")) as ProbeOutput
    const videoStream = probe.streams?.[0]
    if (!videoStream) throw new Error("ffprobe returned no video stream")
    const probedFrameCount = Number(videoStream.nb_read_frames ?? videoStream.nb_frames)

    const canonicalAnalysis = await analyzeFrames(join(firstOut, "frames"), manifest, runCommand)
    const beatMutantAnalysis = await analyzeFrames(join(beatMutantOut, "frames"), manifest, runCommand)
    const cloneMutantAnalysis = await analyzeFrames(join(cloneMutantOut, "frames"), manifest, runCommand)
    const canonicalFirstBadFrame = findFirstBadBeatLocalFrame(canonicalAnalysis.metrics, manifest)
    const beatMutantFirstBadFrame = findFirstBadBeatLocalFrame(beatMutantAnalysis.metrics, manifest)
    if (canonicalFirstBadFrame !== null) throw new Error(`canonical beat-local invariant first failed at frame ${canonicalFirstBadFrame}`)
    if (beatMutantFirstBadFrame !== manifest.negativeControl.expectedFirstBadFrame) {
      throw new Error(`double-offset mutant first failed at frame ${String(beatMutantFirstBadFrame)}, expected ${manifest.negativeControl.expectedFirstBadFrame}`)
    }
    const canonicalMinimumBluePixels = Math.min(...canonicalAnalysis.metrics.map((metric) => metric.bluePixels))
    const cloneMutantMaximumBluePixels = Math.max(...cloneMutantAnalysis.metrics.map((metric) => metric.bluePixels))
    if (cloneMutantMaximumBluePixels >= canonicalMinimumBluePixels) {
      throw new Error(`collapsing clone counts to ${declaredEntropy.collapsedCloneCount} did not reduce rendered clone pixels: mutant peak ${cloneMutantMaximumBluePixels} >= canonical floor ${canonicalMinimumBluePixels}`)
    }

    const framesArtifactDir = resolveContained(repositoryRoot, manifest.artifacts.framesDirectory)
    const mp4ArtifactPath = resolveContained(repositoryRoot, manifest.artifacts.mp4Path)
    const gifArtifactPath = resolveContained(repositoryRoot, manifest.artifacts.gifPath)
    const contactSheetArtifactPath = resolveContained(repositoryRoot, manifest.artifacts.contactSheetPath)
    const metricsArtifactPath = resolveContained(repositoryRoot, manifest.artifacts.metricsPath)
    await mkdir(dirname(framesArtifactDir), { recursive: true })
    await cp(join(firstOut, "frames"), framesArtifactDir, { recursive: true })
    await copyFile(firstMp4, mp4ArtifactPath)

    const inputPattern = join(firstOut, "frames", "%06d.png")
    const gifResult = await runCommand(
      "ffmpeg",
      ["-v", "error", "-y", "-framerate", String(manifest.scene.fps), "-start_number", "0", "-i", inputPattern, "-frames:v", String(manifest.scene.frameCount), "-vf", `fps=${manifest.scene.fps},scale=${manifest.scene.width}:${manifest.scene.height}:flags=neighbor`, "-loop", "0", gifArtifactPath],
      { timeoutMilliseconds: 30_000 },
    )
    assertEmptyStderr("GIF encoding", gifResult)
    const contactResult = await runCommand(
      "ffmpeg",
      ["-v", "error", "-y", "-framerate", String(manifest.scene.fps), "-start_number", "0", "-i", inputPattern, "-frames:v", String(manifest.scene.frameCount), "-vf", "tile=4x3", "-frames:v", "1", contactSheetArtifactPath],
      { timeoutMilliseconds: 30_000 },
    )
    assertEmptyStderr("contact-sheet encoding", contactResult)

    const frameStats = await Promise.all(firstFrames.map((path) => stat(path)))
    const mp4Stat = await stat(firstMp4)
    const gifStat = await stat(gifArtifactPath)
    const contactSheetStat = await stat(contactSheetArtifactPath)
    const lumaMeans = canonicalAnalysis.metrics.map((metric) => metric.lumaMean)
    const minimumLuma = Math.min(...canonicalAnalysis.metrics.map((metric) => metric.lumaMin))
    const maximumLuma = Math.max(...canonicalAnalysis.metrics.map((metric) => metric.lumaMax))
    const meanLuma = lumaMeans.reduce((sum, value) => sum + value, 0) / lumaMeans.length
    const minimumNonBlankPixels = Math.min(...canonicalAnalysis.metrics.map((metric) => metric.nonBlankPixels))
    const minimumNonZeroAlpha = Math.min(...canonicalAnalysis.metrics.map((metric) => metric.alphaNonZeroPixels))
    const expectedCentroids = manifest.assertions.state.motion.expectedLocalCentroidX
    const firstBeatCentroids = canonicalAnalysis.metrics.slice(0, manifest.scene.beatBoundaryFrame).map(requireBlueCentroid)
    const secondBeatCentroids = canonicalAnalysis.metrics.slice(manifest.scene.beatBoundaryFrame).map(requireBlueCentroid)
    assertStrictlyIncreasing(firstBeatCentroids, "first beat motion")
    assertStrictlyIncreasing(secondBeatCentroids, "second beat motion")
    const beatResetObserved = firstBeatCentroids.every((centroid, index) => Math.abs(centroid - secondBeatCentroids[index]!) <= manifest.assertions.state.motion.centroidTolerancePixels)
      && Math.abs(secondBeatCentroids[0]! - expectedCentroids[0]) <= manifest.assertions.state.motion.centroidTolerancePixels

    const browserVersionResult = await runCommand(browserExecutable, ["--version"], { timeoutMilliseconds: 10_000 })
    const ffmpegVersionResult = await runCommand("ffmpeg", ["-version"], { timeoutMilliseconds: 10_000 })
    const bunVersionResult = await runCommand(process.execPath, ["--version"], { timeoutMilliseconds: 10_000 })
    const errorsText = await readFile(errorsPath, "utf8")
    if (errorsText.length > 0) throw new Error(`errors.log is not empty:\n${errorsText}`)

    const captionOnlyInExpectedInterval = canonicalAnalysis.metrics.every((metric) => {
      const expected = metric.frame >= manifest.assertions.state.caption.visibleStartFrame && metric.frame <= manifest.assertions.state.caption.visibleEndFrame
      return expected
        ? metric.greenPixels >= manifest.assertions.state.caption.greenMinimumPixels
        : metric.greenPixels <= manifest.assertions.state.caption.absentMaximumPixels
    })
    const allFrameHashesEqual = firstFrameHashes.every((hash, index) => hash === secondFrameHashes[index])
    const remainingOwnedProcesses = await ownedProcessIds(allRunIds)
    const cleanupComplete = activeRunIds.size === 0 && remainingOwnedProcesses.length === 0
    const host = await observeHost()
    assertSupportedHost(host, manifest)

    const metricsDocument = {
      schemaVersion: "scene-renderer.validation-frame-metrics.v1",
      canonical: canonicalAnalysis.metrics,
      mutant: beatMutantAnalysis.metrics,
      cloneMutant: cloneMutantAnalysis.metrics,
      hashes: {
        frames: firstFrameHashes,
        mp4: firstMp4Hash,
        gif: await sha256File(gifArtifactPath),
        contactSheet: await sha256File(contactSheetArtifactPath),
        postPassRemovedFrames: postMutantFrameHashes,
        cloneCountCollapsedFrames: cloneMutantFrameHashes,
      },
      sources,
      negativeControl: { mutation: manifest.negativeControl.mutation, firstBadFrame: beatMutantFirstBadFrame },
    }
    await writeFile(metricsArtifactPath, `${JSON.stringify(metricsDocument, null, 2)}\n`)
    const renderMilliseconds = performance.now() - startedAt
    const artifactCountBeforeReceipt = await countFiles(artifactRoot)
    const receiptArtifactCount = artifactCountBeforeReceipt + 1
    const largestFrameBytes = Math.max(...frameStats.map(({ size }) => size))
    const withinLimits = renderMilliseconds <= manifest.budgets.maxRenderMilliseconds
      && peakRssBytes <= manifest.budgets.maxPeakRssBytes
      && largestFrameBytes <= manifest.budgets.maxFrameBytes
      && mp4Stat.size <= manifest.budgets.maxMp4Bytes
      && receiptArtifactCount <= manifest.budgets.maxArtifactCount

    const receiptInput = {
      schemaVersion: VALIDATION_RECEIPT_VERSION,
      manifestVersion: VALIDATION_MANIFEST_VERSION,
      cellId: manifest.cellId,
      outcome: "passed",
      proof: {
        state: {
          metrics: canonicalAnalysis.metrics,
          entropy: {
            cloneSeeds: entropy.cloneSeeds,
            cloneCounts: entropy.cloneCounts,
            cloneLayouts: entropy.cloneLayouts,
            postPass: entropy.postPasses[0],
            postPassApplied: postPassDifference.differingFrameCount > 0,
            postPassMutation: { mutation: declaredEntropy.postPassMutation, ...postPassDifference },
            cloneCountApplied: cloneMutantMaximumBluePixels < canonicalMinimumBluePixels,
            cloneMutation: {
              mutation: declaredEntropy.cloneMutation,
              ...cloneDifference,
              canonicalMinimumBluePixels,
              mutantMaximumBluePixels: cloneMutantMaximumBluePixels,
            },
            deterministic: allFrameHashesEqual,
          },
          motion: {
            bluePresentEveryFrame: canonicalAnalysis.metrics.every((metric) => metric.bluePixels >= manifest.assertions.state.motion.blueMinimumPixels),
            beatResetFrame: manifest.scene.beatBoundaryFrame,
            beatResetObserved,
          },
          caption: {
            visibleStartFrame: manifest.assertions.state.caption.visibleStartFrame,
            visibleEndFrame: manifest.assertions.state.caption.visibleEndFrame,
            onlyInExpectedInterval: captionOnlyInExpectedInterval,
          },
          finiteMetrics: canonicalAnalysis.metrics.every((metric) => metric.finite),
          negativeControl: { mutation: manifest.negativeControl.mutation, firstBadFrame: beatMutantFirstBadFrame },
        },
        process: {
          cleanupComplete,
          priorReceiptRemoved,
          errorsLogRead: true,
          errorsLogBytes: Buffer.byteLength(errorsText),
          processStarts,
          renderPasses: allRunIds.length,
          rendererPids,
          peakProcessTreeSize,
          ownedProcessesRemaining: remainingOwnedProcesses.length,
          errors: [],
        },
        render: {
          dimensions: { width: videoStream.width, height: videoStream.height },
          frameCount: probedFrameCount,
          luma: { minimum: minimumLuma, maximum: maximumLuma, mean: meanLuma },
          nonBlank: { minimumPixels: minimumNonBlankPixels },
          alpha: { minimumNonZeroPixels: minimumNonZeroAlpha },
          frameHashes: { firstRun: firstFrameHashes, secondRun: secondFrameHashes, equal: allFrameHashesEqual },
          mp4Hashes: { firstRun: firstMp4Hash, secondRun: secondMp4Hash, equal: firstMp4Hash === secondMp4Hash },
          playableArtifacts: {
            mp4Bytes: mp4Stat.size,
            gifBytes: gifStat.size,
            contactSheetBytes: contactSheetStat.size,
          },
        },
        budgets: {
          renderMilliseconds,
          peakRssBytes,
          largestFrameBytes,
          mp4Bytes: mp4Stat.size,
          artifactCount: receiptArtifactCount,
          withinLimits,
        },
        artifacts: { ...manifest.artifacts },
        sources,
        host,
        nixbox: {
          environment: options.environment ?? process.env.SCENE_VALIDATION_ENVIRONMENT ?? "nixbox",
          browserVersion: firstLine(browserVersionResult.stdout),
          ffmpegVersion: firstLine(ffmpegVersionResult.stdout),
          bunVersion: firstLine(bunVersionResult.stdout),
          frameFileCount: (await framePaths(framesArtifactDir, manifest.scene.frameCount)).length,
          mp4FileCount: Number(await fileExists(mp4ArtifactPath)),
          gifFileCount: Number(await fileExists(gifArtifactPath)),
          contactSheetFileCount: Number(await fileExists(contactSheetArtifactPath)),
          metricsFileCount: Number(await fileExists(metricsArtifactPath)),
          errorsFileCount: Number(await fileExists(errorsPath)),
          receiptFileCount: 1,
        },
      },
    }
    const receipt = decodeValidationReceipt(receiptInput, manifest)
    await publishReceipt(artifactRoot, receiptArtifactPath, `${JSON.stringify(receipt, null, 2)}\n`, receipt.proof.budgets.artifactCount)
    return receipt
  } catch (error) {
    // A refused invocation must never leave a proof behind, including one already persisted before
    // finalization observed the failure. Withdrawal and logging are both reported into errors.log and
    // neither may replace the refusal the caller is about to see.
    const withdrawal = await withdrawReceipt(receiptArtifactPath)
    await recordRefusal(errorsPath, `${describeFailure(error)}${withdrawal}`, "replace")
    throw error
  } finally {
    try {
      for (const runId of activeRunIds) await terminateOwnedProcesses(runId)
      await rm(workspace, { recursive: true, force: true })
    } catch (error) {
      // Teardown is part of the proof: a run that cannot dismantle its own workspace must not leave
      // a published receipt claiming a clean process bound. The catch above never runs for a failure
      // raised here, so this is the only chance to leave a durable reason for the withdrawal.
      const withdrawal = await withdrawReceipt(receiptArtifactPath)
      await recordRefusal(errorsPath, `${describeFailure(error)}${withdrawal}`, "append")
      throw error
    }
  }
}

async function analyzeFrames(
  framesDirectory: string,
  manifest: ValidationManifest,
  runCommand: (command: string, args: readonly string[], options: Omit<CommandOptions, "cwd"> & { readonly cwd?: string }) => Promise<CommandResult>,
): Promise<FrameSetAnalysis> {
  const result = await runCommand(
    "ffmpeg",
    ["-v", "error", "-framerate", String(manifest.scene.fps), "-start_number", "0", "-i", join(framesDirectory, "%06d.png"), "-frames:v", String(manifest.scene.frameCount), "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    { timeoutMilliseconds: 30_000, maxStdoutBytes: RAW_FRAME_OUTPUT_BYTES },
  )
  assertEmptyStderr("raw frame decode", result)
  const frameBytes = manifest.scene.width * manifest.scene.height * 4
  const expectedBytes = frameBytes * manifest.scene.frameCount
  if (result.stdout.length !== expectedBytes) throw new Error(`raw frame decode produced ${result.stdout.length} bytes, expected ${expectedBytes}`)
  const metrics: ValidationFrameMetric[] = []
  for (let frame = 0; frame < manifest.scene.frameCount; frame += 1) {
    metrics.push(measureFrame(result.stdout.subarray(frame * frameBytes, (frame + 1) * frameBytes), frame, manifest.scene.width, manifest.scene.height))
  }
  return { metrics, rawBytes: result.stdout.length }
}

export function measureFrame(rgba: Uint8Array, frame: number, width: number, height: number): ValidationFrameMetric {
  if (rgba.length !== width * height * 4) throw new Error(`frame ${frame} has ${rgba.length} RGBA bytes, expected ${width * height * 4}`)
  let alphaNonZeroPixels = 0
  let bluePixels = 0
  let blueXSum = 0
  let greenPixels = 0
  let nonBlankPixels = 0
  let lumaSum = 0
  let lumaMin = Number.POSITIVE_INFINITY
  let lumaMax = Number.NEGATIVE_INFINITY
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4
    const red = rgba[offset]!
    const green = rgba[offset + 1]!
    const blue = rgba[offset + 2]!
    const alpha = rgba[offset + 3]!
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    lumaSum += luma
    lumaMin = Math.min(lumaMin, luma)
    lumaMax = Math.max(lumaMax, luma)
    if (alpha > 0) alphaNonZeroPixels += 1
    if (red + green + blue > 12) nonBlankPixels += 1
    if (blue >= 80 && blue >= red * 1.5 && blue >= green * 1.25) {
      bluePixels += 1
      blueXSum += pixel % width
    }
    if (green >= 80 && green >= red * 1.5 && green >= blue * 1.25) greenPixels += 1
  }
  const blueCentroidX = bluePixels === 0 ? null : blueXSum / bluePixels
  const lumaMean = lumaSum / (width * height)
  const finite = [blueCentroidX ?? 0, lumaMean, lumaMin, lumaMax].every(Number.isFinite)
  return { frame, bluePixels, blueCentroidX, greenPixels, lumaMean, lumaMin, lumaMax, nonBlankPixels, alphaNonZeroPixels, finite }
}

async function runBoundedCommand(command: string, args: readonly string[], options: CommandOptions): Promise<CommandResult> {
  const startedAt = performance.now()
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (child.pid === undefined) throw new Error(`failed to start ${command}`)
  const pid = child.pid
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let peakRssBytes = 0
  let peakProcessCount = 0
  let outputFailure: Error | undefined
  let samplerFailure: Error | undefined
  let sampling = false
  const maxStdoutBytes = options.maxStdoutBytes ?? MAX_TEXT_OUTPUT_BYTES
  const maxStderrBytes = options.maxStderrBytes ?? MAX_TEXT_OUTPUT_BYTES
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.length
    if (stdoutBytes > maxStdoutBytes) {
      outputFailure ??= new Error(`${command} stdout exceeded ${maxStdoutBytes} bytes`)
      terminateProcessGroup(pid)
      return
    }
    stdoutChunks.push(chunk)
  })
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.length
    if (stderrBytes > maxStderrBytes) {
      outputFailure ??= new Error(`${command} stderr exceeded ${maxStderrBytes} bytes`)
      terminateProcessGroup(pid)
      return
    }
    stderrChunks.push(chunk)
  })
  const sampler = setInterval(() => {
    if (sampling) return
    sampling = true
    void measureProcessTree(pid)
      .then((measurement) => {
        peakRssBytes = Math.max(peakRssBytes, measurement.rssBytes)
        peakProcessCount = Math.max(peakProcessCount, measurement.processCount)
      })
      .catch((error: unknown) => {
        samplerFailure ??= error instanceof Error ? error : new Error(String(error))
      })
      .finally(() => {
        sampling = false
      })
  }, 50)
  const timeout = setTimeout(() => {
    outputFailure ??= new Error(`${command} timed out after ${options.timeoutMilliseconds}ms`)
    terminateProcessGroup(pid)
  }, options.timeoutMilliseconds)
  try {
    const code = await new Promise<number | null>((resolveCode, reject) => {
      child.once("error", reject)
      child.once("close", resolveCode)
    })
    const finalMeasurement = await measureProcessTree(pid)
    peakRssBytes = Math.max(peakRssBytes, finalMeasurement.rssBytes)
    peakProcessCount = Math.max(peakProcessCount, finalMeasurement.processCount)
    const stdout = Buffer.concat(stdoutChunks)
    const stderr = Buffer.concat(stderrChunks)
    if (samplerFailure) throw samplerFailure
    if (outputFailure) throw outputFailure
    if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited ${String(code)}\n${stderr.toString("utf8")}\n${stdout.toString("utf8")}`)
    return { pid, stdout, stderr, elapsedMilliseconds: performance.now() - startedAt, peakRssBytes, peakProcessCount }
  } finally {
    clearInterval(sampler)
    clearTimeout(timeout)
    if (options.runId) await waitForOwnedProcessesToExit(options.runId, 5_000)
  }
}

async function measureProcessTree(rootPid: number): Promise<ProcessTreeMeasurement> {
  if (process.platform !== "linux") {
    throw new Error(`process-tree accounting requires Linux /proc; refusing to substitute the validator's own RSS on ${process.platform}`)
  }
  const processes = await linuxProcesses()
  const descendants = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const entry of processes) {
      if (!descendants.has(entry.pid) && descendants.has(entry.parentPid)) {
        descendants.add(entry.pid)
        changed = true
      }
    }
  }
  let rssBytes = 0
  let processCount = 0
  for (const entry of processes) {
    if (!descendants.has(entry.pid)) continue
    rssBytes += entry.rssBytes
    processCount += 1
  }
  return { rssBytes, processCount }
}

async function linuxProcesses(): Promise<readonly ProcessInfo[]> {
  const entries = await readdir("/proc", { withFileTypes: true })
  const processes = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map(async (entry): Promise<ProcessInfo | undefined> => {
      try {
        const pid = Number(entry.name)
        const statText = await readFile(`/proc/${entry.name}/stat`, "utf8")
        const commandEnd = statText.lastIndexOf(")")
        if (commandEnd < 0) return undefined
        const fields = statText.slice(commandEnd + 2).split(" ")
        const parentPid = Number(fields[1])
        const statusText = await readFile(`/proc/${entry.name}/status`, "utf8")
        const rssMatch = /^VmRSS:\s+(\d+)\s+kB$/m.exec(statusText)
        return { pid, parentPid, rssBytes: Number(rssMatch?.[1] ?? 0) * 1024 }
      } catch {
        return undefined
      }
    }))
  return processes.filter((entry): entry is ProcessInfo => entry !== undefined)
}

async function ownedProcessIds(runIds: readonly string[]): Promise<readonly number[]> {
  if (process.platform !== "linux") {
    throw new Error(`renderer ownership accounting requires Linux /proc; refusing to claim cleanup on ${process.platform}`)
  }
  if (runIds.length === 0) return []
  const entries = await readdir("/proc", { withFileTypes: true })
  const owned: number[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
    try {
      const environment = await readFile(`/proc/${entry.name}/environ`)
      const text = environment.toString("utf8")
      if (runIds.some((runId) => text.includes(`SCENE_VALIDATION_RUN_ID=${runId}\0`))) owned.push(Number(entry.name))
    } catch {
      // Processes can exit between /proc listing and the environment read.
    }
  }
  return owned
}

async function waitForOwnedProcessesToExit(runId: string, timeoutMilliseconds: number): Promise<void> {
  const deadline = performance.now() + timeoutMilliseconds
  do {
    const owned = await ownedProcessIds([runId])
    if (owned.length === 0) return
    await Bun.sleep(50)
  } while (performance.now() < deadline)
  const remaining = await ownedProcessIds([runId])
  await terminateOwnedProcesses(runId)
  throw new Error(`owned renderer processes did not exit: ${remaining.join(", ")}`)
}

async function terminateOwnedProcesses(runId: string): Promise<void> {
  const pids = await ownedProcessIds([runId])
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {
      // The process already exited.
    }
  }
  await Bun.sleep(100)
  for (const pid of await ownedProcessIds([runId])) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {
      // The process already exited.
    }
  }
}

function terminateProcessGroup(pid: number): void {
  try {
    process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM")
  } catch {
    // The process already exited.
  }
  setTimeout(() => {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL")
    } catch {
      // The process already exited.
    }
  }, 500).unref()
}

async function framePaths(directory: string, expectedCount: number): Promise<readonly string[]> {
  const entries = (await readdir(directory)).filter((entry) => /^\d{6}\.png$/.test(entry)).sort()
  if (entries.length !== expectedCount) throw new Error(`expected ${expectedCount} PNG frames in ${directory}, found ${entries.length}`)
  return entries.map((entry) => join(directory, entry))
}

async function sha256File(path: string): Promise<string> {
  return sha256Bytes(await readFile(path))
}

/**
 * Copies a declared render input into the run workspace and digests the copy, so the digested bytes
 * and the rendered bytes are one file. Replacing the declared source afterwards changes nothing this
 * run renders or certifies. The copy is named relative to the run workspace and can only land inside
 * it, so no caller can turn staging into a write anywhere else.
 */
export async function stageRenderInput(sourcePath: string, label: string, workspace: string, name: string): Promise<StagedSource> {
  const targetPath = workspacePath(workspace, name)
  try {
    await copyFile(sourcePath, targetPath)
  } catch (error) {
    throw new Error(`cannot stage ${label} for rendering: ${error instanceof Error ? error.message : String(error)}`)
  }
  const staged = await readFile(targetPath)
  return { label, path: targetPath, sha256: sha256Bytes(staged), bytes: staged.length }
}

/** Writes a generated render input into the run workspace under the digest the renderer will verify. */
async function writeStagedScene(workspace: string, name: string, text: string, label: string): Promise<StagedSource> {
  const targetPath = workspacePath(workspace, name)
  await writeFile(targetPath, text)
  return { label, path: targetPath, sha256: sha256Text(text), bytes: Buffer.byteLength(text) }
}

/** Staged inputs live in the run workspace: a name that escapes it is a refusal, never a write. */
function workspacePath(workspace: string, name: string): string {
  const root = resolve(workspace)
  const candidate = resolve(root, name)
  if (escapes(root, candidate)) throw new Error(`staged render input ${name} escapes the run workspace ${root}`)
  return candidate
}

/** Refuses bytes that drifted from the digest the receipt certifies, before they are opened or named. */
export async function assertDigestUnchanged(path: string, expected: string, label: string): Promise<void> {
  const observed = await sha256File(path)
  if (observed === expected) return
  throw new Error(`${label} changed after it was digested (${expected} -> ${observed}); refusing to certify a run against bytes the receipt does not describe`)
}

/**
 * Re-digests every source the receipt names, not just the ones the renderer opened. A later reader
 * re-hashes exactly these paths to reproduce the proof, so any of them drifting mid-run makes the
 * published provenance unreproducible and the run must refuse instead of certifying it.
 */
export async function assertSourcesUnchanged(repositoryRoot: string, sources: SourceDigestProof): Promise<void> {
  for (const named of [sources.manifest, sources.scene, sources.runtime, sources.package, sources.lock]) {
    await assertDigestUnchanged(resolveContained(repositoryRoot, named.path), named.sha256, named.path)
  }
  const rendererRoot = resolveContained(repositoryRoot, sources.renderer.root)
  const renderer = await digestRendererRoot(rendererRoot, sources.renderer.root)
  if (renderer.sha256 === sources.renderer.sha256 && renderer.fileCount === sources.renderer.fileCount) return
  throw new Error(`renderer source root ${sources.renderer.root} changed during the run (${sources.renderer.fileCount} files ${sources.renderer.sha256} -> ${renderer.fileCount} files ${renderer.sha256}); refusing to certify frames rendered by undigested code`)
}

function assertEmptyStderr(label: string, result: CommandResult): void {
  const stderr = result.stderr.toString("utf8").trim()
  if (stderr.length > 0) throw new Error(`${label} wrote stderr:\n${stderr}`)
}

function requireBlueCentroid(metric: ValidationFrameMetric): number {
  if (metric.blueCentroidX === null) throw new Error(`frame ${metric.frame} has no blue centroid`)
  return metric.blueCentroidX
}

function assertStrictlyIncreasing(values: readonly number[], label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (!(values[index]! > values[index - 1]!)) throw new Error(`${label} is not strictly increasing at local frame ${index}`)
  }
}

function assertSceneMatchesManifest(scene: SceneSpec, entropy: SceneEntropyObservation, manifest: ValidationManifest): void {
  if (scene.schemaVersion !== manifest.scene.schemaVersion
    || scene.width !== manifest.scene.width
    || scene.height !== manifest.scene.height
    || scene.fps !== manifest.scene.fps
    || scene.durationSeconds !== manifest.scene.durationSeconds) {
    throw new Error("scene dimensions, timing, or schema version do not match the validation manifest")
  }
  if (scene.timeline.beats?.length !== manifest.scene.beatBoundariesSeconds.length
    || scene.timeline.beats.some((beat, index) => beat !== manifest.scene.beatBoundariesSeconds[index])) {
    throw new Error("scene beat boundaries do not match the validation manifest")
  }
  const declared = manifest.assertions.state.deterministicEntropy
  if (entropy.cloneSeeds.length !== declared.cloneSeeds.length
    || entropy.cloneSeeds.some((seed, index) => seed !== declared.cloneSeeds[index])) {
    throw new Error(`scene clone seeds [${entropy.cloneSeeds.join(", ")}] do not match the manifest entropy seeds [${declared.cloneSeeds.join(", ")}]`)
  }
  if (entropy.cloneCounts.length !== declared.cloneCounts.length
    || entropy.cloneCounts.some((count, index) => count !== declared.cloneCounts[index])) {
    throw new Error(`scene clone counts [${entropy.cloneCounts.join(", ")}] do not match the manifest clone counts [${declared.cloneCounts.join(", ")}]`)
  }
  if (entropy.cloneLayouts.length !== declared.cloneLayouts.length
    || entropy.cloneLayouts.some((layout, index) => layout !== declared.cloneLayouts[index])) {
    throw new Error(`scene clone layouts [${entropy.cloneLayouts.join(", ")}] do not match the manifest clone layouts [${declared.cloneLayouts.join(", ")}]`)
  }
  if (entropy.postPasses.length !== 1 || entropy.postPasses[0] !== declared.postPass) {
    throw new Error(`scene post chain [${entropy.postPasses.join(", ")}] does not match the manifest post pass ${declared.postPass}`)
  }
}

function resolveContained(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error(`validation path must be relative: ${path}`)
  const candidate = resolve(root, path)
  if (escapes(root, candidate)) throw new Error(`validation path escapes repository root: ${path}`)
  return candidate
}

function escapes(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === "" || fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)
}

function assertArtifactRootSafe(repositoryRoot: string, artifactRoot: string): void {
  const fromRoot = relative(repositoryRoot, artifactRoot)
  if (!fromRoot.startsWith("workflows/scene-lab/reports/2026-07-16-renderer-gaps/")) {
    throw new Error(`refusing to replace artifact root outside the renderer-gaps report: ${fromRoot}`)
  }
}

async function countFiles(root: string): Promise<number> {
  let count = 0
  for (const entry of await readdir(root, { withFileTypes: true })) {
    count += entry.isDirectory() ? await countFiles(join(root, entry.name)) : 1
  }
  return count
}

/**
 * Publishes the receipt only once the artifact inventory it certifies is confirmed. The proof is
 * written beside its final path — so the count it claims already includes itself — and renamed
 * atomically; any failure from the staging write onwards removes the staged proof instead of leaving
 * a `passed` receipt, or its residue, for an invocation that refused.
 */
export async function publishReceipt(artifactRoot: string, receiptPath: string, receiptText: string, certifiedArtifactCount: number): Promise<void> {
  const stagingPath = `${receiptPath}${RECEIPT_STAGING_SUFFIX}`
  try {
    await writeFile(stagingPath, receiptText)
    const observed = await countFiles(artifactRoot)
    if (observed !== certifiedArtifactCount) {
      throw new Error(`artifact count changed after receipt: expected ${certifiedArtifactCount}, found ${observed}`)
    }
    await rename(stagingPath, receiptPath)
  } catch (error) {
    // Residue this cannot remove is withdrawn and recorded again by the runner's refusal path; the
    // failure that got us here is the one the caller must see.
    await rm(stagingPath, { force: true, recursive: true }).catch(() => {})
    throw error
  }
}

/**
 * Withdraws any published proof and records why. Removal comes first — a stale `passed` receipt is
 * the dangerous residue — and the reason is written best-effort, so a filesystem that cannot hold the
 * log never replaces the refusal the caller must see. Returns whether a receipt was there to remove.
 */
export async function revokePublishedReceipt(reason: string, repositoryRoot: string = REPOSITORY_ROOT): Promise<boolean> {
  const root = resolve(repositoryRoot)
  const artifactRoot = resolveContained(root, VALIDATION_ARTIFACT_ROOT)
  assertArtifactRootSafe(root, artifactRoot)
  const receiptPath = resolveContained(root, VALIDATION_RECEIPT_PATH)
  const published = await fileExists(receiptPath)
  await rm(receiptPath, { force: true, recursive: true })
  await rm(`${receiptPath}${RECEIPT_STAGING_SUFFIX}`, { force: true, recursive: true })
  await mkdir(artifactRoot, { recursive: true })
  await recordRefusal(resolveContained(root, VALIDATION_ERRORS_PATH), reason, "replace")
  return published
}

/** Removes a published proof and its staging residue, reporting a failed withdrawal as loggable text. */
async function withdrawReceipt(receiptPath: string): Promise<string> {
  try {
    await rm(receiptPath, { force: true, recursive: true })
    await rm(`${receiptPath}${RECEIPT_STAGING_SUFFIX}`, { force: true, recursive: true })
    return ""
  } catch (error) {
    return `receipt withdrawal failed: ${describeFailure(error)}`
  }
}

/**
 * errors.log is the only durable record of a refusal, but it is not the refusal itself: a filesystem
 * that cannot hold the reason must never replace the error the caller is about to see. A teardown
 * failure appends so it cannot erase the refusal that ran first.
 */
async function recordRefusal(errorsPath: string, text: string, mode: "replace" | "append"): Promise<void> {
  try {
    await mkdir(dirname(errorsPath), { recursive: true })
    if (mode === "append") await appendFile(errorsPath, text)
    else await writeFile(errorsPath, text)
  } catch (error) {
    process.stderr.write(`scene validation cell could not record its refusal in ${errorsPath}: ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

// `Error.stack` does not reliably carry the message under Bun, and errors.log is the only durable
// record of why an invocation refused: state the reason first, then whatever frames survived.
export function describeFailure(error: unknown): string {
  const failure = error instanceof Error ? error : new Error(String(error))
  const frames = (failure.stack ?? "").split("\n").filter((line) => line.trimStart().startsWith("at "))
  return `${[`${failure.name}: ${failure.message}`, ...frames].join("\n")}\n`
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false
    throw error
  }
}

function firstLine(buffer: Buffer): string {
  return buffer.toString("utf8").split(/\r?\n/, 1)[0]?.trim() ?? ""
}

export async function observeHost(): Promise<HostFacts> {
  if (process.platform !== "linux") {
    throw new Error(`scene validation requires a Linux host with cgroup v2 accounting; refusing to certify measurements taken on ${process.platform}`)
  }
  const membership = await readFile("/proc/self/cgroup", "utf8")
  const unified = membership.split("\n").find((line) => line.startsWith("0::"))
  if (unified === undefined) throw new Error("no cgroup v2 membership in /proc/self/cgroup; refusing to certify unaccounted execution")
  const cgroupPath = unified.slice("0::".length).trim()
  const cgroupRoot = join(CGROUP_ROOT, cgroupPath)
  const [controllers, memoryMax, memoryPeak, memoryCurrent, cpuMax, pidsMax, pidsPeak, procs] = await Promise.all([
    readCgroupFile(cgroupRoot, "cgroup.controllers"),
    readCgroupFile(cgroupRoot, "memory.max"),
    readCgroupFile(cgroupRoot, "memory.peak"),
    readCgroupFile(cgroupRoot, "memory.current"),
    readCgroupFile(cgroupRoot, "cpu.max"),
    readCgroupFile(cgroupRoot, "pids.max"),
    readCgroupFile(cgroupRoot, "pids.peak"),
    readCgroupFile(cgroupRoot, "cgroup.procs"),
  ])
  const [cpuQuota, cpuPeriod] = cpuMax.split(/\s+/)
  const cgroupPids = procs.split("\n").map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0)
  const related = await relatedProcessIds(process.pid)
  return {
    platform: process.platform,
    hostname: hostname(),
    architecture: process.arch,
    cgroupVersion: 2,
    cgroupPath,
    controllers: controllers.split(/\s+/).filter((controller) => controller.length > 0),
    memoryMaxBytes: parseCgroupLimit(memoryMax),
    memoryPeakBytes: Number(memoryPeak),
    memoryCurrentBytes: Number(memoryCurrent),
    cpuQuotaMicroseconds: parseCgroupLimit(cpuQuota ?? "max"),
    cpuPeriodMicroseconds: Number(cpuPeriod ?? "0"),
    pidsMax: parseCgroupLimit(pidsMax),
    pidsPeak: Number(pidsPeak),
    cgroupProcessCount: cgroupPids.length,
    foreignProcessCount: cgroupPids.filter((pid) => !related.has(pid)).length,
  }
}

export function assertSupportedHost(facts: HostFacts, manifest: ValidationManifest): void {
  if (facts.platform !== manifest.host.platform) {
    throw new Error(`scene validation requires a ${manifest.host.platform} host with cgroup v${manifest.host.cgroupVersion} accounting; refusing to certify ${facts.platform}`)
  }
  if (facts.hostname !== manifest.host.hostname) {
    throw new Error(`scene validation must run on ${manifest.host.hostname}; observed host ${facts.hostname}`)
  }
  if (facts.cgroupVersion !== manifest.host.cgroupVersion) {
    throw new Error(`scene validation requires cgroup v${manifest.host.cgroupVersion}; observed v${facts.cgroupVersion}`)
  }
  const missing = manifest.host.requiredControllers.filter((controller) => !facts.controllers.includes(controller))
  if (missing.length > 0) {
    throw new Error(`cgroup ${facts.cgroupPath} does not enable the required controllers: ${missing.join(", ")}`)
  }
  if (manifest.host.requireDedicatedCgroup && facts.foreignProcessCount > 0) {
    throw new Error(`cgroup ${facts.cgroupPath} holds ${facts.foreignProcessCount} processes outside the validated process tree`)
  }
  if (facts.memoryPeakBytes > manifest.budgets.maxPeakRssBytes) {
    throw new Error(`cgroup ${facts.cgroupPath} peaked at ${facts.memoryPeakBytes} bytes, above the ${manifest.budgets.maxPeakRssBytes} byte budget`)
  }
  if (facts.memoryMaxBytes !== null && facts.memoryMaxBytes > manifest.budgets.maxPeakRssBytes) {
    throw new Error(`cgroup ${facts.cgroupPath} allows ${facts.memoryMaxBytes} bytes, above the ${manifest.budgets.maxPeakRssBytes} byte budget`)
  }
}

async function readCgroupFile(cgroupRoot: string, name: string): Promise<string> {
  try {
    return (await readFile(join(cgroupRoot, name), "utf8")).trim()
  } catch (error) {
    throw new Error(`cgroup interface ${name} is unreadable under ${cgroupRoot}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseCgroupLimit(value: string): number | null {
  return value === "max" ? null : Number(value)
}

async function relatedProcessIds(rootPid: number): Promise<ReadonlySet<number>> {
  const processes = await linuxProcesses()
  const related = new Set<number>([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const entry of processes) {
      if (!related.has(entry.pid) && related.has(entry.parentPid)) {
        related.add(entry.pid)
        changed = true
      }
    }
  }
  const parents = new Map(processes.map((entry) => [entry.pid, entry.parentPid]))
  for (let ancestor = parents.get(rootPid); ancestor !== undefined && ancestor > 0 && !related.has(ancestor); ancestor = parents.get(ancestor)) {
    related.add(ancestor)
  }
  return related
}

/**
 * Digests every source the receipt names, from the bytes on disk, so `sha256sum <path>` reproduces
 * each entry. The scene and runtime digests come from the staged copies the renderer renders, which
 * are byte copies of the declared paths taken moments earlier.
 */
export async function digestSources(
  repositoryRoot: string,
  manifest: ValidationManifest,
  manifestBytes: Uint8Array,
  scene: StagedSource,
  runtime: StagedSource,
): Promise<SourceDigestProof> {
  if (runtime.bytes === 0) throw new Error(`runtime bundle ${manifest.sources.runtimePath} is empty`)
  await stat(resolveContained(repositoryRoot, manifest.sources.runtimeEntry))
  const rendererRoot = resolveContained(repositoryRoot, manifest.sources.rendererRoot)
  const renderer = await digestRendererRoot(rendererRoot, manifest.sources.rendererRoot)
  const packagePath = resolveContained(repositoryRoot, manifest.sources.packagePath)
  const packageBytes = await readFile(packagePath)
  const packageDocument = parseJsonText(packageBytes.toString("utf8")) as { readonly dependencies?: Readonly<Record<string, string>> }
  const lockBytes = await readFile(resolveContained(repositoryRoot, manifest.sources.lockPath))
  const dependencies = await Promise.all(manifest.sources.dependencies.map(async (dependency) => {
    const declared = packageDocument.dependencies?.[dependency.name]
    if (declared !== dependency.declared) {
      throw new Error(`${manifest.sources.packagePath} declares ${dependency.name}@${String(declared)}, the manifest requires ${dependency.declared}`)
    }
    const resolved = await resolveInstalledVersion(repositoryRoot, dirname(packagePath), dependency.name)
    if (!versionSatisfiesDeclared(declared, resolved)) {
      throw new Error(`${dependency.name}@${resolved} is installed where ${manifest.sources.lockPath} and ${manifest.sources.packagePath} declare ${declared}; refusing to certify a run against an undeclared dependency`)
    }
    return { name: dependency.name, declared, resolved }
  }))
  const digested = {
    manifest: { path: manifest.sources.manifestPath, sha256: sha256Bytes(manifestBytes) },
    scene: { path: manifest.scene.path, sha256: scene.sha256 },
    runtime: { path: manifest.sources.runtimePath, sha256: runtime.sha256, bytes: runtime.bytes },
    renderer: { root: manifest.sources.rendererRoot, ...renderer },
    package: { path: manifest.sources.packagePath, sha256: sha256Bytes(packageBytes) },
    lock: { path: manifest.sources.lockPath, sha256: sha256Bytes(lockBytes) },
    dependencies,
  }
  return { ...digested, digest: sha256Text(JSON.stringify(digested)) }
}

async function digestRendererRoot(rendererRoot: string, declared: string): Promise<{ readonly fileCount: number; readonly sha256: string }> {
  const files = await listSourceFiles(rendererRoot, "")
  if (files.length === 0) throw new Error(`renderer source root ${declared} holds no files`)
  const entries = await Promise.all(files.map(async (relativePath) => `${relativePath} ${await sha256File(join(rendererRoot, relativePath))}`))
  return { fileCount: files.length, sha256: sha256Text(`${entries.join("\n")}\n`) }
}

async function listSourceFiles(root: string, prefix: string): Promise<readonly string[]> {
  const entries = await readdir(prefix === "" ? root : join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...await listSourceFiles(root, relativePath))
    else if (entry.isFile()) files.push(relativePath)
  }
  return files
}

async function resolveInstalledVersion(repositoryRoot: string, packageRoot: string, name: string): Promise<string> {
  for (const root of new Set([packageRoot, repositoryRoot])) {
    const candidate = join(root, "node_modules", name, "package.json")
    if (!(await fileExists(candidate))) continue
    const document = parseJsonText(await readFile(candidate, "utf8")) as { readonly version?: string }
    if (typeof document.version !== "string" || document.version.length === 0) {
      throw new Error(`${candidate} does not record an installed version`)
    }
    return document.version
  }
  throw new Error(`dependency ${name} is not installed under ${packageRoot} or ${repositoryRoot}; refusing to record an unresolved dependency closure`)
}

// Caret and tilde ranges are compared field-wise so the cell needs no semver dependency of its own:
// exact pins must match exactly, `~` and `0.x` carets must match major.minor, other carets the major.
function versionSatisfiesDeclared(declared: string, resolved: string): boolean {
  if (/^\d/.test(declared)) return declared === resolved
  const range = declared.slice(0, 1)
  if (range !== "^" && range !== "~") return false
  const wanted = declared.slice(1).split(".")
  const actual = resolved.split(".")
  const compared = range === "~" || wanted[0] === "0" ? 2 : 1
  return wanted.slice(0, compared).every((field, index) => field === actual[index])
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex")
}

function compareFrameHashes(canonical: readonly string[], mutant: readonly string[]): FrameHashDifference {
  let firstDifferingFrame = canonical.length
  let differingFrameCount = 0
  for (let frame = 0; frame < canonical.length; frame += 1) {
    if (canonical[frame] === mutant[frame]) continue
    if (differingFrameCount === 0) firstDifferingFrame = frame
    differingFrameCount += 1
  }
  return { firstDifferingFrame, differingFrameCount }
}
