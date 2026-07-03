import { appendFile, mkdir } from "node:fs/promises"
import { basename, extname, resolve, sep } from "node:path"
import { Schema } from "effect"

export const FEED_SCHEMA = "xanadu-feed.v1" as const
export const REPO_ROOT = resolve(import.meta.dir, "../../..")
export const FEED_PATH = resolve(REPO_ROOT, "data/xanadu/feed.jsonl")

const NonEmptyStringSchema = Schema.String.check(Schema.isMinLength(1))
const IsoTimestampSchema = NonEmptyStringSchema.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
)

export const FeedKindSchema = Schema.Union([
  Schema.Literal("proof"),
  Schema.Literal("demo"),
  Schema.Literal("note"),
  Schema.Literal("decision"),
  Schema.Literal("question"),
  Schema.Literal("progress"),
])

export const ArtifactMediaSchema = Schema.Union([
  Schema.Literal("audio"),
  Schema.Literal("video"),
  Schema.Literal("image"),
  Schema.Literal("markdown"),
  Schema.Literal("text"),
  Schema.Literal("json"),
  Schema.Literal("embed"),
])

export const ArtifactSchema = Schema.Struct({
  label: NonEmptyStringSchema,
  path: Schema.optional(NonEmptyStringSchema),
  url: Schema.optional(NonEmptyStringSchema),
  media: ArtifactMediaSchema,
})

export const ActionSchema = Schema.Struct({
  label: NonEmptyStringSchema,
  cwd: Schema.optional(NonEmptyStringSchema),
  command: NonEmptyStringSchema,
  argv: Schema.optional(Schema.Array(NonEmptyStringSchema)),
})

export const LinkSchema = Schema.Struct({
  label: NonEmptyStringSchema,
  href: NonEmptyStringSchema,
})

export const FeedEntrySchema = Schema.Struct({
  schema: Schema.Literal(FEED_SCHEMA),
  id: NonEmptyStringSchema,
  ts: IsoTimestampSchema,
  stream: Schema.optional(NonEmptyStringSchema),
  kind: FeedKindSchema,
  title: NonEmptyStringSchema,
  summary: Schema.optional(Schema.String),
  artifacts: Schema.optional(Schema.Array(ArtifactSchema)),
  actions: Schema.optional(Schema.Array(ActionSchema)),
  links: Schema.optional(Schema.Array(LinkSchema)),
  needsInput: Schema.optional(Schema.Boolean),
  tags: Schema.optional(Schema.Array(NonEmptyStringSchema)),
  parentId: Schema.optional(NonEmptyStringSchema),
})

export type FeedKind = Schema.Schema.Type<typeof FeedKindSchema>
export type ArtifactMedia = Schema.Schema.Type<typeof ArtifactMediaSchema>
export type FeedArtifact = Schema.Schema.Type<typeof ArtifactSchema>
export type FeedAction = Schema.Schema.Type<typeof ActionSchema>
export type FeedLink = Schema.Schema.Type<typeof LinkSchema>
type FeedEntryWire = Schema.Schema.Type<typeof FeedEntrySchema>

export interface FeedEntry {
  readonly schema: typeof FEED_SCHEMA
  readonly id: string
  readonly ts: string
  readonly stream: string
  readonly kind: FeedKind
  readonly title: string
  readonly summary: string
  readonly artifacts: readonly FeedArtifact[]
  readonly actions: readonly FeedAction[]
  readonly links: readonly FeedLink[]
  readonly needsInput: boolean
  readonly tags: readonly string[]
  readonly parentId?: string
}

export interface FeedLineWarning {
  readonly line: number
  readonly message: string
}

export interface FeedParseResult {
  readonly entries: readonly FeedEntry[]
  readonly warnings: readonly FeedLineWarning[]
}

export interface ResolvedArtifactPath {
  readonly absolutePath: string
  readonly repoRelativePath: string
}

export interface ResolvedActionCwd {
  readonly absolutePath: string
  readonly repoRelativePath: string
}

export const ARTIFACT_PREFIXES = [
  "data/",
  "streams/",
  "docs/",
  "apps/ai-companion-rtc/docs/",
  "apps/ai-companion-rtc/artifacts/",
] as const

const ROOT_WITH_SEPARATOR = REPO_ROOT.endsWith(sep) ? REPO_ROOT : `${REPO_ROOT}${sep}`

function normalizeFeedEntry(entry: FeedEntryWire): FeedEntry {
  return {
    schema: entry.schema,
    id: entry.id,
    ts: entry.ts,
    stream: entry.stream ?? "companion",
    kind: entry.kind,
    title: entry.title,
    summary: entry.summary ?? "",
    artifacts: entry.artifacts ?? [],
    actions: entry.actions ?? [],
    links: entry.links ?? [],
    needsInput: entry.needsInput ?? false,
    tags: entry.tags ?? [],
    ...(entry.parentId ? { parentId: entry.parentId } : {}),
  }
}

