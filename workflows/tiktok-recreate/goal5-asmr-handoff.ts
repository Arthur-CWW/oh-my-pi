#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

type JsonObject = Record<string, unknown>

type Args = {
  handoff: string
  generatedClips: string
  spatialRenderOutput: string
  outDir: string
  createdAt: string
  proofId: string
}

type ResolvedGeneratedClip = {
  clipId: string
  provider: string
  model: string
  jobId: string
  artifactPath: string
  mediaType: string
  durationSec: number
  fps: number
  dryRun: boolean
  mediaAvailable: boolean
  resolvedMediaPath?: string
  placeholderPath: string
  missingLiveMediaReason?: string
}

const DEFAULT_CREATED_AT = "2026-06-24T00:00:00.000Z"
const DEFAULT_PROOF_ID = "goal5-asmr-seedance-render-proof-001"
const DEFAULT_PLACEHOLDER = "workflows/tiktok-recreate/fixtures/generated-clip-missing-live-media.placeholder.json"

export function buildGoal5Artifacts(args: Args): Record<string, unknown> {
  const handoff = readJson(args.handoff, "Goal 4 handoff bundle")
  const generatedClips = readJson(args.generatedClips, "Goal 2 generated clip manifest")
  const spatialRender = readJson(args.spatialRenderOutput, "Goal 3 spatial render-output manifest")

  const promptOutputs = arrayProp(handoff, "promptOutputs")
  if (promptOutputs.length === 0) throw new Error("Goal 4 handoff has no promptOutputs")
  const firstPrompt = objectProp(promptOutputs[0], "promptOutputs[0]")
  const conceptId = stringProp(firstPrompt, "conceptId")
  const title = promptTitle(handoff, conceptId) ?? conceptId
  const captions = captionBeats(firstPrompt)

  const clips = resolveGeneratedClips(generatedClips, args.generatedClips)
  if (clips.length === 0) throw new Error("Goal 2 generated clip manifest has no clips")
  const primaryClip = clips[0]!
  const audioPath = resolveAudioPath(spatialRender, args.spatialRenderOutput)
  const audioDurationSec = numberFromPath(spatialRender, ["output", "durationSec"]) ?? numberFromPath(spatialRender, ["durationSec"])
  const durationSeconds = Math.max(primaryClip.durationSec, audioDurationSec ?? primaryClip.durationSec)
  const fps = 30
  const durationFrames = Math.ceil(durationSeconds * fps)
  const clipFrames = Math.ceil(primaryClip.durationSec * fps)

  const outDir = safeOutputDir(args.outDir)
  const rel = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/")
  const layerPlanPath = rel(path.join(outDir, "goal5-layer-plan.json"))
  const remotionManifestPath = rel(path.join(outDir, "remotion-context.json"))
  const personaManifestPath = rel(path.join(outDir, "persona-manifest.json"))
  const hyperframesMapPath = rel(path.join(outDir, "hyperframes-animation-map.json"))
  const resolvedClipsPath = rel(path.join(outDir, "generated-clips.resolved.json"))
  const workflowHandoffPath = rel(path.join(outDir, "goal5-workflow-handoff.json"))
  const reviewerReportPath = rel(path.join(outDir, "reviewer-report.html"))
  const remotionOutDir = rel(path.join(outDir, "remotion-render"))
  const hyperframesOutDir = rel(path.join(outDir, "hyperframes"))
  const placeholderMediaPath = rel(path.join(outDir, "media", `${primaryClip.clipId}.placeholder.svg`))

  const clipLayerProps: Record<string, unknown> = {
    generatedClipId: primaryClip.clipId,
    provider: primaryClip.provider,
    model: primaryClip.model,
    providerJobId: primaryClip.jobId,
    plannedArtifactPath: primaryClip.artifactPath,
    artifactPath: primaryClip.artifactPath,
    mediaType: primaryClip.mediaType,
    mediaAvailable: primaryClip.mediaAvailable,
    dryRun: primaryClip.dryRun,
    placeholderPath: primaryClip.placeholderPath,
    objectFit: "cover",
    volume: 0,
  }
  if (primaryClip.resolvedMediaPath) {
    clipLayerProps.src = primaryClip.resolvedMediaPath
  } else {
    clipLayerProps.missingLiveMedia = true
    clipLayerProps.missingLiveMediaReason = primaryClip.missingLiveMediaReason
    clipLayerProps.placeholderImagePath = placeholderMediaPath
    clipLayerProps.placeholderMediaPath = placeholderMediaPath
  }

  const layerPlan = {
    schemaVersion: "tiktok-recreate.layer-plan.v1",
    videoId: conceptId,
    title,
    sourceManifest: args.handoff,
    generatedClipsManifest: args.generatedClips,
    spatialRenderOutput: args.spatialRenderOutput,
    ttsManifest: args.spatialRenderOutput,
    audioPath,
    durationSeconds,
    fps,
    palette: {
      background: "#05070d",
      primary: "#e8f2ff",
      accent: "#a8c8ff",
      aura: "#b7d7ff",
    },
    beats: [
      {
        beatIndex: 0,
        chapterId: "seedance-generated-clip",
        label: "Generated Seedance clip layer",
        mode: primaryClip.mediaAvailable ? "generated-mp4" : "deterministic-placeholder",
        timeRange: {
          startSeconds: 0,
          endSeconds: primaryClip.durationSec,
          startFrame: 0,
          endFrame: clipFrames,
        },
        caption: captions[0] ?? "stay close",
        motionCue: stringProp(firstPrompt, "seedanceMotionPrompt"),
        layers: [
          layer("BackgroundLayer", 0, { seed: conceptId, gradient: "moonlit-server-shrine" }),
          layer("ClipLayer", 10, clipLayerProps),
          layer("TypographyLayer", 40, {
            role: "caption",
            text: captions[0] ?? "stay close",
            variant: "caption",
            position: "bottom-center",
            color: "rgba(236, 246, 255, 0.95)",
          }),
          layer("FlashOverlay", 50, { color: "rgba(183, 215, 255, 0.16)", intensity: 0.32 }),
        ],
      },
      {
        beatIndex: 1,
        chapterId: "spatial-audio-tail",
        label: "Spatial ASMR audio tail",
        mode: "audio-hold",
        timeRange: {
          startSeconds: primaryClip.durationSec,
          endSeconds: durationSeconds,
          startFrame: clipFrames,
          endFrame: durationFrames,
        },
        caption: captions[1] ?? captions[0] ?? "the room is listening",
        sfx: audioPath,
        layers: [
          layer("BackgroundLayer", 0, { seed: `${conceptId}-audio-tail`, gradient: "deep-moonlit-hold" }),
          layer("GridOverlay", 15, { opacity: 0.18, gridSize: 108, color: "rgba(168, 200, 255, 0.2)" }),
          layer("TypographyLayer", 40, {
            role: "caption",
            text: captions[1] ?? captions[0] ?? "the room is listening",
            variant: "caption",
            position: "center",
            color: "rgba(236, 246, 255, 0.92)",
          }),
        ],
      },
    ],
  }

  const remotionContext = {
    schemaVersion: "tiktok-recreate.goal5-context.v1",
    id: conceptId,
    title,
    transcript: captions.join(" "),
    duration: durationSeconds,
    sourceManifests: {
      goal4Handoff: args.handoff,
      generatedClips: args.generatedClips,
      spatialRenderOutput: args.spatialRenderOutput,
    },
  }

  const personaManifest = {
    schemaVersion: "tiktok-recreate.goal5-persona-placeholder.v1",
    personaId: `${conceptId}-synthetic-companion`,
    note: "Goal 5 render proof uses generated clip and spatial audio layers; no separate persona image is required.",
  }

  const resolvedClips = {
    schemaVersion: "goal5-generated-clips-resolution.v1",
    createdAt: args.createdAt,
    sourceManifest: args.generatedClips,
    clips,
    placeholderMediaPath,
  }

  const hyperframesAnimationMap = {
    schemaVersion: "tiktok-recreate.hyperframes-animation-map.v1",
    createdAt: args.createdAt,
    proofId: args.proofId,
    sourceLayerPlan: layerPlanPath,
    rendererCompatibility: {
      remotionComposition: "TiktokRecreate",
      hyperframesProjectCommand: `bun run tiktok-recreate:hyperframes -- --layer-plan ${layerPlanPath} --out ${hyperframesOutDir} --audio ${audioPath}`,
    },
    clips: layerPlan.beats.map((beat) => ({
      beatIndex: beat.beatIndex,
      chapterId: beat.chapterId,
      startSeconds: beat.timeRange.startSeconds,
      endSeconds: beat.timeRange.endSeconds,
      layers: beat.layers.map((l) => ({
        type: l.type,
        zIndex: l.zIndex,
        mapsTo:
          l.type === "ClipLayer"
            ? primaryClip.mediaAvailable
              ? "html-video-layer"
              : "html-placeholder-layer"
            : l.type === "TypographyLayer"
              ? "html-text-overlay"
              : "html-div-layer",
        props: l.props,
      })),
    })),
    limitations: primaryClip.mediaAvailable
      ? []
      : ["Seedance dry-run manifest points at a planned MP4 artifact that is not present locally; both renderers use an explicit placeholder layer."],
  }

  const workflowHandoff = {
    schemaVersion: "tiktok-recreate.goal5-workflow-handoff.v1",
    proofId: args.proofId,
    createdAt: args.createdAt,
    inputs: {
      goal4Handoff: args.handoff,
      generatedClipsManifest: args.generatedClips,
      spatialRenderOutputManifest: args.spatialRenderOutput,
      spatialAudioPath: audioPath,
    },
    outputs: {
      remotionContext: remotionManifestPath,
      personaManifest: personaManifestPath,
      layerPlan: layerPlanPath,
      resolvedGeneratedClips: resolvedClipsPath,
      placeholderMedia: placeholderMediaPath,
      hyperframesAnimationMap: hyperframesMapPath,
      reviewerReport: reviewerReportPath,
      remotionOutDir,
      hyperframesOutDir,
    },
    rendererCommands: {
      materializeGoal5Handoff: `bun workflows/tiktok-recreate/goal5-asmr-handoff.ts --handoff ${args.handoff} --generated-clips ${args.generatedClips} --spatial-render-output ${args.spatialRenderOutput} --outDir ${args.outDir} --createdAt ${args.createdAt} --proofId ${args.proofId}`,
      remotion: `bun run remotion-renderer:render -- --manifest ${remotionManifestPath} --layer-plan ${layerPlanPath} --persona-manifest ${personaManifestPath} --out ${remotionOutDir} --audio-manifest ${args.spatialRenderOutput} --generated-clips-manifest ${args.generatedClips}`,
      hyperframes: `bun run tiktok-recreate:hyperframes -- --layer-plan ${layerPlanPath} --out ${hyperframesOutDir} --audio ${audioPath}`,
    },
    mediaReadiness: {
      generatedClipAvailable: primaryClip.mediaAvailable,
      missingLiveMedia: !primaryClip.mediaAvailable,
      missingLiveMediaReason: primaryClip.missingLiveMediaReason ?? null,
      placeholderMedia: placeholderMediaPath,
      spatialAudioAvailable: existsWithinRepo(audioPath),
    },
  }

  return {
    files: {
      [remotionManifestPath]: remotionContext,
      [personaManifestPath]: personaManifest,
      [layerPlanPath]: layerPlan,
      [resolvedClipsPath]: resolvedClips,
      [hyperframesMapPath]: hyperframesAnimationMap,
      [workflowHandoffPath]: workflowHandoff,
    },
    textFiles: {
      [placeholderMediaPath]: buildPlaceholderSvg({
        clipId: primaryClip.clipId,
        title,
        artifactPath: primaryClip.artifactPath,
        reason: primaryClip.missingLiveMediaReason ?? "Generated clip MP4 is available; placeholder retained for deterministic dry-run inspection.",
      }),
      [reviewerReportPath]: buildReviewerReport({
        placeholderMediaPath,
        handoffPath: workflowHandoffPath,
        layerPlanPath,
        hyperframesMapPath,
        audioPath,
        materializeCommand: workflowHandoff.rendererCommands.materializeGoal5Handoff,
        remotionCommand: workflowHandoff.rendererCommands.remotion,
        hyperframesCommand: workflowHandoff.rendererCommands.hyperframes,
        missingLiveMediaReason: primaryClip.missingLiveMediaReason ?? "Generated clip MP4 is available; placeholder retained for deterministic inspection.",
      }),
    },
    handoff: workflowHandoff,
  }
}

