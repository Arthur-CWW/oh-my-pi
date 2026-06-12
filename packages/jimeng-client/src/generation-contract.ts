import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

export interface JimengGenerationProof {
  sourceFile?: string
  plan: JimengGenerationPlanContract
  submit: JimengGenerationSubmitContract
  finalResponse: JimengGenerationEnvelopeContract
  pollTrace: readonly JimengGenerationPollTraceEntry[]
  artifacts: readonly JimengGenerationArtifactContract[]
  submitDraftContent: JsonObject
  submitMetricsExtra: JsonObject
  submitSceneOptions: readonly JsonValue[]
  finalAigcData: JsonObject | null
  finalDraftContent: JsonObject | null
  finalMetricsExtra: JsonObject | null
}

export interface JimengGenerationPlanContract {
  command: string
  op: string
  submitKind: string
  pollKind: string
  submitId: string
  submitUrl: string
  pollUrl: string
  submitBody: JsonObject
  pollBody: JsonObject | null
  terminalStatus: number
  referenceUploads: readonly JsonValue[]
}

export interface JimengGenerationSubmitContract {
  submitId: string
  historyId: string | null
  httpStatus: number
  responseBody: JimengGenerationEnvelopeContract
}

export interface JimengGenerationEnvelopeContract {
  ret: string | number
  errmsg: string
  data: JsonObject | null
}

export interface JimengGenerationPollTraceEntry {
  httpStatus: number | null
  itemCount: number | null
  status: number | null
}

export interface JimengGenerationArtifactContract {
  kind: string
  savedFile: string | null
  url: string | null
}

export interface JimengGenerationContractSummary {
  source_file: string | null
  command: string
  op: string
  submit_kind: string
  poll_kind: string
  submit_id: string
  history_id: string | null
  ret: string | number
  errmsg: string
  submit_ret: string | number
  submit_errmsg: string
  terminal_status: number
  latest_poll_status: number | null
  final_status: number | null
  generate_type: number | null
  model_req_key: string | null
  model_name: string | null
  function_mode: string | null
  prompt: string | null
  ratio: string | null
  resolution: string | null
  duration_ms: number | null
  fps: number | null
  seed: number | null
  has_first_frame: boolean
  has_end_frame: boolean
  reference_upload_count: number
  artifact_count: number
  artifact_kinds: readonly string[]
}

export interface JimengGenerationContractReport {
  input_path: string
  proof_count: number
  skipped_json_count: number
  summaries: readonly JimengGenerationContractSummary[]
}

export interface JimengGenerationContractOutputFiles {
  summaryJson: string
  summaryMarkdown: string
}

const StringOrNumber = Schema.Union([Schema.String, Schema.Number])
const JsonRecordWireSchema = Schema.Record(Schema.String, Schema.Unknown)
const OptionalJsonRecord = Schema.optional(Schema.NullOr(JsonRecordWireSchema))
const OptionalString = Schema.optional(Schema.NullOr(Schema.String))
const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Number))

const GenerationEnvelopeWireSchema = Schema.Struct({
  ret: StringOrNumber,
  errmsg: Schema.optional(Schema.String),
  data: OptionalJsonRecord,
})

const GenerationPlanWireSchema = Schema.Struct({
  command: Schema.String,
  op: Schema.String,
  submit_kind: Schema.String,
  poll_kind: Schema.String,
  submit_id: Schema.String,
  submit_url: Schema.String,
  poll_url: Schema.String,
  submit_body: JsonRecordWireSchema,
  poll_body: OptionalJsonRecord,
  terminal_status: Schema.Number,
  reference_uploads: Schema.optional(Schema.Array(Schema.Unknown)),
})

const GenerationSubmitWireSchema = Schema.Struct({
  submitId: Schema.String,
  historyId: OptionalString,
  httpStatus: Schema.Number,
  responseBody: GenerationEnvelopeWireSchema,
})

const GenerationPollTraceEntryWireSchema = Schema.Struct({
  httpStatus: OptionalNumber,
  itemCount: OptionalNumber,
  status: OptionalNumber,
})

const GenerationArtifactWireSchema = Schema.Struct({
  kind: Schema.String,
  saved_file: OptionalString,
  url: OptionalString,
})

const GenerationProofWireSchema = Schema.Struct({
  plan: GenerationPlanWireSchema,
  submit: GenerationSubmitWireSchema,
  responseBody: Schema.optional(GenerationEnvelopeWireSchema),
  pollTrace: Schema.Array(GenerationPollTraceEntryWireSchema),
  artifacts: Schema.optional(Schema.Array(GenerationArtifactWireSchema)),
})

