import { createHash } from "node:crypto"
import { decodeGeneratedVideoClipsV1, type GeneratedVideoClipsV1 } from "@wirebabel/media-contracts"

export const BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA = "brainrot_referential_mirror_card.v1" as const
export const PROMPT_PLAN_SCHEMA = "brainrot-referential-prompt-plan.v1" as const
export const GOAL4_HANDOFF_SCHEMA = "goal4-pleometric-pipeline-handoff.v1" as const

export type ReferencePosture = "abstract_mechanics" | "direct_reference_declared" | "generated_fixture" | "upstream_manifest"

export interface SourceLineageReference {
  label: string
  sourceKind: "abstract_mechanic" | "direct_reference" | "generated_fixture" | "upstream_manifest"
  mechanic: string
  referencePosture: ReferencePosture
  pipelineNote: string
}

export interface BrainrotReferentialMirrorNode {
  nodeId: string
  node: string
  viewerRecognition: string
  sourceLineage: SourceLineageReference[]
  handoffTo: string[]
  avoid: string[]
}

export interface BrainrotReferentialMirrorHandoff {
  target: "goal2_seedance" | "goal3_spatial_audio" | "goal5_video_pipeline" | string
  consumes: string[]
  emits: string[]
  ownershipBoundary: string
}

export interface BrainrotReferentialMirrorLayers {
  primaryCharacter: string
  secondaryPropOrCharacter: string
  background: string
  audio: string
  edit: {
    captionBeats: string[]
    overlayMotifs: string[]
    cutRhythm: string
  }
  i2vControls: {
    ratio: "9:16" | "16:9" | "1:1" | string
    durationSec: number
    fps: number
    camera: string
    motion: string
    timing: string
    stability: string
  }
}

export interface BrainrotProviderPrompts {
  image: {
    subject: string
    style: string
    lighting: string
    negative: string
  }
  seedance: {
    motion: string
    camera: string
    stability: string
    negative: string
  }
}

export interface BrainrotAudioIntent {
  spatialReference: string
  musicReference: string
  goal3BindingHint: string
}

export type ProviderParamValue = string | number | boolean

export interface ProviderRouteMetadata {
  provider: string
  model: string
  endpoint: string
  seed: number
  providerParams: Record<string, ProviderParamValue>
}

export interface BrainrotPipelineMetadata {
  createdAt: string
  authoringMode: "original_planning" | "local_remix_art_piece" | string
  upstreamManifestRefs: string[]
  sourceInspirationIds: string[]
  providerRoute: ProviderRouteMetadata
  vibeAxes: string[]
  planningNotes: string[]
}

export interface BrainrotReferentialMirrorCard {
  schemaVersion: typeof BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA
  conceptId: string
  title: string
  originalityBoundary: string
  referentialMirrorGraph: BrainrotReferentialMirrorNode[]
  recognitionChain: string[]
  sourceLineage: SourceLineageReference[]
  handoffs: BrainrotReferentialMirrorHandoff[]
  avoidList: string[]
  layers: BrainrotReferentialMirrorLayers
  providerPrompts: BrainrotProviderPrompts
  audioIntent: BrainrotAudioIntent
  pipelineMetadata: BrainrotPipelineMetadata
}

export interface BrainrotPromptPlan {
  schemaVersion: typeof PROMPT_PLAN_SCHEMA
  conceptId: string
  cardSchemaVersion: typeof BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA
  title: string
  promptHash: {
    algorithm: "sha256"
    value: string
  }
  prompts: {
    imagePrompt: {
      lane: "first_frame_image"
      text: string
      negative: string
    }
    seedanceMotionPrompt: {
      lane: "seedance_i2v_motion"
      text: string
      controls: BrainrotReferentialMirrorLayers["i2vControls"]
      negative: string
    }
  }
  audioIntentReference: {
    spatialAudioReference: string
    musicIntent: string
    goal3BindingHint: string
    ownershipBoundary: string
  }
  captionOverlayPlan: {
    captionBeats: string[]
    overlayMotifs: string[]
    cutRhythm: string
  }
  pipelineMetadata: {
    providerRoute: ProviderRouteMetadata
    upstreamManifestRefs: string[]
    sourceInspirationIds: string[]
    vibeAxes: string[]
  }
  pipelineMetadataNotes: string[]
  handoffTargets: BrainrotReferentialMirrorHandoff[]
  avoidList: string[]
}

