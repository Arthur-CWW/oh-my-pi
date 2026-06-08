import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import type { CampaignPlan, CliJob, RecipeJson, RunManifest, VariantPlan, ViralityReport } from "./types"
import { buildTimeline, createJob, createRecipeFromPlan, createRunManifest, formatCampaignMarkdown, formatSrt, slugify } from "./planner"

export interface MaterializedCampaign {
  job: CliJob
  plan: CampaignPlan
  recipe: RecipeJson
  manifest: RunManifest
}

export function defaultDataDir(): string {
  return path.resolve("data/ugc-cli")
}

export function materializeCampaign(plan: CampaignPlan, options: { outDir?: string; model: string; type: string }): MaterializedCampaign {
  const runRoot = path.resolve(options.outDir ?? path.join(defaultDataDir(), "runs", plan.id))
  ensureDir(runRoot)

  const recipe = createRecipeFromPlan(plan)
  const artifacts: RunManifest["artifacts"] = []

  writeJson(path.join(runRoot, "campaign.json"), plan)
  artifacts.push(artifact("campaign", "json", path.join(runRoot, "campaign.json"), "campaign_plan", "campaign_plan"))

  writeJson(path.join(runRoot, "recipe.json"), recipe)
  artifacts.push(artifact("recipe", "recipe", path.join(runRoot, "recipe.json"), "json_recipe", "recipe_create"))

  writeText(path.join(runRoot, "storyboard.md"), formatCampaignMarkdown(plan))
  artifacts.push(artifact("storyboard", "text", path.join(runRoot, "storyboard.md"), "human_storyboard", "storyboard"))

  const variantsDir = path.join(runRoot, "variants")
  ensureDir(variantsDir)
  for (const variant of plan.variants) {
    artifacts.push(...materializeVariant(variantsDir, variant))
  }

  const job = createJob({
    type: options.type,
    model: options.model,
    input: {
      productName: plan.product.name,
      productUrl: plan.product.url ?? null,
      variants: plan.variantCount,
      formats: plan.formats,
    },
    outputDir: runRoot,
    artifacts: [],
    estimatedCostUsd: plan.estimatedCostUsd,
  })
  const manifest = createRunManifest({ jobId: job.id, plan, artifacts })

  writeJson(path.join(runRoot, "manifest.json"), manifest)
  artifacts.push(artifact("manifest", "json", path.join(runRoot, "manifest.json"), "run_manifest", "manifest"))
  job.artifacts = artifacts

  writeJson(path.join(runRoot, "job.json"), job)
  writeJson(path.join(jobsDir(), `${job.id}.json`), job)

  return { job, plan, recipe, manifest }
}

export function materializeGenericJob(input: {
  model: string
  prompt?: string
  outDir?: string
  kind: string
  params: Record<string, unknown>
}): CliJob {
  const root = path.resolve(input.outDir ?? path.join(defaultDataDir(), "runs", `${slugify(input.model)}-${Date.now()}`))
  ensureDir(root)
  const promptCard = {
    schemaVersion: "ugc.prompt-card/v1",
    model: input.model,
    kind: input.kind,
    prompt: input.prompt ?? "",
    params: input.params,
    providerMode: "external-adapter",
    paidGenerationSubmitted: false,
    notes: ["This is a routeable prompt card. Connect a provider adapter before live generation."],
  }
  writeJson(path.join(root, "prompt-card.json"), promptCard)
  const job = createJob({
    type: input.kind,
    model: input.model,
    input: {
      prompt: input.prompt ?? "",
      params: input.params as Record<string, never>,
    },
    outputDir: root,
    artifacts: [artifact("prompt-card", "json", path.join(root, "prompt-card.json"), "provider_prompt_card", "generate_create")],
    estimatedCostUsd: 0,
  })
  writeJson(path.join(root, "job.json"), job)
  writeJson(path.join(jobsDir(), `${job.id}.json`), job)
  return job
}

export function materializeViralityReport(report: ViralityReport, options: { outDir?: string; model: string }): CliJob {
  const root = path.resolve(options.outDir ?? path.join(defaultDataDir(), "runs", report.id))
  ensureDir(root)
  writeJson(path.join(root, "virality-report.json"), report)
  const job = createJob({
    type: "virality_predictor",
    model: options.model,
    input: {
      video: report.video ?? null,
    },
    outputDir: root,
    artifacts: [artifact("virality-report", "json", path.join(root, "virality-report.json"), "virality_report", "brain_activity")],
    estimatedCostUsd: 0,
  })
  writeJson(path.join(root, "job.json"), job)
  writeJson(path.join(jobsDir(), `${job.id}.json`), job)
  return job
}