function main(argv: string[]): void {
  const args = parseArgs(argv)
  const result = buildGoal5Artifacts(args)
  const files = objectProp(result.files, "files")
  for (const [file, value] of Object.entries(files)) {
    const resolved = safeOutputFile(file)
    mkdirSync(path.dirname(resolved), { recursive: true })
    writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8")
  }
  const textFiles = objectProp(result.textFiles, "textFiles")
  for (const [file, value] of Object.entries(textFiles)) {
    if (typeof value !== "string") throw new Error(`text file content must be a string: ${file}`)
    const resolved = safeOutputFile(file)
    mkdirSync(path.dirname(resolved), { recursive: true })
    writeFileSync(resolved, value, "utf8")
  }
  const handoff = objectProp(result.handoff, "handoff")
  const outputs = objectProp(handoff.outputs, "outputs")
  process.stdout.write(`Goal 5 handoff written to ${path.join(args.outDir, "goal5-workflow-handoff.json")}\n`)
  process.stdout.write(`Layer plan: ${String(outputs.layerPlan)}\n`)
  process.stdout.write(`HyperFrames map: ${String(outputs.hyperframesAnimationMap)}\n`)
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    handoff: "",
    generatedClips: "",
    spatialRenderOutput: "",
    outDir: "data/asmr-companion/goal5-pipeline-proof",
    createdAt: DEFAULT_CREATED_AT,
    proofId: DEFAULT_PROOF_ID,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === "--handoff" && next) {
      args.handoff = next
      index += 1
    } else if (arg === "--generated-clips" && next) {
      args.generatedClips = next
      index += 1
    } else if (arg === "--spatial-render-output" && next) {
      args.spatialRenderOutput = next
      index += 1
    } else if (arg === "--outDir" && next) {
      args.outDir = next
      index += 1
    } else if (arg === "--createdAt" && next) {
      args.createdAt = next
      index += 1
    } else if (arg === "--proofId" && next) {
      args.proofId = next
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage())
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}\n${usage()}`)
    }
  }
  const missing: string[] = []
  if (!args.handoff) missing.push("--handoff <goal4 bundle>")
  if (!args.generatedClips) missing.push("--generated-clips <generated-video-clips.v1.json>")
  if (!args.spatialRenderOutput) missing.push("--spatial-render-output <render-output.json>")
  if (missing.length > 0) throw new Error(`Missing required flags: ${missing.join(", ")}\n${usage()}`)
  return args
}

function usage(): string {
  return `Usage: bun workflows/tiktok-recreate/goal5-asmr-handoff.ts \\
  --handoff data/asmr-companion/goal4-planning/goal4-pipeline-handoff.bundle.json \\
  --generated-clips data/asmr-companion/goal2/seedance-parent-proof/normalized/generated-video-clips.v1.json \\
  --spatial-render-output data/asmr-companion/goal3-spatial-proof/goal3-close-whisper-binaural.render-output.json \\
  --outDir data/asmr-companion/goal5-pipeline-proof`
}

function readJson(filePath: string, label: string): JsonObject {
  const resolved = safeInputFile(filePath)
  if (!existsSync(resolved)) throw new Error(`${label} not found: ${filePath}`)
  return JSON.parse(readFileSync(resolved, "utf8")) as JsonObject
}

function safeInputFile(filePath: string): string {
  const resolved = path.resolve(filePath)
  if (!isWithinRepo(resolved)) throw new Error(`Refusing to read outside repo: ${filePath}`)
  return resolved
}

function safeOutputDir(dirPath: string): string {
  const resolved = path.resolve(dirPath)
  if (!isWithinRepo(resolved)) throw new Error(`Refusing to write outside repo: ${dirPath}`)
  return resolved
}

function safeOutputFile(filePath: string): string {
  const resolved = path.resolve(filePath)
  if (!isWithinRepo(resolved)) throw new Error(`Refusing to write outside repo: ${filePath}`)
  return resolved
}

function isWithinRepo(resolvedPath: string): boolean {
  const repo = process.cwd()
  return resolvedPath === repo || resolvedPath.startsWith(`${repo}${path.sep}`)
}

function objectProp(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as JsonObject
}

function arrayProp(obj: JsonObject, key: string): unknown[] {
  const value = obj[key]
  if (!Array.isArray(value)) throw new Error(`${key} must be an array`)
  return value
}

function stringProp(obj: JsonObject, key: string): string {
  const value = obj[key]
  if (typeof value !== "string") throw new Error(`${key} must be a string`)
  return value
}

function optionalString(obj: JsonObject, key: string): string | undefined {
  const value = obj[key]
  return typeof value === "string" ? value : undefined
}

function promptTitle(handoff: JsonObject, conceptId: string): string | undefined {
  const cards = handoff.cards
  if (!Array.isArray(cards)) return undefined
  for (const card of cards) {
    const obj = typeof card === "object" && card !== null ? (card as JsonObject) : null
    if (obj && obj.conceptId === conceptId) return optionalString(obj, "title")
  }
  return undefined
}

function captionBeats(promptOutput: JsonObject): string[] {
  const plan = promptOutput.captionOverlayPlan
  if (typeof plan !== "object" || plan === null || Array.isArray(plan)) return []
  const beats = (plan as JsonObject).captionBeats
  return Array.isArray(beats) ? beats.filter((item): item is string => typeof item === "string") : []
}

function layer(type: string, zIndex: number, props: Record<string, unknown>): Record<string, unknown> {
  return {
    type,
    zIndex,
    in: { variant: "fade", durationSeconds: 0.2, easing: "easeOut" },
    out: { variant: "fade", durationSeconds: 0.2, easing: "easeIn" },
    props,
  }
}

function buildPlaceholderSvg(input: { clipId: string; title: string; artifactPath: string; reason: string }): string {
  const esc = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#05070d"/>
      <stop offset="50%" stop-color="#0b1122"/>
      <stop offset="100%" stop-color="#02040a"/>
    </linearGradient>
    <radialGradient id="aura" cx="50%" cy="24%" r="50%">
      <stop offset="0%" stop-color="#b7d7ff" stop-opacity="0.34"/>
      <stop offset="58%" stop-color="#5f8cff" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#02040a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <rect width="1080" height="1920" fill="url(#aura)"/>
  <g opacity="0.24">
    <path d="M140 220 C 320 180, 440 310, 610 260 S 930 210, 1010 340" fill="none" stroke="#b7d7ff" stroke-width="3"/>
    <path d="M90 780 C 260 710, 460 880, 610 820 S 880 720, 1010 910" fill="none" stroke="#b7d7ff" stroke-width="2"/>
    <path d="M160 1280 C 360 1200, 520 1360, 720 1290 S 920 1220, 1010 1380" fill="none" stroke="#b7d7ff" stroke-width="2"/>
  </g>
  <g transform="translate(90 1310)">
    <rect width="900" height="330" rx="32" fill="#030710" fill-opacity="0.76" stroke="#b7d7ff" stroke-opacity="0.34" stroke-width="2"/>
    <text x="42" y="72" fill="#ecf6ff" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="800" letter-spacing="4">GENERATED CLIP PLACEHOLDER</text>
    <text x="42" y="132" fill="#ecf6ff" fill-opacity="0.84" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="27">${esc(input.clipId)}</text>
    <text x="42" y="184" fill="#ecf6ff" fill-opacity="0.68" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="23">${esc(input.title)}</text>
    <text x="42" y="236" fill="#ecf6ff" fill-opacity="0.58" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="19">${esc(input.artifactPath)}</text>
    <text x="42" y="282" fill="#ecf6ff" fill-opacity="0.58" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="18">${esc(input.reason).slice(0, 115)}</text>
  </g>
</svg>
`
}

