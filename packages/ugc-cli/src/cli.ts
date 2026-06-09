#!/usr/bin/env bun
import path from "node:path"
import {
  KIE_CAPABILITIES,
  createKieTask,
  getKieCredits,
  getKieTaskDetail,
  prepareKieTask,
  type KieGenerateRequest,
} from "./kie"
import { MODEL_CATALOG, PERSONAS, SUPERCOMPUTER_MODES } from "./templates"
import {
  buildProductBrief,
  createCampaignPlan,
  createRecipeFromPlan,
  createViralityReport,
  getModel,
  parseCsv,
  validateRecipe,
} from "./planner"
import {
  getJob,
  listJobs,
  materializeCampaign,
  materializeGenericJob,
  materializeSoulId,
  materializeViralityReport,
  readJson,
  uploadAsset,
  writeJson,
} from "./store"
import type { CliJob } from "./types"

const USAGE = `Usage: ugc <command> [options]

Open local CLI for Arcads/Higgsfield-style UGC pipelines.
Serialization is JSON only.

Commands:
  supercomputer modes                  List creative modes
  model list                           List routeable models/tools
  model get <model>                    Inspect a model/tool
  generate create <model>              Create a local job or prompt card
  generate cost <model>                Estimate local/planned cost
  generate list                        List local jobs
  generate get <job_id>                Read a local job
  generate wait <job_id>               Print job if completed
  marketing-studio campaign            Build a Higgsfield-style campaign plan
  marketing-studio virality-predictor  Create a local virality report
  arcads ugc-pack                      Build an Arcads-style UGC pack
  recipe create                        Write a JSON recipe
  recipe validate <recipe.json>        Validate a JSON recipe
  provider kie capabilities            List KIE model routes for UGC generation
  provider kie plan                     Build a dry-run KIE request payload
  provider kie create                   Dry-run by default; add --live to submit
  provider kie status <task_id>         Query a live KIE task
  provider kie credits                  Check KIE credits with --live
  upload <image|video|audio> <file>    Copy local asset into data/ugc-cli/uploads
  soul-id create --name <name>         Create a consent-safe character plan

Examples:
  ugc supercomputer modes
  ugc model list
  ugc arcads ugc-pack --product-name "Demo App" --product-url https://example.com --variants 3 --wait
  ugc marketing-studio campaign --product-name "Demo App" --brief "App install ads" --formats ugc_tutorial,show_app_creator --json
  ugc provider kie plan --operation image-text --prompt "synthetic UGC creator portrait, no text" --json
`

interface ParsedArgs {
  positionals: string[]
  flags: Record<string, string | boolean>
}

export async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv)
  const [command, subcommand, third] = args.positionals

  if (!command || command === "help" || command === "--help" || command === "-h") {
    print(USAGE)
    return
  }

  if (command === "supercomputer" && subcommand === "modes") {
    output(SUPERCOMPUTER_MODES, args)
    return
  }

  if (command === "model") {
    handleModel(subcommand, third, args)
    return
  }

  if (command === "generate") {
    await handleGenerate(subcommand, third, args)
    return
  }

  if (command === "marketing-studio") {
    await handleMarketingStudio(subcommand, args)
    return
  }

  if (command === "arcads") {
    await handleArcads(subcommand, args)
    return
  }

  if (command === "recipe") {
    await handleRecipe(subcommand, third, args)
    return
  }

  if (command === "provider") {
    await handleProvider(subcommand, third, args)
    return
  }

  if (command === "upload") {
    handleUpload(subcommand, third, args)
    return
  }

  if (command === "soul-id") {
    handleSoulId(subcommand, args)
    return
  }

  throw new Error(`unknown command: ${command}`)
}

async function handleProvider(provider: string | undefined, action: string | undefined, args: ParsedArgs): Promise<void> {
  if (provider !== "kie") throw new Error("usage: ugc provider kie <capabilities|plan|create|status|credits>")

  if (action === "capabilities") {
    output(KIE_CAPABILITIES, args)
    return
  }

  if (action === "plan") {
    output(prepareKieTask(kieGenerateRequestFromFlags(args)), args)
    return
  }

  if (action === "create") {
    output(await createKieTask(kieGenerateRequestFromFlags(args), {
      live: args.flags.live === true,
      maxSpendUsd: numberFlag(args, "max-spend-usd", 0.25),
      envPath: stringFlag(args, "env"),
    }), args)
    return
  }

  if (action === "status") {
    const taskId = args.positionals[3]
    if (!taskId) throw new Error("usage: ugc provider kie status <task_id>")
    output(await getKieTaskDetail(taskId, { envPath: stringFlag(args, "env") }), args)
    return
  }

  if (action === "credits") {
    if (args.flags.live !== true) {
      output({ mode: "dry-run", endpoint: "GET /api/v1/chat/credit", note: "Add --live to query KIE credits." }, args)
      return
    }
    output(await getKieCredits({ envPath: stringFlag(args, "env") }), args)
    return
  }

  throw new Error("usage: ugc provider kie <capabilities|plan|create|status|credits>")
}