export interface Goal2ClipConstraintReference {
  clipId: string
  promptHash: {
    algorithm: string
    value: string
  }
  firstFrameConditioningManifestPath: string
  generation: {
    durationSec: number
    ratio: string
    fps: number
    dryRun: boolean
  }
  plannedArtifactPath: string
}

export interface Goal2GeneratedVideoReference {
  owner: "goal2_seedance"
  manifestPath: string
  schemaVersion: GeneratedVideoClipsV1["schemaVersion"]
  manifestId: string
  clipConstraints: Goal2ClipConstraintReference[]
  ownershipBoundary: string
}

export interface SpatialAudioRenderOutputReference {
  owner: "goal3_spatial_audio"
  renderOutputPath: string
  schemaVersion: string
  audioPath: string
  output: {
    mediaType: string
    channels: number
    sampleRateHz: number
    durationSec: number
    sha256: string
  }
  sourceManifests: {
    voiceAssetsManifestPath: string
    stemsManifestPath: string
    spatialAudioManifestPath: string
  }
  ownershipBoundary: string
}

export interface Goal4PipelineHandoffBundle {
  schemaVersion: typeof GOAL4_HANDOFF_SCHEMA
  bundleId: string
  createdAt: string
  cards: Array<{
    conceptId: string
    title: string
    cardSchemaVersion: typeof BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA
  }>
  promptPlans: BrainrotPromptPlan[]
  upstreamReferences: {
    generatedVideo: Goal2GeneratedVideoReference
    spatialAudio: SpatialAudioRenderOutputReference
  }
  goal5Handoff: {
    consume: string[]
    doNotOwn: string[]
    rendererIntent: {
      captionOverlayPlans: Array<{
        conceptId: string
        captionBeats: string[]
        overlayMotifs: string[]
      }>
      audioBinding: {
        audioPath: string
        renderOutputPath: string
        spatialAudioManifestPath: string
      }
      generatedClipManifestPath: string
    }
  }
  pipelineMetadataNotes: string[]
}


export class BrainrotPlannerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BrainrotPlannerValidationError"
  }
}

export interface BuildPromptPlanOptions {
  createdAt?: string
}

export interface BuildGoal4PipelineHandoffInput {
  bundleId: string
  createdAt: string
  cards: readonly BrainrotReferentialMirrorCard[]
  generatedClipsManifest: unknown
  generatedClipsManifestPath: string
  spatialRenderOutput: unknown
  spatialRenderOutputPath: string
}

export function decodeBrainrotReferentialMirrorCard(value: unknown): BrainrotReferentialMirrorCard {
  const record = asRecord(value, "card")
  const schemaVersion = asString(record.schemaVersion, "card.schemaVersion")
  if (schemaVersion !== BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA) {
    throw new BrainrotPlannerValidationError(`card.schemaVersion must be ${BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA}`)
  }

  const card = value as BrainrotReferentialMirrorCard
  validateBrainrotReferentialMirrorCard(card)
  return card
}

