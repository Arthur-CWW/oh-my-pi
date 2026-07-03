import { describe, expect, test } from "bun:test"
import {
  decodeFeedEntry,
  FEED_SCHEMA,
  findFeedAction,
  parseFeedJsonl,
  resolveArtifactPath,
  type FeedEntry,
} from "../src/feed.ts"

const baseEntry = {
  schema: FEED_SCHEMA,
  id: "entry-1",
  ts: "2026-07-03T08:00:00.000Z",
  stream: "companion",
  kind: "proof",
  title: "Round trip",
  summary: "A decoded entry",
  artifacts: [{ label: "Readme", path: "data/x.md", media: "markdown" }],
  actions: [{ label: "Run", cwd: ".", command: "bun test", argv: ["bun", "test"] }],
  links: [{ label: "Local", href: "/artifact/data/x.md" }],
  needsInput: false,
  tags: ["test"],
} as const

describe("feed schema", () => {
  test("decodes a JSONL round trip and skips invalid lines", () => {
    const compactEntry = {
      schema: FEED_SCHEMA,
      id: "entry-2",
      ts: "2026-07-03T09:00:00.000Z",
      kind: "note",
      title: "Defaults",
    }
    const text = [JSON.stringify(baseEntry), "not json", JSON.stringify(compactEntry)].join("\n")
    const parsed = parseFeedJsonl(text)

    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["entry-2", "entry-1"])
    expect(parsed.entries[0]?.stream).toBe("companion")
    expect(parsed.entries[0]?.artifacts).toEqual([])
    expect(parsed.entries[0]?.actions).toEqual([])
    expect(parsed.entries[0]?.links).toEqual([])
    expect(parsed.entries[0]?.needsInput).toBe(false)
    expect(parsed.entries[0]?.tags).toEqual([])
  })

  test("validates a complete feed entry", () => {
    const entry = decodeFeedEntry(baseEntry)

    expect(entry).toEqual(baseEntry)
  })

  test("decodes old artifacts and new embed artifacts", () => {
    const oldArtifactEntry = decodeFeedEntry({
      ...baseEntry,
      id: "entry-old-artifact",
      artifacts: [{ label: "Audio", path: "data/x.wav", media: "audio" }],
    })
    const embedEntry = decodeFeedEntry({
      ...baseEntry,
      id: "entry-embed-artifact",
      artifacts: [{ label: "Loop", media: "embed", url: "https://example.com/loop" }],
    })
    const parsed = parseFeedJsonl(
      [
        JSON.stringify({ ...baseEntry, id: "entry-bad-media", artifacts: [{ label: "Bad", path: "data/x.bin", media: "binary" }] }),
        JSON.stringify(embedEntry),
      ].join("\n"),
    )

    expect(oldArtifactEntry.artifacts[0]?.url).toBeUndefined()
    expect(embedEntry.artifacts[0]?.url).toBe("https://example.com/loop")
    expect(parsed.warnings).toHaveLength(1)
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["entry-embed-artifact"])
  })
})

describe("artifact whitelist", () => {
  test("accepts allowed prefixes and rejects traversal or non-whitelisted paths", () => {
    expect(resolveArtifactPath("data/x.wav")?.repoRelativePath).toBe("data/x.wav")
    expect(resolveArtifactPath("../secrets")).toBeNull()
    expect(resolveArtifactPath("/tmp/secrets")).toBeNull()
    expect(resolveArtifactPath("package.json")).toBeNull()
  })
})

describe("action lookup", () => {
  test("resolves only actions registered on decoded feed entries", () => {
    const entry = decodeFeedEntry(baseEntry)
    const entries: readonly FeedEntry[] = [entry]

    expect(findFeedAction(entries, "entry-1", 0)?.action.command).toBe("bun test")
    expect(findFeedAction(entries, "entry-1", 1)).toBeNull()
    expect(findFeedAction(entries, "entry-from-request-body", 0)).toBeNull()
  })
})
