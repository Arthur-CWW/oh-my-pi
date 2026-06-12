import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { jimengError } from "./errors"
import { type JsonObject, type JsonValue } from "./reference-image"

export interface JimengContractInferOptions {
  inputPath: string
  endpoint?: string
  outDir?: string
  generatedAtIso?: string
  maxPathsPerEndpoint?: number
}

export interface JimengContractInference {
  version: 1
  generated_at_iso: string
  input_path: string
  endpoint_filter: string | null
  file_count: number
  artifact_count: number
  documents: JimengContractDocumentSummary[]
  endpoints: JimengContractEndpointSummary[]
  artifacts: JimengContractArtifactSummary[]
  scaffold: {
    recommended_next_steps: readonly string[]
    vitest_snapshot_targets: readonly string[]
    generated_files: readonly string[]
  }
}

export interface JimengContractDocumentSummary {
  relative_path: string
  kind: "raw" | "normalized" | "manifest" | "other"
  command: string | null
  endpoints: readonly string[]
  top_level_keys: readonly string[]
  http_status: number | null
  ret: string | number | null
  json_path_count: number
}

export interface JimengContractEndpointSummary {
  endpoint: string
  slug: string
  sample_count: number
  commands: readonly string[]
  document_kinds: readonly string[]
  http_statuses: readonly number[]
  rets: readonly (string | number)[]
  required_paths: readonly JimengContractPathSummary[]
  observed_paths: readonly JimengContractPathSummary[]
  effect_schema_ir: JimengEffectSchemaIr
  cli_flag_suggestions: readonly string[]
  registry_patch_draft: JsonObject
}

export interface JimengContractPathSummary {
  path: string
  types: readonly string[]
  occurrences: number
  sample_count: number
  required: boolean
  example: JsonValue | null
}

export interface JimengContractArtifactSummary {
  relative_path: string
  kind: "audio" | "video" | "image" | "other"
  bytes: number
}

export interface JimengEffectSchemaIr {
  name: string
  endpoint: string
  mode: "permissive-required-paths"
  required_paths: readonly {
    path: string
    types: readonly string[]
  }[]
  note: string
}

interface LoadedContractDocument {
  absolutePath: string
  relativePath: string
  kind: JimengContractDocumentSummary["kind"]
  value: JsonValue
  normalizedValue: JsonValue
  command: string | null
  endpoints: readonly string[]
  httpStatus: number | null
  ret: string | number | null
  topLevelKeys: readonly string[]
}

interface PathStat {
  path: string
  types: Set<string>
  occurrences: number
  sampleIndexes: Set<number>
  example: JsonValue | null
}

const ContractInferOptionsSchema = Schema.Struct({
  inputPath: Schema.String,
  endpoint: Schema.optional(Schema.String),
  outDir: Schema.optional(Schema.String),
  generatedAtIso: Schema.optional(Schema.String),
  maxPathsPerEndpoint: Schema.optional(Schema.Number),
})

const DefaultMaxPathsPerEndpoint = 80
const ArtifactExtensions = new Set([".mp3", ".wav", ".m4a", ".mp4", ".mov", ".webm", ".png", ".jpg", ".jpeg", ".webp"])

