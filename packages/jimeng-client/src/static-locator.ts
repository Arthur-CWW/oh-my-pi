import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { readJimengCaptureAnalysisFile } from "./discovery-worklist"
import { type JsonObject } from "./reference-image"

const STATIC_FILE_RE = /\.(?:[cm]?[jt]sx?|json|html|map|txt)$/i
const MAX_STATIC_FILE_BYTES = 5_000_000
const DEFAULT_CONTEXT_LINES = 3
const DEFAULT_LIMIT_PER_ENDPOINT = 8
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage"])
const STOP_IDENTIFIERS = new Set([
  "const",
  "function",
  "return",
  "import",
  "export",
  "from",
  "async",
  "await",
  "true",
  "false",
  "null",
  "undefined",
  "fetch",
  "then",
  "catch",
  "new",
  "var",
  "let",
])

export type JimengStaticLocatorTargetKind = "endpoint" | "query"

export interface JimengStaticLocatorSearchTerm {
  value: string
  kind: JimengStaticLocatorTargetKind
}

export interface JimengStaticLocatorOccurrence {
  endpoint: string
  targetKind: JimengStaticLocatorTargetKind
  file: string
  line: number
  column: number
  occurrenceIndex: number
  snippet: string
  nearbySymbols: string[]
  nearbyIdentifiers: string[]
  requestStringHints: string[]
  suggestedAstGrepCommands: string[]
}

export interface JimengStaticLocatorEndpointResult {
  endpoint: string
  targetKind: JimengStaticLocatorTargetKind
  occurrenceCount: number
  files: string[]
  occurrences: JimengStaticLocatorOccurrence[]
}

export interface JimengStaticLocatorResult {
  generatedAtIso: string
  staticRoots: string[]
  analysisFiles: string[]
  endpoints: string[]
  queries: string[]
  searchTerms: JimengStaticLocatorSearchTerm[]
  endpointResults: JimengStaticLocatorEndpointResult[]
}

export function parseJimengStaticLocatorEndpoints(value: string | undefined): string[] {
  if (!value) return []
  return sortedUnique(value.split(",").map((item) => normalizeEndpoint(item.trim())).filter((item): item is string => !!item))
}

export function parseJimengStaticLocatorQueries(value: string | undefined): string[] {
  if (!value) return []
  return sortedUnique(value.split(",").map(normalizeSearchQuery).filter((item): item is string => !!item))
}

export function locateJimengStaticEndpoints(input: {
  staticRoots: string[]
  endpoints?: string[]
  queries?: string[]
  analysisFiles?: string[]
  contextLines?: number
  limitPerEndpoint?: number
  nowIso?: string
}): JimengStaticLocatorResult {
  const staticRoots = sortedUnique(input.staticRoots.map((root) => path.resolve(root)).filter((root) => existsSync(root)))
  const analysisFiles = sortedUnique((input.analysisFiles ?? []).map((file) => path.resolve(file)).filter((file) => existsSync(file)))
  const endpoints = sortedUnique([
    ...(input.endpoints ?? []).map(normalizeEndpoint).filter((endpoint): endpoint is string => !!endpoint),
    ...endpointsFromAnalyses(analysisFiles),
  ])
  const queries = sortedUnique((input.queries ?? []).map(normalizeSearchQuery).filter((query): query is string => !!query))
  const searchTerms: JimengStaticLocatorSearchTerm[] = [
    ...endpoints.map((endpoint) => ({ value: endpoint, kind: "endpoint" as const })),
    ...queries.map((query) => ({ value: query, kind: "query" as const })),
  ]
  if (staticRoots.length === 0) throw new Error("static-locate requires at least one existing --staticRoot")
  if (searchTerms.length === 0) throw new Error("static-locate requires --endpoint, --analysis, --query, or --symbol")

  const contextLines = input.contextLines ?? DEFAULT_CONTEXT_LINES
  const limitPerEndpoint = input.limitPerEndpoint ?? DEFAULT_LIMIT_PER_ENDPOINT
  const resultByEndpoint = new Map<string, JimengStaticLocatorEndpointResult>()
  for (const searchTerm of searchTerms) {
    resultByEndpoint.set(termKey(searchTerm), {
      endpoint: searchTerm.value,
      targetKind: searchTerm.kind,
      occurrenceCount: 0,
      files: [],
      occurrences: [],
    })
  }

  for (const file of staticRoots.flatMap(walkStaticFiles)) {
    const text = readFileSync(file, "utf8")
    for (const searchTerm of searchTerms) {
      const endpointResult = resultByEndpoint.get(termKey(searchTerm))
      if (!endpointResult) continue
      let occurrenceIndex = text.indexOf(searchTerm.value)
      while (occurrenceIndex >= 0) {
        endpointResult.occurrenceCount += 1
        if (!endpointResult.files.includes(file)) endpointResult.files.push(file)
        if (endpointResult.occurrences.length < limitPerEndpoint) {
          const position = lineColumnAt(text, occurrenceIndex)
          const snippet = sanitizeSnippet(snippetAround(text, occurrenceIndex, position.line, contextLines))
          endpointResult.occurrences.push({
            endpoint: searchTerm.value,
            targetKind: searchTerm.kind,
            file,
            line: position.line,
            column: position.column,
            occurrenceIndex,
            snippet,
            nearbySymbols: extractNearbySymbols(snippet),
            nearbyIdentifiers: extractNearbyIdentifiers(snippet),
            requestStringHints: extractRequestStringHints(snippet),
            suggestedAstGrepCommands: astGrepCommands(searchTerm, file),
          })
        }
        occurrenceIndex = text.indexOf(searchTerm.value, occurrenceIndex + searchTerm.value.length)
      }
    }
  }

  return {
    generatedAtIso: input.nowIso ?? new Date().toISOString(),
    staticRoots,
    analysisFiles,
    endpoints,
    queries,
    searchTerms,
    endpointResults: Array.from(resultByEndpoint.values())
      .map((item) => ({
        ...item,
        files: item.files.sort(),
        occurrences: item.occurrences.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line),
      }))
      .sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.endpoint.localeCompare(right.endpoint)),
  }
}