export function validateBrainrotReferentialMirrorCard(card: BrainrotReferentialMirrorCard): void {
  requireString(card.conceptId, "card.conceptId")
  requireString(card.title, "card.title")
  requireString(card.originalityBoundary, "card.originalityBoundary")
  requireNonEmptyArray(card.referentialMirrorGraph, "card.referentialMirrorGraph")
  requireNonEmptyArray(card.recognitionChain, "card.recognitionChain")
  requireNonEmptyArray(card.sourceLineage, "card.sourceLineage")
  requireNonEmptyArray(card.handoffs, "card.handoffs")
  requireNonEmptyArray(card.avoidList, "card.avoidList")

  for (const node of card.referentialMirrorGraph) {
    requireString(node.nodeId, "card.referentialMirrorGraph[].nodeId")
    requireString(node.node, "card.referentialMirrorGraph[].node")
    requireString(node.viewerRecognition, "card.referentialMirrorGraph[].viewerRecognition")
    requireNonEmptyArray(node.sourceLineage, "card.referentialMirrorGraph[].sourceLineage")
    requireNonEmptyArray(node.handoffTo, "card.referentialMirrorGraph[].handoffTo")
    requireNonEmptyArray(node.avoid, "card.referentialMirrorGraph[].avoid")
  }

  requireString(card.layers.primaryCharacter, "card.layers.primaryCharacter")
  requireString(card.layers.secondaryPropOrCharacter, "card.layers.secondaryPropOrCharacter")
  requireString(card.layers.background, "card.layers.background")
  requireString(card.layers.audio, "card.layers.audio")
  requireNonEmptyArray(card.layers.edit.captionBeats, "card.layers.edit.captionBeats")
  requireNonEmptyArray(card.layers.edit.overlayMotifs, "card.layers.edit.overlayMotifs")
  requireString(card.layers.edit.cutRhythm, "card.layers.edit.cutRhythm")
  requireString(card.layers.i2vControls.ratio, "card.layers.i2vControls.ratio")
  requirePositiveNumber(card.layers.i2vControls.durationSec, "card.layers.i2vControls.durationSec")
  requirePositiveNumber(card.layers.i2vControls.fps, "card.layers.i2vControls.fps")
  requireString(card.layers.i2vControls.camera, "card.layers.i2vControls.camera")
  requireString(card.layers.i2vControls.motion, "card.layers.i2vControls.motion")
  requireString(card.layers.i2vControls.timing, "card.layers.i2vControls.timing")
  requireString(card.layers.i2vControls.stability, "card.layers.i2vControls.stability")
  requireString(card.providerPrompts.image.subject, "card.providerPrompts.image.subject")
  requireString(card.providerPrompts.image.style, "card.providerPrompts.image.style")
  requireString(card.providerPrompts.image.lighting, "card.providerPrompts.image.lighting")
  requireString(card.providerPrompts.image.negative, "card.providerPrompts.image.negative")
  requireString(card.providerPrompts.seedance.motion, "card.providerPrompts.seedance.motion")
  requireString(card.providerPrompts.seedance.camera, "card.providerPrompts.seedance.camera")
  requireString(card.providerPrompts.seedance.stability, "card.providerPrompts.seedance.stability")
  requireString(card.providerPrompts.seedance.negative, "card.providerPrompts.seedance.negative")
  requireString(card.audioIntent.spatialReference, "card.audioIntent.spatialReference")
  requireString(card.audioIntent.musicReference, "card.audioIntent.musicReference")
  requireString(card.audioIntent.goal3BindingHint, "card.audioIntent.goal3BindingHint")
  requireString(card.pipelineMetadata.createdAt, "card.pipelineMetadata.createdAt")
  requireString(card.pipelineMetadata.authoringMode, "card.pipelineMetadata.authoringMode")
  requireNonEmptyArray(card.pipelineMetadata.upstreamManifestRefs, "card.pipelineMetadata.upstreamManifestRefs")
  requireNonEmptyArray(card.pipelineMetadata.sourceInspirationIds, "card.pipelineMetadata.sourceInspirationIds")
  requireString(card.pipelineMetadata.providerRoute.provider, "card.pipelineMetadata.providerRoute.provider")
  requireString(card.pipelineMetadata.providerRoute.model, "card.pipelineMetadata.providerRoute.model")
  requireString(card.pipelineMetadata.providerRoute.endpoint, "card.pipelineMetadata.providerRoute.endpoint")
  requirePositiveNumber(card.pipelineMetadata.providerRoute.seed, "card.pipelineMetadata.providerRoute.seed")
  requireNonEmptyArray(card.pipelineMetadata.vibeAxes, "card.pipelineMetadata.vibeAxes")
  requireNonEmptyArray(card.pipelineMetadata.planningNotes, "card.pipelineMetadata.planningNotes")

  assertAvoidListDoesNotAppearInPositivePromptFields(card)
}

