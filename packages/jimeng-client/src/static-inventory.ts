import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import {
  isHighValueJimengDiscoveryEndpoint,
  isUsefulJimengDiscoveryEndpoint,
  normalizeJimengDiscoveryEndpoint,
  type JimengDiscoveryRiskClass,
} from "./discovery-worklist"
import {
  getJimengDiscoveryKnownEndpoints,
  type JimengDiscoveryKnownEndpoint,
  type JimengDiscoveryKnownStatus,
} from "./endpoint-registry"
import { type JsonObject } from "./reference-image"

const STATIC_FILE_RE = /\.(?:[cm]?[jt]sx?|json|html|map|txt)$/i
const MAX_STATIC_FILE_BYTES = 8_000_000
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"])
const ENDPOINT_STRING_RE = /["'`](\/(?:mweb\/(?:search\/)?v\d+|lv\/v\d+|api\/|commerce\/|aweme\/|webcast\/)[^"'`\\\s?#${}]*)/g
const FULL_URL_RE = /https?:\/\/[^"'`\s]+\/(?:mweb\/(?:search\/)?v\d+|lv\/v\d+|api\/|commerce\/|aweme\/|webcast\/)[^"'`\s?#${}]*/g
const CAPCUT_STATIC_CATALOG_RE = /https?:\/\/[^"'`\s]+\/obj\/ies-fe-bee-sg\/bee_prod\/[^"'`\s?#]+/g

export type JimengStaticInventoryResourceKind = "api_endpoint" | "static_catalog"

export type JimengStaticInventoryRecommendedAction =
  | "already_implemented"
  | "capture_or_compare_before_live"
  | "capture_exact_payload"
  | "probe_read_endpoint"
  | "approval_or_disposable_fixture"
  | "document_low_value_or_risky"

export interface JimengStaticInventoryOccurrence {
  file: string
  line: number
  column: number
  host: string | null
}

export interface JimengStaticInventoryItem {
  rank: number
  priority: number
  resource: string
  resourceKind: JimengStaticInventoryResourceKind
  occurrenceCount: number
  fileCount: number
  files: string[]
  hosts: string[]
  sampleOccurrences: JimengStaticInventoryOccurrence[]
  highValue: boolean
  riskClass: JimengDiscoveryRiskClass
  knownStatus: JimengDiscoveryKnownStatus | null
  knownCommand: string | null
  knownNote: string | null
  recommendedAction: JimengStaticInventoryRecommendedAction
  reason: string
}

export interface JimengStaticInventoryResult {
  generatedAtIso: string
  staticRoots: string[]
  includeKnown: boolean
  totalResourceCount: number
  includedResourceCount: number
  skippedImplementedCount: number
  highValueGapCount: number
  knownStatusCounts: Record<string, number>
  riskClassCounts: Record<string, number>
  items: JimengStaticInventoryItem[]
}

export function inventoryJimengStaticApis(input: {
  staticRoots: string[]
  includeKnown?: boolean
  limit?: number
  nowIso?: string
}): JimengStaticInventoryResult {
  const staticRoots = sortedUnique(input.staticRoots.map((root) => path.resolve(root)).filter((root) => existsSync(root)))
  if (staticRoots.length === 0) throw new Error("static-inventory requires at least one existing --staticRoot")

  const includeKnown = input.includeKnown === true
  const limit = input.limit ?? 200
  const evidenceByResource = new Map<string, {
    kind: JimengStaticInventoryResourceKind
    files: Set<string>
    hosts: Set<string>
    occurrences: JimengStaticInventoryOccurrence[]
    count: number
  }>()

  for (const file of staticRoots.flatMap(walkStaticFiles)) {
    const text = readFileSync(file, "utf8")
    for (const hit of resourcesFromText(text)) {
      const existing = evidenceByResource.get(hit.resource) ?? {
        kind: hit.kind,
        files: new Set<string>(),
        hosts: new Set<string>(),
        occurrences: [],
        count: 0,
      }
      existing.count += 1
      existing.files.add(file)
      if (hit.host) existing.hosts.add(hit.host)
      if (existing.occurrences.length < 6) {
        existing.occurrences.push({
          file,
          line: hit.line,
          column: hit.column,
          host: hit.host,
        })
      }
      evidenceByResource.set(hit.resource, existing)
    }
  }

  const knownByEndpoint = new Map<string, JimengDiscoveryKnownEndpoint>(
    getJimengDiscoveryKnownEndpoints().map((endpoint) => [endpoint.endpoint, endpoint]),
  )
  const allItems = Array.from(evidenceByResource.entries()).map(([resource, evidence]) => {
    const known = evidence.kind === "api_endpoint"
      ? knownByEndpoint.get(resource) ?? null
      : staticCatalogKnownEndpoint(resource)
    const highValue = evidence.kind === "static_catalog" || isHighValueJimengDiscoveryEndpoint(resource)
    const riskClass = classifyStaticInventoryRisk(resource, evidence.kind)
    const recommendation = recommendStaticInventoryAction({ resource, kind: evidence.kind, highValue, riskClass, known })
    return {
      rank: 0,
      priority: recommendation.priority,
      resource,
      resourceKind: evidence.kind,
      occurrenceCount: evidence.count,
      fileCount: evidence.files.size,
      files: Array.from(evidence.files).sort().slice(0, 12),
      hosts: Array.from(evidence.hosts).sort(),
      sampleOccurrences: evidence.occurrences.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
      highValue,
      riskClass,
      knownStatus: known?.status ?? null,
      knownCommand: known?.command ?? null,
      knownNote: known?.note ?? null,
      recommendedAction: recommendation.action,
      reason: recommendation.reason,
    } satisfies JimengStaticInventoryItem
  })

  const skippedImplementedCount = allItems.filter((item) => item.knownStatus === "implemented").length
  const includedItems = allItems
    .filter((item) => includeKnown || item.knownStatus !== "implemented")
    .sort((left, right) => right.priority - left.priority || Number(right.highValue) - Number(left.highValue) || left.resource.localeCompare(right.resource))
    .slice(0, limit)
    .map((item, index) => ({ ...item, rank: index + 1 }))

  return {
    generatedAtIso: input.nowIso ?? new Date().toISOString(),
    staticRoots,
    includeKnown,
    totalResourceCount: allItems.length,
    includedResourceCount: includedItems.length,
    skippedImplementedCount: includeKnown ? 0 : skippedImplementedCount,
    highValueGapCount: allItems.filter((item) => item.highValue && item.knownStatus !== "implemented").length,
    knownStatusCounts: countKnownStatuses(allItems),
    riskClassCounts: countRiskClasses(allItems),
    items: includedItems,
  }
}

export function summarizeJimengStaticInventory(result: JimengStaticInventoryResult): JsonObject {
  return {
    generated_at_iso: result.generatedAtIso,
    static_roots: result.staticRoots,
    include_known: result.includeKnown,
    total_resource_count: result.totalResourceCount,
    included_resource_count: result.includedResourceCount,
    skipped_implemented_count: result.skippedImplementedCount,
    high_value_gap_count: result.highValueGapCount,
    known_status_counts: result.knownStatusCounts,
    risk_class_counts: result.riskClassCounts,
    items: result.items.map((item) => ({
      rank: item.rank,
      priority: item.priority,
      resource: item.resource,
      resource_kind: item.resourceKind,
      occurrence_count: item.occurrenceCount,
      file_count: item.fileCount,
      files: item.files,
      hosts: item.hosts,
      high_value: item.highValue,
      risk_class: item.riskClass,
      known_status: item.knownStatus,
      known_command: item.knownCommand,
      recommended_action: item.recommendedAction,
      reason: item.reason,
      sample_occurrences: item.sampleOccurrences.map((occurrence) => ({
        file: occurrence.file,
        line: occurrence.line,
        column: occurrence.column,
        host: occurrence.host,
      })),
    })),
  }
}

export function writeJimengStaticInventoryMarkdown(result: JimengStaticInventoryResult): string {
  const lines: string[] = []
  lines.push("# Jimeng Static API Inventory")
  lines.push("")
  lines.push(`- Generated at: ${result.generatedAtIso}`)
  lines.push(`- Static roots: ${result.staticRoots.length}`)
  lines.push(`- Total resources: ${result.totalResourceCount}`)
  lines.push(`- Included resources: ${result.includedResourceCount}`)
  lines.push(`- High-value gaps: ${result.highValueGapCount}`)
  lines.push(`- Skipped implemented: ${result.skippedImplementedCount}`)
  lines.push("")
  lines.push("| Rank | Action | Risk | Known | Occurrences | Resource | Reason |")
  lines.push("| ---: | --- | --- | --- | ---: | --- | --- |")
  for (const item of result.items.slice(0, 80)) {
    lines.push([
      item.rank,
      item.recommendedAction,
      item.riskClass,
      item.knownCommand ?? item.knownStatus ?? "",
      item.occurrenceCount,
      `\`${item.resource}\``,
      item.reason,
    ].join(" | "))
  }
  lines.push("")
  lines.push("This is an offline inventory over local frontend bundles/source roots. It does not open a browser, load a session, or replay requests.")
  return `${lines.join("\n")}\n`
}

function resourcesFromText(text: string): Array<{
  resource: string
  kind: JimengStaticInventoryResourceKind
  host: string | null
  line: number
  column: number
}> {
  const resources: Array<{
    resource: string
    kind: JimengStaticInventoryResourceKind
    host: string | null
    line: number
    column: number
  }> = []
  for (const match of text.matchAll(ENDPOINT_STRING_RE)) {
    const endpoint = normalizeJimengDiscoveryEndpoint(match[1])
    if (!endpoint || !isUsefulJimengDiscoveryEndpoint(endpoint)) continue
    const position = lineColumnAt(text, match.index ?? 0)
    resources.push({ resource: endpoint, kind: "api_endpoint", host: null, line: position.line, column: position.column })
  }
  for (const match of text.matchAll(FULL_URL_RE)) {
    const parsed = parseStaticUrl(match[0])
    const endpoint = normalizeJimengDiscoveryEndpoint(parsed.resource)
    if (!endpoint || !isUsefulJimengDiscoveryEndpoint(endpoint)) continue
    const position = lineColumnAt(text, match.index ?? 0)
    resources.push({ resource: endpoint, kind: "api_endpoint", host: parsed.host, line: position.line, column: position.column })
  }
  for (const match of text.matchAll(CAPCUT_STATIC_CATALOG_RE)) {
    const parsed = parseStaticUrl(match[0])
    const position = lineColumnAt(text, match.index ?? 0)
    resources.push({ resource: parsed.resource, kind: "static_catalog", host: parsed.host, line: position.line, column: position.column })
  }
  return resources
}

function parseStaticUrl(value: string): { resource: string; host: string | null } {
  try {
    const url = new URL(value)
    return { resource: `${url.origin}${url.pathname}`, host: url.host }
  } catch {
    return { resource: value.split("?")[0] ?? value, host: null }
  }
}

function classifyStaticInventoryRisk(resource: string, kind: JimengStaticInventoryResourceKind): JimengDiscoveryRiskClass {
  if (kind === "static_catalog") return "read"
  const pathText = resource.toLowerCase()
  if (/pay|payment|vip|order|checkout|subscribe|wallet|billing|credit/.test(pathText)) return "payment"
  if (/analytics|slardar|beacon|event|log|report|monitor/.test(pathText)) return "analytics"
  if (/upload|imagex|tos|applyupload|commitupload|submit_audit/.test(pathText)) return "upload"
  if (/aigc_draft\/generate|generate_voice|tts_generate|voice\/submit_task|generate|submit|lip.?sync|text.?to.?video|image.?to.?video|conversation/.test(pathText)) return "generate"
  if (/(?:^|\/)(?:create|update|delete|remove|rename|copy|save|favorite|publish|edit|add|add_async|label_as_exported|promote_asset|batch_sync_asset)(?:$|[\/_])/.test(pathText)) return "mutate"
  if (/get_|\/get|list|query|feed|search|config|categor|metadata|history|asset|explore|template|detail/.test(pathText)) return "read"
  return "unclassified"
}

function recommendStaticInventoryAction(input: {
  resource: string
  kind: JimengStaticInventoryResourceKind
  highValue: boolean
  riskClass: JimengDiscoveryRiskClass
  known: JimengDiscoveryKnownEndpoint | null
}): { action: JimengStaticInventoryRecommendedAction; priority: number; reason: string } {
  if (input.known?.status === "implemented") {
    return { action: "already_implemented", priority: 5, reason: `Covered by ${input.known.command}.` }
  }
  if (input.known?.status === "dry_run_only") {
    return { action: "approval_or_disposable_fixture", priority: 92, reason: input.known.note }
  }
  if (input.known?.status === "partial" && input.resource === "/mweb/v1/dreamina_subject/generate_voice") {
    return { action: "approval_or_disposable_fixture", priority: 92, reason: input.known.note }
  }
  if (input.known?.status === "partial") {
    return { action: "capture_or_compare_before_live", priority: 88, reason: input.known.note }
  }
  if (input.known?.status === "captured_only") {
    return { action: "capture_exact_payload", priority: 84, reason: input.known.note }
  }
  if (input.known?.status === "cataloged_only") {
    return { action: "document_low_value_or_risky", priority: 24, reason: input.known.note }
  }
  if (input.known?.status === "blocked") {
    return { action: "capture_exact_payload", priority: input.highValue ? 36 : 18, reason: input.known.note }
  }
  if (input.kind === "static_catalog") {
    return { action: "probe_read_endpoint", priority: 68, reason: "Static public catalog URL; fetch only if it carries useful template/reference metadata." }
  }
  if (input.riskClass === "read") {
    return {
      action: "probe_read_endpoint",
      priority: input.highValue ? 74 : 42,
      reason: "Read-like endpoint found statically; capture or replay explicit safe variants before CLI promotion.",
    }
  }
  if (input.riskClass === "generate") {
    return {
      action: "capture_or_compare_before_live",
      priority: input.highValue ? 82 : 58,
      reason: "Generation-like endpoint found statically; require UI capture/dry-run comparison before live replay.",
    }
  }
  if (input.riskClass === "upload" || input.riskClass === "mutate") {
    return {
      action: "approval_or_disposable_fixture",
      priority: input.highValue ? 62 : 44,
      reason: "Endpoint may mutate account/upload state; use a disposable fixture or explicit approval.",
    }
  }
  if (input.riskClass === "payment" || input.riskClass === "analytics" || input.riskClass === "third_party") {
    return { action: "document_low_value_or_risky", priority: 10, reason: "Low-value or risky endpoint for UGC API extraction." }
  }
  return {
    action: input.highValue ? "capture_exact_payload" : "document_low_value_or_risky",
    priority: input.highValue ? 50 : 18,
    reason: "Endpoint needs focused capture to determine request shape and value.",
  }
}

function staticCatalogKnownEndpoint(resource: string): JimengDiscoveryKnownEndpoint | null {
  if (!resource.includes("/obj/ies-fe-bee-sg/bee_prod/")) return null
  return {
    endpoint: resource,
    status: "implemented",
    command: "capcut-template-metadata",
    note: "Public CapCut bee_prod ratio/scene metadata catalogs are covered by capcut-template-metadata.",
    evidence: [],
    nextProbe: null,
  }
}

function countKnownStatuses(items: Array<{ knownStatus: JimengDiscoveryKnownStatus | null }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = item.knownStatus ?? "unknown"
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function countRiskClasses(items: Array<{ riskClass: JimengDiscoveryRiskClass }>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const item of items) counts[item.riskClass] = (counts[item.riskClass] ?? 0) + 1
  return counts
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

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index)
  const lines = before.split(/\r?\n/)
  return {
    line: lines.length,
    column: (lines.at(-1) ?? "").length + 1,
  }
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}
