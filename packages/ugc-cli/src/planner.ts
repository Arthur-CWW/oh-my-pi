import { createHash, randomUUID } from "node:crypto"
import path from "node:path"
import { FORMAT_TEMPLATES, MODEL_CATALOG, PERSONAS } from "./templates"
import type {
  BeatPlan,
  CampaignPlan,
  CliJob,
  ModelSpec,
  ProductBrief,
  RecipeJson,
  RunManifest,
  VariantPlan,
  ViralityReport,
} from "./types"

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "ugc"
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10)
}

export function parseCsv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  return items.length > 0 ? items : fallback
}

export function buildProductBrief(input: {
  productName?: string
  productUrl?: string
  productDescription?: string
  targetAudience?: string
  goal?: string
  approvedClaims?: string[]
  forbiddenClaims?: string[]
  productImage?: string
  appScreenshot?: string
}): ProductBrief {
  const inferredName = input.productName ?? (input.productUrl ? hostnameLabel(input.productUrl) : "Untitled Product")
  const description =
    input.productDescription ??
    `A product campaign for ${inferredName}. Add a stronger product description before submitting paid generation.`

  const assets: ProductBrief["assets"] = []
  if (input.productImage) assets.push({ kind: "image", pathOrUrl: input.productImage, role: "product_image" })
  if (input.appScreenshot) assets.push({ kind: "image", pathOrUrl: input.appScreenshot, role: "app_screenshot" })
  if (input.productUrl) assets.push({ kind: "other", pathOrUrl: input.productUrl, role: "source_url" })

  return {
    name: inferredName,
    url: input.productUrl,
    description,
    targetAudience: input.targetAudience ?? "performance marketers, founders, and shortform viewers",
    goal: input.goal ?? "generate testable shortform ad variants",
    approvedClaims: input.approvedClaims ?? [],
    forbiddenClaims: input.forbiddenClaims ?? [
      "guaranteed results",
      "fake customer testimonial",
      "medical, financial, or legal claims without substantiation",
    ],
    assets,
  }
}

export function createCampaignPlan(input: {
  product: ProductBrief
  formats: string[]
  variants: number
  personas?: string[]
  hookStyles?: string[]
  goal?: string
  jobType?: string
}): CampaignPlan {
  const formats = resolveFormats(input.formats)
  const personas = resolvePersonas(input.personas)
  const hookStyles = input.hookStyles?.length
    ? input.hookStyles
    : ["pain_point", "skeptical_testimonial", "show_me", "founder_demo", "curiosity_gap"]
  const variantCount = Math.max(1, Math.min(input.variants, 50))

  const seed = `${input.product.name}:${input.product.url ?? ""}:${input.goal ?? ""}:${input.jobType ?? ""}`
  const id = `${slugify(input.product.name)}-${shortHash(seed)}`
  const variants: VariantPlan[] = []

  for (let index = 0; index < variantCount; index += 1) {
    const format = formats[index % formats.length]!
    const persona = personas[index % personas.length]!
    const hookStyle = hookStyles[index % hookStyles.length]!
    variants.push(createVariantPlan({ index, product: input.product, formatId: format.id, personaId: persona.id, hookStyle }))
  }

  const estimatedCostUsd = estimateCampaignCost(variants)

  return {
    schemaVersion: "ugc.campaign/v1",
    id,
    createdAt: new Date().toISOString(),
    product: input.product,
    goal: input.goal ?? input.product.goal,
    variantCount,
    formats: formats.map((format) => format.id),
    variants,
    providerPlan: defaultProviderPlan(),
    estimatedCostUsd,
    serialization: "json",
  }
}

