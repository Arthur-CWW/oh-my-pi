import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { z } from "zod"
import { type JsonObject, type JsonValue } from "./reference-image"
import { JimengJsonObjectSchema, JimengJsonValueSchema, parseJimengContract, parseJsonText } from "./schema"

const STATIC_FILE_RE = /\.(?:[cm]?[jt]sx?|json|html|map|txt)$/i
const MAX_STATIC_FILE_BYTES = 3_000_000
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"])
const ENDPOINT_STRING_RE = /["'`](\/(?:mweb\/v\d+|lv\/v\d+|api\/|commerce\/|aweme\/|webcast\/)[^"'`\\\s?#${}]*)/g
const FULL_URL_RE = /https?:\/\/[^"'`\s]+\/(?:mweb\/v\d+|lv\/v\d+|api\/|commerce\/|aweme\/|webcast\/)[^"'`\s?#${}]*/g

const JimengRiskSchema = z.enum(["read", "mutate", "upload", "generate", "payment", "analytics", "third_party", "unclassified"])

const JimengStaticHintSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
}).passthrough()

const JimengCaptureCandidateSchema = z.object({
  rank: z.number().optional(),
  method: z.string(),
  endpoint: z.string().optional(),
  url_host: z.string().optional(),
  url_pathname: z.string(),
  status: z.number().nullable().optional(),
  risk_class: JimengRiskSchema.catch("unclassified"),
  replay_safe_by_default: z.boolean().optional(),
  score: z.number().optional(),
  reasons: z.array(z.string()).optional(),
  request_body_sha256: z.string().nullable().optional(),
  response_text_sha256: z.string().nullable().optional(),
  response_ret: z.union([z.string(), z.number()]).nullable().optional(),
  response_errmsg: z.string().nullable().optional(),
  request_shape: JimengJsonObjectSchema.nullable().optional(),
  response_shape: JimengJsonObjectSchema.nullable().optional(),
  initiator_functions: z.array(z.string()).optional(),
  initiator_scripts: z.array(z.string()).optional(),
  static_hints: z.array(JimengStaticHintSchema).optional(),
}).passthrough()

const JimengCaptureAnalysisSchema = z.object({
  source_path: z.string().nullable().optional(),
  analyzed_at_iso: z.string().optional(),
  total_events: z.number().optional(),
  total_requests: z.number().optional(),
  candidates: z.array(JimengCaptureCandidateSchema),
}).passthrough()

const JimengEndpointProbeCandidateSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  method: z.enum(["GET", "POST"]),
  query: z.string().nullable().optional(),
  risk_class: JimengRiskSchema.catch("unclassified"),
  replay_safe_by_default: z.boolean().optional(),
  variants: z.array(z.object({
    name: z.string(),
    body: JimengJsonValueSchema,
  }).passthrough()),
}).passthrough()

const JimengEndpointProbeCandidateFileSchema = z.object({
  source_path: z.string().nullable().optional(),
  candidates: z.array(JimengEndpointProbeCandidateSchema),
}).passthrough()

type JimengCaptureCandidateInput = z.infer<typeof JimengCaptureCandidateSchema>
type JimengCaptureAnalysisInput = z.infer<typeof JimengCaptureAnalysisSchema>
type JimengEndpointProbeCandidateInput = z.infer<typeof JimengEndpointProbeCandidateSchema>

export type JimengDiscoveryKnownStatus =
  | "implemented"
  | "partial"
  | "dry_run_only"
  | "cataloged_only"
  | "captured_only"
  | "blocked"

export interface JimengDiscoveryKnownEndpoint {
  endpoint: string
  status: JimengDiscoveryKnownStatus
  command: string | null
  note: string
}

export type JimengDiscoveryRiskClass = z.infer<typeof JimengRiskSchema>

export type JimengDiscoveryRecommendedAction =
  | "probe_then_promote_cli"
  | "capture_request_builder"
  | "compare_dry_run_before_live"
  | "approval_or_disposable_fixture"
  | "already_covered"
  | "document_low_value_or_risky"
  | "static_capture_needed"