export function inferJimengContractsFromPath(options: JimengContractInferOptions): JimengContractInference {
  const decoded = parseJimengContractInferOptions(options)
  const inputPath = path.resolve(decoded.inputPath)
  if (!existsSync(inputPath)) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_CONTRACT_INFER_INPUT_MISSING",
      message: `contract-infer input path does not exist: ${inputPath}`,
      retryable: false,
      details: { inputPath },
    })
  }

  const files = collectFiles(inputPath)
  const jsonFiles = files.filter((file) => path.extname(file).toLowerCase() === ".json")
  const artifacts = files
    .filter((file) => ArtifactExtensions.has(path.extname(file).toLowerCase()))
    .map((file) => summarizeArtifact(inputPath, file))

  const documents = jsonFiles
    .map((file) => loadContractDocument(inputPath, file))
    .filter((document) => decoded.endpoint ? document.endpoints.includes(decoded.endpoint) : document.endpoints.length > 0)

  const endpointMap = new Map<string, LoadedContractDocument[]>()
  for (const document of documents) {
    for (const endpoint of document.endpoints) {
      if (decoded.endpoint && endpoint !== decoded.endpoint) continue
      endpointMap.set(endpoint, [...(endpointMap.get(endpoint) ?? []), document])
    }
  }

  const endpoints = [...endpointMap.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([endpoint, endpointDocuments]) => summarizeEndpoint(endpoint, endpointDocuments, decoded.maxPathsPerEndpoint ?? DefaultMaxPathsPerEndpoint))

  return {
    version: 1,
    generated_at_iso: decoded.generatedAtIso ?? new Date().toISOString(),
    input_path: inputPath,
    endpoint_filter: decoded.endpoint ?? null,
    file_count: documents.length,
    artifact_count: artifacts.length,
    documents: documents.map(summarizeDocument),
    endpoints,
    artifacts,
    scaffold: {
      recommended_next_steps: [
        "Review required_paths for false positives caused by sample-specific values.",
        "Promote the generated Effect Schema IR into a hand-tightened boundary schema for the selected command family.",
        "Add or update a Vitest snapshot over the normalized contract object before wiring more live calls.",
        "Patch endpoint-registry rows with evidence, command ownership, risk, and next probe from registry_patch_draft.",
      ],
      vitest_snapshot_targets: endpoints.map((endpoint) => `contract-infer:${endpoint.endpoint}`),
      generated_files: [
        "contract-summary.json",
        "contract-summary.md",
        "effect-schema-ir.json",
        "registry-patch-draft.json",
      ],
    },
  }
}

export function writeJimengContractInferenceOutputs(inference: JimengContractInference, outDir: string): {
  summaryJson: string
  summaryMarkdown: string
  schemaIrJson: string
  registryPatchDraftJson: string
} {
  const resolved = path.resolve(outDir)
  mkdirSync(resolved, { recursive: true })
  const summaryJson = path.join(resolved, "contract-summary.json")
  const summaryMarkdown = path.join(resolved, "contract-summary.md")
  const schemaIrJson = path.join(resolved, "effect-schema-ir.json")
  const registryPatchDraftJson = path.join(resolved, "registry-patch-draft.json")

  writeJson(summaryJson, inference)
  writeFileSync(summaryMarkdown, writeJimengContractInferenceMarkdown(inference), "utf8")
  writeJson(schemaIrJson, Object.fromEntries(inference.endpoints.map((endpoint) => [endpoint.endpoint, endpoint.effect_schema_ir])))
  writeJson(registryPatchDraftJson, Object.fromEntries(inference.endpoints.map((endpoint) => [endpoint.endpoint, endpoint.registry_patch_draft])))

  return { summaryJson, summaryMarkdown, schemaIrJson, registryPatchDraftJson }
}

