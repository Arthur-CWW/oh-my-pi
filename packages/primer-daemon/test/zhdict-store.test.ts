import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { handleZhDictApi } from "../src/zhdict-api"
import { ensureZhDictTables, getCachedZhGloss, indexZhDict, lookupZhSentences, saveZhGloss } from "../src/zhdict-store"
import { resolveDaemonPaths } from "../src/paths"

const ROOT = new URL(".tmp/zhdict-store/", import.meta.url).pathname
let counter = 0

function fixturePaths(): { readerDb: string; zhdictDb: string; cedictDb: string } {
  const id = `${Date.now()}-${counter++}`
  mkdirSync(ROOT, { recursive: true })
  return { readerDb: join(ROOT, `${id}.reader.sqlite`), zhdictDb: join(ROOT, `${id}.zhdict.sqlite`), cedictDb: join(ROOT, `${id}.cedict.sqlite`) }
}

describe("zhdict store", () => {
  test("ranks easier sentences first", () => {
    const paths = fixturePaths()
    const db = new Database(paths.zhdictDb)
    ensureZhDictTables(db)
    db.query("INSERT INTO zh_sentences (text, source, hsk_estimate) VALUES (?, ?, ?)").run("我喜欢学习。", "hsk1", 0.02)
    db.query("INSERT INTO zh_sentences (text, source, hsk_estimate) VALUES (?, ?, ?)").run("这个词很难理解。", "reader", 30.2)
    db.close()
    expect(lookupZhSentences(paths.zhdictDb, "学习", 4)[0]?.text).toBe("我喜欢学习。")
    rmSync(paths.zhdictDb, { force: true })
  })

  test("roundtrips a cached Chinese gloss", () => {
    const paths = fixturePaths()
    const gloss = saveZhGloss(paths.zhdictDb, {
      word: "喜欢",
      simpleDef: "觉得很好，愿意接近。",
      synonyms: [{ word: "爱", note: "感情更强。", relation: "近义词" }],
      registerNote: null,
      model: "test-model",
    })
    expect(getCachedZhGloss(paths.zhdictDb, "喜欢")).toMatchObject({ word: gloss.word, simpleDef: gloss.simpleDef, synonyms: gloss.synonyms })
    rmSync(paths.zhdictDb, { force: true })
  })

  test("rejects malformed generated gloss JSON at the endpoint", async () => {
    const paths = fixturePaths()
    const cedict = new Database(paths.cedictDb)
    cedict.exec("CREATE TABLE cedict (simplified TEXT, traditional TEXT, pinyin TEXT, definitions TEXT); CREATE TABLE decomposition (char TEXT, ids TEXT, components TEXT)")
    cedict.query("INSERT INTO cedict VALUES (?, ?, ?, ?)").run("喜欢", "喜歡", "xǐhuan", JSON.stringify(["to like"]))
    cedict.close()
    const response = await handleZhDictApi(
      new Request("http://test/api/zhdict/%E5%96%9C%E6%AC%A2/generate", { method: "POST", body: "{}" }),
      resolveDaemonPaths({ PRIMER_CEDICT_DB: paths.cedictDb, PRIMER_ZHDICT_DB: paths.zhdictDb }),
      { generate: async () => "not json" },
    )
    expect(response?.status).toBe(502)
    rmSync(paths.cedictDb, { force: true })
  })

  test("index is idempotent", () => {
    const paths = fixturePaths()
    const deck = join(ROOT, `deck-${counter++}`)
    mkdirSync(join(deck, "complete-hsk-vocabulary/wordlists/exclusive/new"), { recursive: true })
    writeFileSync(join(deck, "complete-hsk-vocabulary/wordlists/exclusive/new/1.json"), JSON.stringify([{ simplified: "喜欢" }, { simplified: "学习" }]))
    writeFileSync(join(deck, "mando_sentences.md"), "喜欢: 我喜欢学习。\n")
    const reader = new Database(paths.readerDb)
    reader.exec("CREATE TABLE reading_docs (id INTEGER PRIMARY KEY, title TEXT, source TEXT); CREATE TABLE reading_paragraphs (doc_id INTEGER, idx INTEGER, text TEXT)")
    reader.query("INSERT INTO reading_docs VALUES (1, ?, ?)").run("短文", "fixture")
    reader.query("INSERT INTO reading_paragraphs VALUES (1, 0, ?)").run("我喜欢学习。")
    reader.close()
    const config = { readerDb: paths.readerDb, zhdictDb: paths.zhdictDb }
    const first = indexZhDict(config, { hskDeckDir: deck })
    const second = indexZhDict(config, { hskDeckDir: deck })
    expect(first.sentenceCount).toBe(2)
    expect(second.insertedCount).toBe(0)
    expect(second.sentenceCount).toBe(first.sentenceCount)
    rmSync(deck, { recursive: true, force: true })
    rmSync(paths.readerDb, { force: true })
    rmSync(paths.zhdictDb, { force: true })
  })
})
