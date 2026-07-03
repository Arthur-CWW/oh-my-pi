#!/usr/bin/env bun
import { Effect, Result } from "effect"
import * as S from "effect/Schedule"
import { FetchHttpClient } from "effect/unstable/http"
import { readdir, readFile, writeFile, mkdir, stat, open } from "node:fs/promises"
import { join, extname, resolve, dirname } from "node:path"

// Re-use the library's Effect-based search/download primitives
import { downloadBorgesLibrary, searchBorgesLibrary } from "./src/client.ts"
import { searchAnnaArchive } from "./src/anna-archive.ts"
import { downloadArxiv, searchArxiv } from "./src/arxiv.ts"
import { downloadInternetArchive, searchInternetArchive } from "./src/internet-archive.ts"
import { downloadDirectFile } from "./src/direct-download.ts"
import { searchLibraryGenesis } from "./src/library-genesis.ts"
import type { MirrorGroup } from "./src/mirrors.ts"
import type { BookResult, DownloadResult } from "./src/schemas.ts"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScoredCandidate {
  result: BookResult
  source: MirrorSource
  score: number
  reasons: string[]
}

interface SummarizedCandidate {
  id: string
  title: string
  authors: string[]
  year?: number
  language?: string
  format: string
  size?: string
  source: string
  sourceUrl: string
  score: number
  reasons: string[]
}

interface MirrorSource {
  id: string
  kind: "anna" | "libgen" | "internet_archive" | "arxiv" | "auto"
  baseUrl?: string
  origin: "discovered" | "manual" | "default"
  monitorUrl?: string
  validCert?: boolean
  status?: string
}

interface MirrorPlan {
  sources: MirrorSource[]
  summary: {
    enabled: boolean
    sourceUrl: string
    groups: string[]
    manualCount: number
    discoveredCount: number
    candidateCount: number
    status: string
    error?: string
    candidates: SummarizedSource[]
    cached?: boolean
  }
}

interface SummarizedSource {
  id: string
  kind: string
  baseUrl?: string
  origin: string
  monitorUrl?: string
  validCert?: boolean
  status?: string
}

interface BatchOptions {
  outDir: string
  report: string
  dryRun: boolean
  concurrency: number
  maxResults: number
  retries: number
  targetTimeoutMs: number
  skipExisting: boolean
  formats: string[]
  translators: string[]
  authors: string[]
  languages: string[]
  keywords: string[]
  pretty: boolean
  discoverMirrors: boolean
  mirrorSource: string
  mirrorGroups: string[]
  baseUrls: string[]
  noCache: boolean
  cacheFile: string
  sourceCandidates: MirrorSource[]
}

interface TargetPreferences {
  formats: string[]
  translators: string[]
  authors: string[]
  languages: string[]
  keywords: string[]
}

interface BatchTarget {
  id: string
  query: string
  directUrl?: string
  preferences: TargetPreferences
}

interface DownloadAttempt {
  downloadedPath: string
  title: string
  bytes: number
}

interface ExistingMatch {
  path: string
  bytes: number
  reason: string
}

interface SourceFailure {
  source: SummarizedSource
  stage: "search" | "download"
  blocked: boolean
  error: string
}

interface TargetResult {
  id: string
  query: string
  startedAt: string
  status: "dry_run" | "ok" | "skipped_existing" | "error" | "blocked" | "no_results"
  searchAttempts?: number
  downloadAttempts?: number
  selectedSource?: SummarizedSource
  selected?: SummarizedCandidate
  download?: DownloadAttempt
  downloadedPath?: string
  bytes?: number
  validation?: { valid: boolean; reason: string }
  candidates: SummarizedCandidate[]
  sourceFailures: SourceFailure[]
  error?: string
}