export interface JimengDiscoveryStaticEndpoint {
  endpoint: string
  files: string[]
  occurrence_count: number
  high_value: boolean
  known_status: JimengDiscoveryKnownStatus | null
  known_command: string | null
}

export interface JimengDiscoveryWorkItem {
  rank: number
  priority: number
  endpoint: string
  method: string
  source: "capture" | "static"
  risk_class: z.infer<typeof JimengRiskSchema>
  known_status: JimengDiscoveryKnownStatus | null
  known_command: string | null
  recommended_action: JimengDiscoveryRecommendedAction
  reason: string
  blocked_reason: string | null
  replay_safe_by_default: boolean
  has_probe_variants: boolean
  probe_variant_count: number
  suggested_commands: string[]
  evidence: JsonObject
}

export interface JimengDiscoveryProbeVariantExport {
  endpoint: string
  method: "GET" | "POST"
  query: string | null
  risk_class: z.infer<typeof JimengRiskSchema>
  replay_safe_by_default: boolean
  variant_count: number
  variants: Array<{ name: string; body: JsonValue }>
}

export interface JimengDiscoveryWorklist {
  generated_at_iso: string
  analysis_files: string[]
  static_roots: string[]
  include_known: boolean
  known_endpoint_count: number
  captured_endpoint_count: number
  static_endpoint_count: number
  work_item_count: number
  skipped_known_count: number
  probe_variant_exports: JimengDiscoveryProbeVariantExport[]
  items: JimengDiscoveryWorkItem[]
  static_only_endpoints: JimengDiscoveryStaticEndpoint[]
}

export function readJimengCaptureAnalysisFile(file: string): JimengCaptureAnalysisInput {
  const resolved = path.resolve(file)
  const body = parseJsonText(readFileSync(resolved, "utf8"), "Jimeng capture analysis")
  return parseJimengContract(JimengCaptureAnalysisSchema, body, "Jimeng capture analysis")
}

export function readJimengEndpointProbeCandidateFile(file: string): JimengEndpointProbeCandidateInput[] {
  const resolved = path.resolve(file)
  const body = parseJsonText(readFileSync(resolved, "utf8"), "Jimeng endpoint probe candidates")
  const parsed = parseJimengContract(JimengEndpointProbeCandidateFileSchema, body, "Jimeng endpoint probe candidates")
  return parsed.candidates
}