export function buildPromptPlan(card: BrainrotReferentialMirrorCard, _options: BuildPromptPlanOptions = {}): BrainrotPromptPlan {
  validateBrainrotReferentialMirrorCard(card)

  const recognitionChain = card.recognitionChain.join(" -> ")
  const sourcePosture = card.pipelineMetadata.authoringMode === "local_remix_art_piece" ? "Declared-reference local remix first frame" : "Prompt-planned short-video first frame"
  const imagePrompt = [
    `${sourcePosture} for ${card.title}.`,
    `Subject: ${card.providerPrompts.image.subject}.`,
    `Character layer: ${card.layers.primaryCharacter}.`,
    `Secondary beat: ${card.layers.secondaryPropOrCharacter}.`,
    `Background: ${card.layers.background}.`,
    `Style: ${card.providerPrompts.image.style}.`,
    `Lighting: ${card.providerPrompts.image.lighting}.`,
    `Recognition chain: ${recognitionChain}.`,
    "Constraints: no generated text, no logo-like glyphs, no watermark-like artifacts, no identity drift, keep first-frame conditioning stable.",
  ].join(" ")

  const seedanceMotionPrompt = [
    `Seedance I2V motion for ${card.conceptId}: ${card.providerPrompts.seedance.motion}.`,
    `Camera: ${card.providerPrompts.seedance.camera}.`,
    `Timing: ${card.layers.i2vControls.timing}.`,
    `Stability: ${card.providerPrompts.seedance.stability}.`,
    `Controls: ${card.layers.i2vControls.ratio}, ${card.layers.i2vControls.durationSec}s, ${card.layers.i2vControls.fps}fps.`,
    "Preserve first-frame composition and keep the frame free of generated text.",
  ].join(" ")

  const promptHash = sha256([imagePrompt, seedanceMotionPrompt, card.audioIntent.spatialReference, card.audioIntent.musicReference].join("\n"))

  return {
    schemaVersion: PROMPT_PLAN_SCHEMA,
    conceptId: card.conceptId,
    cardSchemaVersion: BRAINROT_REFERENTIAL_MIRROR_CARD_SCHEMA,
    title: card.title,
    promptHash: {
      algorithm: "sha256",
      value: promptHash,
    },
    prompts: {
      imagePrompt: {
        lane: "first_frame_image",
        text: imagePrompt,
        negative: card.providerPrompts.image.negative,
      },
      seedanceMotionPrompt: {
        lane: "seedance_i2v_motion",
        text: seedanceMotionPrompt,
        controls: card.layers.i2vControls,
        negative: card.providerPrompts.seedance.negative,
      },
    },
    audioIntentReference: {
      spatialAudioReference: card.audioIntent.spatialReference,
      musicIntent: card.audioIntent.musicReference,
      goal3BindingHint: card.audioIntent.goal3BindingHint,
      ownershipBoundary: "Goal 3 owns stems, spatial manifests, render proof, and audio mastering; Goal 4 emits intent only.",
    },
    captionOverlayPlan: {
      captionBeats: [...card.layers.edit.captionBeats],
      overlayMotifs: [...card.layers.edit.overlayMotifs],
      cutRhythm: card.layers.edit.cutRhythm,
    },
    pipelineMetadata: {
      providerRoute: {
        provider: card.pipelineMetadata.providerRoute.provider,
        model: card.pipelineMetadata.providerRoute.model,
        endpoint: card.pipelineMetadata.providerRoute.endpoint,
        seed: card.pipelineMetadata.providerRoute.seed,
        providerParams: { ...card.pipelineMetadata.providerRoute.providerParams },
      },
      upstreamManifestRefs: [...card.pipelineMetadata.upstreamManifestRefs],
      sourceInspirationIds: [...card.pipelineMetadata.sourceInspirationIds],
      vibeAxes: [...card.pipelineMetadata.vibeAxes],
    },
    pipelineMetadataNotes: buildPipelineMetadataNotes(card),
    handoffTargets: card.handoffs.map((handoff) => ({
      target: handoff.target,
      consumes: [...handoff.consumes],
      emits: [...handoff.emits],
      ownershipBoundary: handoff.ownershipBoundary,
    })),
    avoidList: [...card.avoidList],
  }
}