interface BatchReport {
  startedAt: string
  finishedAt: string | null
  options: Record<string, unknown>
  mirrorDiscovery: MirrorPlan["summary"]
  summary: Record<string, number>
  results: TargetResult[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MIRROR_SOURCE = "https://open-slum.org/"
const MIRROR_CACHE_TTL_MS = 60 * 60 * 1000
const httpLayer = FetchHttpClient.layer

const DEFAULT_KAUFMANN_TARGETS = [
  { query: "Nietzsche Daybreak Kaufmann", id: "nietzsche-daybreak" } as const,
  { query: "Nietzsche Gay Science Kaufmann", id: "nietzsche-gay-science" } as const,
]

const DEFAULT_OPTIONS: BatchOptions = {
  outDir: `${process.env.HOME ?? "."}/.borges-library/downloads`,
  report: "-",
  dryRun: false,
  concurrency: 4,
  maxResults: 25,
  retries: 4,
  targetTimeoutMs: 120_000,
  skipExisting: true,
  formats: [],
  translators: [],
  authors: [],
  languages: [],
  keywords: [],
  pretty: true,
  discoverMirrors: true,
  mirrorSource: DEFAULT_MIRROR_SOURCE,
  mirrorGroups: ["anna", "libgen"],
  baseUrls: [],
  noCache: false,
  cacheFile: `${process.env.HOME ?? "."}/.borges-library/mirrors-cache.json`,
  sourceCandidates: [],
}

const BLOCKED_MARKERS = [
  "captcha", "challenge", "checking your browser", "cloudflare",
  "cf-browser-verify", "access denied", "forbidden", "bot check",
  "ddos-guard", "html/error page",
]

const QUERY_STOPWORDS: Record<string, true> = {
  a: true, an: true, and: true, are: true, by: true, for: true, from: true, in: true, into: true, is: true,
  of: true, on: true, or: true, the: true, to: true, vol: true, volume: true,
}


// ---------------------------------------------------------------------------
// Pure helpers (no I/O)
// ---------------------------------------------------------------------------

function normalizeKeyword(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
}

function normalizeText(value: unknown): string {
  return normalizeKeyword(value).replace(/[^a-z0-9]+/g, " ").trim()
}

function normalizeFormat(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/^\./, "")
}

function splitList(value: unknown): string[] {
  return String(value ?? "").split(",").map(v => v.trim()).filter(Boolean)
}

function mergePreference(...groups: unknown[]): string[] {
  const values: string[] = []
  for (const group of groups) {
    if (!group) continue
    if (Array.isArray(group)) values.push(...group)
    else values.push(...splitList(group))
  }
  return [...new Set(values.map(String).map(v => v.trim()).filter(Boolean))]
}

function normalizeMirrorGroup(value: string): "anna" | "libgen" {
  const n = normalizeKeyword(value)
  if (n === "anna" || n.includes("anna")) return "anna"
  if (n === "libgen" || n.includes("library genesis") || n.includes("genesis")) return "libgen"
  exit(`Unknown mirror group: ${value}`)
}

function normalizeBaseUrl(value: string): string {
  try {
    const url = new URL(String(value).trim())
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    exit(`Invalid base URL: ${value}`)
  }
}

function inferMirrorKind(url: string, group?: string): "anna" | "libgen" {
  const ng = group ? normalizeKeyword(group) : ""
  if (ng.includes("anna")) return "anna"
  if (ng.includes("libgen") || ng.includes("genesis")) return "libgen"
  try {
    const host = new URL(url).hostname.toLowerCase()
    if (host.includes("anna")) return "anna"
    if (host.includes("libgen") || host.includes("librarygenesis")) return "libgen"
  } catch {}
  return "libgen"
}

function candidateHaystack(result: BookResult): string {
  return normalizeKeyword(
    [result.title, ...(result.authors ?? []), result.language, result.format, result.year]
      .filter(Boolean).join(" ")
  )
}

function scoreCandidate(result: BookResult, source: MirrorSource, index: number, target: BatchTarget, maxResults: number): ScoredCandidate {
  let score = Math.max(0, maxResults - index)
  const reasons = [`${source.id} search rank ${index + 1}: +${Math.max(0, maxResults - index)}`]
  if (source.kind === "arxiv" || result.source === "arxiv") {
    score += 20
    reasons.push("direct arXiv source: +20")
  } else if (source.kind === "internet_archive" || result.source === "internet_archive") {
    score += 10
    reasons.push("direct Internet Archive source: +10")
  }
  const prefs = target.preferences
  const haystack = candidateHaystack(result)
  const haystackText = normalizeText(haystack)

  const queryText = normalizeText(target.query)
  const queryTokens = queryText
    .split(" ")
    .filter((token) => token.length >= 3 && !QUERY_STOPWORDS[token])
  if (queryText && haystackText.includes(queryText)) {
    score += 120
    reasons.push("exact query phrase in metadata: +120")
  }
  if (queryTokens.length > 0) {
    const tokenHits = queryTokens.filter((token) => haystackText.includes(token)).length
    const ratio = tokenHits / queryTokens.length
    const pts = tokenHits * 12
    if (pts > 0) {
      score += pts
      reasons.push(`query token overlap ${tokenHits}/${queryTokens.length}: +${pts}`)
    }
    if (ratio < 0.35) {
      score -= 100
      reasons.push(`weak query match ${tokenHits}/${queryTokens.length}: -100`)
    }
  }
  const authors = normalizeKeyword((result.authors ?? []).join(" "))
  const language = normalizeKeyword(result.language ?? "")
  const format = normalizeFormat(result.format)

  if (prefs.languages.length === 0 && language && !language.includes("english")) {
    score -= 30
    reasons.push(`non-English language ${result.language}: -30`)
  }

  if (prefs.formats.length > 0) {
    const fi = prefs.formats.indexOf(format)
    if (fi >= 0) { const pts = 90 - fi * 10; score += pts; reasons.push(`preferred format ${format}: +${pts}`) }
    else { score -= 25; reasons.push(`non-preferred format ${format || "unknown"}: -25`) }
  }
  for (const t of prefs.translators) {
    const n = normalizeKeyword(t); if (!n) continue
    if (haystack.includes(n)) { score += 70; reasons.push(`translator keyword ${t}: +70`) }
  }
  for (const a of prefs.authors) {
    const n = normalizeKeyword(a); if (!n) continue
    if (authors.includes(n)) { score += 55; reasons.push(`author keyword ${a}: +55`) }
    else if (haystack.includes(n)) { score += 25; reasons.push(`author keyword ${a} in metadata: +25`) }
  }
  if (prefs.languages.length > 0 && language) {
    const languageMatched = prefs.languages.some((l) => {
      const n = normalizeKeyword(l)
      return Boolean(n) && (language.includes(n) || n.includes(language))
    })
    if (languageMatched) {
      score += 45
      reasons.push(`language ${result.language}: +45`)
    } else {
      score -= 60
      reasons.push(`non-preferred language ${result.language}: -60`)
    }
  }
  for (const k of prefs.keywords) {
    const n = normalizeKeyword(k); if (!n) continue
    if (haystack.includes(n)) { score += 20; reasons.push(`keyword ${k}: +20`) }
  }
  if (format === "unknown") { score -= 40; reasons.push("unknown format: -40") }
  return { result, source, score, reasons }
}

function summarizeCandidate(scored: ScoredCandidate): SummarizedCandidate {
  const r = scored.result
  return { id: r.id, title: r.title, authors: [...r.authors], year: r.year, language: r.language, format: r.format, size: r.size, source: r.source, sourceUrl: r.sourceUrl, score: scored.score, reasons: scored.reasons }
}

function summarizeSource(source: MirrorSource): SummarizedSource {
  return { id: source.id, kind: source.kind, baseUrl: source.baseUrl, origin: source.origin, monitorUrl: source.monitorUrl, validCert: source.validCert, status: source.status }
}

function isBlockedMessage(message: string): boolean {
  return BLOCKED_MARKERS.some(m => normalizeKeyword(message).includes(m))
}

function isBlockedError(err: unknown): boolean {
  if (err instanceof BlockedSourceError) return true
  const e = err as Record<string, unknown> | null
  if (e?.blocked === true) return true
  return isBlockedMessage((e?.message as string) ?? String(err))
}

class BlockedSourceError extends Error {
  blocked = true
  constructor(message: string) { super(message); this.name = "BlockedSourceError" }
}

function asBlockedError(err: unknown, prefix = "Source blocked"): BlockedSourceError {
  if (err instanceof BlockedSourceError) return err
  return new BlockedSourceError(`${prefix}: ${(err as Error)?.message ?? String(err)}`)
}

function sourceFailure(source: MirrorSource, stage: "search" | "download", err: unknown): SourceFailure {
  return { source: summarizeSource(source), stage, blocked: isBlockedError(err), error: (err as Error)?.message ?? String(err) }
}

function defaultSourceCandidate(): MirrorSource {
  return { id: "default", kind: "auto", origin: "default" }
}

function publicSourceCandidates(): MirrorSource[] {
  return [
    { id: "internet-archive", kind: "internet_archive", origin: "default" },
    { id: "arxiv", kind: "arxiv", origin: "default" },
  ]
}

function normalizeDiscoveredCandidate(raw: Record<string, unknown>, origin: "discovered" | "manual" = "discovered", index = 0): MirrorSource | null {
  try {
    const url = raw.url ?? raw.baseUrl ?? raw.base_url ?? raw.address
    if (!url || typeof url !== "string") return null
    const baseUrl = normalizeBaseUrl(url)
    const kind = (raw.kind ?? raw.type ?? raw.source) as string | undefined
    return {
      id: raw.id ? String(raw.id) : `${origin}-${kind ?? "unknown"}-${index + 1}`,
      kind: kind ? inferMirrorKind(baseUrl, kind) : inferMirrorKind(baseUrl),
      baseUrl,
      origin,
      monitorUrl: raw.monitorUrl ?? raw.monitor_url ?? raw.monitor,
      validCert: raw.validCert ?? raw.valid_cert ?? raw.certValid,
    } as MirrorSource
  } catch { return null }
}

function interleaveSources(sources: MirrorSource[]): MirrorSource[] {
  const byKind: Record<string, MirrorSource[]> = { anna: [], libgen: [], other: [] }
  for (const s of sources) {
    const k = s.kind === "anna" ? "anna" : s.kind === "libgen" ? "libgen" : "other"
    byKind[k].push(s)
  }
  const result: MirrorSource[] = []
  const maxLen = Math.max(byKind.anna.length, byKind.libgen.length)
  for (let i = 0; i < maxLen; i++) {
    if (byKind.anna[i]) result.push(byKind.anna[i])
    if (byKind.libgen[i]) result.push(byKind.libgen[i])
  }
  result.push(...byKind.other)
  return result
}

function shuffleSources(sources: MirrorSource[]): MirrorSource[] {
  const copy = [...sources]
  const last = copy.pop()!
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  copy.push(last)
  return copy
}

function dedupeSources(sources: MirrorSource[]): MirrorSource[] {
  const seen = new Set<string>()
  return sources.filter(s => { if (!s) return false; const k = s.baseUrl ?? s.id; if (seen.has(k)) return false; seen.add(k); return true })
}

function fallbackRankSources(sources: MirrorSource[]): MirrorSource[] {
  return [...sources].sort((a, b) => {
    const aHTTPS = (a.baseUrl ?? "").startsWith("https://") ? 1 : 0
    const bHTTPS = (b.baseUrl ?? "").startsWith("https://") ? 1 : 0
    if (bHTTPS - aHTTPS) return bHTTPS - aHTTPS
    if ((b.validCert === true ? 1 : 0) - (a.validCert === true ? 1 : 0)) return (b.validCert === true ? 1 : 0) - (a.validCert === true ? 1 : 0)
    const aOK = a.status === "ok" || a.status === "up" || a.status === "online" ? 1 : 0
    const bOK = b.status === "ok" || b.status === "up" || b.status === "online" ? 1 : 0
    return bOK - aOK
  })
}

function targetsFromJson(json: unknown): { targets: unknown[]; preferences: Record<string, unknown> } {
  if (Array.isArray(json)) return { targets: json, preferences: {} }
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>
    const t = Array.isArray(o.targets) ? o.targets : Array.isArray(o.queries) ? o.queries : []
    const p = o.preferences && typeof o.preferences === "object" ? o.preferences as Record<string, unknown> : {}
    return { targets: t, preferences: p }
  }
  exit("Input JSON must be an array or an object with a targets array")
}