export function buildJimengDiscoveryWorklist(input: {
  analyses: JimengCaptureAnalysisInput[]
  analysisFiles?: string[]
  probeCandidates?: JimengEndpointProbeCandidateInput[]
  staticRoots?: string[]
  includeKnown?: boolean
  nowIso?: string
}): JimengDiscoveryWorklist {
  const includeKnown = input.includeKnown === true
  const analysisFiles = input.analysisFiles ?? input.analyses.map((analysis) => analysis.source_path ?? "inline")
  const staticRoots = (input.staticRoots ?? []).map((root) => path.resolve(root)).filter((root) => existsSync(root))
  const knownByEndpoint = buildKnownEndpointMap()
  const probeByEndpoint = buildProbeCandidateMap(input.probeCandidates ?? [])
  const capturedEndpoints = new Set<string>()
  const items: JimengDiscoveryWorkItem[] = []
  let skippedKnownCount = 0

  for (const analysis of input.analyses) {
    const sourcePath = analysis.source_path ?? "inline"
    for (const candidate of analysis.candidates) {
      const endpoint = normalizeEndpoint(candidate.url_pathname || candidate.endpoint)
      if (!endpoint) continue
      if (!isUsefulEndpoint(endpoint)) continue
      capturedEndpoints.add(endpoint)
      const known = knownByEndpoint.get(endpoint) ?? null
      const probe = probeByEndpoint.get(endpoint) ?? null
      const recommendation = recommendCapturedCandidate(candidate, endpoint, known, probe)
      if (recommendation.action === "already_covered" && !includeKnown) {
        skippedKnownCount += 1
        continue
      }
      items.push({
        rank: 0,
        priority: recommendation.priority,
        endpoint,
        method: candidate.method.toUpperCase(),
        source: "capture",
        risk_class: candidate.risk_class,
        known_status: known?.status ?? null,
        known_command: known?.command ?? null,
        recommended_action: recommendation.action,
        reason: recommendation.reason,
        blocked_reason: recommendation.blockedReason,
        replay_safe_by_default: candidate.replay_safe_by_default === true,
        has_probe_variants: !!probe,
        probe_variant_count: probe?.variants.length ?? 0,
        suggested_commands: suggestedCommandsForCandidate(endpoint, candidate, probe, recommendation.action),
        evidence: {
          capture_source: sourcePath,
          capture_rank: candidate.rank ?? null,
          capture_score: candidate.score ?? null,
          status: candidate.status ?? null,
          response_ret: candidate.response_ret ?? null,
          response_errmsg: candidate.response_errmsg ?? null,
          request_body_sha256: candidate.request_body_sha256 ?? null,
          response_text_sha256: candidate.response_text_sha256 ?? null,
          reasons: candidate.reasons ?? [],
          initiator_functions: (candidate.initiator_functions ?? []).slice(0, 8),
          initiator_scripts: (candidate.initiator_scripts ?? []).slice(0, 4),
          static_hints: staticHintsToJson(candidate.static_hints ?? []),
          request_shape: candidate.request_shape ?? null,
          response_shape: candidate.response_shape ?? null,
        },
      })
    }
  }

  const staticEndpoints = collectStaticEndpoints(staticRoots, knownByEndpoint)
  for (const endpoint of staticEndpoints) {
    if (capturedEndpoints.has(endpoint.endpoint)) continue
    if (endpoint.known_status === "implemented" && !includeKnown) continue
    const recommendation = recommendStaticEndpoint(endpoint)
    items.push({
      rank: 0,
      priority: recommendation.priority,
      endpoint: endpoint.endpoint,
      method: "UNKNOWN",
      source: "static",
      risk_class: "unclassified",
      known_status: endpoint.known_status,
      known_command: endpoint.known_command,
      recommended_action: recommendation.action,
      reason: recommendation.reason,
      blocked_reason: recommendation.blockedReason,
      replay_safe_by_default: false,
      has_probe_variants: false,
      probe_variant_count: 0,
      suggested_commands: [
        `Record a focused background CDP UI action that reaches ${endpoint.endpoint}, then run capture-analyze on raw-network.jsonl.`,
      ],
      evidence: {
        occurrence_count: endpoint.occurrence_count,
        files: endpoint.files.slice(0, 8),
        high_value: endpoint.high_value,
      },
    })
  }

  const rankedItems = items
    .sort((left, right) => right.priority - left.priority || left.endpoint.localeCompare(right.endpoint))
    .map((item, index) => ({ ...item, rank: index + 1 }))

  const probeVariantExports = Array.from(probeByEndpoint.values())
    .filter((candidate) => candidate.replay_safe_by_default === true || includeKnown)
    .map((candidate) => ({
      endpoint: normalizeEndpoint(candidate.endpoint) ?? candidate.endpoint,
      method: candidate.method,
      query: candidate.query ?? null,
      risk_class: candidate.risk_class,
      replay_safe_by_default: candidate.replay_safe_by_default === true,
      variant_count: candidate.variants.length,
      variants: candidate.variants.map((variant) => ({ name: variant.name, body: variant.body })),
    }))

  return {
    generated_at_iso: input.nowIso ?? new Date().toISOString(),
    analysis_files: analysisFiles,
    static_roots: staticRoots,
    include_known: includeKnown,
    known_endpoint_count: knownByEndpoint.size,
    captured_endpoint_count: capturedEndpoints.size,
    static_endpoint_count: staticEndpoints.length,
    work_item_count: rankedItems.length,
    skipped_known_count: skippedKnownCount,
    probe_variant_exports: probeVariantExports,
    items: rankedItems,
    static_only_endpoints: staticEndpoints.filter((endpoint) => !capturedEndpoints.has(endpoint.endpoint)),
  }
}