function parseJsonLine(line: string): object {
  return JSON.parse(line) as object
}

export function decodeFeedEntry(value: object): FeedEntry {
  return normalizeFeedEntry(Schema.decodeUnknownSync(FeedEntrySchema)(value))
}

export function parseFeedJsonl(text: string): FeedParseResult {
  const entries: FeedEntry[] = []
  const warnings: FeedLineWarning[] = []
  const lines = text.split(/\r?\n/)

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (!line) continue
    try {
      entries.push(decodeFeedEntry(parseJsonLine(line)))
    } catch (error) {
      warnings.push({ line: index + 1, message: error instanceof Error ? error.message : String(error) })
    }
  }

  return {
    entries: sortNewestFirst(entries),
    warnings,
  }
}

export async function readFeedFile(path = FEED_PATH, log: (message: string) => void = console.warn): Promise<readonly FeedEntry[]> {
  const file = Bun.file(path)
  if (!(await file.exists())) return []
  const parsed = parseFeedJsonl(await file.text())
  for (const warning of parsed.warnings) {
    log(`[xanadu] skipped invalid feed line ${warning.line}: ${warning.message}`)
  }
  return parsed.entries
}

export async function appendFeedEntry(entry: FeedEntry, path = FEED_PATH): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true })
  Schema.decodeUnknownSync(FeedEntrySchema)(entry)
  await appendFile(path, `${JSON.stringify(entry)}\n`)
}

export function sortNewestFirst(entries: readonly FeedEntry[]): readonly FeedEntry[] {
  return [...entries].sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts))
}

export function parseCommandLine(command: string): readonly string[] {
  const parts: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of command) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === "\\") {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current)
        current = ""
      }
      continue
    }
    current += char
  }

  if (escaping) current += "\\"
  if (quote) throw new Error(`Unclosed quote in command: ${command}`)
  if (current.length > 0) parts.push(current)
  if (parts.length === 0) throw new Error("Action command produced no argv")
  return parts
}

export function actionArgv(action: FeedAction): readonly string[] {
  return action.argv && action.argv.length > 0 ? action.argv : parseCommandLine(action.command)
}

export function findFeedAction(
  entries: readonly FeedEntry[],
  entryId: string,
  index: number,
): { readonly entry: FeedEntry; readonly action: FeedAction } | null {
  if (!Number.isInteger(index) || index < 0) return null
  const entry = entries.find((candidate) => candidate.id === entryId)
  if (!entry) return null
  const action = entry.actions[index]
  return action ? { entry, action } : null
}

export function normalizeRepoRelativePath(repoRelativePath: string): string | null {
  if (!repoRelativePath || repoRelativePath.startsWith("/") || repoRelativePath.includes("\0")) return null
  if (/^[A-Za-z]:[\\/]/.test(repoRelativePath)) return null

  const slashPath = repoRelativePath.replaceAll("\\", "/")
  const segments = slashPath.split("/")
  const normalized: string[] = []
  for (const segment of segments) {
    if (!segment || segment === ".") continue
    if (segment === "..") return null
    normalized.push(segment)
  }
  if (normalized.length === 0) return "."
  return normalized.join("/")
}

export function resolveRepoPath(repoRelativePath: string): ResolvedActionCwd | null {
  const normalized = normalizeRepoRelativePath(repoRelativePath)
  if (!normalized) return null
  const absolutePath = resolve(REPO_ROOT, normalized)
  if (absolutePath !== REPO_ROOT && !absolutePath.startsWith(ROOT_WITH_SEPARATOR)) return null
  return { absolutePath, repoRelativePath: normalized }
}

export function resolveActionCwd(cwd: string | undefined): ResolvedActionCwd | null {
  return resolveRepoPath(cwd ?? ".")
}

export function resolveArtifactPath(repoRelativePath: string): ResolvedArtifactPath | null {
  const normalized = normalizeRepoRelativePath(repoRelativePath)
  if (!normalized) return null
  if (!ARTIFACT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return null
  const absolutePath = resolve(REPO_ROOT, normalized)
  if (!absolutePath.startsWith(ROOT_WITH_SEPARATOR)) return null
  return { absolutePath, repoRelativePath: normalized }
}

export function contentTypeForPath(path: string): string {
  const extension = extname(basename(path)).toLowerCase()
  switch (extension) {
    case ".wav":
      return "audio/wav"
    case ".webm":
      return "video/webm"
    case ".png":
      return "image/png"
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".html":
      return "text/html; charset=utf-8"
    case ".md":
      return "text/markdown; charset=utf-8"
    case ".json":
      return "application/json; charset=utf-8"
    case ".jsonl":
      return "application/x-ndjson; charset=utf-8"
    case ".txt":
      return "text/plain; charset=utf-8"
    default:
      return "application/octet-stream"
  }
}