export function summarizeJimengStaticLocator(result: JimengStaticLocatorResult): JsonObject {
  return {
    generated_at_iso: result.generatedAtIso,
    static_roots: result.staticRoots,
    analysis_files: result.analysisFiles,
    endpoint_count: result.endpoints.length,
    query_count: result.queries.length,
    search_term_count: result.searchTerms.length,
    endpoints: result.endpointResults.map((endpoint) => ({
      endpoint: endpoint.endpoint,
      target_kind: endpoint.targetKind,
      occurrence_count: endpoint.occurrenceCount,
      file_count: endpoint.files.length,
      files: endpoint.files.slice(0, 12),
      nearby_symbols: sortedUnique(endpoint.occurrences.flatMap((occurrence) => occurrence.nearbySymbols)).slice(0, 20),
      nearby_identifiers: sortedUnique(endpoint.occurrences.flatMap((occurrence) => occurrence.nearbyIdentifiers)).slice(0, 30),
      request_string_hints: sortedUnique(endpoint.occurrences.flatMap((occurrence) => occurrence.requestStringHints)).slice(0, 30),
      sample_occurrences: endpoint.occurrences.slice(0, 4).map((occurrence) => ({
        file: occurrence.file,
        line: occurrence.line,
        column: occurrence.column,
        snippet: occurrence.snippet,
        suggested_ast_grep_commands: occurrence.suggestedAstGrepCommands,
      })),
    })),
  }
}

export function writeJimengStaticLocatorMarkdown(result: JimengStaticLocatorResult): string {
  const lines: string[] = []
  lines.push("# Jimeng Static Locator")
  lines.push("")
  lines.push(`- Generated at: ${result.generatedAtIso}`)
  lines.push(`- Static roots: ${result.staticRoots.length}`)
  lines.push(`- Analysis files: ${result.analysisFiles.length}`)
  lines.push(`- Endpoints: ${result.endpoints.length}`)
  lines.push(`- Queries: ${result.queries.length}`)
  lines.push("")
  lines.push("| Kind | Term | Occurrences | Files | Top symbols |")
  lines.push("| --- | --- | ---: | ---: | --- |")
  for (const endpoint of result.endpointResults) {
    const topSymbols = sortedUnique(endpoint.occurrences.flatMap((occurrence) => occurrence.nearbySymbols)).slice(0, 8)
    lines.push([
      endpoint.targetKind,
      `\`${endpoint.endpoint}\``,
      endpoint.occurrenceCount,
      endpoint.files.length,
      topSymbols.map((symbol) => `\`${symbol}\``).join(", "),
    ].join(" | "))
  }
  lines.push("")
  lines.push("Raw local snippets are written under ignored `data/**`. Normalized snippets redact URL query strings and credential-like assignments.")
  return `${lines.join("\n")}\n`
}

function endpointsFromAnalyses(analysisFiles: string[]): string[] {
  const endpoints: string[] = []
  for (const file of analysisFiles) {
    const analysis = readJimengCaptureAnalysisFile(file)
    for (const candidate of analysis.candidates) {
      const endpoint = normalizeEndpoint(candidate.url_pathname || candidate.endpoint)
      if (endpoint && isStaticLocatorApiEndpoint(endpoint)) endpoints.push(endpoint)
    }
  }
  return sortedUnique(endpoints)
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
  const queryIndex = value.indexOf("?")
  const endpoint = queryIndex >= 0 ? value.slice(0, queryIndex) : value
  return endpoint.startsWith("/") ? endpoint : null
}