type GenerationProofWire = Schema.Schema.Type<typeof GenerationProofWireSchema>

export function parseJimengGenerationProof(value: JsonValue, operation = "jimeng generation proof", sourceFile?: string): JimengGenerationProof {
  const wire = decodeGenerationContract(GenerationProofWireSchema, value, operation)
  const plan = normalizePlan(wire.plan)
  const submit = normalizeSubmit(wire.submit)
  const finalResponse = normalizeEnvelope(wire.responseBody ?? wire.submit.responseBody)
  const submitDraftContent = parseJsonObjectText(plan.submitBody.draft_content, `${operation} plan.submit_body.draft_content`)
  const submitMetricsExtra = parseJsonObjectText(plan.submitBody.metrics_extra, `${operation} plan.submit_body.metrics_extra`)
  const submitSceneOptions = parseJsonArrayText(submitMetricsExtra.sceneOptions, `${operation} plan.submit_body.metrics_extra.sceneOptions`)
  const finalAigcData = aigcDataFromEnvelope(wire.responseBody ?? wire.submit.responseBody)
  const finalDraftContent = finalAigcData && typeof finalAigcData.draft_content === "string"
    ? parseJsonObjectText(finalAigcData.draft_content, `${operation} responseBody.data.aigc_data.draft_content`)
    : null
  const finalMetricsExtra = finalAigcData && typeof finalAigcData.metrics_extra === "string"
    ? parseJsonObjectText(finalAigcData.metrics_extra, `${operation} responseBody.data.aigc_data.metrics_extra`)
    : null

  return {
    sourceFile,
    plan,
    submit,
    finalResponse,
    pollTrace: wire.pollTrace.map((entry) => ({
      httpStatus: entry.httpStatus ?? null,
      itemCount: entry.itemCount ?? null,
      status: entry.status ?? null,
    })),
    artifacts: (wire.artifacts ?? []).map((artifact) => ({
      kind: artifact.kind,
      savedFile: artifact.saved_file ?? null,
      url: artifact.url ?? null,
    })),
    submitDraftContent,
    submitMetricsExtra,
    submitSceneOptions,
    finalAigcData,
    finalDraftContent,
    finalMetricsExtra,
  }
}

export function summarizeJimengGenerationProof(proof: JimengGenerationProof): JimengGenerationContractSummary {
  const submitVideoInput = firstVideoInput(proof.submitDraftContent)
  const submitParams = textToVideoParams(proof.submitDraftContent)
  const firstScene = firstObject(proof.submitSceneOptions)
  const finalAigcData = proof.finalAigcData
  const finalModelInfo = objectValue(finalAigcData?.model_info)
  const latestPollStatus = [...proof.pollTrace].reverse().find((entry) => entry.status !== null)?.status ?? null
  const finalStatus = numberValue(finalAigcData?.status) ?? numberValue(objectValue(finalAigcData?.task)?.status)
  const artifactKinds = [...new Set(proof.artifacts.map((artifact) => artifact.kind))].sort()

  return {
    source_file: proof.sourceFile ?? null,
    command: proof.plan.command,
    op: proof.plan.op,
    submit_kind: proof.plan.submitKind,
    poll_kind: proof.plan.pollKind,
    submit_id: proof.plan.submitId,
    history_id: proof.submit.historyId,
    ret: proof.finalResponse.ret,
    errmsg: proof.finalResponse.errmsg,
    submit_ret: proof.submit.responseBody.ret,
    submit_errmsg: proof.submit.responseBody.errmsg,
    terminal_status: proof.plan.terminalStatus,
    latest_poll_status: latestPollStatus,
    final_status: finalStatus,
    generate_type: numberValue(finalAigcData?.generate_type),
    model_req_key: stringValue(submitParams?.model_req_key) ?? stringValue(finalModelInfo?.model_req_key) ?? stringValue(objectValue(proof.plan.submitBody.extend)?.root_model),
    model_name: stringValue(finalModelInfo?.model_name),
    function_mode: stringValue(proof.submitMetricsExtra.functionMode) ?? stringValue(proof.finalMetricsExtra?.functionMode),
    prompt: stringValue(submitVideoInput?.prompt),
    ratio: stringValue(submitParams?.video_aspect_ratio),
    resolution: stringValue(submitVideoInput?.resolution) ?? stringValue(firstScene?.resolution),
    duration_ms: numberValue(submitVideoInput?.duration_ms),
    fps: numberValue(submitVideoInput?.fps),
    seed: numberValue(submitVideoInput?.seed) ?? numberValue(submitParams?.seed),
    has_first_frame: typeof submitVideoInput?.first_frame_image === "string",
    has_end_frame: typeof submitVideoInput?.end_frame_image === "string",
    reference_upload_count: proof.plan.referenceUploads.length,
    artifact_count: proof.artifacts.length,
    artifact_kinds: artifactKinds,
  }
}