export function getJimengDiscoveryKnownEndpoints(): JimengDiscoveryKnownEndpoint[] {
  return KNOWN_ENDPOINTS.map((endpoint) => ({ ...endpoint }))
}

export function normalizeJimengDiscoveryEndpoint(value: string | undefined): string | null {
  return normalizeEndpoint(value)
}

export function isUsefulJimengDiscoveryEndpoint(endpoint: string): boolean {
  return isUsefulEndpoint(endpoint)
}

export function isHighValueJimengDiscoveryEndpoint(endpoint: string): boolean {
  return isHighValueEndpoint(endpoint)
}

export function summarizeJimengDiscoveryWorklist(worklist: JimengDiscoveryWorklist): JsonObject {
  return {
    generated_at_iso: worklist.generated_at_iso,
    analysis_files: worklist.analysis_files,
    static_roots: worklist.static_roots,
    include_known: worklist.include_known,
    known_endpoint_count: worklist.known_endpoint_count,
    captured_endpoint_count: worklist.captured_endpoint_count,
    static_endpoint_count: worklist.static_endpoint_count,
    work_item_count: worklist.work_item_count,
    skipped_known_count: worklist.skipped_known_count,
    probe_variant_export_count: worklist.probe_variant_exports.length,
    items: worklist.items.map((item) => ({
      rank: item.rank,
      priority: item.priority,
      endpoint: item.endpoint,
      method: item.method,
      source: item.source,
      risk_class: item.risk_class,
      known_status: item.known_status,
      known_command: item.known_command,
      recommended_action: item.recommended_action,
      reason: item.reason,
      blocked_reason: item.blocked_reason,
      replay_safe_by_default: item.replay_safe_by_default,
      has_probe_variants: item.has_probe_variants,
      probe_variant_count: item.probe_variant_count,
      suggested_commands: item.suggested_commands,
      evidence: item.evidence,
    })),
    static_only_endpoints: worklist.static_only_endpoints.map((endpoint) => ({
      endpoint: endpoint.endpoint,
      occurrence_count: endpoint.occurrence_count,
      high_value: endpoint.high_value,
      known_status: endpoint.known_status,
      known_command: endpoint.known_command,
      files: endpoint.files.slice(0, 8),
    })),
  }
}

export function writeJimengDiscoveryWorklistMarkdown(worklist: JimengDiscoveryWorklist): string {
  const lines: string[] = []
  lines.push("# Jimeng Discovery Worklist")
  lines.push("")
  lines.push(`- Generated at: ${worklist.generated_at_iso}`)
  lines.push(`- Analysis files: ${worklist.analysis_files.length}`)
  lines.push(`- Captured endpoints: ${worklist.captured_endpoint_count}`)
  lines.push(`- Static endpoints: ${worklist.static_endpoint_count}`)
  lines.push(`- Work items: ${worklist.work_item_count}`)
  lines.push(`- Already-covered captures skipped: ${worklist.skipped_known_count}`)
  lines.push(`- Probe variant exports: ${worklist.probe_variant_exports.length}`)
  lines.push("")
  lines.push("| Rank | Priority | Action | Risk | Endpoint | Known | Reason |")
  lines.push("| ---: | ---: | --- | --- | --- | --- | --- |")
  for (const item of worklist.items.slice(0, 40)) {
    lines.push([
      item.rank,
      item.priority,
      item.recommended_action,
      item.risk_class,
      `\`${item.endpoint}\``,
      item.known_command ?? item.known_status ?? "",
      item.reason,
    ].join(" | "))
  }
  lines.push("")
  lines.push("Raw probe variant bodies, when available, are written only to local ignored artifacts. Re-check risk and approval requirements before replaying generate, upload, mutate, or payment endpoints.")
  return `${lines.join("\n")}\n`
}

function buildKnownEndpointMap(): Map<string, JimengDiscoveryKnownEndpoint> {
  return new Map(KNOWN_ENDPOINTS.map((endpoint) => [endpoint.endpoint, endpoint]))
}