function handleModel(subcommand: string | undefined, modelId: string | undefined, args: ParsedArgs): void {
  if (subcommand === "list") {
    output(MODEL_CATALOG, args)
    return
  }
  if (subcommand === "get" && modelId) {
    const model = getModel(modelId)
    if (!model) throw new Error(`unknown model: ${modelId}`)
    output(model, args)
    return
  }
  throw new Error("usage: ugc model <list|get>")
}

async function handleGenerate(subcommand: string | undefined, modelId: string | undefined, args: ParsedArgs): Promise<void> {
  if (subcommand === "list") {
    output(listJobs(), args)
    return
  }

  if (subcommand === "get" && modelId) {
    const job = getRequiredJob(modelId)
    output(job, args)
    return
  }

  if (subcommand === "wait" && modelId) {
    const job = getRequiredJob(modelId)
    output(job, args)
    return
  }

  if (subcommand === "cost" && modelId) {
    const model = getModel(modelId)
    if (!model) throw new Error(`unknown model: ${modelId}`)
    output({ model: model.id, estimatedCostUsd: model.estimatedCostUsd, note: "local planner submits no paid generation" }, args)
    return
  }

  if (subcommand !== "create" || !modelId) {
    throw new Error("usage: ugc generate create <model>")
  }

  const model = getModel(modelId)
  if (!model) throw new Error(`unknown model: ${modelId}`)

  if (model.id === "arcads_ugc_pack" || model.id === "marketing_studio_video") {
    const materialized = createAndMaterializeCampaign(args, {
      model: model.id,
      type: model.id === "arcads_ugc_pack" ? "arcads_ugc_pack" : "marketing_studio_campaign",
      fallbackFormats:
        model.id === "arcads_ugc_pack"
          ? ["talking_head_product_cutaway", "show_app_creator", "unboxing_pov"]
          : ["ugc_tutorial", "product_review", "tv_commercial"],
    })
    output(materialized.job, args)
    return
  }

  if (model.id === "brain_activity") {
    const report = createViralityReport({
      video: stringFlag(args, "video"),
      hook: stringFlag(args, "hook") ?? stringFlag(args, "prompt"),
      captions: stringFlag(args, "captions"),
      product: stringFlag(args, "product-name"),
    })
    const job = materializeViralityReport(report, { model: model.id, outDir: stringFlag(args, "out-dir") })
    output(job, args)
    return
  }

  const job = materializeGenericJob({
    model: model.id,
    kind: model.family,
    prompt: stringFlag(args, "prompt"),
    outDir: stringFlag(args, "out-dir"),
    params: args.flags,
  })
  output(job, args)
}

async function handleMarketingStudio(subcommand: string | undefined, args: ParsedArgs): Promise<void> {
  if (subcommand === "campaign") {
    const materialized = createAndMaterializeCampaign(args, {
      model: "marketing_studio_video",
      type: "marketing_studio_campaign",
      fallbackFormats: ["ugc_tutorial", "product_review", "tv_commercial"],
    })
    output(materialized.job, args)
    return
  }

  if (subcommand === "virality-predictor" || subcommand === "virality_predictor") {
    const report = createViralityReport({
      video: stringFlag(args, "video"),
      hook: stringFlag(args, "hook"),
      captions: stringFlag(args, "captions"),
      product: stringFlag(args, "product-name"),
    })
    const job = materializeViralityReport(report, { model: "brain_activity", outDir: stringFlag(args, "out-dir") })
    output(job, args)
    return
  }

  throw new Error("usage: ugc marketing-studio <campaign|virality-predictor>")
}