export function writeJimengContractInferenceMarkdown(inference: JimengContractInference): string {
  const lines = [
    "# Jimeng Contract Inference",
    "",
    `Generated: ${inference.generated_at_iso}`,
    `Input: \`${inference.input_path}\``,
    `Endpoint filter: ${inference.endpoint_filter ? `\`${inference.endpoint_filter}\`` : "none"}`,
    `JSON documents: ${inference.file_count}`,
    `Artifacts: ${inference.artifact_count}`,
    "",
    "## Endpoints",
    "",
  ]

  for (const endpoint of inference.endpoints) {
    lines.push(
      `### \`${endpoint.endpoint}\``,
      "",
      `- samples: ${endpoint.sample_count}`,
      `- commands: ${endpoint.commands.length > 0 ? endpoint.commands.map((command) => `\`${command}\``).join(", ") : "unknown"}`,
      `- document kinds: ${endpoint.document_kinds.join(", ") || "unknown"}`,
      `- HTTP statuses: ${endpoint.http_statuses.join(", ") || "unknown"}`,
      `- ret values: ${endpoint.rets.join(", ") || "unknown"}`,
      "",
      "| Contract path | Types | Example |",
      "|---|---|---|",
    )
    for (const contractPath of endpoint.required_paths.slice(0, 24)) {
      lines.push(`| \`${contractPath.path}\` | ${contractPath.types.join(" \\| ")} | \`${formatMarkdownExample(contractPath.example)}\` |`)
    }
    lines.push(
      "",
      "CLI flag suggestions:",
      "",
      ...(endpoint.cli_flag_suggestions.length > 0
        ? endpoint.cli_flag_suggestions.map((flag) => `- \`${flag}\``)
        : ["- none inferred"]),
      "",
    )
  }

  if (inference.artifacts.length > 0) {
    lines.push("## Artifacts", "", "| File | Kind | Bytes |", "|---|---|---:|")
    for (const artifact of inference.artifacts) {
      lines.push(`| \`${artifact.relative_path}\` | ${artifact.kind} | ${artifact.bytes} |`)
    }
    lines.push("")
  }

  return `${lines.join("\n")}\n`
}

// Boundary helper: CLI/tests may pass raw JSON-ish option objects.
// ast-grep-ignore: no-unsafe-any-unknown-ts
function parseJimengContractInferOptions(value: unknown): JimengContractInferOptions {
  try {
    return Schema.decodeUnknownSync(ContractInferOptionsSchema)(value)
  } catch (error) {
    throw jimengError({
      category: "validation",
      code: "JIMENG_CONTRACT_INFER_OPTIONS_INVALID",
      message: "contract-infer options did not match the required contract.",
      retryable: false,
      details: { error: error instanceof Error ? error.message : String(error) },
    })
  }
}

function collectFiles(inputPath: string): string[] {
  const stat = statSync(inputPath)
  if (stat.isFile()) return [inputPath]
  if (!stat.isDirectory()) return []

  return readdirSync(inputPath)
    .flatMap((name) => {
      const file = path.join(inputPath, name)
      const childStat = statSync(file)
      if (childStat.isDirectory()) {
        if (name === "node_modules" || name === ".git" || name === "contract" || name === "contract-infer") return []
        return collectFiles(file)
      }
      return childStat.isFile() ? [file] : []
    })
    .sort((left, right) => left.localeCompare(right))
}

function loadContractDocument(root: string, file: string): LoadedContractDocument {
  const value = readJsonValue(file)
  const normalizedValue = normalizeContractValue(value)
  const relativePath = path.relative(root, file)
  const topLevelKeys = isJsonObject(normalizedValue) ? Object.keys(normalizedValue).sort() : []

  return {
    absolutePath: file,
    relativePath,
    kind: documentKind(relativePath),
    value,
    normalizedValue,
    command: extractCommand(normalizedValue, relativePath),
    endpoints: extractEndpoints(value, relativePath),
    httpStatus: extractNumber(normalizedValue, ["http_status", "httpStatus", "submit.httpStatus", "summary.http_status"]),
    ret: extractStringOrNumber(normalizedValue, ["ret", "submit.responseBody.ret", "summary.ret", "responseBody.ret"]),
    topLevelKeys,
  }
}

function summarizeDocument(document: LoadedContractDocument): JimengContractDocumentSummary {
  return {
    relative_path: document.relativePath,
    kind: document.kind,
    command: document.command,
    endpoints: document.endpoints,
    top_level_keys: document.topLevelKeys,
    http_status: document.httpStatus,
    ret: document.ret,
    json_path_count: pathSummariesForValue(document.normalizedValue, 1).length,
  }
}