const KNOWN_ENDPOINTS: JimengDiscoveryKnownEndpoint[] = [
  known("/mweb/v1/aigc_draft/generate", "partial", "text2image/text2video/image2video/frames2video/lip-sync", "Unified generation submit; several modes are implemented or dry-run gated, live lip-sync/end-frame still require capture compare."),
  known("/mweb/v1/get_asset_list", "implemented", "assets", "No-spend workspace asset/history listing."),
  known("/mweb/v1/get_history", "blocked", null, "Safe frontend-derived probes returned ret=0 with empty records_list, including explicit workspace scope; use assets/history-records until a non-empty UI capture is available."),
  known("/mweb/v1/get_history_by_ids", "implemented", "history-records", "No-spend history lookup by submit/history id."),
  known("/mweb/v1/get_history_queue_info", "implemented", "history-queue", "No-spend queue/progress lookup."),
  known("/mweb/v1/get_video_by_vid", "implemented", "video-info", "No-spend VOD metadata lookup."),
  known("/mweb/v1/video_generate/get_common_config", "implemented", "lip-sync-config", "No-spend video/lip-sync model config."),
  known("/mweb/v1/get_user_local_item_list", "implemented", "voice-clones", "No-spend cloned voice/user local item listing."),
  known("/mweb/v1/voice/submit_task", "dry_run_only", "voice-clone-submit", "Voice clone submit may create assets or consume quota."),
  known("/mweb/v1/voice/query_task", "partial", "voice-clone-query", "Query command exists; live proof needs a real task id."),
  known("/mweb/v1/voice/update", "dry_run_only", "voice-clone-update", "Mutates cloned voice assets."),
  known("/mweb/v1/voice/delete", "dry_run_only", "voice-clone-delete", "Mutates cloned voice assets."),
  known("/mweb/v1/feed", "partial", "voices", "Built-in voice library replay is implemented for captured signed feed requests."),
  known("/mweb/v1/tts_generate", "implemented", "tts/sample-voices", "Direct TTS MP3 generation."),
  known("/mweb/v1/get_upload_token", "implemented", "upload-token/upload-image/upload-video", "Scene 1/2/3 upload token support."),
  known("/mweb/v1/imagex/submit_audit_job", "implemented", "subject-create/subject-update", "Used in subject image creation/update path."),
  known("/mweb/v1/get_image_by_uri", "implemented", "subject-create/subject-update", "Provider image URI lookup used in subject flows."),
  known("/mweb/v1/get_explore", "implemented", "templates/short-videos", "No-spend Explore/template/short-video mining."),
  known("/mweb/v1/feed_short_video", "implemented", "overseas-short-videos", "No-spend overseas/reference short-video mining."),
  known("/mweb/v1/get_image_description", "implemented", "describe-image", "No-spend reference image description."),
  known("/mweb/v1/face_recognize", "implemented", "describe-image", "No-spend face probe."),
  known("/mweb/v1/blend_preview", "implemented", "controlnet-preview", "No-spend pose/depth/canny preview."),
  known("/mweb/v1/pose_detect", "implemented", "controlnet-preview", "Pose validation for ControlNet preview."),
  known("/mweb/v1/saliency_seg", "implemented", "object-mask", "No-spend object/mask segmentation."),
  known("/mweb/v1/dreamina_subject/get", "implemented", "subjects", "No-spend subject/persona listing."),
  known("/mweb/v1/dreamina_subject/create", "implemented", "subject-create", "Subject/persona creation from image."),
  known("/mweb/v1/dreamina_subject/update", "implemented", "subject-update", "Subject/persona update."),
  known("/mweb/v1/dreamina_subject/delete", "implemented", "subject-delete", "Subject/persona delete."),
  known("/mweb/v1/dreamina_subject/generate_voice", "dry_run_only", "subject-generate-voice", "Subject voice generation may consume quota and needs capture/approval."),
  known("/lv/v1/cc_web/plane/get_categories", "implemented", "capcut-categories", "No-spend CapCut commercial category catalog."),
  known("/lv/v1/cc_web/replicate/get_search_words", "blocked", null, "Signed no-spend probes returned ret=0 but only region metadata, not usable search words; capture a UI call that returns keyword data before promotion."),
  known("/lv/v1/cc_web/replicate/search_templates", "captured_only", null, "Guessed payloads returned param errors; capture real UI row/search payload."),
  known("/lv/v1/cc_web/plane/get_collection_templates", "captured_only", null, "Known endpoint string; capture real UI payload before exposing."),
  known("/lv/v1/cc_web/plane/batch_get_collection_templates", "captured_only", null, "Known endpoint string; capture real UI payload before exposing."),
  known("/lv/v1/cc_web/plane/fuzzy_search_templates", "captured_only", null, "Known endpoint string; tested guessed English fields returned empty results."),
  known("/mweb/v1/get_unread_count", "cataloged_only", null, "Low-value notification count endpoint."),
  known("/mweb/v1/workspace/create", "captured_only", null, "Workspace mutation; low priority until needed for automated project setup."),
  known("/mweb/v1/workspace/update", "captured_only", null, "Workspace mutation; low priority until needed for automated project setup."),
  known("/mweb/v1/creation_agent/v2/conversation", "partial", null, "Older SSE agent submit preserved but not a current high-priority UGC surface."),
  known("/mweb/v1/creation_agent/v2/get_agent_config", "implemented", "agent-catalog", "Schema-backed agent/model config catalog."),
  known("/mweb/v1/creation_agent/v2/skill/list", "implemented", "agent-catalog", "Schema-backed official/custom agent skill catalog."),
]