export function createVariantPlan(input: {
  index: number
  product: ProductBrief
  formatId: string
  personaId: string
  hookStyle: string
}): VariantPlan {
  const format = FORMAT_TEMPLATES.find((candidate) => candidate.id === input.formatId) ?? FORMAT_TEMPLATES[0]!
  const persona = PERSONAS.find((candidate) => candidate.id === input.personaId) ?? PERSONAS[0]!
  const variantNumber = input.index + 1
  const claim = input.product.approvedClaims[0] ?? "the workflow gets simpler"
  const riskClaim = input.product.forbiddenClaims.find((item) => item.toLowerCase().includes("fake")) ?? ""
  const hook = buildHook(input.product, input.hookStyle, persona.label)
  const body = buildBody(input.product, format.id, claim)
  const cta = buildCta(input.product)
  const fullText = `${hook} ${body} ${cta}`
  const beats = createBeats({ hook, body, cta, product: input.product, formatId: format.id, durationSec: format.durationSec })

  return {
    id: `variant-${String(variantNumber).padStart(3, "0")}`,
    formatId: format.id,
    formatLabel: format.label,
    persona,
    hookStyle: input.hookStyle,
    script: {
      hook,
      body,
      cta,
      fullText,
      beats,
    },
    assetsNeeded: [
      {
        kind: "image",
        role: "synthetic_persona_reference",
        promptOrInstruction: persona.visualPrompt,
        providerPreference: ["gemini-image", "openai-image", "seedream", "local-placeholder"],
      },
      {
        kind: "video",
        role: "talking_or_voiceover_clip",
        promptOrInstruction: `Create a ${persona.cameraStyle} clip for: ${fullText}. Do not render readable text.`,
        providerPreference: ["lipsync-adapter", "jimeng", "kie", "fal", "static-micro-motion"],
      },
      {
        kind: "video",
        role: "broll",
        promptOrInstruction: brollPrompt(input.product, format.id),
        providerPreference: ["jimeng", "kie", "fal", "local-still-motion"],
      },
      {
        kind: "subtitle",
        role: "captions",
        promptOrInstruction: "Render final readable text in post only.",
        providerPreference: ["local-srt", "local-ass", "remotion"],
      },
    ],
    render: {
      aspectRatio: "9:16",
      width: 1080,
      height: 1920,
      fps: 30,
      durationSec: format.durationSec,
      captionStyle: format.captionStyle,
    },
    compliance: {
      syntheticPersona: true,
      needsAiDisclosure: true,
      blockedClaims: riskClaim ? [riskClaim] : [],
      notes: [
        "Synthetic persona only; no real-person clone.",
        "Readable captions/text must be rendered in post.",
        "Substantiate factual/numeric claims before paid distribution.",
      ],
    },
  }
}

export function createRecipeFromPlan(plan: CampaignPlan): RecipeJson {
  return {
    schemaVersion: "ugc.recipe/v1",
    id: plan.id,
    name: `${plan.product.name} UGC Campaign`,
    createdAt: plan.createdAt,
    product: plan.product,
    matrix: {
      variants: plan.variantCount,
      formats: plan.formats,
      personas: unique(plan.variants.map((variant) => variant.persona.id)),
      hookStyles: unique(plan.variants.map((variant) => variant.hookStyle)),
    },
    graph: [
      {
        id: "product_brief",
        kind: "product.normalize",
        provider: "local",
        needs: [],
        input: { product: plan.product as unknown as Record<string, never> },
        output: { product: "product.json" },
      },
      {
        id: "script_variants",
        kind: "script.generate",
        provider: "local-plan",
        needs: ["product_brief"],
        input: { variants: plan.variantCount, formats: plan.formats },
        output: { scripts: "variants/*/script.json" },
      },
      {
        id: "persona_cards",
        kind: "persona.select",
        provider: "local-plan",
        needs: ["script_variants"],
        input: { personas: unique(plan.variants.map((variant) => variant.persona.id)) },
        output: { personas: "personas.json" },
      },
      {
        id: "provider_prompt_cards",
        kind: "provider.prompt-pack",
        provider: "local-plan",
        needs: ["persona_cards"],
        input: { noModelRenderedText: true, submitPaidGeneration: false },
        output: { prompts: "variants/*/provider-prompts.json" },
      },
      {
        id: "caption_sidecars",
        kind: "subtitle.generate",
        provider: "local",
        needs: ["script_variants"],
        input: { format: "srt", renderReadableTextInPost: true },
        output: { captions: "variants/*/captions.srt" },
      },
      {
        id: "timeline_specs",
        kind: "render.timeline",
        provider: "local",
        needs: ["caption_sidecars", "provider_prompt_cards"],
        input: { renderer: "remotion-or-ffmpeg", serialization: "json" },
        output: { timelines: "variants/*/timeline.json" },
      },
    ],
    render: {
      width: 1080,
      height: 1920,
      fps: 30,
      aspectRatio: "9:16",
    },
  }
}