function summarizeEndpoint(endpoint: string, documents: LoadedContractDocument[], maxPaths: number): JimengContractEndpointSummary {
  const pathStats = new Map<string, PathStat>()
  documents.forEach((document, index) => {
    collectPathStats(document.normalizedValue, "", index, pathStats)
  })
  const observedPaths = [...pathStats.values()]
    .map((stat) => pathStatSummary(stat, documents.length))
    .filter((stat) => isUsefulPath(stat.path))
    .sort(comparePathSummary)
  const strictRequiredPaths = observedPaths
    .filter((stat) => stat.required && stat.path.split(".").length <= 8 && !isMostlyVolatilePath(stat.path))
    .slice(0, maxPaths)
  const frequentPathThreshold = Math.max(2, Math.ceil(documents.length / 2))
  const frequentStablePaths = observedPaths
    .filter((stat) => stat.sample_count >= frequentPathThreshold && stat.path.split(".").length <= 8 && !isMostlyVolatilePath(stat.path))
    .slice(0, maxPaths)
  const requiredPaths = strictRequiredPaths.length > 0 ? strictRequiredPaths : frequentStablePaths
  const commands = uniqueSorted(documents.map((document) => document.command).filter(isPresentString))
  const documentKinds = uniqueSorted(documents.map((document) => document.kind))
  const httpStatuses = uniqueSortedNumbers(documents.map((document) => document.httpStatus).filter(isPresentNumber))
  const rets = uniqueSortedStringOrNumbers(documents.map((document) => document.ret).filter(isPresentStringOrNumber))
  const slug = endpointSlug(endpoint)

  return {
    endpoint,
    slug,
    sample_count: documents.length,
    commands,
    document_kinds: documentKinds,
    http_statuses: httpStatuses,
    rets,
    required_paths: requiredPaths,
    observed_paths: observedPaths.slice(0, maxPaths),
    effect_schema_ir: {
      name: `${pascalCase(slug)}ObservedSchema`,
      endpoint,
      mode: "permissive-required-paths",
      required_paths: requiredPaths.map((stat) => ({
        path: stat.path,
        types: stat.types,
      })),
      note: "Generated scaffold only. Promote relied-on paths into hand-reviewed Effect Schema and keep provider-additive fields permissive.",
    },
    cli_flag_suggestions: inferCliFlagSuggestions(observedPaths),
    registry_patch_draft: {
      endpoint,
      status: "partial",
      command: commands[0] ?? null,
      evidence: documents.slice(0, 6).map((document) => document.relativePath),
      nextProbe: "Promote contract-infer required paths into a hand-tightened typed client/CLI wrapper and Vitest replay snapshot.",
      risk: endpointRisk(endpoint),
    },
  }
}

function pathSummariesForValue(value: JsonValue, sampleCount: number): JimengContractPathSummary[] {
  const stats = new Map<string, PathStat>()
  collectPathStats(value, "", 0, stats)
  return [...stats.values()].map((stat) => pathStatSummary(stat, sampleCount))
}

function collectPathStats(value: JsonValue, currentPath: string, sampleIndex: number, stats: Map<string, PathStat>): void {
  if (currentPath) addPathStat(stats, currentPath, value, sampleIndex)
  if (Array.isArray(value)) {
    value.slice(0, 8).forEach((entry) => collectPathStats(entry, `${currentPath}[]`, sampleIndex, stats))
    return
  }
  if (!isJsonObject(value)) return
  for (const [key, entry] of Object.entries(value)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key
    collectPathStats(entry, nextPath, sampleIndex, stats)
  }
}

function addPathStat(stats: Map<string, PathStat>, contractPath: string, value: JsonValue, sampleIndex: number): void {
  const existing = stats.get(contractPath) ?? {
    path: contractPath,
    types: new Set<string>(),
    occurrences: 0,
    sampleIndexes: new Set<number>(),
    example: null,
  }
  existing.types.add(jsonType(value))
  existing.occurrences += 1
  existing.sampleIndexes.add(sampleIndex)
  if (existing.example === null && !isMostlyVolatilePath(contractPath)) existing.example = compactExample(value)
  stats.set(contractPath, existing)
}