function known(endpoint: string, status: JimengDiscoveryKnownStatus, command: string | null, note: string): JimengDiscoveryKnownEndpoint {
  return { endpoint, status, command, note }
}

function recommendCapturedCandidate(
  candidate: JimengCaptureCandidateInput,
  endpoint: string,
  known: JimengDiscoveryKnownEndpoint | null,
  probe: JimengEndpointProbeCandidateInput | null,
): { action: JimengDiscoveryRecommendedAction; priority: number; reason: string; blockedReason: string | null } {
  if (known?.status === "implemented") {
    return { action: "already_covered", priority: 5, reason: `Covered by ${known.command}.`, blockedReason: null }
  }
  if (known?.status === "cataloged_only") {
    return {
      action: "document_low_value_or_risky",
      priority: isHighValueEndpoint(endpoint) ? 35 : 14,
      reason: known.note,
      blockedReason: "Cataloged or low-value endpoint; promote only if a later UGC workflow needs it.",
    }
  }
  if (known?.status === "blocked") {
    return {
      action: "static_capture_needed",
      priority: isHighValueEndpoint(endpoint) ? 38 : 18,
      reason: known.note,
      blockedReason: "Previous safe probes did not return useful data; capture a non-empty UI flow before CLI promotion.",
    }
  }
  if (known?.status === "dry_run_only") {
    return {
      action: "approval_or_disposable_fixture",
      priority: 88,
      reason: known.note,
      blockedReason: "Live run may spend quota or mutate account assets; require explicit approval, disposable fixture, or matching UI capture.",
    }
  }
  if (endpoint === "/mweb/v1/aigc_draft/generate") {
    return {
      action: "compare_dry_run_before_live",
      priority: 86,
      reason: "Unified generation endpoint; compare captured UI submit against a dry-run plan before enabling a live mode.",
      blockedReason: "Potential generation spend; dry-run/capture compare gate required.",
    }
  }
  if (candidate.risk_class === "read" && (candidate.replay_safe_by_default === true || probe)) {
    return {
      action: "probe_then_promote_cli",
      priority: known ? 72 : 92,
      reason: known ? known.note : "Captured read-safe endpoint with JSON evidence; replay explicit variants, then promote stable fields into a typed command.",
      blockedReason: null,
    }
  }
  if (candidate.risk_class === "generate") {
    return {
      action: "capture_request_builder",
      priority: 82,
      reason: known?.note ?? "Captured generation-like endpoint; recover request-builder semantics before live replay.",
      blockedReason: "Potential generation spend; do not replay without dry-run contract and approval.",
    }
  }
  if (candidate.risk_class === "upload" || candidate.risk_class === "mutate") {
    return {
      action: "approval_or_disposable_fixture",
      priority: 74,
      reason: known?.note ?? "Endpoint mutates account or upload state; use a disposable fixture and explicit approval before live proof.",
      blockedReason: "Mutation/upload side effect.",
    }
  }
  if (candidate.risk_class === "payment" || candidate.risk_class === "analytics" || candidate.risk_class === "third_party") {
    return {
      action: "document_low_value_or_risky",
      priority: 12,
      reason: "Endpoint is low-value for UGC extraction or risky to replay.",
      blockedReason: "Skip unless a later feature needs it.",
    }
  }
  return {
    action: "static_capture_needed",
    priority: isHighValueEndpoint(endpoint) ? 58 : 32,
    reason: known?.note ?? "Endpoint needs a focused capture or static request-builder trace before promotion.",
    blockedReason: null,
  }
}