function preferencesFrom(target: Record<string, unknown>, inherited: TargetPreferences, global: BatchOptions): TargetPreferences {
  return {
    formats: mergePreference(target.formats ?? target.format, inherited.formats, global.formats).map(normalizeFormat),
    translators: mergePreference(target.translators ?? target.translator, inherited.translators, global.translators),
    authors: mergePreference(target.authors ?? target.author, inherited.authors, global.authors),
    languages: mergePreference(target.languages ?? target.language ?? target.lang, inherited.languages, global.languages),
    keywords: mergePreference(target.keywords ?? target.keyword, inherited.keywords, global.keywords),
  }
}

function normalizeTarget(raw: unknown, index: number, inherited: TargetPreferences, global: BatchOptions): BatchTarget {
  if (typeof raw === "string") return { id: `target-${index + 1}`, query: raw, preferences: preferencesFrom({}, inherited, global) }
  if (!raw || typeof raw !== "object") exit(`Target ${index + 1} must be a string or object`)
  const r = raw as Record<string, unknown>
  const query = r.query ?? r.title ?? r.q
  if (!query || typeof query !== "string") exit(`Target ${index + 1} is missing a query string`)
  const directUrl = r.url ?? r.sourceUrl ?? r.downloadUrl
  if (directUrl !== undefined && typeof directUrl !== "string") exit(`Target ${index + 1} direct URL must be a string`)
  return { id: String(r.id ?? `target-${index + 1}`), query, directUrl, preferences: preferencesFrom(r, inherited, global) }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): string {
  return `Borges Library batch downloader

Usage:
  bun ./download-batch.ts [options] [query ...]
  bun ./download-batch.ts --input targets.json --out-dir ./books --report report.json

Targets may be strings or objects in JSON:
  ["Nietzsche Daybreak Kaufmann", {"query":"The Gay Science","formats":["pdf"],"translators":["Kaufmann"]}]
  {"targets":[...], "preferences":{"formats":["pdf","epub"], "languages":["English"]}}
  {"query":"Paul Romer Endogenous Technological Change 1990","url":"https://example.edu/paper.pdf","formats":["pdf"]}

Options:
  --input, -i FILE          Read targets from JSON file
  --target, -t QUERY        Add one search target (repeatable)
  --out-dir, -o DIR         Output directory (default: ~/.borges-library/downloads)
  --report FILE            Write JSON report to FILE, or - for stdout (default: -)
  --dry-run                Search and score only; do not download
  --concurrency N          Parallel target count (default: 4)
  --max-results N          Search result limit per target (default: 25)
  --retries N              Retry search/download failures N times (default: 4)
  --target-timeout-ms N    Per-target timeout in milliseconds (default: 120000)
  --format LIST            Preferred formats, comma-separated (pdf,epub,mobi,djvu,txt)
  --translator LIST        Preferred translator keywords, comma-separated
  --author LIST            Preferred author keywords, comma-separated
  --language LIST          Preferred language keywords, comma-separated
  --keyword LIST           Extra preferred title/metadata keywords, comma-separated
  --discover-mirrors       Discover mirror candidates before searching (default: on)
  --no-discover-mirrors    Skip OpenSLUM mirror discovery
  --no-cache               Skip mirror cache; force fresh discovery
  --mirror-source URL      Status page (default: ${DEFAULT_MIRROR_SOURCE})
  --mirror-group LIST      Discovery groups: anna,libgen (default: both)
  --base-url URL           Add an explicit mirror/base URL (repeatable)
  --base-url-list LIST     Add comma-separated explicit mirror/base URLs
  --skip-existing          Skip already-valid matching files (default)
  --no-skip-existing       Download even when a matching file exists
  --compact                Minify JSON report
  --help, -h               Show this help
With no targets or input, the historical Kaufmann Nietzsche batch is used.`
}

