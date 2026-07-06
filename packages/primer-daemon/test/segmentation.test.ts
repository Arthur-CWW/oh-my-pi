import { describe, expect, test } from "bun:test"
import { classifyWord, extractSentence, isHan, parsePinyin, segmentText } from "../web/src/lib/segmentation"

// ---------------------------------------------------------------------------
// isHan
// ---------------------------------------------------------------------------

describe("isHan", () => {
  test("returns true for CJK ideographs", () => {
    expect(isHan("你")).toBe(true)
    expect(isHan("道")).toBe(true)
    expect(isHan("hello你好")).toBe(true)
  })

  test("returns false for non-CJK text", () => {
    expect(isHan("hello")).toBe(false)
    expect(isHan("123")).toBe(false)
    expect(isHan("")).toBe(false)
    expect(isHan("。！？")).toBe(false)
  })

  test("handles CJK Extension B", () => {
    // Extension B characters (U+20000+) are outside our basic range — that's fine,
    // HSK vocabulary doesn't use them. Just verify no crash.
    expect(isHan("𠀀")).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// segmentText
// ---------------------------------------------------------------------------

describe("segmentText", () => {
  test("segments a basic Chinese sentence", () => {
    const segs = segmentText("我是中国人")
    // Intl.Segmenter should split this into words
    expect(segs.length).toBeGreaterThan(0)
    // Concatenation of all segments should equal original
    expect(segs.map((s) => s.text).join("")).toBe("我是中国人")
  })

  test("segments mixed Chinese and punctuation", () => {
    const segs = segmentText("你好，世界！")
    const joined = segs.map((s) => s.text).join("")
    expect(joined).toBe("你好，世界！")
    // Punctuation segments should not be word-like
    const comma = segs.find((s) => s.text === "，")
    if (comma) expect(comma.isWordLike).toBe(false)
  })

  test("offsets are correct", () => {
    const text = "我是学生"
    const segs = segmentText(text)
    for (const seg of segs) {
      expect(text.slice(seg.offset, seg.offset + seg.text.length)).toBe(seg.text)
    }
  })

  test("handles empty string", () => {
    expect(segmentText("")).toEqual([])
  })

  test("handles pure ASCII", () => {
    const segs = segmentText("hello world")
    expect(segs.map((s) => s.text).join("")).toBe("hello world")
  })

  test("handles CJK punctuation correctly", () => {
    const segs = segmentText("道可道，非常道。名可名，非常名。")
    const joined = segs.map((s) => s.text).join("")
    expect(joined).toBe("道可道，非常道。名可名，非常名。")
    // Full-stop and comma should exist as segments
    const periods = segs.filter((s) => s.text === "。")
    expect(periods.length).toBe(2)
  })

  test("handles mixed Western and Chinese punctuation", () => {
    const segs = segmentText("这是test!好的?OK。")
    expect(segs.map((s) => s.text).join("")).toBe("这是test!好的?OK。")
  })
})

// ---------------------------------------------------------------------------
// classifyWord
// ---------------------------------------------------------------------------

describe("classifyWord", () => {
  const known = new Set(["我", "是", "的", "一", "不"])
  const queued = new Set(["道"])
  const marked = new Set(["玄"])

  test("known words classify as known", () => {
    expect(classifyWord("我", known, queued, marked)).toBe("known")
    expect(classifyWord("是", known, queued, marked)).toBe("known")
  })

  test("unknown Han words classify as unknown", () => {
    expect(classifyWord("龙", known, queued, marked)).toBe("unknown")
  })

  test("queued words classify as queued", () => {
    expect(classifyWord("道", known, queued, marked)).toBe("queued")
  })

  test("marked words classify as marked", () => {
    expect(classifyWord("玄", known, queued, marked)).toBe("marked")
  })

  test("non-Han text always classifies as known", () => {
    expect(classifyWord("hello", known, queued, marked)).toBe("known")
    expect(classifyWord("123", known, queued, marked)).toBe("known")
    expect(classifyWord("，", known, queued, marked)).toBe("known")
    expect(classifyWord("。", known, queued, marked)).toBe("known")
  })

  test("marked takes priority over queued and known", () => {
    const k = new Set(["玄"])
    const q = new Set(["玄"])
    const m = new Set(["玄"])
    expect(classifyWord("玄", k, q, m)).toBe("marked")
  })

  test("queued takes priority over known", () => {
    const k = new Set(["道"])
    const q = new Set(["道"])
    expect(classifyWord("道", k, q, new Set())).toBe("queued")
  })
})

// ---------------------------------------------------------------------------
// extractSentence
// ---------------------------------------------------------------------------

describe("extractSentence", () => {
  test("extracts sentence containing the word", () => {
    const para = "道可道，非常道。名可名，非常名。"
    // "道" at index 0 should be in the first sentence
    expect(extractSentence(para, 0, 1)).toBe("道可道，非常道。")
    // "名" at index 9 should be in the second sentence
    expect(extractSentence(para, 9, 10)).toBe("名可名，非常名。")
  })

  test("handles ！as sentence boundary", () => {
    const para = "你好！我是学生。"
    expect(extractSentence(para, 0, 2)).toBe("你好！")
    expect(extractSentence(para, 3, 5)).toBe("我是学生。")
  })

  test("handles ？as sentence boundary", () => {
    const para = "你是谁？我是他。"
    expect(extractSentence(para, 0, 1)).toBe("你是谁？")
    expect(extractSentence(para, 4, 5)).toBe("我是他。")
  })

  test("handles Western ? and ! as boundaries", () => {
    const para = "Really?是的!好。"
    expect(extractSentence(para, 0, 6)).toBe("Really?")
    expect(extractSentence(para, 7, 9)).toBe("是的!")
  })

  test("handles ；as sentence boundary", () => {
    const para = "上善若水；水善利万物。"
    expect(extractSentence(para, 0, 2)).toBe("上善若水；")
    expect(extractSentence(para, 5, 6)).toBe("水善利万物。")
  })

  test("falls back to whole paragraph when no boundaries", () => {
    const para = "道可道非常道"
    expect(extractSentence(para, 0, 1)).toBe("道可道非常道")
  })

  test("handles empty paragraph", () => {
    expect(extractSentence("", 0, 0)).toBe("")
  })

  test("handles single-sentence paragraph with trailing period", () => {
    const para = "天地不仁。"
    expect(extractSentence(para, 0, 2)).toBe("天地不仁。")
  })

  test("handles consecutive punctuation", () => {
    const para = "真的吗？！当然！"
    // Word at index 0 ("真的吗？") — split on ？
    const s = extractSentence(para, 0, 1)
    // Should get something containing 真 as a sentence
    expect(s).toContain("真")
  })
})

// ---------------------------------------------------------------------------
// parsePinyin
// ---------------------------------------------------------------------------

describe("parsePinyin", () => {
  test("parses numbered pinyin", () => {
    const result = parsePinyin("ni3 hao3")
    expect(result).toEqual([
      { text: "ni", tone: 3 },
      { text: "hao", tone: 3 },
    ])
  })

  test("handles tone 5 (neutral)", () => {
    const result = parsePinyin("ma5")
    expect(result).toEqual([{ text: "ma", tone: 5 }])
  })

  test("handles missing tone number as neutral", () => {
    const result = parsePinyin("de")
    expect(result).toEqual([{ text: "de", tone: 5 }])
  })

  test("handles all four tones", () => {
    const result = parsePinyin("ma1 ma2 ma3 ma4")
    expect(result.map((s) => s.tone)).toEqual([1, 2, 3, 4])
  })

  test("handles empty string", () => {
    expect(parsePinyin("")).toEqual([])
  })

  test("handles CEDICT u: notation", () => {
    const result = parsePinyin("lu:4")
    expect(result).toEqual([{ text: "lu:", tone: 4 }])
  })

  test("handles concatenated pinyin", () => {
    const result = parsePinyin("zhong1guo2")
    expect(result).toEqual([
      { text: "zhong", tone: 1 },
      { text: "guo", tone: 2 },
    ])
  })
})