async function handleArcads(subcommand: string | undefined, args: ParsedArgs): Promise<void> {
  if (subcommand !== "ugc-pack") throw new Error("usage: ugc arcads ugc-pack")
  const materialized = createAndMaterializeCampaign(args, {
    model: "arcads_ugc_pack",
    type: "arcads_ugc_pack",
    fallbackFormats: ["talking_head_product_cutaway", "show_app_creator", "unboxing_pov"],
  })
  output(materialized.job, args)
}

async function handleRecipe(subcommand: string | undefined, fileOrTemplate: string | undefined, args: ParsedArgs): Promise<void> {
  if (subcommand === "create") {
    const plan = createCampaignPlan({
      product: productFromFlags(args),
      variants: numberFlag(args, "variants", 3),
      formats: parseCsv(stringFlag(args, "formats"), ["talking_head_product_cutaway", "show_app_creator", "unboxing_pov"]),
      personas: parseCsv(stringFlag(args, "personas"), PERSONAS.map((persona) => persona.id)),
      goal: stringFlag(args, "brief") ?? stringFlag(args, "goal"),
      jobType: "recipe_create",
    })
    const recipe = createRecipeFromPlan(plan)
    const out = path.resolve(stringFlag(args, "out") ?? stringFlag(args, "out-file") ?? `${recipe.id}.recipe.json`)
    writeJson(out, recipe)
    output({ path: out, recipe }, args)
    return
  }

  if (subcommand === "validate" && fileOrTemplate) {
    const value = readJson(fileOrTemplate)
    const valid = validateRecipe(value)
    output({ file: path.resolve(fileOrTemplate), valid, serialization: "json" }, args)
    if (!valid) process.exitCode = 1
    return
  }

  throw new Error("usage: ugc recipe <create|validate>")
}

function handleUpload(kind: string | undefined, file: string | undefined, args: ParsedArgs): void {
  if (kind !== "image" && kind !== "video" && kind !== "audio") throw new Error("usage: ugc upload <image|video|audio> <file>")
  if (!file) throw new Error("upload file is required")
  output(uploadAsset({ kind, file, outDir: stringFlag(args, "out-dir") }), args)
}

function handleSoulId(subcommand: string | undefined, args: ParsedArgs): void {
  if (subcommand !== "create") throw new Error("usage: ugc soul-id create --name <name> --image <file> ...")
  const name = stringFlag(args, "name")
  if (!name) throw new Error("--name is required")
  const images = multiFlag(args, "image")
  output(materializeSoulId({ name, images, outDir: stringFlag(args, "out-dir") }), args)
}

function createAndMaterializeCampaign(
  args: ParsedArgs,
  options: { model: string; type: string; fallbackFormats: string[] },
): ReturnType<typeof materializeCampaign> {
  const plan = createCampaignPlan({
    product: productFromFlags(args),
    variants: numberFlag(args, "variants", 3),
    formats: parseCsv(stringFlag(args, "formats"), options.fallbackFormats),
    personas: parseCsv(stringFlag(args, "personas"), PERSONAS.map((persona) => persona.id)),
    hookStyles: parseCsv(stringFlag(args, "hook-styles"), []),
    goal: stringFlag(args, "brief") ?? stringFlag(args, "goal"),
    jobType: options.type,
  })
  return materializeCampaign(plan, { outDir: stringFlag(args, "out-dir"), model: options.model, type: options.type })
}

function productFromFlags(args: ParsedArgs): ReturnType<typeof buildProductBrief> {
  return buildProductBrief({
    productName: stringFlag(args, "product-name") ?? stringFlag(args, "name"),
    productUrl: stringFlag(args, "product-url") ?? stringFlag(args, "url"),
    productDescription: stringFlag(args, "product-description") ?? stringFlag(args, "description") ?? stringFlag(args, "brief"),
    targetAudience: stringFlag(args, "target-audience") ?? stringFlag(args, "audience"),
    goal: stringFlag(args, "goal"),
    approvedClaims: parseCsv(stringFlag(args, "approved-claims"), []),
    forbiddenClaims: parseCsv(stringFlag(args, "forbidden-claims"), []),
    productImage: stringFlag(args, "product-image") ?? stringFlag(args, "image"),
    appScreenshot: stringFlag(args, "app-screenshot"),
  })
}