function exit(message: string): never {
  console.error(message)
  console.error("\n" + usage())
  process.exit(2)
}

function parsePositiveInt(value: string, name: string): number {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 1) exit(`${name} must be a positive integer`)
  return n
}

function parseNonNegativeInt(value: string, name: string): number {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 0) exit(`${name} must be zero or a positive integer`)
  return n
}

function parseArgs(argv: string[]): { options: BatchOptions; inputFiles: string[]; cliTargets: string[] } {
  const options = { ...DEFAULT_OPTIONS }
  const cliTargets: string[] = []
  const inputFiles: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => { if (i + 1 >= argv.length) exit(`Missing value for ${arg}`); return argv[++i] }

    if (arg === "--help" || arg === "-h")        { console.log(usage()); process.exit(0) }
    else if (arg === "--input" || arg === "-i")  inputFiles.push(next())
    else if (arg === "--target" || arg === "-t") cliTargets.push(next())
    else if (arg === "--out-dir" || arg === "-o") options.outDir = next()
    else if (arg === "--report")                  options.report = next()
    else if (arg === "--dry-run")                 options.dryRun = true
    else if (arg === "--concurrency")             options.concurrency = parsePositiveInt(next(), "concurrency")
    else if (arg === "--max-results")             options.maxResults = parsePositiveInt(next(), "max-results")
    else if (arg === "--retries")                 options.retries = parseNonNegativeInt(next(), "retries")
    else if (arg === "--target-timeout-ms")       options.targetTimeoutMs = parsePositiveInt(next(), "target-timeout-ms")
    else if (arg === "--format" || arg === "--formats")    options.formats = mergePreference(options.formats, splitList(next()).map(normalizeFormat))
    else if (arg === "--translator" || arg === "--translators") options.translators = mergePreference(options.translators, splitList(next()))
    else if (arg === "--author" || arg === "--authors")       options.authors = mergePreference(options.authors, splitList(next()))
    else if (arg === "--language" || arg === "--languages" || arg === "--lang") options.languages = mergePreference(options.languages, splitList(next()))
    else if (arg === "--keyword" || arg === "--keywords")     options.keywords = mergePreference(options.keywords, splitList(next()))
    else if (arg === "--discover-mirrors")       options.discoverMirrors = true
    else if (arg === "--no-discover-mirrors")    options.discoverMirrors = false
    else if (arg === "--no-cache")               options.noCache = true
    else if (arg === "--mirror-source")          { options.mirrorSource = next(); options.discoverMirrors = true }
    else if (arg === "--mirror-group" || arg === "--mirror-groups") { options.mirrorGroups = mergePreference(splitList(next()).map(normalizeMirrorGroup)); options.discoverMirrors = true }
    else if (arg === "--base-url")               options.baseUrls = mergePreference(options.baseUrls, next())
    else if (arg === "--base-url-list" || arg === "--base-urls") options.baseUrls = mergePreference(options.baseUrls, splitList(next()))
    else if (arg === "--skip-existing")          options.skipExisting = true
    else if (arg === "--no-skip-existing")       options.skipExisting = false
    else if (arg === "--compact")                options.pretty = false
    else if (arg.startsWith("--"))               exit(`Unknown option: ${arg}`)
    else cliTargets.push(arg)
  }
  return { options, inputFiles, cliTargets }
}