function pathStatSummary(stat: PathStat, sampleCount: number): JimengContractPathSummary {
  return {
    path: stat.path,
    types: [...stat.types].sort(),
    occurrences: stat.occurrences,
    sample_count: stat.sampleIndexes.size,
    required: stat.sampleIndexes.size === sampleCount,
    example: stat.example,
  }
}

function comparePathSummary(left: JimengContractPathSummary, right: JimengContractPathSummary): number {
  if (left.required !== right.required) return left.required ? -1 : 1
  const leftDepth = left.path.split(".").length
  const rightDepth = right.path.split(".").length
  if (leftDepth !== rightDepth) return leftDepth - rightDepth
  return left.path.localeCompare(right.path)
}

function inferCliFlagSuggestions(paths: readonly JimengContractPathSummary[]): string[] {
  const flags = new Set<string>()
  const pathText = paths.map((entry) => entry.path).join("\n")
  const candidates: readonly [RegExp, string][] = [
    [/prompt/i, "--prompt"],
    [/image_uri|imageUri/i, "--imageUri"],
    [/audio_vid|audioVid|voice_clone\.audio\.vid|audio\.vid/i, "--audioVid"],
    [/video_item_id|videoItemId/i, "--videoItemId"],
    [/task_id_list|taskIds/i, "--taskIds"],
    [/local_item_id|localItemId|voiceId/i, "--voice-id"],
    [/voice_clone\.name|request\.name/i, "--name"],
    [/duration_ms|videoDuration/i, "--durationSec"],
    [/resolution/i, "--videoResolution"],
    [/video_aspect_ratio|(^|\.)ratio($|\.)/i, "--ratio"],
    [/model_req_key|modelReqKey/i, "--modelReqKey"],
    [/seed/i, "--seed"],
    [/fps/i, "--fps"],
    [/first_frame_image|firstFrame/i, "--firstFrameUri"],
    [/end_frame_image|lastFrame/i, "--lastFrameUri"],
    [/voice_id|tone_id|speaker/i, "--voice-id"],
    [/item_platform/i, "--item-platform"],
    [/submit_id|submitId/i, "--submitId"],
  ]
  for (const [pattern, flag] of candidates) {
    if (pattern.test(pathText)) flags.add(flag)
  }
  return [...flags].sort()
}

function normalizeContractValue(value: JsonValue, keyHint = ""): JsonValue {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") {
    if (isSensitiveString(keyHint, value)) return redactString(keyHint, value)
    if (shouldParseJsonString(keyHint, value)) {
      const parsed = tryParseJson(value)
      if (parsed !== null) return normalizeContractValue(parsed, keyHint)
    }
    if (isVolatilePathKey(keyHint)) return stablePlaceholder(keyHint, value)
    return value.length > 240 ? `${value.slice(0, 237)}...` : value
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeContractValue(entry, keyHint))
  const out: Record<string, JsonValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    out[key] = normalizeContractValue(entry, key)
  }
  return out
}

function readJsonValue(file: string): JsonValue {
  // ast-grep-ignore: no-unsafe-any-unknown-ts
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown
  return toJsonValue(parsed, file)
}

// Boundary helper: validates JSON.parse output before it enters contract inference.
// ast-grep-ignore: no-unsafe-any-unknown-ts
function toJsonValue(value: unknown, source: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry, source))
  if (typeof value === "object") {
    const out: Record<string, JsonValue> = {}
    for (const [key, entry] of Object.entries(value)) out[key] = toJsonValue(entry, source)
    return out
  }
  throw jimengError({
    category: "validation",
    code: "JIMENG_CONTRACT_INFER_JSON_INVALID",
    message: `contract-infer JSON file contained a non-JSON value: ${source}`,
    retryable: false,
    details: { source },
  })
}

