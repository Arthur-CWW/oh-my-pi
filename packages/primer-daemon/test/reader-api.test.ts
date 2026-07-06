import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"

import { lookupCedictBest, lookupCedictExact } from "../src/dict"
import { resolveDaemonPaths, type DaemonPaths } from "../src/paths"
import { handleReaderApi } from "../src/reader-api"
const TEST_TMP_ROOT = new URL(".tmp/reader-api/", import.meta.url).pathname
let nextApiId = 0

type NoRows = Record<string, never>
let activePaths: DaemonPaths | null = null

interface DashboardFixture {
  baseUrl: string
  paths: DaemonPaths
}

interface ErrorResponse {
  error: string
}

interface CreateDocResponse {
  id: number
  paragraphCount: number
}

interface CreateMarkResponse {
  markId: number
  queueItem: QueueItemResponse
}

interface QueueItemResponse {
  id: number
  word: string
  pinyin: string | null
  gloss: string | null
  status: string
  lookupCount: number
  provenance: QueueProvenanceResponse | null
}

interface QueueProvenanceResponse {
  docId: number
  docTitle: string
  paragraphIdx: number
  start: number
  end: number
  sentence: string
}

interface DictResponse {
  word: string
  entries: Array<{ simplified: string; traditional: string; pinyin: string; definitions: string[] }>
}

interface KnownWordsResponse {
  words: string[]
}

const REAL_CEDICT_FIXTURE = [
  { simplified: "110", traditional: "110", pinyin: "yāoyāolíng", definitions: ["the emergency number for law enforcement in Mainland China and Taiwan"] },
  { simplified: "119", traditional: "119", pinyin: "yāoyāojiǔ", definitions: ["the emergency number for firefighting services in Mainland China"] },
  { simplified: "11区", traditional: "11區", pinyin: "11qū", definitions: ["(ACG) Japan (from the anime \"Code Geass\", in which Japan was renamed Area 11)"] },
  { simplified: "120", traditional: "120", pinyin: "yāoèrlíng", definitions: ["the emergency number for medical assistance and first aid in Mainland China"] },
  { simplified: "2019冠状病毒病", traditional: "2019冠狀病毒病", pinyin: "èrlíngyījiǔguānzhuàngbìngdúbìng", definitions: ["COVID-19, the coronavirus disease identified in 2019"] },
  { simplified: "21三体综合症", traditional: "21三體綜合症", pinyin: "21sāntǐzōnghézhèng", definitions: ["trisomy; Down's syndrome"] },
  { simplified: "3C", traditional: "3C", pinyin: "sānc", definitions: ["computers, communications, and consumer electronics", "China Compulsory Certificate (CCC)"] },
  { simplified: "3D打印", traditional: "3D打印", pinyin: "sānddǎyìn", definitions: ["to 3D print; 3D printing"] },
  { simplified: "3D打印机", traditional: "3D打印機", pinyin: "sānddǎyìnjī", definitions: ["3D printer"] },
  { simplified: "3P", traditional: "3P", pinyin: "sānp", definitions: ["(slang) threesome"] },
  { simplified: "3Q", traditional: "3Q", pinyin: "sānq", definitions: ["(Internet slang) thank you (loanword)"] },
  { simplified: "421", traditional: "421", pinyin: "sìèryī", definitions: ["four grandparents, two parents and an only child"] },
  { simplified: "4S店", traditional: "4S店", pinyin: "sìsdiàn", definitions: ["authorized full-service car dealership (offering sales, spare parts, after-sales service and customer support)"] },
  { simplified: "502胶", traditional: "502膠", pinyin: "wǔlíngèrjiāo", definitions: ["cyanoacrylate glue"] },
  { simplified: "88", traditional: "88", pinyin: "bābā", definitions: ["(Internet slang) bye-bye (alternative for 拜拜[báibái])"] },
  { simplified: "95后", traditional: "95後", pinyin: "jiǔwǔhòu", definitions: ["people born between 1995-01-01 and 1999-12-31", "Gen Z (abbr. for 95後|95后[jiǔwǔhòu] + 00後|00后[línglínghòu])"] },
  { simplified: "996", traditional: "996", pinyin: "jiǔjiǔliù", definitions: ["9am–9pm, six days a week (work schedule)"] },
  { simplified: "A", traditional: "A", pinyin: "a", definitions: ["(slang) (Tw) to steal"] },
  { simplified: "AA制", traditional: "AA制", pinyin: "aazhì", definitions: ["to split the bill; to go Dutch"] },
  { simplified: "AB制", traditional: "AB制", pinyin: "abzhì", definitions: ["to split the bill (where the male counterpart foots the larger portion of the sum)", "(theater) a system where two actors take turns in acting the main role, with one actor replacing the other if either is unavailable"] },
  { simplified: "学生", traditional: "學生", pinyin: "xuésheng", definitions: ["student; schoolchild"] },
]

