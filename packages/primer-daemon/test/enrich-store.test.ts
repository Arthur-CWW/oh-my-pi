import { join } from "node:path"
import { tmpdir } from "node:os"
import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"

import { createReadingDoc, createReadingMark } from "../src/reading-store"
import { addLabel, ensureEnrichTables, insertEnrichment, listEnrichments, type EnrichmentOutput } from "../src/enrich-store"
import { buildEnrichmentPrompt, buildEnrichmentPromptInput, type EnrichmentPromptInput } from "../src/enrich-runner"

function fixtureOutput(queueItemId: number): EnrichmentOutput {
  return {
    enrichment_version: "v0",
    item: { queue_item_id: queueItemId, word: "学习", pinyin: "xuéxí" },
    provenance: {
      source_sentence: "我喜欢学习。",
      doc_id: 1,
      doc_title: "测试",
      paragraph_idx: 0,
      mark_id: 1,
      quote_verified: true,
    },
    sense_disambiguation: {
      cedict_definitions: ["to study"],
      selected_sense_index: 0,
      selected_sense: "to study",
      evidence_quote: "学习",
      gloss_in_context: "to study here",
      source: "cedict",
      confidence: "high",
      note: null,
    },
    examples: [
      { sentence: "我喜欢学习。", pinyin: "Wǒ xǐhuān xuéxí.", translation: "I like studying.", uses_sense_index: 0, unknown_tokens: [], known_token_ratio: 0.9 },
      { sentence: "他每天学习。", pinyin: "Tā měitiān xuéxí.", translation: "He studies every day.", uses_sense_index: 0, unknown_tokens: [], known_token_ratio: 0.9 },
    ],
    morpheme_note: null,
    contrast: null,
    review_target: {
      durable_candidate: true,
      retrieval_target: "学习 = study",
      why: "Common and useful.",
      note: "Targeting judgment only.",
    },
    self_audit: {
      no_empty_filler_fields: true,
      sense_selected_not_dumped: true,
      answer_not_leaked_into_target: true,
      examples_within_unknown_budget: true,
      omissions: ["morpheme_note: omitted"],
    },
  }
}

describe("enrichment store", () => {
  test("round-trips output and appends labels", () => {
    const db = new Database(":memory:")
    try {
      const doc = createReadingDoc(db, { title: "测试", text: "我喜欢学习。" })
      const mark = createReadingMark(db, { docId: doc.id, paragraphIdx: 0, start: 4, end: 6, surface: "学习", sentence: "我喜欢学习。", pinyin: "xuéxí", gloss: "to study" })
      ensureEnrichTables(db)
      const inserted = insertEnrichment(db, { queueItemId: mark.queueItem.id, model: "test", output: fixtureOutput(mark.queueItem.id), status: "ok", elapsedMs: 12 })
      expect(inserted.output?.item.word).toBe("学习")
      const label = addLabel(db, { enrichmentId: inserted.id, field: "sense_disambiguation", verdict: "edit", edited: "revised", note: "Sharper evidence" })
      expect(label.verdict).toBe("edit")
      const listed = listEnrichments(db, mark.queueItem.id)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.labels[0]?.edited).toBe("revised")
      expect(listed[0]?.output?.self_audit.omissions).toEqual(["morpheme_note: omitted"])
    } finally {
      db.close()
    }
  })

  test("fills the prompt input block without changing the worked examples", () => {
    const input: EnrichmentPromptInput = {
      queue_item: { id: 7, word: "学习", pinyin: "xuéxí", gloss: "to study" },
      cedict: { simplified: "学习", traditional: "學習", pinyin: "xuéxí", definitions: ["to study"] },
      decomposition: [{ char: "学", ids: "⿱⺍子", components: ["⺍", "子"] }],
      source: { doc_id: 2, doc_title: "短文", paragraph_idx: 0, paragraph_text: "我喜欢学习。", sentence: "我喜欢学习。", mark_id: 9 },
      known_words: ["喜欢"],
      seed_function_words: ["我", "的"],
      sibling_queue_items: [{ word: "学生", pinyin: "xuéshēng", gloss: "student" }],
    }
    const template = "# Queue\n### Input (filled per queue item)\n```json\n{\"queue_item\":{}}\n```\n## Worked example A\n```json\n{\"keep\":true}\n```"
    const prompt = buildEnrichmentPrompt(input, template)
    expect(prompt).toContain('"word": "学习"')
    expect(prompt).toContain('"sibling_queue_items"')
    expect(prompt).toContain('"keep":true')
  })

  test("fills prompt slots from a fixture ledger and CEDICT database", () => {
    const ledger = new Database(":memory:")
    const cedictPath = join(tmpdir(), `primer-enrich-fixture-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite`)
    const cedict = new Database(cedictPath)
    try {
      cedict.exec("CREATE TABLE cedict (simplified TEXT, traditional TEXT, pinyin TEXT, definitions TEXT); CREATE TABLE decomposition (char TEXT, ids TEXT, components TEXT); CREATE TABLE known_words (word TEXT)")
      cedict.query("INSERT INTO cedict VALUES (?, ?, ?, ?)").run("学习", "學習", "xuéxí", JSON.stringify(["to study"]))
      cedict.query("INSERT INTO decomposition VALUES (?, ?, ?)").run("学", "⿱⺍子", JSON.stringify(["⺍", "子"]))
      cedict.query("INSERT INTO known_words VALUES (?)").run("喜欢")
      const doc = createReadingDoc(ledger, { title: "短文", text: "我喜欢学习。" })
      const mark = createReadingMark(ledger, { docId: doc.id, paragraphIdx: 0, start: 4, end: 6, surface: "学习", sentence: "我喜欢学习。", pinyin: "xuéxí", gloss: "to study" })
      const input = buildEnrichmentPromptInput(ledger, { browserDb: "", twitterDb: "", readerDb: "", learningCardsDb: "", readerSite: "", ledgerDb: "", cedictDb: cedictPath, generationStore: "", shadowingDir: "" }, mark.queueItem.id)
      const template = "### Input (filled per queue item)\n```json\n{}\n```\nworked example"
      const prompt = buildEnrichmentPrompt(input, template)
      expect(prompt).toContain('"paragraph_text": "我喜欢学习。"')
      expect(prompt).toContain('"definitions": [\n      "to study"\n    ]')
      expect(prompt).toContain('"known_words": [\n    "喜欢"\n  ]')
    } finally {
      ledger.close()
      cedict.close()
    }
  })
})