// ---------------------------------------------------------------------------
// I/O helpers (Effect-based)
// ---------------------------------------------------------------------------

async function readJsonFile(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")) }
  catch (err) { exit(`Failed to read JSON input ${file}: ${(err as Error).message}`) }
}

async function loadTargets(inputFiles: string[], cliTargets: string[], options: BatchOptions): Promise<BatchTarget[]> {
  const rawTargets: unknown[] = []
  const inherited: TargetPreferences = { formats: [], translators: [], authors: [], languages: [], keywords: [] }

  for (const file of inputFiles) {
    const { targets, preferences } = targetsFromJson(await readJsonFile(file))
    rawTargets.push(...targets)
    inherited.formats = mergePreference(inherited.formats, preferences.formats ?? preferences.format).map(normalizeFormat)
    inherited.translators = mergePreference(inherited.translators, preferences.translators ?? preferences.translator)
    inherited.authors = mergePreference(inherited.authors, preferences.authors ?? preferences.author)
    inherited.languages = mergePreference(inherited.languages, preferences.languages ?? preferences.language ?? preferences.lang)
    inherited.keywords = mergePreference(inherited.keywords, preferences.keywords ?? preferences.keyword)
  }
  rawTargets.push(...cliTargets)
  if (rawTargets.length === 0) rawTargets.push(...DEFAULT_KAUFMANN_TARGETS)
  return rawTargets.map((t, i) => normalizeTarget(t, i, inherited, options))
}

function looksLikeHtmlOrChallenge(textHead: string): boolean {
  const lower = normalizeKeyword(textHead.slice(0, 512))
  return lower.includes("<html") || lower.includes("<!doctype") || isBlockedMessage(lower)
}

// ---------------------------------------------------------------------------
// Effect-based core pipeline
// ---------------------------------------------------------------------------

function validateFileEffect(filePath: string, expectedFormat: string) {
  return Effect.gen(function* () {
    const info = yield* Effect.tryPromise(() => stat(filePath))
    if (info.size === 0) return { valid: false, bytes: 0, reason: "empty file" }
    const fd = yield* Effect.tryPromise(() => open(filePath, "r"))
    const buf = new Uint8Array(1024)
    const { bytesRead } = yield* Effect.tryPromise(() => fd.read({ buffer: buf }))
    yield* Effect.tryPromise(() => fd.close())
    const head = new TextDecoder().decode(buf.slice(0, bytesRead))
    if (looksLikeHtmlOrChallenge(head)) return { valid: false, bytes: info.size, reason: "HTML or challenge page" }
    return { valid: true, bytes: info.size, reason: "ok" }
  })
}

function validExistingMatchEffect(outDir: string, result: BookResult) {
  return Effect.gen(function* () {
    const entries = yield* Effect.orElseSucceed(
      Effect.tryPromise(() => readdir(outDir, { withFileTypes: true })),
      () => [] as { name: string; isFile(): boolean }[],
    )
    const wantedFormat = normalizeFormat(result.format)
    const sourceFileName = (() => {
      try {
        return decodeURIComponent(new URL(result.sourceUrl).pathname.split("/").pop() ?? "")
      } catch {
        return ""
      }
    })()
    const sourceTokens = normalizeText(sourceFileName).split(" ").filter(t => t.length >= 4)
    const titleTokens = normalizeText(result.title).split(" ").filter(t => t.length >= 4)
    const matchTokens = sourceTokens.length >= 2 ? sourceTokens : titleTokens

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const file = join(outDir, entry.name)
      const ext = normalizeFormat(extname(entry.name))
      if (wantedFormat && wantedFormat !== "unknown" && ext !== wantedFormat) continue
      const nameText = normalizeText(entry.name)
      const tokenHits = matchTokens.filter(t => nameText.includes(t)).length
      const tokenMatch = matchTokens.length > 0 && tokenHits >= Math.min(4, matchTokens.length) && tokenHits / matchTokens.length >= 0.6
      if (!tokenMatch && !nameText.includes(normalizeText(result.id.slice(0, 12)))) continue
      const validation = yield* validateFileEffect(file, result.format)
      if (validation.valid) return { path: file, bytes: validation.bytes, reason: validation.reason }
    }
    return undefined as ExistingMatch | undefined
  })
}


function runSearchEffect(target: BatchTarget, options: BatchOptions, source?: MirrorSource) {
  const directTimeoutMs = Math.max(1_000, Math.min(options.targetTimeoutMs, 30_000))
  if (source?.kind === "internet_archive") {
    return searchInternetArchive({ query: target.query, limit: options.maxResults, timeoutMs: directTimeoutMs })
  }
  if (source?.kind === "arxiv") {
    return searchArxiv({ query: target.query, limit: options.maxResults, timeoutMs: directTimeoutMs })
  }
  if (source?.kind === "anna") {
    return searchAnnaArchive({ query: target.query, limit: options.maxResults, baseUrl: source.baseUrl })
  }
  if (source?.kind === "libgen" && source.baseUrl) {
    return searchLibraryGenesis({ query: target.query, limit: options.maxResults, baseUrl: source.baseUrl })
  }
  return searchBorgesLibrary(target.query, options.maxResults, {})
}

