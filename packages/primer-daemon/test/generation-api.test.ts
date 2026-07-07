import { copyFileSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, test } from "bun:test"

import { handleGenerationApi } from "../src/generation-api"
import { resolveDaemonPaths, type DaemonPaths } from "../src/paths"
import { ingestGeneration } from "../scripts/ingest-generation"

const TEST_TMP_ROOT = new URL(".tmp/generation-api/", import.meta.url).pathname
const REPO_ROOT = new URL("../../..", import.meta.url).pathname
const FIXED_NOW = new Date("2026-07-07T00:00:00.000Z")

interface GenerationFixture {
  paths: DaemonPaths
  baseUrl: string
}

interface BatchProvenanceResponse {
  id: string
  kind: string
  sourceFile: string
  worker: string | null
  model: string | null
  promptVersion: string | null
  ingestedAt: string
}

interface GenerationStatsResponse {
  available: boolean
  storePath: string
  kinds: Array<{ kind: string; batches: number; rows: number }>
  tierHistograms: Array<{ kind: string; tier: string | null; rows: number }>
}

interface AnnotationRowResponse {
  annId: string
  unitKey: string | null
  verdict: string | null
  batch: BatchProvenanceResponse
}

interface VerdictRowResponse {
  annId: string
  tier: string
  paraphrase: boolean
  anchorPrecise: boolean
  redundant: boolean
  retrievalTarget: string
  defectsJson: string
  verdict: string
  batch: BatchProvenanceResponse
}

interface HskCardRowResponse {
  word: string
  pinyin: string
  gloss: string
  cardType: string
  front: string
  back: string
  retrievalTarget: string
  tier: string
  notes: string | null
  batch: BatchProvenanceResponse
}

interface RowsResponse<Row> {
  available: boolean
  rows: Row[]
}

describe("generation API", () => {
  test("serves stats and read-only rows from a real ingested generation store", async () => {
    await withGenerationFixture("populated", async ({ baseUrl, paths }) => {
      const stats = await requestJson<GenerationStatsResponse>(baseUrl, paths, "/api/generation/stats")
      expect(stats.response.status).toBe(200)
      expect(stats.body.available).toBe(true)
      const kindsByName = new Map(stats.body.kinds.map((k) => [k.kind, k]))
      for (const kind of ["annotation-rewrite", "rubric-verdict", "hsk-cards"] as const) {
        const entry = kindsByName.get(kind)
        expect(entry).toBeDefined()
        expect(entry?.batches).toBe(1)
        expect(entry !== undefined && entry.rows > 0).toBe(true)
      }
      expect(stats.body.tierHistograms.some((t) => t.kind === "rubric-verdict" && t.rows > 0)).toBe(true)
      expect(stats.body.tierHistograms.some((t) => t.kind === "hsk-cards" && t.tier === "T2" && t.rows > 0)).toBe(true)

      const annotations = await requestJson<RowsResponse<AnnotationRowResponse>>(
        baseUrl,
        paths,
        "/api/generation/annotations?unit=u-07-opening&verdict=keep&limit=2",
      )
      expect(annotations.response.status).toBe(200)
      expect(annotations.body.available).toBe(true)
      expect(annotations.body.rows).toHaveLength(2)
      expect(annotations.body.rows[0]).toMatchObject({ unitKey: "u-07-opening", verdict: "keep" })
      expect(annotations.body.rows[0].batch).toMatchObject({
        kind: "annotation-rewrite",
        sourceFile: "streams/primer/wrapped-commentary-reader/artifacts/generation/quality-pass-2026-07-06/slice-a.json",
        ingestedAt: FIXED_NOW.toISOString(),
      })

      const verdicts = await requestJson<RowsResponse<VerdictRowResponse>>(baseUrl, paths, "/api/generation/verdicts?tier=T1&limit=2")
      expect(verdicts.response.status).toBe(200)
      expect(verdicts.body.available).toBe(true)
      expect(verdicts.body.rows).toHaveLength(2)
      expect(verdicts.body.rows[0]).toMatchObject({ tier: "T1", verdict: "revise", batch: { kind: "rubric-verdict" } })
      expect(typeof verdicts.body.rows[0].paraphrase).toBe("boolean")
      expect(verdicts.body.rows[0].defectsJson.length).toBeGreaterThan(0)

      const cards = await requestJson<RowsResponse<HskCardRowResponse>>(baseUrl, paths, "/api/generation/hsk-cards?tier=T2&limit=3")
      expect(cards.response.status).toBe(200)
      expect(cards.body.available).toBe(true)
      expect(cards.body.rows).toHaveLength(3)
      expect(cards.body.rows[0]).toMatchObject({ tier: "T2", batch: { kind: "hsk-cards" } })
      expect(cards.body.rows[0].word.length).toBeGreaterThan(0)
      expect(cards.body.rows[0].front.length).toBeGreaterThan(0)
    })
  })

  test("returns available false when the generation store is missing", async () => {
    rmSync(join(TEST_TMP_ROOT, "missing"), { recursive: true, force: true })
    const paths = resolveDaemonPaths({ PRIMER_GENERATION_STORE: join(TEST_TMP_ROOT, "missing", "generation-store.sqlite") })
    const response = await handleGenerationApi(new Request("http://generation-api.test/api/generation/stats"), paths)
    if (response === null) throw new Error("generation API did not handle stats route")

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available: false })
  })
})

async function withGenerationFixture(name: string, run: (fixture: GenerationFixture) => Promise<void>): Promise<void> {
  const rootDir = join(TEST_TMP_ROOT, name, "root")
  const storePath = join(TEST_TMP_ROOT, name, "generation-store.sqlite")
  rmSync(join(TEST_TMP_ROOT, name), { recursive: true, force: true })
  copyRealFixture(
    "streams/primer/wrapped-commentary-reader/artifacts/generation/quality-pass-2026-07-06/slice-a.json",
    rootDir,
  )
  copyRealFixture("streams/primer/wrapped-commentary-reader/artifacts/generation/rubric-2026-07-06/verdicts-1.jsonl", rootDir)
  copyRealFixture("streams/primer/hsk-cards/gen-2026-07-06/hsk5-001-060.json", rootDir)
  await ingestGeneration({ rootDir, storePath, now: () => FIXED_NOW })

  await run({
    paths: resolveDaemonPaths({ PRIMER_GENERATION_STORE: storePath }),
    baseUrl: "http://generation-api.test",
  })
}

async function requestJson<T>(baseUrl: string, paths: DaemonPaths, path: string): Promise<{ response: Response; body: T }> {
  const response = await handleGenerationApi(new Request(`${baseUrl}${path}`), paths)
  if (response === null) throw new Error(`unhandled generation API route: ${path}`)
  return { response, body: (await response.json()) as T }
}

function copyRealFixture(relativePath: string, rootDir: string): void {
  const destination = join(rootDir, relativePath)
  mkdirSync(dirname(destination), { recursive: true })
  copyFileSync(join(REPO_ROOT, relativePath), destination)
}