export function buildJimengGenerationContractReport(inputPath: string): JimengGenerationContractReport {
  const files = generationProofJsonFiles(inputPath)
  const summaries: JimengGenerationContractSummary[] = []
  let skippedJsonCount = 0
  for (const file of files) {
    const parsed = readJsonFile(file)
    try {
      const proof = parseJimengGenerationProof(parsed, `jimeng generation proof ${path.basename(file)}`, path.relative(process.cwd(), file))
      summaries.push(summarizeJimengGenerationProof(proof))
    } catch (error) {
      if (error instanceof Error && error.message.includes("Jimeng generation proof contract did not match required fields")) {
        skippedJsonCount += 1
        continue
      }
      throw error
    }
  }

  return {
    input_path: path.resolve(inputPath),
    proof_count: summaries.length,
    skipped_json_count: skippedJsonCount,
    summaries: summaries.sort((a, b) => `${a.command}:${a.source_file}`.localeCompare(`${b.command}:${b.source_file}`)),
  }
}

export function writeJimengGenerationContractReportMarkdown(report: JimengGenerationContractReport): string {
  const lines = [
    "# Jimeng Generation Contract Report",
    "",
    `Input: \`${report.input_path}\``,
    `Proofs: ${report.proof_count}`,
    `Skipped JSON files: ${report.skipped_json_count}`,
    "",
    "| Command | Source | Model | Function | Status | Artifacts | Prompt |",
    "|---|---|---|---|---:|---:|---|",
  ]
  for (const summary of report.summaries) {
    lines.push([
      summary.command,
      summary.source_file ?? "",
      summary.model_req_key ?? "",
      summary.function_mode ?? "",
      String(summary.final_status ?? summary.latest_poll_status ?? ""),
      String(summary.artifact_count),
      truncateForMarkdown(summary.prompt ?? "", 88),
    ].map(markdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"))
  }
  return `${lines.join("\n")}\n`
}

export function writeJimengGenerationContractReportOutputs(report: JimengGenerationContractReport, outDir: string): JimengGenerationContractOutputFiles {
  mkdirSync(outDir, { recursive: true })
  const summaryJson = path.join(outDir, "generation-contract-summary.json")
  const summaryMarkdown = path.join(outDir, "generation-contract-summary.md")
  writeFileSync(summaryJson, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(summaryMarkdown, writeJimengGenerationContractReportMarkdown(report))
  return { summaryJson, summaryMarkdown }
}

function normalizePlan(plan: Schema.Schema.Type<typeof GenerationPlanWireSchema>): JimengGenerationPlanContract {
  return {
    command: plan.command,
    op: plan.op,
    submitKind: plan.submit_kind,
    pollKind: plan.poll_kind,
    submitId: plan.submit_id,
    submitUrl: plan.submit_url,
    pollUrl: plan.poll_url,
    submitBody: jsonObject(plan.submit_body, "plan.submit_body"),
    pollBody: plan.poll_body ? jsonObject(plan.poll_body, "plan.poll_body") : null,
    terminalStatus: plan.terminal_status,
    referenceUploads: (plan.reference_uploads ?? []).map(jsonValue),
  }
}

function normalizeSubmit(submit: Schema.Schema.Type<typeof GenerationSubmitWireSchema>): JimengGenerationSubmitContract {
  return {
    submitId: submit.submitId,
    historyId: submit.historyId ?? null,
    httpStatus: submit.httpStatus,
    responseBody: normalizeEnvelope(submit.responseBody),
  }
}

function normalizeEnvelope(envelope: Schema.Schema.Type<typeof GenerationEnvelopeWireSchema>): JimengGenerationEnvelopeContract {
  return {
    ret: envelope.ret,
    errmsg: envelope.errmsg ?? "",
    data: envelope.data ? jsonObject(envelope.data, "response data") : null,
  }
}

function aigcDataFromEnvelope(envelope: GenerationProofWire["responseBody"]): JsonObject | null {
  if (!envelope) return null
  const data = envelope.data
  if (!data) return null
  const aigcData = data.aigc_data
  return aigcData && typeof aigcData === "object" && !Array.isArray(aigcData) ? jsonObject(aigcData, "responseBody.data.aigc_data") : null
}

function generationProofJsonFiles(inputPath: string): string[] {
  const resolved = path.resolve(inputPath)
  if (!existsSync(resolved)) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_GENERATION_CONTRACT_INPUT_MISSING",
      message: `generation-contract input path does not exist: ${inputPath}`,
      retryable: false,
      details: { inputPath },
    })
  }
  const stat = statSync(resolved)
  if (stat.isFile()) return resolved.endsWith(".json") ? [resolved] : []
  return walk(resolved).filter((file) => file.endsWith(".json") && isLikelyGenerationProofFile(file))
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "contract" || entry.name === "contract-infer" || entry.name === "raw") return []
      return walk(fullPath)
    }
    return entry.isFile() ? [fullPath] : []
  })
}