function runDownloadEffect(result: BookResult, outDir: string, options: BatchOptions, source?: MirrorSource) {
  if (source?.kind === "internet_archive" || result.source === "internet_archive") {
    return downloadInternetArchive({ result, outDir, retries: options.retries, timeoutMs: options.targetTimeoutMs })
  }
  if (source?.kind === "arxiv" || result.source === "arxiv") {
    return downloadArxiv({ result, outDir, retries: options.retries, timeoutMs: options.targetTimeoutMs })
  }
  if (result.source === "direct_url") {
    return downloadDirectFile({ result, outDir, retries: options.retries, timeoutMs: options.targetTimeoutMs })
  }
  return downloadBorgesLibrary(result, outDir, source?.baseUrl ? { baseUrl: source.baseUrl, retries: options.retries } : { retries: options.retries })
}

function atomicDownloadEffect(scored: ScoredCandidate, outDir: string, options: BatchOptions, source?: MirrorSource) {
  return Effect.gen(function* () {
    const dl = yield* runDownloadEffect(scored.result, outDir, options, source)
    const validation = yield* validateFileEffect(dl.downloadedPath, scored.result.format)
    if (!validation.valid) return yield* Effect.fail(new Error(`Download validation failed: ${validation.reason}`))
    return dl
  })
}

function discoverMirrorSourcesEffect(options: BatchOptions) {
  return Effect.gen(function* () {
    const manualSources = dedupeSources(
      options.baseUrls.map((url, i) => normalizeDiscoveredCandidate({ url: normalizeBaseUrl(url) }, "manual", i)).filter(Boolean) as MirrorSource[],
    )

    const summary: MirrorPlan["summary"] = {
      enabled: options.discoverMirrors,
      sourceUrl: options.mirrorSource,
      groups: options.mirrorGroups,
      manualCount: manualSources.length,
      discoveredCount: 0,
      candidateCount: 0,
      status: options.discoverMirrors ? "pending" : (manualSources.length > 0 ? "manual" : "disabled"),
      error: undefined,
      candidates: [],
    }

    let discoveredSources: MirrorSource[] = []
    if (options.discoverMirrors) {
      try {
        const mirrorModule = yield* Effect.tryPromise(() => import("./src/mirrors.ts"))
        const discovered = yield* mirrorModule.discoverOpenSlumMirrors({ groups: options.mirrorGroups as MirrorGroup[], statusPageUrl: options.mirrorSource })
        const discoveredUnknown = discovered as unknown
        const discoveredRecord = discoveredUnknown && typeof discoveredUnknown === "object" && !Array.isArray(discoveredUnknown) ? discoveredUnknown as Record<string, unknown> : {}
        const raw = Array.isArray(discoveredUnknown)
          ? discoveredUnknown
          : discoveredRecord.candidates ?? discoveredRecord.mirrors ?? discoveredRecord.urls ?? []
        const rawCandidates: unknown[] = Array.isArray(raw) ? raw : []
        const normalized = rawCandidates
          .map((c, i) => normalizeDiscoveredCandidate(c as Record<string, unknown>, "discovered", i))
          .filter(Boolean) as MirrorSource[]
        discoveredSources = dedupeSources(interleaveSources(fallbackRankSources(normalized)))
        summary.discoveredCount = discoveredSources.length
        summary.status = "ok"
      } catch (err) {
        summary.status = "error"
        summary.error = (err as Error)?.message ?? String(err)
      }
    }

    let sources = dedupeSources([...manualSources, ...discoveredSources])
    if (sources.length === 0 || options.discoverMirrors || manualSources.length > 0) {
      sources.push(defaultSourceCandidate())
    }
    sources = dedupeSources([...sources, ...publicSourceCandidates()])
    summary.candidateCount = sources.length
    summary.candidates = sources.map(summarizeSource)
    return { sources, summary }
  })
}

function directCandidateFromTarget(target: BatchTarget): ScoredCandidate {
  const url = target.directUrl!
  let format = "unknown"
  try {
    format = normalizeFormat(extname(new URL(url).pathname))
  } catch {}
  if (format === "unknown" && target.preferences.formats.length > 0) format = target.preferences.formats[0] ?? "unknown"
  const result: BookResult = {
    id: `direct:${target.id}`,
    title: target.query,
    authors: target.preferences.authors.length > 0 ? target.preferences.authors : ["Unknown"],
    language: target.preferences.languages[0],
    format: normalizeFormat(format) as BookResult["format"],
    source: "direct_url",
    sourceUrl: url,
  }
  return {
    result,
    source: { id: "direct-url", kind: "auto", origin: "manual", baseUrl: url },
    score: 1_000,
    reasons: ["explicit direct URL target: +1000"],
  }
}

