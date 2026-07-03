#!/usr/bin/env bun
/**
 * TikTok recreation bootstrap → Slotok workflow handoff.
 *
 * Reads a bootstrap manifest and Antigravity frame-decomposition JSON files,
 * then writes a JSON-safe Slotok import payload describing completed
 * decomposition artifacts and planned Jimeng/KIE/MiniMax TTS/Remotion generation steps.
 *
 * Usage:
 *   bun scripts/tiktok-recreate-handoff.boundary.ts \
 *     --manifest data/video-recreation/samuelszuchan/bootstrap-20260620/manifest.json \
 *     --decompositions data/video-recreation/samuelszuchan/bootstrap-20260620/antigravity-frame-decompositions \
 *     --out data/video-recreation/samuelszuchan/bootstrap-20260620/slotok-handoff.json \
 *     --lane ugc-ads \
 *     --sourcePolicy abstract-mechanics \
 *     [--plates data/video-recreation/samuelszuchan/bootstrap-20260620/plates] \
 *     [--minimaxOutDir data/video-recreation/samuelszuchan/bootstrap-20260620/tts] \
 *     [--minimaxMode dry-run]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"

const LANES = ["brainrot", "ugc-ads"] as const
const SOURCE_POLICIES = ["metadata-only", "abstract-mechanics", "rights-cleared-source"] as const
const REFERENCE_ARCHIVE_FORMAT_OUTPUT_KINDS = [
  "format-template",
  "pose-plan",
  "caption-template",
  "hook-family",
  "cta-pattern",
] as const

type Lane = (typeof LANES)[number]
type SourcePolicy = (typeof SOURCE_POLICIES)[number]
type ReferenceArchiveFormatOutputKind = (typeof REFERENCE_ARCHIVE_FORMAT_OUTPUT_KINDS)[number]

type JsonValue = string | number | boolean | null | { readonly [key: string]: JsonValue } | readonly JsonValue[]

interface ReferenceArchiveFormatOutput {
  readonly id: string
  readonly title: string
  readonly kind: ReferenceArchiveFormatOutputKind
  readonly summary: string
  readonly stageIds: readonly string[]
  readonly candidateIds: readonly string[]
  readonly manifestJson: JsonValue
}
interface ProviderJobInput {
  // Keep this union in sync with Slotok's UgcProvider (kie/jimeng/local/codex).
  // MiniMax TTS jobs are emitted as provider="local" / operation="minimax-tts"
  // because Slotok's import validator rejects unknown providers.
  readonly provider: "kie" | "jimeng" | "local" | "codex"
  readonly operation: string
  readonly mode?: "dry-run" | "live"
  readonly status?: "planned" | "queued" | "running" | "succeeded" | "failed" | "blocked" | "completed"
  readonly targetIds?: readonly string[]
  readonly spendCapUsd?: number
  readonly estimatedCostUsd?: number | null
  readonly request: JsonValue
  readonly response?: JsonValue | null
  readonly artifactPaths?: readonly string[]
  readonly error?: string | null
}

interface ReferenceArchiveInput {
  readonly referenceProfileId: string
  readonly sourcePolicy?: SourcePolicy
  readonly archiveStatus?: "not-started" | "queued" | "sampled" | "decomposed"
  readonly preservedMechanics?: JsonValue
  readonly swappedFields?: readonly string[]
  readonly blockedFields?: readonly string[]
  readonly guardrails?: readonly string[]
  readonly candidateFormatOutputs?: readonly ReferenceArchiveFormatOutput[]
  readonly notes?: readonly string[]
}

interface NoteInput {
  readonly author?: "arthur" | "agent"
  readonly attachedTo: { readonly kind: "persona" | "candidate" | "batch" | "branch" | "stage" | "reference-profile"; readonly id: string }
  readonly verdict: "keep" | "fork" | "revise" | "reject" | "watch-again"
  readonly body: string
  readonly requestedChange?: string | null
}

interface HandoffPayload {
  readonly lane: Lane
  readonly sourcePolicy: SourcePolicy
  readonly records?: readonly JsonValue[]
  readonly providerJobs?: readonly ProviderJobInput[]
  readonly candidatePatches?: readonly never[]
  readonly referenceArchives?: readonly ReferenceArchiveInput[]
  readonly notes?: readonly NoteInput[]
  readonly artifactPaths?: readonly string[]
  readonly result?: JsonValue | null
  readonly metadata?: JsonValue
  readonly resultMetadata?: JsonValue
}

interface BootstrapVideo {
  readonly id: string
  readonly title?: string
  readonly description?: string
  readonly duration?: number
  readonly view_count?: number
  readonly like_count?: number
  readonly comment_count?: number
  readonly frames?: readonly string[]
  readonly transcript?: string
}

interface BootstrapManifest {
  readonly schemaVersion?: string
  readonly sourceProfile?: string
  readonly selectedCount?: number
  readonly videos?: readonly BootstrapVideo[]
}

interface DecompositionFormat {
  readonly format_family?: string
  readonly hook_pattern?: string
  readonly script_structure?: readonly string[]
  readonly visual_structure?: readonly string[]
  readonly caption_style?: readonly string[]
  readonly pacing_notes?: readonly string[]
  readonly retention_devices?: readonly string[]
}

interface DecompositionTimelineSegment {
  readonly start_seconds?: number
  readonly end_seconds?: number
  readonly narration_function?: string
  readonly visual_function?: string
  readonly remotion_equivalent?: string
}

interface DecompositionRecipe {
  readonly research_input_slot?: string
  readonly script_generation_prompt?: string
  readonly jimeng_persona_prompt_zh?: string
  readonly jimeng_persona_description_zh?: string
  readonly slide_visual_prompts?: readonly string[]
  readonly remotion_layers?: readonly string[]
  readonly provider_routes?: readonly JsonValue[]
}

interface DecompositionFile {
  readonly source_video_id?: string
  readonly transcript?: JsonValue
  readonly format_decomposition?: DecompositionFormat
  readonly timeline?: readonly DecompositionTimelineSegment[]
  readonly recreation_recipe?: DecompositionRecipe
  readonly slotok_artifacts?: readonly JsonValue[]
  readonly comparison_metrics?: readonly string[]
  readonly uncertainties?: readonly string[]
}

interface Args {
  manifest: string
  decompositions: string
  out: string
  lane: Lane
  sourcePolicy: SourcePolicy
  plates: string
  minimaxOutDir: string
  minimaxMode: string
}

function main(argv: string[]): void {
  const args = parseArgs(argv)
  validateArgs(args)

  const manifest = readJsonFile<BootstrapManifest>(args.manifest, "manifest")
  if (!manifest.videos || manifest.videos.length === 0) {
    throw new Error(`Manifest has no videos: ${args.manifest}`)
  }

  const decompositions = loadDecompositions(args.decompositions, manifest.videos)
  const payload = buildHandoff(args, manifest, decompositions)

  const outPath = resolve(args.out)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  console.error(`Wrote handoff to ${relative(process.cwd(), outPath)}`)
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    manifest: "",
    decompositions: "",
    out: "",
    lane: "ugc-ads",
    sourcePolicy: "abstract-mechanics",
    plates: "",
    minimaxOutDir: "",
    minimaxMode: "dry-run",
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const next = argv[index + 1]
    if (arg === "--manifest" && next) {
      args.manifest = next
      index += 1
    } else if (arg === "--decompositions" && next) {
      args.decompositions = next
      index += 1
    } else if (arg === "--out" && next) {
      args.out = next
      index += 1
    } else if (arg === "--lane" && next) {
      args.lane = parseEnum(next, LANES, "--lane")
      index += 1
    } else if (arg === "--sourcePolicy" && next) {
      args.sourcePolicy = parseEnum(next, SOURCE_POLICIES, "--sourcePolicy")
      index += 1
    } else if (arg === "--plates" && next) {
      args.plates = next
      index += 1
    } else if (arg === "--minimaxOutDir" && next) {
      args.minimaxOutDir = next
      index += 1
    } else if (arg === "--minimaxMode" && next) {
      args.minimaxMode = next
      index += 1
    } else if (arg === "--help" || arg === "-h") {
      console.log(usageText())
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag: ${arg}. Use --help for usage.`)
    }
  }

  return args
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], label: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${label} must be one of ${allowed.join(" | ")}, got ${value}`)
  }
  return value as T
}

function validateArgs(args: Args): void {
  const missing: string[] = []
  if (!args.manifest) missing.push("--manifest <path>")
  if (!args.decompositions) missing.push("--decompositions <dir>")
  if (!args.out) missing.push("--out <path>")
  if (missing.length > 0) {
    throw new Error(`Missing required flags: ${missing.join(", ")}\n\n${usageText()}`)
  }
}

function usageText(): string {
  return `Usage: bun scripts/tiktok-recreate-handoff.boundary.ts [flags]

Required:
  --manifest <path>         Path to tiktok-recreate bootstrap manifest.json
  --decompositions <dir>    Directory containing Antigravity decomposition *.json files
  --out <path>              Path to write the Slotok handoff JSON

Optional:
  --lane brainrot|ugc-ads                         (default: ugc-ads)
  --sourcePolicy metadata-only|abstract-mechanics|rights-cleared-source   (default: abstract-mechanics)
  --plates <dir>            KIE plates output directory (default: <manifest-dir>/plates)
  --minimaxOutDir <dir>     MiniMax TTS audio output directory (default: <manifest-dir>/tts)
  --minimaxMode dry-run|live    TTS synthesis mode (default: dry-run)
  --help, -h            Show this help`
}

function readJsonFile<T>(filePath: string, label: string): T {
  const resolved = resolve(filePath)
  if (!existsSync(resolved)) {
    throw new Error(`${label} not found: ${filePath}`)
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8")) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse ${label} at ${filePath}: ${message}`)
  }
}

function loadDecompositions(dir: string, videos: readonly BootstrapVideo[]): Map<string, DecompositionFile> {
  const decompositionsDir = resolve(dir)
  if (!existsSync(decompositionsDir)) {
    throw new Error(`Decompositions directory not found: ${dir}`)
  }

  const entries = readdirSync(decompositionsDir, { withFileTypes: true })
  const available = new Set(
    entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => entry.name),
  )

  const out = new Map<string, DecompositionFile>()
  for (const video of videos) {
    const fileName = `${video.id}.json`
    if (!available.has(fileName)) {
      throw new Error(`Missing decomposition for video ${video.id}: expected ${join(dir, fileName)}`)
    }
    const filePath = join(decompositionsDir, fileName)
    out.set(video.id, readJsonFile<DecompositionFile>(filePath, `decomposition for ${video.id}`))
  }

  return out
}

function buildHandoff(
  args: Args,
  manifest: BootstrapManifest,
  decompositions: Map<string, DecompositionFile>,
): HandoffPayload {
  const providerJobs: ProviderJobInput[] = []
  const artifactPaths: string[] = []
  const now = new Date().toISOString()
  const batchId = now.replace(/[^0-9]/g, "").slice(0, 14)
  artifactPaths.push(relativePath(args.manifest))

  const platesDir = args.plates || join(dirname(args.manifest), "plates")
  const relPlatesDir = relativePath(platesDir)
  const rendersDir = join(dirname(args.manifest), "renders")
  const relRendersDir = relativePath(rendersDir)
  const ttsDir = args.minimaxOutDir || join(dirname(args.manifest), "tts")
  const relTtsDir = relativePath(ttsDir)

  for (const video of manifest.videos ?? []) {
    const decomposition = decompositions.get(video.id)
    if (!decomposition) {
      throw new Error(`Decomposition missing for video ${video.id}`)
    }

    const decompositionPath = join(args.decompositions, `${video.id}.json`)
    const relDecompositionPath = relativePath(decompositionPath)
    const frameDir = join(dirname(args.manifest), "frames", video.id)
    const relFrameDir = relativePath(frameDir)

    providerJobs.push(buildAntigravityJob(video, decomposition, relDecompositionPath, manifest.sourceProfile, batchId))
    providerJobs.push(buildJimengJob(video, decomposition, args.manifest, batchId))
    providerJobs.push(...buildKieJobs(video, decomposition, platesDir, relPlatesDir, batchId))
    providerJobs.push(buildRemotionJob(video, decomposition, rendersDir, relRendersDir, batchId))
    providerJobs.push(buildMinimaxTtsJob(video, decomposition, ttsDir, relTtsDir, args.minimaxMode, batchId))

    artifactPaths.push(relDecompositionPath)
    if (existsSync(frameDir)) {
      artifactPaths.push(relFrameDir)
    }
  }

  artifactPaths.push(relPlatesDir)
  artifactPaths.push(relRendersDir)
  artifactPaths.push(relTtsDir)
  if (existsSync(platesDir)) {
    artifactPaths.push(join(relPlatesDir, "manifest.json"))
  }
  return {
    lane: args.lane,
    sourcePolicy: args.sourcePolicy,
    records: [],
    providerJobs,
    candidatePatches: [],
    referenceArchives: [],
    notes: [],
    artifactPaths,
    result: {
      summary: {
        sourceProfile: manifest.sourceProfile,
        videoCount: manifest.videos?.length ?? 0,
        decompositionCount: decompositions.size,
        plannedProviderJobCount: providerJobs.length,
        referenceArchiveCount: 0,
      },
    },
    metadata: {
      schemaVersion: "tiktok-recreate-handoff.v1",
      manifestSchemaVersion: manifest.schemaVersion,
      generatedAt: now,
      handoffBatchId: batchId,
    },
    resultMetadata: {
      cleanRoomPolicy: args.sourcePolicy,
      sourceMediaExcluded: true,
      rightsStatus: "public-research-target",
    },
  }
}

function buildAntigravityJob(
  video: BootstrapVideo,
  decomposition: DecompositionFile,
  decompositionPath: string,
  sourceProfile: string | undefined,
  batchId: string,
): ProviderJobInput {
  const format = decomposition.format_decomposition
  const timeline = decomposition.timeline ?? []
  return {
    id: `antigravity-decomp-${video.id}-${batchId}`,
    provider: "codex",
    operation: "antigravity-frame-decomposition",
    mode: "dry-run",
    status: "completed",
    targetIds: [],
    spendCapUsd: 0,
    estimatedCostUsd: null,
    request: redactedJsonValue({
      sourceVideoId: video.id,
      sourceProfile,
      inputPolicy: "abstract-mechanics",
      frameSampleCount: video.frames?.length ?? 0,
    }),
    response: redactedJsonValue({
      sourceVideoId: decomposition.source_video_id ?? video.id,
      formatFamily: format?.format_family,
      hookPattern: format?.hook_pattern,
      scriptStructure: format?.script_structure,
      visualStructure: format?.visual_structure,
      captionStyle: format?.caption_style,
      pacingNotes: format?.pacing_notes,
      retentionDevices: format?.retention_devices,
      timelineSegments: timeline.length,
      remotionEquivalents: timeline.map((segment) => segment.remotion_equivalent).filter(Boolean),
      slideVisualPromptsCount: decomposition.recreation_recipe?.slide_visual_prompts?.length ?? 0,
    }),
    artifactPaths: [decompositionPath],
    error: null,
  }
}

function buildJimengJob(
  video: BootstrapVideo,
  decomposition: DecompositionFile,
  manifestPath: string,
  batchId: string,
): ProviderJobInput {
  const recipe = decomposition.recreation_recipe
  return {
    id: `jimeng-persona-${video.id}-${batchId}`,
    provider: "jimeng",
    operation: "synthetic-persona-generation",
    mode: "dry-run",
    status: "planned",
    targetIds: [],
    spendCapUsd: 0.5,
    estimatedCostUsd: 0.5,
    request: redactedJsonValue({
      sourceVideoId: video.id,
      personaPromptZh: recipe?.jimeng_persona_prompt_zh,
      personaDescriptionZh: recipe?.jimeng_persona_description_zh,
      slideVisualPromptCount: recipe?.slide_visual_prompts?.length ?? 0,
      concurrency: 1,
      outDir: join(dirname(manifestPath), "jimeng-personas", video.id),
      note: "Run explicitly with outDir/artifact paths and concurrency 1. Not executed during handoff generation.",
    }),
    response: null,
    artifactPaths: [],
    error: null,
  }
}

function buildKieJobs(
  video: BootstrapVideo,
  decomposition: DecompositionFile,
  platesDir: string,
  relPlatesDir: string,
  batchId: string,
): ProviderJobInput[] {
  const prompts = decomposition.recreation_recipe?.slide_visual_prompts ?? []
  const jobs: ProviderJobInput[] = []
  for (let index = 0; index < prompts.length; index += 1) {
    const jobId = `${video.id}_slide_${index}_${batchId}`
    const requestPath = join(relPlatesDir, "requests", `${jobId}_request.json`)
    const responsePath = join(relPlatesDir, "responses", `${jobId}_response.json`)
    const plateDir = join(relPlatesDir, "plates", jobId)
    jobs.push({
      id: `kie-image-${jobId}`,
      provider: "kie",
      operation: "image-text",
      mode: "dry-run",
      status: "planned",
      targetIds: [],
      spendCapUsd: 0.25,
      estimatedCostUsd: 0.25,
      request: redactedJsonValue({
        videoId: video.id,
        slideIndex: index,
        slideVisualPrompt: prompts[index],
        prefixedPrompt: "",
        negativePrompt: "source creator likeness, source logos, watermarks, readable text, copyrighted characters, identifiable private locations",
        operation: "image-text",
        aspectRatio: "9:16",
        quality: "basic",
        preparedPayloadPath: requestPath,
        outDir: platesDir,
      }),
      response: redactedJsonValue({
        createResponsePath: responsePath,
        resultUrls: [],
        resultPlatePaths: [plateDir],
        state: "prepared",
      }),
      artifactPaths: [requestPath, plateDir],
      error: null,
    })
  }
  return jobs
}

function buildRemotionJob(
  video: BootstrapVideo,
  decomposition: DecompositionFile,
  rendersDir: string,
  relRendersDir: string,
  batchId: string,
): ProviderJobInput {
  const recipe = decomposition.recreation_recipe
  const timeline = decomposition.timeline ?? []
  const renderDir = join(relRendersDir, video.id)
  return {
    id: `remotion-render-${video.id}-${batchId}`,
    provider: "local",
    operation: "remotion-render",
    mode: "dry-run",
    status: "planned",
    targetIds: [],
    spendCapUsd: 0,
    estimatedCostUsd: 0,
    request: redactedJsonValue({
      sourceVideoId: video.id,
      remotionLayers: recipe?.remotion_layers,
      remotionEquivalents: timeline.map((segment) => ({
        segment: `${segment.start_seconds ?? 0}-${segment.end_seconds ?? 0}`,
        component: segment.remotion_equivalent,
      })),
      durationSeconds: video.duration,
      scriptGenerationPrompt: recipe?.script_generation_prompt,
      outDir: join(rendersDir, video.id),
      expectedArtifacts: {
        mp4: join(renderDir, "recreate.mp4"),
        manifest: join(renderDir, "manifest.json"),
      },
    }),
    response: null,
    artifactPaths: [renderDir],
    error: null,
  }
}

function buildMinimaxTtsJob(
  video: BootstrapVideo,
  decomposition: DecompositionFile,
  ttsDir: string,
  relTtsDir: string,
  mode: string,
  batchId: string,
): ProviderJobInput {
  const jobId = `${video.id}_${batchId}`
  const videoTtsDir = join(relTtsDir, video.id)
  return {
    id: `minimax-tts-${jobId}`,
    provider: "local",
    operation: "minimax-tts",
    mode: mode === "live" ? "live" : "dry-run",
    status: "planned",
    targetIds: [],
    spendCapUsd: 0.5,
    estimatedCostUsd: 0.1,
    request: redactedJsonValue({
      videoId: video.id,
      voiceId: "289066744107112",
      model: "speech-2.8-turbo",
      outDir: ttsDir,
      expectedAudioPaths: [
        join(videoTtsDir, "audio", "narration.mp3"),
        join(videoTtsDir, "audio", "narration.response.json"),
        join(videoTtsDir, "tts-manifest.json"),
      ],
      note: "Synthetic voice only — no creator imitation.",
    }),
    response: null,
    artifactPaths: [videoTtsDir],
    error: null,
  }
}

function buildReferenceArchive(
  video: BootstrapVideo,
  decomposition: DecompositionFile,
  sourcePolicy: SourcePolicy,
  sourceProfile: string | undefined,
): ReferenceArchiveInput {
  const format = decomposition.format_decomposition
  const recipe = decomposition.recreation_recipe
  const timeline = decomposition.timeline ?? []

  const formatOutputs: ReferenceArchiveFormatOutput[] = []
  if (format?.format_family) {
    formatOutputs.push({
      id: `format-${video.id}`,
      title: format.format_family,
      kind: "format-template",
      summary: `Hook pattern: ${format.hook_pattern ?? "unknown"}; ${format.script_structure?.length ?? 0} script beats; ${format.visual_structure?.length ?? 0} visual motifs.`,
      stageIds: [],
      candidateIds: [],
      manifestJson: redactedJsonValue({
        scriptStructure: format.script_structure,
        visualStructure: format.visual_structure,
        captionStyle: format.caption_style,
        pacingNotes: format.pacing_notes,
        retentionDevices: format.retention_devices,
      }),
    })
  }

  if (format?.hook_pattern) {
    formatOutputs.push({
      id: `hook-${video.id}`,
      title: format.hook_pattern,
      kind: "hook-family",
      summary: `Abstract hook family derived from ${video.id} metadata.`,
      stageIds: [],
      candidateIds: [],
      manifestJson: redactedJsonValue({
        hookPattern: format.hook_pattern,
        narrationFunctions: timeline.map((segment) => segment.narration_function).filter(Boolean),
      }),
    })
  }

  if (format?.caption_style && format.caption_style.length > 0) {
    formatOutputs.push({
      id: `caption-${video.id}`,
      title: `${format.caption_style.join(", ")} captions`,
      kind: "caption-template",
      summary: `Caption mechanics abstracted from decomposition; verbatim text excluded under ${sourcePolicy} policy.`,
      stageIds: [],
      candidateIds: [],
      manifestJson: redactedJsonValue({ captionStyle: format.caption_style }),
    })
  }

  return {
    referenceProfileId: `tiktok-ref-${video.id}`,
    sourcePolicy,
    archiveStatus: "decomposed",
    preservedMechanics: redactedJsonValue({
      formatFamily: format?.format_family,
      hookPattern: format?.hook_pattern,
      scriptStructure: format?.script_structure,
      visualStructure: format?.visual_structure,
      captionStyle: format?.caption_style,
      pacingNotes: format?.pacing_notes,
      retentionDevices: format?.retention_devices,
      timeline: timeline.map((segment) => ({
        startSeconds: segment.start_seconds,
        endSeconds: segment.end_seconds,
        narrationFunction: segment.narration_function,
        visualFunction: segment.visual_function,
        remotionEquivalent: segment.remotion_equivalent,
      })),
      remotionLayers: recipe?.remotion_layers,
      providerRoutes: recipe?.provider_routes?.map((route) =>
        typeof route === "object" && route !== null ? redactProviderRoute(route as Record<string, JsonValue>) : route,
      ),
    }),
    swappedFields: ["face / likeness", "voice", "verbatim transcript", "source pixels and audio", "narrator identity"],
    blockedFields: [
      "mp4 source file",
      "raw audio stream",
      "signed URLs",
      "cookies / auth tokens",
      "direct generation input under abstract-mechanics",
    ],
    guardrails: [
      "abstract-mechanics-only",
      "no-direct-source-media",
      "public-research-target",
      "jimeng-live-explicit-command-only",
    ],
    candidateFormatOutputs: formatOutputs,
    notes: [
      `Reference archive derived from public TikTok metadata for ${sourceProfile ?? "unknown profile"} video ${video.id}.`,
      `Source policy: ${sourcePolicy}. Verbatim media excluded from generation inputs.`,
    ],
  }
}

function redactProviderRoute(route: Record<string, JsonValue>): JsonValue {
  const redacted: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(route)) {
    redacted[key] = /cookie|authorization|token|secret|signature|url$/i.test(key) ? "[REDACTED]" : value
  }
  return redacted
}

function buildNotes(): NoteInput[] {
  return [
    {
      author: "agent",
      attachedTo: { kind: "batch", id: "tiktok-recreate-bootstrap" },
      verdict: "keep",
      body:
        "Clean-room mechanics derived from public TikTok metadata only. " +
        "Source media, signed URLs, cookies, and raw likeness/voice are excluded from generation inputs. " +
        "Jimeng, KIE, MiniMax TTS, and Remotion jobs are planned/dry-run; run live generation explicitly with outDir/artifact paths, spend caps, and concurrency 1.",
    },
  ]
}

function relativePath(filePath: string): string {
  const resolved = resolve(filePath)
  const cwd = process.cwd()
  return resolved.startsWith(`${cwd}/`) ? resolved.slice(cwd.length + 1) : filePath
}

function redactedJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

try {
  main(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