function normalizeSearchQuery(value: string | undefined): string | null {
  const query = value?.trim()
  if (!query) return null
  return query.length > 512 ? query.slice(0, 512) : query
}

function termKey(term: JimengStaticLocatorSearchTerm): string {
  return `${term.kind}:${term.value}`
}

function isStaticLocatorApiEndpoint(endpoint: string): boolean {
  return /^\/(?:mweb\/(?:search\/)?v\d+|lv\/v\d+|api\/[^/]+|commerce\/v\d+|aweme\/|webcast\/)/.test(endpoint)
}

function lineColumnAt(text: string, index: number): { line: number; column: number } {
  const before = text.slice(0, index)
  const lines = before.split(/\r?\n/)
  return {
    line: lines.length,
    column: (lines.at(-1) ?? "").length + 1,
  }
}

function snippetAround(text: string, index: number, line: number, contextLines: number): string {
  const lines = text.split(/\r?\n/)
  const currentLine = lines[line - 1] ?? ""
  if (currentLine.length > 2_000 || lines.length <= 2) {
    const start = Math.max(0, index - 1_200)
    const end = Math.min(text.length, index + 1_800)
    return text.slice(start, end)
  }
  const startLine = Math.max(1, line - contextLines)
  const endLine = Math.min(lines.length, line + contextLines)
  return lines.slice(startLine - 1, endLine).map((value, indexOffset) => `${startLine + indexOffset}: ${value}`).join("\n")
}

function sanitizeSnippet(snippet: string): string {
  return snippet
    .replace(/https?:\/\/(?=["'`])/g, "<protocol-literal>")
    .replace(/https?:\/\/[^"'`\s)]+/g, (value) => redactUrl(value))
    .replace(/\b(cookie|authorization|token|secret|x-signature|x-sign|msToken)\b\s*[:=]\s*["'`]?[^"'`,\s)]+/gi, "$1=<redacted>")
    .slice(0, 4_000)
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value)
    return `<url ${url.host}${url.pathname}${url.search ? "?<redacted-query>" : ""}>`
  } catch {
    return "<redacted-url>"
  }
}

function extractNearbySymbols(snippet: string): string[] {
  const symbols: string[] = []
  const patterns = [
    /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]{2,})\s*=/g,
    /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]{2,})\s*\(/g,
    /\b([A-Za-z_$][A-Za-z0-9_$]{2,})\s*:\s*(?:async\s*)?\(/g,
    /\b([A-Za-z_$][A-Za-z0-9_$]{2,})\s*=\s*(?:async\s*)?\(/g,
  ]
  for (const pattern of patterns) {
    for (const match of snippet.matchAll(pattern)) {
      if (match[1]) symbols.push(match[1])
    }
  }
  return sortedUnique(symbols).slice(0, 30)
}

function extractNearbyIdentifiers(snippet: string): string[] {
  const identifiers = Array.from(snippet.matchAll(/\b[A-Za-z_$][A-Za-z0-9_$]{2,}\b/g))
    .map((match) => match[0])
    .filter((identifier) => !STOP_IDENTIFIERS.has(identifier))
    .filter((identifier) => !/^[A-Z0-9_]{16,}$/.test(identifier))
  return sortedUnique(identifiers).slice(0, 60)
}

function extractRequestStringHints(snippet: string): string[] {
  const hints = Array.from(snippet.matchAll(/["'`]([^"'`]{3,160})["'`]/g))
    .map((match) => match[1])
    .filter((value): value is string => !!value)
    .filter((value) => /mweb|lv\/v|model|req|key|scene|type|template|voice|subject|frame|option|generate|lip|video|image|ratio|duration/i.test(value))
    .map((value) => value.length > 160 ? `${value.slice(0, 157)}...` : value)
  return sortedUnique(hints).slice(0, 60)
}

function astGrepCommands(term: JimengStaticLocatorSearchTerm, file: string): string[] {
  const escapedTerm = term.value.replace(/'/g, "'\\''")
  const escapedFile = file.replace(/'/g, "'\\''")
  if (term.kind === "query" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(term.value)) {
    return [
      `mise x ast-grep -- ast-grep --lang ts -p '${escapedTerm}' '${escapedFile}'`,
      `rg -n '${escapedTerm}' '${escapedFile}'`,
    ]
  }
  return [
    `mise x ast-grep -- ast-grep --lang ts -p '"${escapedTerm}"' '${escapedFile}'`,
    `mise x ast-grep -- ast-grep --lang ts -p "'${escapedTerm}'" '${escapedFile}'`,
  ]
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort()
}