function processTargetEffect(target: BatchTarget, options: BatchOptions) {
  return Effect.gen(function* () {
    const startedAt = new Date().toISOString()
    const base = { id: target.id, query: target.query, startedAt }
    const sourceFailures: SourceFailure[] = []
    const allScored: ScoredCandidate[] = []
    let noResultAttempts = 0

    if (target.directUrl) {
      const pick = directCandidateFromTarget(target)
      const selectedSrc = summarizeSource(pick.source)
      const summarized = [summarizeCandidate(pick)]
      if (options.dryRun) {
        return { ...base, status: "dry_run" as const, searchAttempts: 0, selectedSource: selectedSrc, selected: summarizeCandidate(pick), candidates: summarized, sourceFailures }
      }
      if (options.skipExisting) {
        const existing = yield* validExistingMatchEffect(options.outDir, pick.result)
        if (existing) {
          return { ...base, status: "skipped_existing" as const, searchAttempts: 0, selectedSource: selectedSrc, selected: summarizeCandidate(pick), downloadedPath: existing.path, bytes: existing.bytes, validation: { valid: true, reason: existing.reason }, candidates: summarized, sourceFailures }
        }
      }
      const dlResult = yield* Effect.result(atomicDownloadEffect(pick, options.outDir, options, pick.source))
      if (Result.isSuccess(dlResult)) {
        const dl = dlResult.success
        return { ...base, status: "ok" as const, searchAttempts: 0, downloadAttempts: options.retries + 1, selectedSource: selectedSrc, selected: summarizeCandidate(pick), download: dl as DownloadAttempt, candidates: summarized, sourceFailures }
      }
      sourceFailures.push(sourceFailure(pick.source, "download", dlResult.failure))
      return { ...base, status: "error" as const, error: `direct URL download failed: ${(dlResult.failure as Error)?.message ?? String(dlResult.failure)}`, selectedSource: selectedSrc, selected: summarizeCandidate(pick), sourceFailures, candidates: summarized }
    }

    const candidates = shuffleSources(options.sourceCandidates)
    const sourceSearchTimeoutMs = Math.max(5_000, Math.min(options.targetTimeoutMs, 30_000))
    const sourceSearchConcurrency = Math.max(1, Math.min(6, candidates.length))

    const sourceResults = yield* Effect.all(
      candidates.map((source) => {
        const searchEff = Effect.gen(function* () {
          return yield* runSearchEffect(target, options, source)
        }).pipe(
          Effect.retry(S.exponential("250 millis", 2.0).pipe(S.both(S.recurs(options.retries)))),
          Effect.timeoutOrElse({
            duration: sourceSearchTimeoutMs,
            orElse: () => Effect.fail(new Error(`search ${source.baseUrl ?? source.id} timed out after ${sourceSearchTimeoutMs}ms`)),
          }),
          Effect.mapError((err) => {
            if (isBlockedError(err)) return asBlockedError(err, `search ${source.baseUrl ?? source.id}`)
            return new Error(`search ${source.baseUrl ?? source.id} failed: ${(err as Error)?.message ?? String(err)}`)
          }),
        )
        return Effect.result(searchEff).pipe(Effect.map((result) => ({ source, result })))
      }),
      { concurrency: sourceSearchConcurrency },
    )

    for (const { source, result: searchResult } of sourceResults) {
      if (!Result.isSuccess(searchResult)) {
        sourceFailures.push(sourceFailure(source, "search", searchResult.failure))
        continue
      }
      const results = searchResult.success
      if (results.length === 0) { noResultAttempts++; continue }

      allScored.push(
        ...results.map((r, i) => scoreCandidate(r, source, i, target, options.maxResults)),
      )
    }

    if (allScored.length === 0) {
      if (sourceFailures.length > 0) {
        const allBlocked = sourceFailures.every(f => f.blocked)
        return { ...base, status: allBlocked ? "blocked" as const : "error" as const, error: allBlocked ? "All attempted sources reported a CAPTCHA, challenge, or error page" : "All attempted sources failed", sourceFailures, candidates: [] }
      }
      return { ...base, status: "no_results" as const, searchAttempts: noResultAttempts, candidates: [], sourceFailures }
    }

    const scored = allScored.sort((a, b) => b.score - a.score)
    const pick = scored[0]!
    const selectedSrc = summarizeSource(pick.source)
    const summarized = scored.map(summarizeCandidate)

    if (options.dryRun) {
      return { ...base, status: "dry_run" as const, searchAttempts: candidates.length, selectedSource: selectedSrc, selected: summarizeCandidate(pick), candidates: summarized, sourceFailures }
    }

    if (options.skipExisting) {
      const existing = yield* validExistingMatchEffect(options.outDir, pick.result)
      if (existing) {
        return { ...base, status: "skipped_existing" as const, searchAttempts: candidates.length, selectedSource: selectedSrc, selected: summarizeCandidate(pick), downloadedPath: existing.path, bytes: existing.bytes, validation: { valid: true, reason: existing.reason }, candidates: summarized, sourceFailures }
      }
    }

    const dlEff = atomicDownloadEffect(pick, options.outDir, options, pick.source).pipe(
      Effect.retry(S.exponential("250 millis", 2.0).pipe(S.both(S.recurs(options.retries)))),
      Effect.mapError((err) => {
        if (isBlockedError(err)) return asBlockedError(err, `download ${pick.source.baseUrl ?? pick.source.id}`)
        return new Error(`download failed: ${(err as Error)?.message ?? String(err)}`)
      })
    )
    const dlResult = yield* Effect.result(dlEff)
    if (Result.isSuccess(dlResult)) {
      const dl = dlResult.success
      return { ...base, status: "ok" as const, searchAttempts: candidates.length, downloadAttempts: options.retries + 1, selectedSource: selectedSrc, selected: summarizeCandidate(pick), download: dl as DownloadAttempt, candidates: summarized, sourceFailures }
    }
    sourceFailures.push(sourceFailure(pick.source, "download", dlResult.failure))
    const allBlocked = sourceFailures.every(f => f.blocked)
    return { ...base, status: allBlocked ? "blocked" as const : "error" as const, error: allBlocked ? "All attempted sources reported a CAPTCHA, challenge, or error page" : "Selected source download failed", selectedSource: selectedSrc, selected: summarizeCandidate(pick), sourceFailures, candidates: summarized }
  })
}

function loadMirrorCacheEffect(cacheFile: string) {
  return Effect.gen(function* () {
    const raw = yield* Effect.orElseSucceed(
      Effect.tryPromise(() => readFile(cacheFile, "utf8")),
      () => null,
    )
    if (!raw) return undefined
    const cached = JSON.parse(raw) as { sources: MirrorSource[]; summary: MirrorPlan["summary"]; cachedAt: number }
    if (!cached || !Array.isArray(cached.sources) || !cached.cachedAt) return undefined
    if (cached.summary?.status === "error") return undefined
    if (Date.now() - cached.cachedAt > MIRROR_CACHE_TTL_MS) return undefined
    return cached
  })
}