function extractCommand(value: JsonValue, relativePath: string): string | null {
  const direct = extractString(value, ["command", "plan.command", "summary.command"])
  if (direct) return direct
  const firstSegment = relativePath.split(path.sep)[0]
  return firstSegment.includes("-") ? firstSegment : null
}

function extractEndpoints(value: JsonValue, relativePath: string): string[] {
  const endpoints = new Set<string>()
  for (const endpoint of extractStringArray(value, ["endpoint_sequence", "endpoints", "summary.endpoint_sequence"])) {
    if (isEndpointPath(endpoint)) endpoints.add(endpoint)
  }
  for (const candidate of [
    extractString(value, ["endpoint", "summary.endpoint"]),
    extractUrlPath(value, "plan.submit_url"),
    extractUrlPath(value, "plan.poll_url"),
  ]) {
    if (candidate && isEndpointPath(candidate)) endpoints.add(candidate)
  }

  const lowerPath = relativePath.toLowerCase()
  if (endpoints.size === 0 && /text2video|image2video|frames2video/.test(lowerPath)) {
    if (lowerPath.includes("submit")) endpoints.add("/mweb/v1/aigc_draft/generate")
    if (lowerPath.includes("poll") || lowerPath.includes("result")) endpoints.add("/mweb/v1/get_history_by_ids")
  }
  if (endpoints.size === 0 && lowerPath.includes("tts")) endpoints.add("/mweb/v1/tts_generate")
  if (endpoints.size === 0 && lowerPath.includes("account-credit")) endpoints.add("/commerce/v1/benefits/user_credit")
  return [...endpoints].sort()
}

function extractStringArray(value: JsonValue, paths: readonly string[]): string[] {
  const strings: string[] = []
  for (const contractPath of paths) {
    const found = getByPath(value, contractPath)
    if (!Array.isArray(found)) continue
    for (const entry of found) {
      if (typeof entry === "string") strings.push(entry)
    }
  }
  return strings
}

function isEndpointPath(value: string): boolean {
  return /^(\/(?:mweb|commerce|lv|cc)\/v\d+\/|\/api\/)/.test(value)
}

function extractUrlPath(value: JsonValue, contractPath: string): string | null {
  const url = extractString(value, [contractPath])
  if (!url) return null
  try {
    return new URL(url).pathname
  } catch {
    const match = url.match(/(\/(?:mweb|commerce|lv|cc)\/v\d+\/[^?\s]+)/)
    return match?.[1] ?? null
  }
}

function extractString(value: JsonValue, paths: readonly string[]): string | null {
  for (const contractPath of paths) {
    const found = getByPath(value, contractPath)
    if (typeof found === "string") return found
  }
  return null
}

function extractStringOrNumber(value: JsonValue, paths: readonly string[]): string | number | null {
  for (const contractPath of paths) {
    const found = getByPath(value, contractPath)
    if (typeof found === "string" || typeof found === "number") return found
  }
  return null
}

function extractNumber(value: JsonValue, paths: readonly string[]): number | null {
  for (const contractPath of paths) {
    const found = getByPath(value, contractPath)
    if (typeof found === "number") return found
  }
  return null
}

function getByPath(value: JsonValue, contractPath: string): JsonValue | undefined {
  let current: JsonValue | undefined = value
  for (const part of contractPath.split(".")) {
    if (!isJsonObject(current)) return undefined
    current = current[part]
  }
  return current
}

function summarizeArtifact(root: string, file: string): JimengContractArtifactSummary {
  const ext = path.extname(file).toLowerCase()
  return {
    relative_path: path.relative(root, file),
    kind: ext === ".mp3" || ext === ".wav" || ext === ".m4a"
      ? "audio"
      : ext === ".mp4" || ext === ".mov" || ext === ".webm"
        ? "video"
        : ext === ".png" || ext === ".jpg" || ext === ".jpeg" || ext === ".webp"
          ? "image"
          : "other",
    bytes: statSync(file).size,
  }
}