function isLikelyGenerationProofFile(file: string): boolean {
  const normalized = file.split(path.sep).join("/")
  return normalized.includes("/normalized/") && /(?:text2video|image2video|frames2video|generation).*result\.json$/.test(path.basename(normalized))
}

function readJsonFile(file: string): JsonValue {
  try {
    return jsonValue(JSON.parse(readFileSync(file, "utf8")))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "validation",
      code: "JIMENG_GENERATION_CONTRACT_JSON_PARSE_FAILED",
      message: `generation-contract could not parse JSON file: ${file}`,
      retryable: false,
      details: { file, error: message },
    })
  }
}

function parseJsonObjectText(value: JsonValue | undefined, operation: string): JsonObject {
  if (typeof value !== "string") {
    throw contractError(operation, "expected a JSON string")
  }
  try {
    const parsed = JSON.parse(value) as JsonValue
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return jsonObject(parsed, operation)
    throw contractError(operation, "expected JSON object text")
  } catch (error) {
    if (error instanceof Error && error.name === "JimengError") throw error
    const message = error instanceof Error ? error.message : String(error)
    throw contractError(operation, message)
  }
}

function parseJsonArrayText(value: JsonValue | undefined, operation: string): readonly JsonValue[] {
  if (typeof value !== "string") {
    throw contractError(operation, "expected a JSON string")
  }
  try {
    const parsed = JSON.parse(value) as JsonValue
    if (Array.isArray(parsed)) return parsed.map(jsonValue)
    throw contractError(operation, "expected JSON array text")
  } catch (error) {
    if (error instanceof Error && error.name === "JimengError") throw error
    const message = error instanceof Error ? error.message : String(error)
    throw contractError(operation, message)
  }
}

function decodeGenerationContract<A>(schema: Schema.Decoder<A>, value: JsonValue, operation: string): A {
  try {
    return Schema.decodeUnknownSync(schema)(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw jimengError({
      category: "upstream",
      code: "JIMENG_GENERATION_CONTRACT_CHANGED",
      message: `${operation}: Jimeng generation proof contract did not match required fields.`,
      retryable: false,
      details: { operation, error: message },
    })
  }
}

function firstVideoInput(draft: JsonObject): JsonObject | null {
  const component = firstObject(draft.component_list)
  const abilities = objectValue(component?.abilities)
  const genVideo = objectValue(abilities?.gen_video)
  const params = objectValue(genVideo?.text_to_video_params)
  return firstObject(params?.video_gen_inputs)
}

function textToVideoParams(draft: JsonObject): JsonObject | null {
  const component = firstObject(draft.component_list)
  const abilities = objectValue(component?.abilities)
  const genVideo = objectValue(abilities?.gen_video)
  return objectValue(genVideo?.text_to_video_params)
}

function firstObject(value: JsonValue | readonly JsonValue[] | undefined): JsonObject | null {
  if (!Array.isArray(value)) return null
  const first = value[0]
  return first && typeof first === "object" && !Array.isArray(first) ? first : null
}

function objectValue(value: JsonValue | undefined): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function jsonObject(value: unknown, operation: string): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const output: JsonObject = {}
    for (const [key, child] of Object.entries(value)) {
      output[key] = jsonValue(child)
    }
    return output
  }
  throw contractError(operation, "expected an object")
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map(jsonValue)
  if (value && typeof value === "object") return jsonObject(value, "json value")
  throw contractError("json value", `unsupported value type ${typeof value}`)
}

function contractError(operation: string, message: string): never {
  throw jimengError({
    category: "upstream",
    code: "JIMENG_GENERATION_CONTRACT_CHANGED",
    message: `${operation}: Jimeng generation proof contract did not match required fields.`,
    retryable: false,
    details: { operation, error: message },
  })
}

function truncateForMarkdown(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}