export function materializeSoulId(input: { name: string; images: string[]; outDir?: string }): CliJob {
  const root = path.resolve(input.outDir ?? path.join(defaultDataDir(), "soul-id", slugify(input.name)))
  ensureDir(root)
  const copiedImages: string[] = []
  for (const image of input.images) {
    const resolved = path.resolve(image)
    if (!existsSync(resolved)) continue
    const destination = path.join(root, path.basename(image))
    copyFileSync(resolved, destination)
    copiedImages.push(destination)
  }

  const soul = {
    schemaVersion: "ugc.soul-id/v1",
    id: `soul-${slugify(input.name)}`,
    name: input.name,
    consentStatus: "synthetic-or-owned-required-before-live-training",
    referenceImages: copiedImages,
    providerPlan: ["local-plan", "future: Higgsfield/Soul-like adapter", "future: open character-consistency adapter"],
    paidTrainingSubmitted: false,
  }
  writeJson(path.join(root, "soul-id.json"), soul)

  const job = createJob({
    type: "soul_id_create",
    model: "soul_id_local_plan",
    input: {
      name: input.name,
      images: copiedImages,
    },
    outputDir: root,
    artifacts: [artifact("soul-id", "json", path.join(root, "soul-id.json"), "character_plan", "soul-id_create")],
    estimatedCostUsd: 0,
  })
  writeJson(path.join(root, "job.json"), job)
  writeJson(path.join(jobsDir(), `${job.id}.json`), job)
  return job
}

export function listJobs(): CliJob[] {
  const dir = jobsDir()
  if (!existsSync(dir)) return []
  const files = Array.from(new Bun.Glob("*.json").scanSync(dir))
  return files
    .map((file) => readJson(path.join(dir, file)) as CliJob)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getJob(id: string): CliJob | undefined {
  const file = path.join(jobsDir(), `${id}.json`)
  if (!existsSync(file)) return undefined
  return readJson(file) as CliJob
}

export function uploadAsset(input: { kind: "image" | "video" | "audio"; file: string; outDir?: string }): CliJob {
  const resolved = path.resolve(input.file)
  if (!existsSync(resolved)) throw new Error(`file not found: ${input.file}`)
  const root = path.resolve(input.outDir ?? path.join(defaultDataDir(), "uploads", input.kind))
  ensureDir(root)
  const destination = path.join(root, `${Date.now()}-${path.basename(input.file)}`)
  copyFileSync(resolved, destination)
  const upload = {
    schemaVersion: "ugc.upload/v1",
    kind: input.kind,
    source: resolved,
    storedPath: destination,
    bytes: statSync(destination).size,
  }
  writeJson(`${destination}.json`, upload)
  const job = createJob({
    type: `upload_${input.kind}`,
    model: "local_upload",
    input: { file: resolved, kind: input.kind },
    outputDir: root,
    artifacts: [
      artifact("upload", input.kind, destination, "uploaded_asset", "upload"),
      artifact("upload-metadata", "json", `${destination}.json`, "uploaded_asset_metadata", "upload"),
    ],
    estimatedCostUsd: 0,
  })
  writeJson(path.join(jobsDir(), `${job.id}.json`), job)
  return job
}

export function readJson(file: string): unknown {
  return JSON.parse(readFileSync(path.resolve(file), "utf8"))
}

export function writeJson(file: string, value: unknown): void {
  ensureDir(path.dirname(file))
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

function writeText(file: string, value: string): void {
  ensureDir(path.dirname(file))
  writeFileSync(file, value, "utf8")
}

function materializeVariant(variantsDir: string, variant: VariantPlan): RunManifest["artifacts"] {
  const dir = path.join(variantsDir, variant.id)
  ensureDir(dir)
  const artifacts: RunManifest["artifacts"] = []

  writeJson(path.join(dir, "variant.json"), variant)
  artifacts.push(artifact(`${variant.id}-variant`, "json", path.join(dir, "variant.json"), "variant_plan", variant.id))

  writeText(path.join(dir, "script.txt"), variant.script.fullText)
  artifacts.push(artifact(`${variant.id}-script`, "text", path.join(dir, "script.txt"), "script", variant.id))

  writeText(path.join(dir, "captions.srt"), formatSrt(variant))
  artifacts.push(artifact(`${variant.id}-captions`, "subtitle", path.join(dir, "captions.srt"), "captions", variant.id))

  writeJson(path.join(dir, "timeline.json"), buildTimeline(variant))
  artifacts.push(artifact(`${variant.id}-timeline`, "timeline", path.join(dir, "timeline.json"), "timeline", variant.id))

  writeJson(path.join(dir, "provider-prompts.json"), variant.assetsNeeded)
  artifacts.push(artifact(`${variant.id}-provider-prompts`, "json", path.join(dir, "provider-prompts.json"), "provider_prompt_cards", variant.id))

  return artifacts
}

function artifact(
  id: string,
  kind: RunManifest["artifacts"][number]["kind"],
  file: string,
  role: string,
  createdBy: string,
): RunManifest["artifacts"][number] {
  return { id, kind, path: file, role, createdBy }
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

function jobsDir(): string {
  const dir = path.join(defaultDataDir(), "jobs")
  ensureDir(dir)
  return dir
}