function buildReviewerReport(input: {
  placeholderMediaPath: string
  handoffPath: string
  layerPlanPath: string
  hyperframesMapPath: string
  audioPath: string
  materializeCommand: string
  remotionCommand: string
  hyperframesCommand: string
  missingLiveMediaReason: string
}): string {
  const esc = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
  const imageRel = path.relative(path.dirname(input.handoffPath), input.placeholderMediaPath).split(path.sep).join("/")
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Goal 5 ASMR Seedance Pipeline Proof</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #05070d; color: #ecf6ff; }
    main { max-width: 1120px; margin: 0 auto; padding: 40px 24px 80px; }
    h1 { margin: 0 0 10px; font-size: 32px; }
    h2 { margin-top: 34px; border-top: 1px solid rgba(183,215,255,.2); padding-top: 24px; }
    code, pre { background: rgba(183,215,255,.08); border: 1px solid rgba(183,215,255,.16); border-radius: 10px; }
    code { padding: 2px 6px; }
    pre { padding: 14px; overflow-x: auto; white-space: pre-wrap; }
    .grid { display: grid; grid-template-columns: 360px 1fr; gap: 24px; align-items: start; }
    .poster { width: 100%; max-height: 640px; object-fit: contain; border: 1px solid rgba(183,215,255,.25); border-radius: 18px; background: #02040a; }
    .callout { padding: 16px 18px; border: 1px solid rgba(255,210,120,.35); border-radius: 14px; background: rgba(255,210,120,.08); color: #ffe6b0; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
  <main>
    <h1>Goal 5 ASMR + Seedance render handoff proof</h1>
    <p>Materialized from Goal 4 handoff + Goal 2 generated clip manifest + Goal 3 spatial audio render-output.</p>
    <div class="callout">${esc(input.missingLiveMediaReason)}</div>
    <h2>Human-openable visual placeholder</h2>
    <div class="grid">
      <img class="poster" src="${esc(imageRel)}" alt="Generated clip placeholder" />
      <div>
        <p><strong>Placeholder media:</strong> <code>${esc(input.placeholderMediaPath)}</code></p>
        <p><strong>Remotion layer:</strong> <code>ClipLayer</code> with <code>missingLiveMedia=true</code>.</p>
        <p><strong>HyperFrames mapping:</strong> <code>${esc(input.hyperframesMapPath)}</code>.</p>
        <p><strong>Spatial audio:</strong> <code>${esc(input.audioPath)}</code>.</p>
      </div>
    </div>
    <h2>Proof files</h2>
    <ul>
      <li><code>${esc(input.handoffPath)}</code> — top-level Goal 5 handoff and rerun commands.</li>
      <li><code>${esc(input.layerPlanPath)}</code> — Remotion/HyperFrames-compatible layer plan.</li>
      <li><code>${esc(input.hyperframesMapPath)}</code> — concrete HyperFrames compatibility mapping.</li>
    </ul>
    <h2>Reviewer commands</h2>
    <pre>${esc(input.materializeCommand)}

bun test workflows/tiktok-recreate/goal5-asmr-handoff.test.ts

${esc(input.remotionCommand)}

${esc(input.hyperframesCommand)}</pre>
  </main>
</body>
</html>
`
}

function resolveGeneratedClips(manifest: JsonObject, manifestPath: string): ResolvedGeneratedClip[] {
  const clips = arrayProp(manifest, "clips")
  return clips.map((clip, index) => {
    const obj = objectProp(clip, `clips[${index}]`)
    const clipId = stringProp(obj, "clipId")
    const providerJob = objectProp(obj.providerJob, `clips[${index}].providerJob`)
    const generation = objectProp(obj.generation, `clips[${index}].generation`)
    const artifact = objectProp(obj.artifact, `clips[${index}].artifact`)
    const artifactPath = stringProp(artifact, "path")
    const resolved = resolveRepoPathIfSafe(artifactPath, path.dirname(path.resolve(manifestPath)))
    const mediaAvailable = Boolean(resolved && existsSync(resolved))
    return {
      clipId,
      provider: stringProp(providerJob, "provider"),
      model: stringProp(providerJob, "model"),
      jobId: stringProp(providerJob, "jobId"),
      artifactPath,
      mediaType: optionalString(artifact, "mediaType") ?? "video/mp4",
      durationSec: numberProp(generation, "durationSec"),
      fps: numberProp(generation, "fps"),
      dryRun: booleanProp(generation, "dryRun"),
      mediaAvailable,
      resolvedMediaPath: mediaAvailable ? path.relative(process.cwd(), resolved!).split(path.sep).join("/") : undefined,
      placeholderPath: DEFAULT_PLACEHOLDER,
      missingLiveMediaReason: mediaAvailable
        ? undefined
        : `Generated clip artifact is planned by ${manifestPath} but no local MP4 exists at ${artifactPath}.`,
    }
  })
}

function resolveAudioPath(spatialRender: JsonObject, spatialRenderPath: string): string {
  const direct = optionalString(spatialRender, "audioPath")
  const output = typeof spatialRender.output === "object" && spatialRender.output !== null ? (spatialRender.output as JsonObject) : undefined
  const nested = output ? optionalString(output, "audioPath") : undefined
  const audioPath = direct ?? nested
  if (!audioPath) throw new Error("Goal 3 spatial render-output has no audioPath")
  const resolved = resolveRepoPathIfSafe(audioPath, path.dirname(path.resolve(spatialRenderPath)))
  if (!resolved) throw new Error(`Unsafe audio path in spatial render-output: ${audioPath}`)
  return path.relative(process.cwd(), resolved).split(path.sep).join("/")
}

function resolveRepoPathIfSafe(value: string, baseDir: string): string | undefined {
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) return undefined
  if (value.startsWith("file://")) return resolveRepoPathIfSafe(new URL(value).pathname, baseDir)
  const candidates = path.isAbsolute(value)
    ? [path.resolve(value)]
    : [path.resolve(value), path.resolve(baseDir, value)]
  return candidates.find((candidate) => isWithinRepo(candidate))
}

function existsWithinRepo(value: string): boolean {
  const resolved = resolveRepoPathIfSafe(value, process.cwd())
  return Boolean(resolved && existsSync(resolved))
}

function numberProp(obj: JsonObject, key: string): number {
  const value = obj[key]
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`)
  return value
}

function booleanProp(obj: JsonObject, key: string): boolean {
  const value = obj[key]
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`)
  return value
}

function numberFromPath(obj: JsonObject, keys: string[]): number | undefined {
  let cursor: unknown = obj
  for (const key of keys) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) return undefined
    cursor = (cursor as JsonObject)[key]
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : undefined
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  }
}
