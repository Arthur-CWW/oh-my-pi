import { describe, expect, test } from "bun:test"
import { charAtTime, detectTone, parseAlignment, sentenceAtTime } from "../web/src/lib/alignment"

// ---------------------------------------------------------------------------
// Fixture — two-sentence alignment
// ---------------------------------------------------------------------------

const FIXTURE = {
  version: 1,
  media: { file: "test.mp3", durationMs: 3000, lang: "zh", asr: "test" },
  sentences: [
    {
      idx: 0,
      text: "你好",
      pinyin: "nǐ hǎo",
      startMs: 0,
      endMs: 1000,
      charTiming: "interpolated",
      chars: [
        { ch: "你", pinyin: "nǐ", startMs: 0, endMs: 500 },
        { ch: "好", pinyin: "hǎo", startMs: 500, endMs: 1000 },
      ],
    },
    {
      idx: 1,
      text: "世界",
      pinyin: "shìjiè",
      startMs: 1200,
      endMs: 2200,
      chars: [
        { ch: "世", pinyin: "shì", startMs: 1200, endMs: 1700 },
        { ch: "界", pinyin: "jiè", startMs: 1700, endMs: 2200 },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// parseAlignment
// ---------------------------------------------------------------------------

describe("parseAlignment", () => {
  test("parses valid alignment", () => {
    const result = parseAlignment(FIXTURE)
    expect(result.version).toBe(1)
    expect(result.media.durationMs).toBe(3000)
    expect(result.sentences).toHaveLength(2)
    expect(result.sentences[0].chars).toHaveLength(2)
    expect(result.sentences[0].chars[0].ch).toBe("你")
    expect(result.sentences[0].charTiming).toBe("interpolated")
    expect(result.sentences[1].charTiming).toBeUndefined()
  })

  test("rejects non-object", () => {
    expect(() => parseAlignment("string")).toThrow("must be an object")
    expect(() => parseAlignment(null)).toThrow("must be an object")
    expect(() => parseAlignment(42)).toThrow("must be an object")
  })

  test("rejects wrong version", () => {
    expect(() => parseAlignment({ ...FIXTURE, version: 2 })).toThrow("Unsupported alignment version")
  })

  test("rejects missing media", () => {
    expect(() => parseAlignment({ version: 1, sentences: [] })).toThrow("Missing media")
  })

  test("rejects missing sentences", () => {
    expect(() => parseAlignment({ version: 1, media: { durationMs: 100 } })).toThrow("Missing sentences")
  })

  test("rejects sentence without text", () => {
    expect(() =>
      parseAlignment({
        version: 1,
        media: { durationMs: 100 },
        sentences: [{ startMs: 0, endMs: 100, chars: [] }],
      }),
    ).toThrow("text must be a string")
  })

  test("rejects char without startMs", () => {
    expect(() =>
      parseAlignment({
        version: 1,
        media: { durationMs: 100 },
        sentences: [{ text: "a", startMs: 0, endMs: 100, chars: [{ ch: "a", endMs: 50 }] }],
      }),
    ).toThrow("startMs must be number")
  })

  test("parses empty sentences array", () => {
    const result = parseAlignment({
      version: 1,
      media: { file: "x.mp3", durationMs: 0, lang: "zh", asr: "test" },
      sentences: [],
    })
    expect(result.sentences).toHaveLength(0)
  })

  test("defaults idx from array position when missing", () => {
    const result = parseAlignment({
      version: 1,
      media: { file: "x.mp3", durationMs: 1000, lang: "zh", asr: "test" },
      sentences: [
        { text: "一", pinyin: "yī", startMs: 0, endMs: 500, chars: [{ ch: "一", pinyin: "yī", startMs: 0, endMs: 500 }] },
      ],
    })
    expect(result.sentences[0].idx).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// charAtTime
// ---------------------------------------------------------------------------

describe("charAtTime", () => {
  const parsed = parseAlignment(FIXTURE)

  test("finds char at exact start", () => {
    const result = charAtTime(parsed.sentences, 0)
    expect(result).toEqual({ sentenceIdx: 0, charIdx: 0 })
  })

  test("finds char in middle of range", () => {
    const result = charAtTime(parsed.sentences, 250)
    expect(result).toEqual({ sentenceIdx: 0, charIdx: 0 })
  })

  test("finds second char", () => {
    const result = charAtTime(parsed.sentences, 500)
    expect(result).toEqual({ sentenceIdx: 0, charIdx: 1 })
  })

  test("finds char in second sentence", () => {
    const result = charAtTime(parsed.sentences, 1500)
    expect(result).toEqual({ sentenceIdx: 1, charIdx: 0 })
  })

  test("finds last char at boundary", () => {
    const result = charAtTime(parsed.sentences, 1700)
    expect(result).toEqual({ sentenceIdx: 1, charIdx: 1 })
  })

  test("returns null for gap between sentences", () => {
    const result = charAtTime(parsed.sentences, 1100)
    expect(result).toBeNull()
  })

  test("returns null before first sentence", () => {
    const shifted = parseAlignment({
      ...FIXTURE,
      sentences: [{ ...FIXTURE.sentences[0], startMs: 500, endMs: 1500, chars: [{ ch: "A", pinyin: "a", startMs: 500, endMs: 1500 }] }],
    })
    expect(charAtTime(shifted.sentences, 200)).toBeNull()
  })

  test("returns null after last sentence", () => {
    expect(charAtTime(parsed.sentences, 2500)).toBeNull()
  })

  test("handles empty sentences array", () => {
    expect(charAtTime([], 100)).toBeNull()
  })

  test("handles sentence with empty chars array", () => {
    const emptySentence = parseAlignment({
      version: 1,
      media: { file: "x.mp3", durationMs: 1000, lang: "zh", asr: "test" },
      sentences: [{ text: "。", pinyin: "", startMs: 0, endMs: 500, chars: [] }],
    })
    expect(charAtTime(emptySentence.sentences, 250)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// sentenceAtTime
// ---------------------------------------------------------------------------

describe("sentenceAtTime", () => {
  const parsed = parseAlignment(FIXTURE)

  test("finds first sentence", () => {
    expect(sentenceAtTime(parsed.sentences, 0)).toBe(0)
    expect(sentenceAtTime(parsed.sentences, 500)).toBe(0)
    expect(sentenceAtTime(parsed.sentences, 1000)).toBe(0)
  })

  test("finds second sentence", () => {
    expect(sentenceAtTime(parsed.sentences, 1200)).toBe(1)
    expect(sentenceAtTime(parsed.sentences, 1800)).toBe(1)
    expect(sentenceAtTime(parsed.sentences, 2200)).toBe(1)
  })

  test("returns null in gap", () => {
    expect(sentenceAtTime(parsed.sentences, 1100)).toBeNull()
  })

  test("returns null before first", () => {
    const shifted = parseAlignment({
      ...FIXTURE,
      sentences: [{ ...FIXTURE.sentences[0], startMs: 500, endMs: 1000, chars: [] }],
    })
    expect(sentenceAtTime(shifted.sentences, 100)).toBeNull()
  })

  test("returns null after last", () => {
    expect(sentenceAtTime(parsed.sentences, 3000)).toBeNull()
  })

  test("handles empty array", () => {
    expect(sentenceAtTime([], 100)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// detectTone
// ---------------------------------------------------------------------------

describe("detectTone", () => {
  test("detects tone 1 (macron)", () => {
    expect(detectTone("jīn")).toBe(1)
    expect(detectTone("tiān")).toBe(1)
    expect(detectTone("chāo")).toBe(1)
    expect(detectTone("dōng")).toBe(1)
  })

  test("detects tone 2 (acute)", () => {
    expect(detectTone("tián")).toBe(2)
    expect(detectTone("guó")).toBe(2)
  })

  test("detects tone 3 (caron)", () => {
    expect(detectTone("nǐ")).toBe(3)
    expect(detectTone("hǎo")).toBe(3)
    expect(detectTone("xiǎng")).toBe(3)
    expect(detectTone("mǎi")).toBe(3)
  })

  test("detects tone 4 (grave)", () => {
    expect(detectTone("qù")).toBe(4)
    expect(detectTone("shì")).toBe(4)
    expect(detectTone("jiè")).toBe(4)
  })

  test("returns 5 for neutral/no diacritic", () => {
    expect(detectTone("de")).toBe(5)
    expect(detectTone("le")).toBe(5)
    expect(detectTone("ma")).toBe(5)
  })

  test("returns 5 for empty string", () => {
    expect(detectTone("")).toBe(5)
  })

  test("handles single vowel with tone", () => {
    expect(detectTone("ā")).toBe(1)
    expect(detectTone("é")).toBe(2)
    expect(detectTone("ǐ")).toBe(3)
    expect(detectTone("ò")).toBe(4)
  })
})