function kieGenerateRequestFromFlags(args: ParsedArgs): KieGenerateRequest {
  const operation = stringFlag(args, "operation") ?? stringFlag(args, "op") ?? "image-text"
  const prompt = stringFlag(args, "prompt")
  if (!prompt) throw new Error("--prompt is required")
  if (!isKieOperation(operation)) throw new Error(`unsupported KIE operation: ${operation}`)
  return {
    operation,
    prompt,
    aspectRatio: stringFlag(args, "aspect-ratio") ?? stringFlag(args, "ratio"),
    durationSec: numberFlag(args, "duration", numberFlag(args, "duration-sec", 5)),
    resolution: stringFlag(args, "resolution"),
    quality: qualityFlag(args),
    imageUrl: stringFlag(args, "image-url"),
    endImageUrl: stringFlag(args, "end-image-url"),
    imageUrls: multiFlag(args, "image-url"),
    referenceImageUrls: multiFlag(args, "reference-image-url"),
    referenceVideoUrls: multiFlag(args, "reference-video-url"),
    referenceAudioUrl: stringFlag(args, "reference-audio-url"),
    audioUrl: stringFlag(args, "audio-url"),
    callBackUrl: stringFlag(args, "callback-url"),
    negativePrompt: stringFlag(args, "negative-prompt"),
    seed: numberFlag(args, "seed", -1),
    generateAudio: args.flags["generate-audio"] === true,
    nsfwChecker: args.flags["nsfw-checker"] === true,
  }
}

function isKieOperation(value: string): value is KieGenerateRequest["operation"] {
  return KIE_CAPABILITIES.some((capability) => capability.operation === value)
}

function qualityFlag(args: ParsedArgs): KieGenerateRequest["quality"] | undefined {
  const value = stringFlag(args, "quality")
  if (value === "basic" || value === "standard" || value === "pro") return value
  return undefined
}

function getRequiredJob(id: string): CliJob {
  const job = getJob(id)
  if (!job) throw new Error(`job not found: ${id}`)
  return job
}

function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = []
  const flags: Record<string, string | boolean> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!
    if (!token.startsWith("--")) {
      positionals.push(token)
      continue
    }

    const withoutPrefix = token.slice(2)
    const equals = withoutPrefix.indexOf("=")
    if (equals >= 0) {
      const key = withoutPrefix.slice(0, equals)
      const value = withoutPrefix.slice(equals + 1)
      setFlag(flags, key, value)
      continue
    }

    const next = argv[index + 1]
    if (next && !next.startsWith("--")) {
      setFlag(flags, withoutPrefix, next)
      index += 1
      continue
    }

    setFlag(flags, withoutPrefix, true)
  }

  return { positionals, flags }
}

function setFlag(flags: Record<string, string | boolean>, key: string, value: string | boolean): void {
  const previous = flags[key]
  if (typeof previous === "string" && typeof value === "string") {
    flags[key] = `${previous},${value}`
    return
  }
  flags[key] = value
}

function stringFlag(args: ParsedArgs, key: string): string | undefined {
  const value = args.flags[key]
  return typeof value === "string" ? value : undefined
}

function multiFlag(args: ParsedArgs, key: string): string[] {
  return parseCsv(stringFlag(args, key), [])
}

function numberFlag(args: ParsedArgs, key: string, fallback: number): number {
  const raw = stringFlag(args, key)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function output(value: unknown, args: ParsedArgs): void {
  if (args.flags.json || args.flags["json-lines"]) {
    print(JSON.stringify(value, null, 2))
    return
  }
  print(pretty(value))
}

function pretty(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "object" && item && "id" in item && "name" in item) {
          const model = item as { id: string; name: string; capability?: string; description?: string }
          return `${model.id}\t${model.name}\t${model.capability ?? ""}\t${model.description ?? ""}`
        }
        if (typeof item === "object" && item && "id" in item && "label" in item) {
          const mode = item as { id: string; label: string; category?: string; description?: string }
          return `${mode.id}\t${mode.label}\t${mode.category ?? ""}\t${mode.description ?? ""}`
        }
        return JSON.stringify(item)
      })
      .join("\n")
  }
  if (typeof value === "object" && value && "id" in value && "status" in value && "outputDir" in value) {
    const job = value as CliJob
    return [
      `job_id: ${job.id}`,
      `type: ${job.type}`,
      `model: ${job.model}`,
      `status: ${job.status}`,
      `output_dir: ${job.outputDir}`,
      `artifacts: ${job.artifacts.length}`,
      `estimated_cost_usd: ${job.estimatedCostUsd.toFixed(2)}`,
    ].join("\n")
  }
  return JSON.stringify(value, null, 2)
}

function print(value: string): void {
  process.stdout.write(`${value}\n`)
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
}