export function buildGoal4PipelineHandoff(input: BuildGoal4PipelineHandoffInput): Goal4PipelineHandoffBundle {
  if (input.cards.length === 0) {
    throw new BrainrotPlannerValidationError("handoff requires at least one card")
  }

  const cards = input.cards.map((card) => decodeBrainrotReferentialMirrorCard(card))
  const promptPlans = cards.map((card) => buildPromptPlan(card))
  const generatedVideo = buildGoal2GeneratedVideoReference(
    input.generatedClipsManifest,
    input.generatedClipsManifestPath,
  )
  const spatialAudio = buildSpatialAudioRenderOutputReference(
    input.spatialRenderOutput,
    input.spatialRenderOutputPath,
  )

  return {
    schemaVersion: GOAL4_HANDOFF_SCHEMA,
    bundleId: input.bundleId,
    createdAt: input.createdAt,
    cards: cards.map((card) => ({
      conceptId: card.conceptId,
      title: card.title,
      cardSchemaVersion: card.schemaVersion,
    })),
    promptPlans,
    upstreamReferences: {
      generatedVideo,
      spatialAudio,
    },
    goal5Handoff: {
      consume: [
        "promptPlans[].prompts.imagePrompt",
        "promptPlans[].prompts.seedanceMotionPrompt",
        "promptPlans[].captionOverlayPlan",
        "upstreamReferences.generatedVideo.clipConstraints",
        "upstreamReferences.spatialAudio.audioPath",
      ],
      doNotOwn: [
        "Goal 2 owns provider submit/upload/session/job metadata internals.",
        "Goal 3 owns stem synthesis, spatial automation, and audio render internals.",
        "Goal 5 owns renderer ingestion, Remotion/HyperFrames mapping, and final composition.",
      ],
      rendererIntent: {
        captionOverlayPlans: promptPlans.map((plan) => ({
          conceptId: plan.conceptId,
          captionBeats: [...plan.captionOverlayPlan.captionBeats],
          overlayMotifs: [...plan.captionOverlayPlan.overlayMotifs],
        })),
        audioBinding: {
          audioPath: spatialAudio.audioPath,
          renderOutputPath: spatialAudio.renderOutputPath,
          spatialAudioManifestPath: spatialAudio.sourceManifests.spatialAudioManifestPath,
        },
        generatedClipManifestPath: generatedVideo.manifestPath,
      },
    },
    pipelineMetadataNotes: [
      "Goal 4 handoff contains prompt semantics, artifact-reduction intent, and upstream manifest references only.",
      "Goal 2 provider job, endpoint, model, upload, raw request, and conditioning metadata remain in Goal 2 artifacts.",
      "Goal 3 audio stem, object automation, render engine, and master-output metadata remain in Goal 3 artifacts.",
      "Goal 5 can consume this bundle without duplicating conditioning/audio/render internals.",
    ],
  }
}

export function buildGoal2GeneratedVideoReference(value: unknown, manifestPath: string): Goal2GeneratedVideoReference {
  const manifest = decodeGeneratedVideoClipsV1(value, "Goal 4 generated-video upstream reference")
  return {
    owner: "goal2_seedance",
    manifestPath,
    schemaVersion: manifest.schemaVersion,
    manifestId: manifest.manifestId,
    clipConstraints: manifest.clips.map((clip) => ({
      clipId: clip.clipId,
      promptHash: {
        algorithm: clip.prompt.promptHash.algorithm,
        value: clip.prompt.promptHash.value,
      },
      firstFrameConditioningManifestPath: clip.firstFrame.conditioningManifestPath,
      generation: {
        durationSec: clip.generation.durationSec,
        ratio: clip.generation.ratio,
        fps: clip.generation.fps,
        dryRun: clip.generation.dryRun,
      },
      plannedArtifactPath: clip.artifact.path,
    })),
    ownershipBoundary: "Reference only: Goal 2 owns provider access, upload, request/response, watermark, and SynthID-conditioning internals.",
  }
}

