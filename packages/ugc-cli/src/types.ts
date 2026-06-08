export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type AssetKind = "image" | "video" | "audio" | "subtitle" | "text" | "json" | "recipe" | "timeline" | "other"

export type JobStatus = "planned" | "running" | "completed" | "failed"

export type ProviderMode = "local-plan" | "mock" | "external-adapter"

export interface ModelSpec {
  id: string
  name: string
  family: "image" | "video" | "audio" | "analysis" | "campaign" | "character"
  capability: string
  providerMode: ProviderMode
  description: string
  estimatedCostUsd: number
  params: Record<string, JsonValue>
}

export interface SupercomputerMode {
  id: string
  label: string
  category: "generate" | "marketing" | "editing" | "analysis" | "character"
  description: string
  defaultModel: string
}

export interface ProductBrief {
  name: string
  url?: string
  description: string
  targetAudience: string
  goal: string
  approvedClaims: string[]
  forbiddenClaims: string[]
  assets: Array<{
    kind: AssetKind
    pathOrUrl: string
    role: string
  }>
}

export interface PersonaSpec {
  id: string
  label: string
  archetype: string
  cameraStyle: string
  energy: string
  trustSignal: string
  voiceDirection: string
  visualPrompt: string
  consentStatus: "synthetic" | "owned" | "licensed" | "consented"
}

export interface FormatTemplate {
  id: string
  label: string
  arcadsEquivalent: string
  higgsfieldEquivalent: string
  durationSec: number
  sceneRoles: string[]
  captionStyle: string
}

export interface BeatPlan {
  id: string
  role: "hook" | "problem" | "demo" | "proof" | "cta" | "broll" | "caption" | "disclosure"
  startMs: number
  endMs: number
  text: string
  visual: string
}

export interface VariantPlan {
  id: string
  formatId: string
  formatLabel: string
  persona: PersonaSpec
  hookStyle: string
  script: {
    hook: string
    body: string
    cta: string
    fullText: string
    beats: BeatPlan[]
  }
  assetsNeeded: Array<{
    kind: AssetKind
    role: string
    promptOrInstruction: string
    providerPreference: string[]
  }>
  render: {
    aspectRatio: "9:16" | "1:1" | "16:9"
    width: number
    height: number
    fps: number
    durationSec: number
    captionStyle: string
  }
  compliance: {
    syntheticPersona: boolean
    needsAiDisclosure: boolean
    blockedClaims: string[]
    notes: string[]
  }
}

export interface CampaignPlan {
  schemaVersion: "ugc.campaign/v1"
  id: string
  createdAt: string
  product: ProductBrief
  goal: string
  variantCount: number
  formats: string[]
  variants: VariantPlan[]
  providerPlan: Array<{
    node: string
    capability: string
    preferred: string[]
    localFallback: string
  }>
  estimatedCostUsd: number
  serialization: "json"
}

export interface RecipeJson {
  schemaVersion: "ugc.recipe/v1"
  id: string
  name: string
  createdAt: string
  product: ProductBrief
  matrix: {
    variants: number
    formats: string[]
    personas: string[]
    hookStyles: string[]
  }
  graph: Array<{
    id: string
    kind: string
    provider: string
    needs: string[]
    input: Record<string, JsonValue>
    output: Record<string, string>
  }>
  render: {
    width: number
    height: number
    fps: number
    aspectRatio: string
  }
}

export interface ArtifactRecord {
  id: string
  kind: AssetKind
  path: string
  role: string
  createdBy: string
}

export interface CliJob {
  schemaVersion: "ugc.job/v1"
  id: string
  type: string
  model: string
  status: JobStatus
  createdAt: string
  finishedAt?: string
  input: Record<string, JsonValue>
  outputDir: string
  artifacts: ArtifactRecord[]
  estimatedCostUsd: number
}

export interface RunManifest {
  schemaVersion: "ugc.run/v1"
  jobId: string
  status: JobStatus
  createdAt: string
  finishedAt: string
  serialization: "json"
  product?: ProductBrief
  variants: VariantPlan[]
  artifacts: ArtifactRecord[]
  providerPlan: CampaignPlan["providerPlan"]
  cost: {
    estimatedUsd: number
    actualUsd: number
    paidGenerationSubmitted: boolean
  }
  guardrails: {
    noPaidGeneration: boolean
    noAutoposting: boolean
    noRealPersonClone: boolean
    noModelRenderedText: boolean
  }
}

export interface ViralityReport {
  schemaVersion: "ugc.virality/v1"
  id: string
  createdAt: string
  video?: string
  scores: {
    hookStrength: number
    retentionRisk: number
    captionReadability: number
    productClarity: number
    scrollStopPotential: number
  }
  notes: string[]
  nextTests: string[]
}