describe("reader API", () => {
  test("looks up exact dictionary entries and longest-prefix matches from a real fixture", () => {
    const paths = makePaths("dict")
    const cedict = createCedictFixture(paths.cedictDb)
    try {
      const exact = lookupCedictExact(paths.cedictDb, "3D打印机")
      expect(exact.entries[0]).toMatchObject({ simplified: "3D打印机", traditional: "3D打印機", pinyin: "sānddǎyìnjī" })

      const traditional = lookupCedictExact(paths.cedictDb, "3D打印機")
      expect(traditional.entries[0].simplified).toBe("3D打印机")

      const best = lookupCedictBest(paths.cedictDb, "3D打印机坏了")
      expect(best.word).toBe("3D打印机")
      expect(best.entries[0].definitions).toEqual(["3D printer"])
    } finally {
      cedict.close()
    }
  })

  test("returns contract dictionary errors while mark enrichment degrades to null when CEDICT is missing", async () => {
    await withDashboard(false, async ({ baseUrl }) => {
      const exact = await requestJson<ErrorResponse>(baseUrl, `/api/dict/${encodeURIComponent("学生")}`)
      const best = await requestJson<ErrorResponse>(baseUrl, `/api/dict/best?text=${encodeURIComponent("学生学习")}`)
      const created = await requestJson<CreateDocResponse>(baseUrl, "/api/reader/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "无词典", text: "学生学习。" }),
      })
      const marked = await requestJson<CreateMarkResponse>(baseUrl, "/api/reader/marks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId: created.body.id, paragraphIdx: 0, start: 0, end: 2, surface: "学生", sentence: "学生学习。" }),
      })

      expect(exact.response.status).toBe(503)
      expect(exact.body).toEqual({ error: "cedict not built — run bun run cedict:build" })
      expect(best.response.status).toBe(503)
      expect(best.body).toEqual({ error: "cedict not built — run bun run cedict:build" })
      expect(marked.response.status).toBe(200)
      expect(marked.body.queueItem.pinyin).toBeNull()
      expect(marked.body.queueItem.gloss).toBeNull()
    })
  })

  test("serves reader, dict, known-word, and queue endpoints with enriched mark provenance", async () => {
    await withDashboard(true, async ({ baseUrl }) => {
      const created = await requestJson<CreateDocResponse>(baseUrl, "/api/reader/docs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "课堂", text: "学生喜欢3D打印机。\n\nAA制也常见。" }),
      })
      expect(created.response.status).toBe(200)
      expect(created.body.paragraphCount).toBe(2)

      const exact = await requestJson<DictResponse>(baseUrl, "/api/dict/3D%E6%89%93%E5%8D%B0%E6%9C%BA")
      expect(exact.body.entries[0].definitions).toEqual(["3D printer"])

      const best = await requestJson<DictResponse>(baseUrl, "/api/dict/best?text=3D%E6%89%93%E5%8D%B0%E6%9C%BA%E5%9D%8F%E4%BA%86")
      expect(best.body.word).toBe("3D打印机")

      const known = await requestJson<KnownWordsResponse>(baseUrl, "/api/reader/known-words")
      expect(known.body.words).toContain("学生")

      const marked = await requestJson<CreateMarkResponse>(baseUrl, "/api/reader/marks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          docId: created.body.id,
          paragraphIdx: 0,
          start: 4,
          end: 9,
          surface: "3D打印机",
          sentence: "学生喜欢3D打印机。",
        }),
      })
      expect(marked.response.status).toBe(200)
      expect(marked.body.queueItem).toMatchObject({ word: "3D打印机", pinyin: "sānddǎyìnjī", gloss: "3D printer", lookupCount: 1 })
      expect(marked.body.queueItem.provenance).toMatchObject({ docTitle: "课堂", paragraphIdx: 0, start: 4, end: 9 })

      const queue = await requestJson<QueueItemResponse[]>(baseUrl, "/api/queue?status=new&limit=10")
      expect(queue.body).toHaveLength(1)
      expect(queue.body[0].provenance?.sentence).toBe("学生喜欢3D打印机。")

      const kept = await requestJson<QueueItemResponse>(baseUrl, `/api/queue/${queue.body[0].id}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "keep" }),
      })
      expect(kept.body.status).toBe("keep")
      expect(kept.body.provenance?.docId).toBe(created.body.id)
    })
  })
})

async function withDashboard(cedictBuilt: boolean, run: (fixture: DashboardFixture) => Promise<void>): Promise<void> {
  const paths = makePaths(`api-${nextApiId}`)
  nextApiId += 1
  const cedict = cedictBuilt ? createCedictFixture(paths.cedictDb) : null
  const ledger = new Database(paths.ledgerDb)
  activePaths = paths
  try {
    await run({ paths, baseUrl: "http://reader-api.test" })
  } finally {
    activePaths = null
    ledger.close()
    cedict?.close()
  }
}
async function requestJson<T>(baseUrl: string, path: string, init?: RequestInit): Promise<{ response: Response; body: T }> {
  if (activePaths === null) throw new Error("reader API test request outside fixture")
  const response = await handleReaderApi(new Request(`${baseUrl}${path}`, init), activePaths)
  if (response === null) throw new Error(`unhandled reader API route: ${path}`)
  const body = (await response.json()) as T
  return { response, body }
}

function makePaths(name: string): DaemonPaths {
  const suffix = `reader-api-${nextApiId}-${name}`
  return resolveDaemonPaths({
    PRIMER_BROWSER_DB: `file:${suffix}-browser?mode=memory&cache=shared`,
    PRIMER_TWITTER_DB: `file:${suffix}-twitter?mode=memory&cache=shared`,
    PRIMER_READER_DB: `file:${suffix}-reader?mode=memory&cache=shared`,
    PRIMER_CARDS_DB: `file:${suffix}-cards?mode=memory&cache=shared`,
    PRIMER_READER_SITE: ".",
    PRIMER_LEDGER_DB: `file:${suffix}-ledger?mode=memory&cache=shared`,
    PRIMER_CEDICT_DB: `file:${suffix}-cedict?mode=memory&cache=shared`,
  })
}


function createCedictFixture(path: string): Database {
  const db = new Database(path)
  try {
    db.exec(`
CREATE TABLE cedict (
  simplified TEXT NOT NULL,
  traditional TEXT NOT NULL,
  pinyin TEXT NOT NULL,
  definitions TEXT NOT NULL
);
CREATE INDEX cedict_simplified_idx ON cedict(simplified);
CREATE INDEX cedict_traditional_idx ON cedict(traditional);
CREATE TABLE known_words (
  word TEXT PRIMARY KEY,
  hsk_level INTEGER NOT NULL
);
`)
    const insertEntry = db.query<NoRows, [string, string, string, string]>("INSERT INTO cedict (simplified, traditional, pinyin, definitions) VALUES (?, ?, ?, ?)")
    for (const entry of REAL_CEDICT_FIXTURE) insertEntry.run(entry.simplified, entry.traditional, entry.pinyin, JSON.stringify(entry.definitions))
    const insertKnown = db.query<NoRows, [string, number]>("INSERT INTO known_words (word, hsk_level) VALUES (?, ?)")
    insertKnown.run("学生", 1)
    insertKnown.run("AA制", 5)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