function recommendStaticEndpoint(endpoint: JimengDiscoveryStaticEndpoint): { action: JimengDiscoveryRecommendedAction; priority: number; reason: string; blockedReason: string | null } {
  if (endpoint.known_status === "dry_run_only") {
    return {
      action: "approval_or_disposable_fixture",
      priority: 84,
      reason: "Known dry-run-only endpoint found statically; capture the matching UI action or get explicit approval before live enablement.",
      blockedReason: "Potential spend or mutation.",
    }
  }
  if (endpoint.known_status === "partial" || endpoint.known_status === "captured_only") {
    return {
      action: "static_capture_needed",
      priority: endpoint.high_value ? 68 : 45,
      reason: "Known endpoint is not fully live-proved; capture the exact UI flow and compare/replay carefully.",
      blockedReason: null,
    }
  }
  if (endpoint.known_status === "blocked") {
    return {
      action: "static_capture_needed",
      priority: endpoint.high_value ? 36 : 18,
      reason: "Known endpoint has safe probe evidence but no useful payload yet; capture a non-empty UI flow before promotion.",
      blockedReason: "Previous safe probes returned empty or metadata-only payloads.",
    }
  }
  if (endpoint.known_status === "implemented") {
    return {
      action: "already_covered",
      priority: 5,
      reason: `Covered by ${endpoint.known_command}.`,
      blockedReason: null,
    }
  }
  return {
    action: "static_capture_needed",
    priority: endpoint.high_value ? 62 : 30,
    reason: "Static endpoint string has no matching dynamic capture yet.",
    blockedReason: null,
  }
}

function suggestedCommandsForCandidate(
  endpoint: string,
  candidate: JimengCaptureCandidateInput,
  probe: JimengEndpointProbeCandidateInput | null,
  action: JimengDiscoveryRecommendedAction,
): string[] {
  if (action === "probe_then_promote_cli") {
    const variantsHint = probe
      ? `@data/jimeng-lab/<worklist>/raw/${slugEndpoint(endpoint)}-variants.json`
      : "@data/jimeng-lab/<capture-analysis>/raw/<endpoint-probe-candidates.json>"
    return [
      `jimeng-browser-proxy endpoint-probe --endpoint ${endpoint} --method ${candidate.method.toUpperCase()} --variants ${variantsHint} --outDir data/jimeng-lab/proof-<date>-${slugEndpoint(endpoint)}`,
    ]
  }
  if (action === "compare_dry_run_before_live") {
    return [
      "jimeng-browser-proxy lip-sync-compare --plan data/jimeng-lab/<proof>/raw/<dry-run-plan>.json --rawNetwork data/jimeng-captures/<capture>/raw-network.jsonl --outDir data/jimeng-lab/proof-<date>-lip-sync-compare",
    ]
  }
  if (action === "capture_request_builder" || action === "static_capture_needed") {
    return [
      `Record one background CDP UI action for ${endpoint}; then run capture-analyze with --staticRoot pointing at the relevant unpacked bundle/source root.`,
    ]
  }
  return []
}