export function buildSpatialAudioRenderOutputReference(value: unknown, renderOutputPath: string): SpatialAudioRenderOutputReference {
  const record = asRecord(value, "spatial render output")
  const output = asRecord(record.output, "spatial render output.output")
  const source = asRecord(record.source, "spatial render output.source")

  return {
    owner: "goal3_spatial_audio",
    renderOutputPath,
    schemaVersion: asString(record.schemaVersion, "spatial render output.schemaVersion"),
    audioPath: asString(record.audioPath, "spatial render output.audioPath"),
    output: {
      mediaType: asString(output.mediaType, "spatial render output.output.mediaType"),
      channels: asNumber(output.channels, "spatial render output.output.channels"),
      sampleRateHz: asNumber(output.sampleRateHz, "spatial render output.output.sampleRateHz"),
      durationSec: asNumber(output.durationSec, "spatial render output.output.durationSec"),
      sha256: asString(output.sha256, "spatial render output.output.sha256"),
    },
    sourceManifests: {
      voiceAssetsManifestPath: asString(source.voiceAssetsManifestPath, "spatial render output.source.voiceAssetsManifestPath"),
      stemsManifestPath: asString(source.stemsManifestPath, "spatial render output.source.stemsManifestPath"),
      spatialAudioManifestPath: asString(source.spatialAudioManifestPath, "spatial render output.source.spatialAudioManifestPath"),
    },
    ownershipBoundary: "Reference only: Goal 3 owns voice assets, stems, spatial automation, render engine, and audio proof generation.",
  }
}

function assertAvoidListDoesNotAppearInPositivePromptFields(card: BrainrotReferentialMirrorCard): void {
  const haystack = normalizeForPolicy(collectPositiveCreativeFields(card).join("\n"))
  for (const avoid of card.avoidList) {
    const normalizedAvoid = normalizeForPolicy(avoid)
    if (normalizedAvoid.length >= 4 && haystack.includes(normalizedAvoid)) {
      throw new BrainrotPlannerValidationError(`card positive prompt fields include avoid-list entry: ${avoid}`)
    }
  }
}


function collectPositiveCreativeFields(card: BrainrotReferentialMirrorCard): string[] {
  return [
    card.conceptId,
    card.title,
    card.originalityBoundary,
    ...card.recognitionChain,
    ...card.referentialMirrorGraph.flatMap((node) => [
      node.node,
      node.viewerRecognition,
      ...node.sourceLineage.flatMap((lineage) => [lineage.mechanic, lineage.pipelineNote]),
    ]),
    ...card.sourceLineage.flatMap((lineage) => [lineage.mechanic, lineage.pipelineNote]),
    card.layers.primaryCharacter,
    card.layers.secondaryPropOrCharacter,
    card.layers.background,
    card.layers.audio,
    ...card.layers.edit.captionBeats,
    ...card.layers.edit.overlayMotifs,
    card.layers.edit.cutRhythm,
    card.layers.i2vControls.camera,
    card.layers.i2vControls.motion,
    card.layers.i2vControls.timing,
    card.layers.i2vControls.stability,
    card.providerPrompts.image.subject,
    card.providerPrompts.image.style,
    card.providerPrompts.image.lighting,
    card.providerPrompts.seedance.motion,
    card.providerPrompts.seedance.camera,
    card.providerPrompts.seedance.stability,
    card.audioIntent.spatialReference,
    card.audioIntent.musicReference,
    card.audioIntent.goal3BindingHint,
  ]
}

function buildPipelineMetadataNotes(card: BrainrotReferentialMirrorCard): string[] {
  return [
    `Planning boundary: ${card.originalityBoundary}`,
    `Authoring mode: ${card.pipelineMetadata.authoringMode}.`,
    "Pipeline metadata: sourceLineage and upstreamManifestRefs track mechanics, provider dependencies, and artifact paths outside the pixels so Seedance/I2V quality can be compared and providers can be swapped.",
    `Avoid list enforced on positive prompt fields: ${card.avoidList.join("; ")}.`,
    "Goal 4 does not own provider access, audio rendering, image conditioning, or final renderer behavior.",
    ...card.pipelineMetadata.planningNotes,
  ]
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function normalizeForPolicy(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function requireString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BrainrotPlannerValidationError(`${label} must be a non-empty string`)
  }
}

function requirePositiveNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new BrainrotPlannerValidationError(`${label} must be a positive finite number`)
  }
}

function requireNonEmptyArray<T>(value: readonly T[] | undefined, label: string): asserts value is readonly T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BrainrotPlannerValidationError(`${label} must be a non-empty array`)
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BrainrotPlannerValidationError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function asString(value: unknown, label: string): string {
  requireString(value, label)
  return value
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BrainrotPlannerValidationError(`${label} must be a finite number`)
  }
  return value
}