function saveMirrorCacheEffect(cacheFile: string, sources: MirrorSource[], summary: MirrorPlan["summary"]) {
  if (summary.status === "error") return Effect.void
  return Effect.gen(function* () {
    yield* Effect.orElseSucceed(
      Effect.tryPromise(() => mkdir(dirname(resolve(cacheFile)), { recursive: true })),
      () => undefined,
    )
    const cached = { sources, summary, cachedAt: Date.now() }
    yield* Effect.orElseSucceed(
      Effect.tryPromise(() => writeFile(cacheFile, JSON.stringify(cached, null, 2) + "\n")),
      () => undefined,
    )
  })
}

function summaryFromResults(results: TargetResult[], totalTargets: number): Record<string, number> {
  const summary: Record<string, number> = {}
  for (const result of results) {
    summary[result.status] = (summary[result.status] ?? 0) + 1
  }
  const pending = totalTargets - results.length
  if (pending > 0) summary.pending = pending
  return summary
}

function reportOptions(options: BatchOptions): Record<string, unknown> {
  return {
    outDir: options.outDir, dryRun: options.dryRun, concurrency: options.concurrency,
    maxResults: options.maxResults, retries: options.retries, targetTimeoutMs: options.targetTimeoutMs,
    skipExisting: options.skipExisting, formats: options.formats,
    translators: options.translators, authors: options.authors,
    languages: options.languages, keywords: options.keywords,
    discoverMirrors: options.discoverMirrors, mirrorSource: options.mirrorSource,
    mirrorGroups: options.mirrorGroups, baseUrls: options.baseUrls,
  }
}

function buildReport(startedAt: string, finishedAt: string | null, options: BatchOptions, mirrorPlan: MirrorPlan, results: TargetResult[], totalTargets: number): BatchReport {
  return {
    startedAt,
    finishedAt,
    options: reportOptions(options),
    mirrorDiscovery: mirrorPlan.summary,
    summary: summaryFromResults(results, totalTargets),
    results,
  }
}

let reportWriteChain: Promise<void> = Promise.resolve()

function writeReportEffect(report: BatchReport, options: BatchOptions, final: boolean) {
  return Effect.gen(function* () {
    const json = JSON.stringify(report, null, options.pretty ? 2 : 0) + "\n"
    if (options.report === "-" || !options.report) {
      if (final) yield* Effect.sync(() => process.stdout.write(json))
      return
    }
    const reportPath = resolve(options.report)
    reportWriteChain = reportWriteChain.then(async () => {
      await mkdir(dirname(reportPath), { recursive: true })
      await writeFile(reportPath, json)
    })
    yield* Effect.tryPromise(() => reportWriteChain)
  })
}

function targetTimeoutResult(target: BatchTarget, timeoutMs: number): TargetResult {
  return {
    id: target.id,
    query: target.query,
    startedAt: new Date().toISOString(),
    status: "error",
    candidates: [],
    sourceFailures: [],
    error: `Target timed out after ${timeoutMs}ms`,
  }
}

function ensurePublicSources(plan: MirrorPlan): MirrorPlan {
  const sources = dedupeSources([...plan.sources, ...publicSourceCandidates()])
  return {
    sources,
    summary: {
      ...plan.summary,
      candidateCount: sources.length,
      candidates: sources.map(summarizeSource),
    },
  }
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

const main = Effect.gen(function* () {
  const { options, inputFiles, cliTargets } = parseArgs(process.argv.slice(2))
  options.outDir = resolve(options.outDir)

  // Mirror discovery (with cache)
  let mirrorPlan: MirrorPlan
  if (options.discoverMirrors && !options.noCache) {
    const cached = yield* loadMirrorCacheEffect(options.cacheFile)
    if (cached) {
      mirrorPlan = { sources: cached.sources, summary: { ...cached.summary, cached: true } }
    } else {
      mirrorPlan = yield* discoverMirrorSourcesEffect(options)
      yield* saveMirrorCacheEffect(options.cacheFile, mirrorPlan.sources, mirrorPlan.summary)
    }
  } else {
    mirrorPlan = yield* discoverMirrorSourcesEffect(options)
  }

  mirrorPlan = ensurePublicSources(mirrorPlan)
  options.sourceCandidates = mirrorPlan.sources
  const targets = yield* Effect.tryPromise(() => loadTargets(inputFiles, cliTargets, options))
  const startedAt = new Date().toISOString()
  const progressResults: TargetResult[] = []

  const results = yield* Effect.all(
    targets.map((target) =>
      processTargetEffect(target, options).pipe(
        Effect.timeoutOrElse({ duration: options.targetTimeoutMs, orElse: () => Effect.succeed(targetTimeoutResult(target, options.targetTimeoutMs)) }),
        Effect.tap((result) => Effect.gen(function* () {
          progressResults.push(result)
          const progressReport = buildReport(startedAt, null, options, mirrorPlan, progressResults, targets.length)
          yield* writeReportEffect(progressReport, options, false)
        })),
      )
    ),
    { concurrency: options.concurrency },
  )
  const finishedAt = new Date().toISOString()
  const report = buildReport(startedAt, finishedAt, options, mirrorPlan, results, targets.length)

  yield* writeReportEffect(report, options, true)

  if (results.some(r => r.status === "error" || r.status === "blocked")) {
    yield* Effect.sync(() => { process.exitCode = 1 })
  }
})

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

await Effect.runPromise(main.pipe(Effect.provide(httpLayer)))