export function createJob(input: {
  id?: string
  type: string
  model: string
  input: Record<string, JsonPrimitive>
  outputDir: string
  artifacts: Array<{ id: string; kind: "image" | "video" | "audio" | "subtitle" | "text" | "json" | "recipe" | "timeline" | "other"; path: string; role: string; createdBy: string }>
  estimatedCostUsd: number
  status?: "planned" | "running" | "completed" | "failed"
}): CliJob {
  return {
    schemaVersion: "ugc.job/v1",
    id: input.id ?? `job-${Date.now()}-${randomUUID().slice(0, 8)}`,
    type: input.type,
    model: input.model,
    status: input.status ?? "completed",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    input: input.input as Record<string, JsonPrimitive>,
    outputDir: input.outputDir,
    artifacts: input.artifacts,
    estimatedCostUsd: input.estimatedCostUsd,
  }
}

type JsonPrimitive = null | boolean | number | string | JsonPrimitive[] | { [key: string]: JsonPrimitive }

export function createRunManifest(input: {
  jobId: string
  plan: CampaignPlan
  artifacts: RunManifest["artifacts"]
}): RunManifest {
  const now = new Date().toISOString()
  return {
    schemaVersion: "ugc.run/v1",
    jobId: input.jobId,
    status: "completed",
    createdAt: input.plan.createdAt,
    finishedAt: now,
    serialization: "json",
    product: input.plan.product,
    variants: input.plan.variants,
    artifacts: input.artifacts,
    providerPlan: input.plan.providerPlan,
    cost: {
      estimatedUsd: input.plan.estimatedCostUsd,
      actualUsd: 0,
      paidGenerationSubmitted: false,
    },
    guardrails: {
      noPaidGeneration: true,
      noAutoposting: true,
      noRealPersonClone: true,
      noModelRenderedText: true,
    },
  }
}

export function createViralityReport(input: { video?: string; hook?: string; captions?: string; product?: string }): ViralityReport {
  const hasVideo = Boolean(input.video)
  const hookLength = input.hook?.length ?? 0
  const captionLength = input.captions?.length ?? 0
  const hookStrength = scoreClamp(55 + Math.min(25, hookLength / 4) + (hasVideo ? 5 : 0))
  const captionReadability = scoreClamp(captionLength > 0 ? 80 - Math.max(0, captionLength - 140) / 8 : 58)
  const productClarity = scoreClamp(input.product ? 72 : 48)
  const retentionRisk = scoreClamp(100 - (hookStrength * 0.45 + captionReadability * 0.2 + productClarity * 0.2))
  const scrollStopPotential = scoreClamp((hookStrength + captionReadability + productClarity) / 3)

  return {
    schemaVersion: "ugc.virality/v1",
    id: `virality-${Date.now()}-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    video: input.video,
    scores: {
      hookStrength,
      retentionRisk,
      captionReadability,
      productClarity,
      scrollStopPotential,
    },
    notes: [
      "Local heuristic report only; replace with multimodal model scoring when a provider adapter is connected.",
      "Use this to rank variants against each other, not as an absolute prediction.",
    ],
    nextTests: [
      "Test one direct pain-point hook against one skeptical-review hook.",
      "Keep text overlays deterministic and under five words per caption beat.",
      "Add a product proof shot before the CTA if product clarity is weak.",
    ],
  }
}

export function formatCampaignMarkdown(plan: CampaignPlan): string {
  const lines = [
    `# ${plan.product.name} UGC Campaign`,
    "",
    `Campaign ID: ${plan.id}`,
    `Goal: ${plan.goal}`,
    `Serialization: JSON`,
    `Estimated paid-generation cost submitted now: $0.00`,
    "",
    "## Product",
    "",
    plan.product.description,
    "",
    "## Variants",
    "",
  ]

  for (const variant of plan.variants) {
    lines.push(`### ${variant.id} — ${variant.formatLabel}`)
    lines.push("")
    lines.push(`Persona: ${variant.persona.label}`)
    lines.push(`Hook style: ${variant.hookStyle}`)
    lines.push("")
    lines.push(variant.script.fullText)
    lines.push("")
    lines.push("Assets:")
    for (const asset of variant.assetsNeeded) {
      lines.push(`- ${asset.role}: ${asset.promptOrInstruction}`)
    }
    lines.push("")
  }

  return `${lines.join("\n")}\n`
}