function buildProbeCandidateMap(candidates: JimengEndpointProbeCandidateInput[]): Map<string, JimengEndpointProbeCandidateInput> {
  const map = new Map<string, JimengEndpointProbeCandidateInput>()
  for (const candidate of candidates) {
    const endpoint = normalizeEndpoint(candidate.endpoint)
    if (!endpoint) continue
    const existing = map.get(endpoint)
    if (!existing || existing.variants.length < candidate.variants.length) map.set(endpoint, candidate)
  }
  return map
}

function collectStaticEndpoints(staticRoots: string[], knownByEndpoint: Map<string, JimengDiscoveryKnownEndpoint>): JimengDiscoveryStaticEndpoint[] {
  const endpointEvidence = new Map<string, { files: Set<string>; count: number }>()
  for (const root of staticRoots) {
    for (const file of walkStaticFiles(root)) {
      const text = readFileSync(file, "utf8")
      for (const endpoint of endpointsFromText(text)) {
        const normalized = normalizeEndpoint(endpoint)
        if (!normalized) continue
        if (!isUsefulEndpoint(normalized)) continue
        const evidence = endpointEvidence.get(normalized) ?? { files: new Set<string>(), count: 0 }
        evidence.files.add(file)
        evidence.count += 1
        endpointEvidence.set(normalized, evidence)
      }
    }
  }

  return Array.from(endpointEvidence.entries())
    .map(([endpoint, evidence]) => {
      const known = knownByEndpoint.get(endpoint) ?? null
      return {
        endpoint,
        files: Array.from(evidence.files).sort(),
        occurrence_count: evidence.count,
        high_value: isHighValueEndpoint(endpoint),
        known_status: known?.status ?? null,
        known_command: known?.command ?? null,
      }
    })
    .sort((left, right) => Number(right.high_value) - Number(left.high_value) || left.endpoint.localeCompare(right.endpoint))
}

function endpointsFromText(text: string): string[] {
  const endpoints: string[] = []
  for (const match of text.matchAll(ENDPOINT_STRING_RE)) {
    if (match[1]) endpoints.push(match[1])
  }
  for (const match of text.matchAll(FULL_URL_RE)) {
    if (match[0]) endpoints.push(match[0])
  }
  return endpoints
}

function walkStaticFiles(root: string): string[] {
  const found: string[] = []
  visit(root)
  return found

  function visit(target: string): void {
    const stat = statSync(target)
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(path.basename(target))) return
      for (const entry of readdirSync(target)) visit(path.join(target, entry))
      return
    }
    if (!stat.isFile()) return
    if (stat.size > MAX_STATIC_FILE_BYTES) return
    if (!STATIC_FILE_RE.test(target)) return
    found.push(target)
  }
}

function normalizeEndpoint(value: string | undefined): string | null {
  if (!value) return null
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      return new URL(value).pathname
    } catch {
      return null
    }
  }
  const slash = value.indexOf("/")
  const endpoint = slash >= 0 ? value.slice(slash) : value
  if (endpoint.includes("${") || endpoint.includes("}")) return null
  const queryIndex = endpoint.indexOf("?")
  return queryIndex >= 0 ? endpoint.slice(0, queryIndex) : endpoint
}

function isUsefulEndpoint(endpoint: string): boolean {
  if (endpoint === "/api/" || endpoint === "/api") return false
  return /^\/(?:mweb\/v\d+|lv\/v\d+|api\/[^/]+|commerce\/v\d+|aweme\/|webcast\/)/.test(endpoint)
}

function isHighValueEndpoint(endpoint: string): boolean {
  return /aigc|video|image|voice|subject|persona|template|explore|asset|history|lip|pose|mask|saliency|blend|upload|tts|feed_short|capcut|cc_web/i.test(endpoint)
}

function staticHintsToJson(hints: Array<z.infer<typeof JimengStaticHintSchema>>): JsonValue {
  return hints.slice(0, 8).map((hint) => ({
    file: hint.file,
    line: hint.line,
    column: hint.column,
  }))
}

function slugEndpoint(endpoint: string): string {
  const slug = endpoint.replace(/^\/+/, "").replace(/[^0-9A-Za-z_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80)
  return slug || "endpoint"
}