function documentKind(relativePath: string): JimengContractDocumentSummary["kind"] {
  if (relativePath.includes(`${path.sep}raw${path.sep}`)) return "raw"
  if (relativePath.includes(`${path.sep}normalized${path.sep}`)) return "normalized"
  if (path.basename(relativePath).toLowerCase().includes("manifest")) return "manifest"
  return "other"
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function jsonType(value: JsonValue): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function compactExample(value: JsonValue): JsonValue | null {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}...` : value
  if (Array.isArray(value)) return value.length === 0 ? [] : [`array(${value.length})`]
  return { keys: Object.keys(value).sort().slice(0, 12) }
}

function shouldParseJsonString(key: string, value: string): boolean {
  if (!/draft_content|metrics_extra|video_task_extra|sceneOptions|payload/i.test(key)) return false
  const trimmed = value.trim()
  return (trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))
}

function tryParseJson(value: string): JsonValue | null {
  try {
    // ast-grep-ignore: no-unsafe-any-unknown-ts
    return toJsonValue(JSON.parse(value) as unknown, "embedded-json-string")
  } catch {
    return null
  }
}

function isSensitiveString(key: string, value: string): boolean {
  return /cookie|authorization|token|secret|x-signature|a_bogus|msToken/i.test(key) || /[?&](msToken|a_bogus|x-signature|x-expires|X-Amz|lk3s)=/i.test(value)
}

function redactString(key: string, value: string): string {
  if (/url/i.test(key) || /^https?:\/\//.test(value)) return "[SIGNED_URL_REDACTED]"
  return `[REDACTED ${value.length} chars]`
}

function stablePlaceholder(key: string, value: string): string {
  if (/submit|history|task|logid|log_id|generate_id|capflow|uuid|hash|md5/i.test(key)) return `[${key.toUpperCase()}]`
  return value
}

function isVolatilePathKey(key: string): boolean {
  return /submit_id|submitId|history_id|historyId|task_id|taskId|logid|log_id|generate_id|capflow_id|created_time|finish_time|systime|uid|url|uri|cookie/i.test(key)
}

function isMostlyVolatilePath(contractPath: string): boolean {
  return /(^|\.)(id|uid|uri|url|cookie|logid|log_id|systime|created_time|finish_time|atIso|generate_id|history_group_key_md5|submit_id|submitId|history_id|historyId|task_id|taskId|capflow_id|response_text_sha256|responseTextSha256|saved_file|artifact|artifacts)(\.|$)/i.test(contractPath)
}

function isUsefulPath(contractPath: string): boolean {
  return !contractPath.endsWith("[]") && !/browser_session|submit_headers|poll_headers|cookie/i.test(contractPath)
}

function endpointSlug(endpoint: string): string {
  return endpoint.replace(/^https?:\/\/[^/]+/, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "endpoint"
}

function endpointRisk(endpoint: string): string {
  if (/generate|tts|voice|subject|upload|pre_process|mix_audio/i.test(endpoint)) return "generation-or-mutation"
  if (/commerce|purchase|trade|refund|subscription/i.test(endpoint)) return "account-commerce"
  return "read-or-unknown"
}

function pascalCase(value: string): string {
  return value.split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`).join("")
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right))
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}

function uniqueSortedStringOrNumbers(values: readonly (string | number)[]): (string | number)[] {
  return [...new Set(values)].sort((left, right) => String(left).localeCompare(String(right)))
}

function isPresentString(value: string | null): value is string {
  return typeof value === "string" && value.length > 0
}

function isPresentNumber(value: number | null): value is number {
  return typeof value === "number"
}

function isPresentStringOrNumber(value: string | number | null): value is string | number {
  return typeof value === "string" || typeof value === "number"
}

function formatMarkdownExample(value: JsonValue | null): string {
  if (value === null) return "null"
  return JSON.stringify(value).replace(/`/g, "'").slice(0, 120)
}

function writeJson(file: string, value: JsonValue | JimengContractInference | Record<string, JsonValue | JsonObject | JimengEffectSchemaIr>): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}