export function formatSrt(variant: VariantPlan): string {
  return variant.script.beats
    .map((beat, index) => {
      return `${index + 1}\n${formatSrtTime(beat.startMs)} --> ${formatSrtTime(beat.endMs)}\n${beat.text}\n`
    })
    .join("\n")
}

export function buildTimeline(variant: VariantPlan): Record<string, unknown> {
  return {
    schemaVersion: "ugc.timeline/v1",
    variantId: variant.id,
    width: variant.render.width,
    height: variant.render.height,
    fps: variant.render.fps,
    durationSec: variant.render.durationSec,
    layers: [
      {
        id: "base_talking_clip",
        type: "video",
        role: "talking_or_voiceover_clip",
        startMs: 0,
        endMs: variant.render.durationSec * 1000,
        fit: "cover",
        source: "provider_prompt_cards.json#talking_or_voiceover_clip",
      },
      {
        id: "broll_cutaways",
        type: "video",
        role: "broll",
        startMs: Math.floor(variant.render.durationSec * 1000 * 0.35),
        endMs: Math.floor(variant.render.durationSec * 1000 * 0.72),
        fit: "cover",
        source: "provider_prompt_cards.json#broll",
      },
      {
        id: "captions",
        type: "subtitle",
        role: "captions",
        startMs: 0,
        endMs: variant.render.durationSec * 1000,
        style: variant.render.captionStyle,
        source: "captions.srt",
      },
      {
        id: "ai_disclosure",
        type: "text",
        role: "disclosure",
        startMs: 0,
        endMs: variant.render.durationSec * 1000,
        text: "AI-generated synthetic creator",
        placement: "bottom-safe-area-small",
      },
    ],
  }
}

export function getModel(id: string): ModelSpec | undefined {
  return MODEL_CATALOG.find((model) => model.id === id)
}

export function validateRecipe(value: unknown): value is RecipeJson {
  if (!value || typeof value !== "object") return false
  const recipe = value as Partial<RecipeJson>
  return recipe.schemaVersion === "ugc.recipe/v1" && typeof recipe.id === "string" && Array.isArray(recipe.graph)
}

function resolveFormats(ids: string[]): typeof FORMAT_TEMPLATES {
  const matches = ids
    .map((id) => FORMAT_TEMPLATES.find((format) => format.id === id))
    .filter((format): format is (typeof FORMAT_TEMPLATES)[number] => Boolean(format))
  return matches.length > 0 ? matches : [FORMAT_TEMPLATES[0]!]
}

function resolvePersonas(ids?: string[]): typeof PERSONAS {
  if (!ids?.length) return PERSONAS
  const matches = ids
    .map((id) => PERSONAS.find((persona) => persona.id === id))
    .filter((persona): persona is (typeof PERSONAS)[number] => Boolean(persona))
  return matches.length > 0 ? matches : PERSONAS
}

function buildHook(product: ProductBrief, hookStyle: string, personaLabel: string): string {
  switch (hookStyle) {
    case "skeptical_testimonial":
      return `I thought ${product.name} was another overhyped tool, but this part changed my mind.`
    case "show_me":
      return `Show me the fastest way to understand ${product.name} without reading a landing page.`
    case "founder_demo":
      return `If I were launching ${product.name} today, this is the demo I would show first.`
    case "curiosity_gap":
      return `The weird thing about ${product.name} is not the feature list. It is what it replaces.`
    case "pain_point":
    default:
      return `${personaLabel} take: if this workflow is still manual, ${product.name} is the shortcut I would test.`
  }
}

function buildBody(product: ProductBrief, formatId: string, claim: string): string {
  const benefit = product.description.replace(/\s+/g, " ").slice(0, 150)
  if (formatId === "show_app_creator") {
    return `Open the app, show the main screen, then cut to the result. The key claim is simple: ${claim}. ${benefit}`
  }
  if (formatId === "unboxing_pov") {
    return `Start with the package or product image, reveal the use case, then cut to the first practical result. ${benefit}`
  }
  if (formatId === "tv_commercial") {
    return `Lead with one clean product shot, one human problem, and one proof visual. Keep the product centered. ${benefit}`
  }
  return `Cut from the creator to the product proof, then show the exact moment where ${claim}. ${benefit}`
}

