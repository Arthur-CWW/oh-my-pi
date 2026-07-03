import {
  appendFeedEntry,
  decodeFeedEntry,
  FEED_SCHEMA,
  type ArtifactMedia,
  type FeedAction,
  type FeedArtifact,
  type FeedEntry,
  type FeedKind,
  parseCommandLine,
} from "./feed.ts"

interface ParsedArgs {
  readonly stream: string
  readonly kind: FeedKind
  readonly title: string
  readonly summary: string
  readonly artifacts: readonly FeedArtifact[]
  readonly actions: readonly FeedAction[]
  readonly links: readonly { readonly label: string; readonly href: string }[]
  readonly needsInput: boolean
  readonly tags: readonly string[]
}

const kinds = new Set<FeedKind>(["proof", "demo", "note", "decision", "question", "progress"])
const mediaKinds = new Set<ArtifactMedia>(["audio", "video", "image", "markdown", "text", "json"])

function usage(): string {
  return [
    "Usage: bun run post -- --title <title> [options]",
    "",
    "Options:",
    "  --stream <name>                         Stream name, default companion",
    "  --kind <proof|demo|note|decision|question|progress>",
    "  --summary <markdown>                    Card summary markdown",
    "  --artifact 'label=Name,path=file,media=audio'        Repeatable",
    "  --action 'label=Run,cwd=apps/x,command=bun run test' Repeatable",
    "  --link 'label=Name,href=https://example.test'        Repeatable",
    "  --tag <tag>                             Repeatable",
    "  --question                              Mark as needs Arthur input; kind defaults to question",
  ].join("\n")
}

function splitSpec(spec: string): ReadonlyMap<string, string> {
  const values = new Map<string, string>()
  for (const part of spec.split(",")) {
    const equalsIndex = part.indexOf("=")
    if (equalsIndex <= 0) throw new Error(`Bad key=value segment: ${part}`)
    values.set(part.slice(0, equalsIndex).trim(), part.slice(equalsIndex + 1).trim())
  }
  return values
}

function requiredSpecValue(values: ReadonlyMap<string, string>, key: string, spec: string): string {
  const value = values.get(key)
  if (!value) throw new Error(`Missing ${key} in spec: ${spec}`)
  return value
}

function parseArtifact(spec: string): FeedArtifact {
  const values = splitSpec(spec)
  const media = requiredSpecValue(values, "media", spec)
  if (!mediaKinds.has(media as ArtifactMedia)) throw new Error(`Unsupported artifact media: ${media}`)
  return {
    label: requiredSpecValue(values, "label", spec),
    path: requiredSpecValue(values, "path", spec),
    media: media as ArtifactMedia,
  }
}

function parseAction(spec: string): FeedAction {
  const values = splitSpec(spec)
  const command = requiredSpecValue(values, "command", spec)
  const cwd = values.get("cwd") ?? "."
  return {
    label: requiredSpecValue(values, "label", spec),
    cwd,
    command,
    argv: parseCommandLine(command),
  }
}

function parseLink(spec: string): { readonly label: string; readonly href: string } {
  const values = splitSpec(spec)
  return {
    label: requiredSpecValue(values, "label", spec),
    href: requiredSpecValue(values, "href", spec),
  }
}

function readFlagValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1]
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`)
  return value
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  let stream = "companion"
  let kind: FeedKind = "note"
  let kindExplicit = false
  let title = ""
  let summary = ""
  let needsInput = false
  const artifacts: FeedArtifact[] = []
  const actions: FeedAction[] = []
  const links: { label: string; href: string }[] = []
  const tags: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg || arg === "--") continue
    switch (arg) {
      case "--stream":
        stream = readFlagValue(argv, index, arg)
        index += 1
        break
      case "--kind": {
        const value = readFlagValue(argv, index, arg)
        if (!kinds.has(value as FeedKind)) throw new Error(`Unsupported kind: ${value}`)
        kind = value as FeedKind
        kindExplicit = true
        index += 1
        break
      }
      case "--title":
        title = readFlagValue(argv, index, arg)
        index += 1
        break
      case "--summary":
        summary = readFlagValue(argv, index, arg)
        index += 1
        break
      case "--artifact":
        artifacts.push(parseArtifact(readFlagValue(argv, index, arg)))
        index += 1
        break
      case "--action":
        actions.push(parseAction(readFlagValue(argv, index, arg)))
        index += 1
        break
      case "--link":
        links.push(parseLink(readFlagValue(argv, index, arg)))
        index += 1
        break
      case "--tag":
        tags.push(readFlagValue(argv, index, arg))
        index += 1
        break
      case "--question":
        needsInput = true
        if (!kindExplicit) kind = "question"
        break
      case "--help":
      case "-h":
        console.log(usage())
        process.exit(0)
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (!title.trim()) throw new Error("--title is required")
  return { stream, kind, title, summary, artifacts, actions, links, needsInput, tags }
}

const args = parseArgs(Bun.argv.slice(2))
const entry = decodeFeedEntry({
  schema: FEED_SCHEMA,
  id: crypto.randomUUID(),
  ts: new Date().toISOString(),
  stream: args.stream,
  kind: args.kind,
  title: args.title,
  summary: args.summary,
  artifacts: args.artifacts,
  actions: args.actions,
  links: args.links,
  needsInput: args.needsInput,
  tags: args.tags,
}) satisfies FeedEntry

await appendFeedEntry(entry)
console.log(JSON.stringify(entry))
