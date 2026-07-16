import { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"

import {
  buildHanlyZhPrompt,
  ensureHanlyZhTable,
  insertHanlyZh,
  listHanlyZh,
  parseHanlyZhOutput,
} from "../src/hanly-zh"

describe("Hanly zh pilot", () => {
  test("round-trips a generated row and JSON components", () => {
    const db = new Database(":memory:")
    try {
      ensureHanlyZhTable(db)
      const inserted = insertHanlyZh(db, {
        char: "明",
        sourceSummary: "Hanly 分解：日、月\nHanly 英文字源资料：sun and moon make bright",
        zhExplanation: "太阳和月亮都很亮",
        components: [{ 部件: "日", 意思: "太阳" }, { 部件: "月", 意思: "月亮" }],
        model: "test-model",
        status: "ok",
      })
      expect(inserted.char).toBe("明")
      expect(inserted.components).toEqual([{ 部件: "日", 意思: "太阳" }, { 部件: "月", 意思: "月亮" }])
      expect(listHanlyZh(db, 10)).toHaveLength(1)
      expect(listHanlyZh(db, 10)[0]?.sourceSummary).toContain("Hanly 英文字源资料")
    } finally {
      db.close()
    }
  })

  test("builds a zh-only constrained prompt from Hanly fields", () => {
    const prompt = buildHanlyZhPrompt({
      char: "明",
      decomposition: ["日", "月"],
      primitives: [{ char: "日", meaning: "太阳", phonetic: "" }, { char: "月", meaning: "月亮", phonetic: "" }],
      etymology: "The sun and moon together suggest brightness.",
    })
    expect(prompt).toContain("HSK 1-3")
    expect(prompt).toContain("只能来自下面的 Hanly 输入资料")
    expect(prompt).toContain("The sun and moon together suggest brightness.")
    expect(prompt).toContain('"字源一句话"')
    expect(prompt).toContain("联想：")
  })

  test("rejects output that is not marked as a mnemonic or contains English", () => {
    expect(() =>
      parseHanlyZhOutput(
        JSON.stringify({ char: "明", 部件: [], 字源一句话: "太阳很亮", 记忆提示: "记住太阳", 信心: "中" }),
        "明",
      ),
    ).toThrow("联想")
    expect(() =>
      parseHanlyZhOutput(
        JSON.stringify({ char: "明", 部件: [], 字源一句话: "sun很亮", 记忆提示: "联想：太阳", 信心: "中" }),
        "明",
      ),
    ).toThrow("Latin")
  })
})