function buildCta(product: ProductBrief): string {
  if (product.url) return `Try it from the link and test whether it fits your workflow.`
  return `Save this and test ${product.name} against your current workflow.`
}

function brollPrompt(product: ProductBrief, formatId: string): string {
  const noText = "No readable text, no subtitles, no logos except user-supplied product assets."
  if (formatId === "show_app_creator") return `Vertical phone screen cutaways and close-up app workflow shots for ${product.name}. ${noText}`
  if (formatId === "unboxing_pov") return `First-person unboxing and product detail shots for ${product.name}, creator POV, natural lighting. ${noText}`
  if (formatId === "wild_card") return `Absurd shortform ad B-roll for ${product.name}: kinetic overlays, product ritual, punchy movement. ${noText}`
  return `Creator-style product B-roll for ${product.name}: desk close-ups, hand movement, fast cutaways. ${noText}`
}

function createBeats(input: {
  hook: string
  body: string
  cta: string
  product: ProductBrief
  formatId: string
  durationSec: number
}): BeatPlan[] {
  const total = input.durationSec * 1000
  const segments = [
    { role: "hook" as const, start: 0, end: Math.floor(total * 0.18), text: input.hook, visual: "tight creator shot" },
    {
      role: "problem" as const,
      start: Math.floor(total * 0.18),
      end: Math.floor(total * 0.38),
      text: firstSentence(input.body),
      visual: "creator explains the pain point",
    },
    {
      role: "demo" as const,
      start: Math.floor(total * 0.38),
      end: Math.floor(total * 0.66),
      text: `Show ${input.product.name} in the workflow.`,
      visual: input.formatId === "show_app_creator" ? "app screen mockup in post" : "product cutaway",
    },
    {
      role: "proof" as const,
      start: Math.floor(total * 0.66),
      end: Math.floor(total * 0.84),
      text: "Use only approved proof or keep this as a visual demo.",
      visual: "before/after or result shot",
    },
    { role: "cta" as const, start: Math.floor(total * 0.84), end: total, text: input.cta, visual: "creator CTA with product overlay" },
  ]

  return segments.map((segment, index) => ({
    id: `beat_${String(index + 1).padStart(2, "0")}`,
    role: segment.role,
    startMs: segment.start,
    endMs: segment.end,
    text: segment.text,
    visual: segment.visual,
  }))
}

function firstSentence(value: string): string {
  const [sentence] = value.split(/(?<=[.!?])\s+/)
  return sentence ?? value
}

function defaultProviderPlan(): CampaignPlan["providerPlan"] {
  return [
    {
      node: "product_brief",
      capability: "product.normalize",
      preferred: ["local-json", "web-access-fetch"],
      localFallback: "manual product brief",
    },
    {
      node: "script_variants",
      capability: "script.generate",
      preferred: ["openai", "anthropic", "gemini"],
      localFallback: "deterministic template script",
    },
    {
      node: "persona_reference",
      capability: "image.generate",
      preferred: ["gemini-image", "openai-image", "seedream"],
      localFallback: "synthetic persona prompt card",
    },
    {
      node: "voice",
      capability: "tts.generate",
      preferred: ["cartesia", "elevenlabs", "openai-tts"],
      localFallback: "voice direction text",
    },
    {
      node: "broll",
      capability: "video.generate",
      preferred: ["jimeng", "kie", "fal", "veo", "kling"],
      localFallback: "still image motion / storyboard placeholder",
    },
    {
      node: "captions",
      capability: "subtitle.generate",
      preferred: ["local-srt", "local-ass", "remotion"],
      localFallback: "local SRT",
    },
    {
      node: "render",
      capability: "render.compose",
      preferred: ["remotion", "ffmpeg"],
      localFallback: "timeline JSON",
    },
  ]
}

function estimateCampaignCost(variants: VariantPlan[]): number {
  const perVariantExternalBudget = 0
  return variants.length * perVariantExternalBudget
}

function formatSrtTime(ms: number): string {
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  const millis = ms % 1000
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`
}

function scoreClamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function hostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return path.basename(url) || "Product"
  }
}
