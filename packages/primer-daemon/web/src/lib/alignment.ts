/**
 * Alignment JSON helpers for the shadowing surface.
 * Parse alignment files, look up chars/sentences by playback time.
 */

// ---------------------------------------------------------------------------
// Types — match the v1 alignment contract
// ---------------------------------------------------------------------------

export interface AlignmentChar {
  ch: string
  pinyin: string
  startMs: number
  endMs: number
}

export interface AlignmentSentence {
  idx: number
  text: string
  pinyin: string
  startMs: number
  endMs: number
  charTiming?: string
  chars: AlignmentChar[]
}

export interface AlignmentMedia {
  file: string
  durationMs: number
  lang: string
  asr: string
}

export interface Alignment {
  version: number
  media: AlignmentMedia
  sentences: AlignmentSentence[]
}

// ---------------------------------------------------------------------------
// Parse + validate
// ---------------------------------------------------------------------------

/**
 * Parse and validate alignment JSON. Throws on invalid shape.
 * Accepts the raw parsed object (caller does JSON.parse).
 */
export function parseAlignment(raw: unknown): Alignment {
  if (typeof raw !== "object" || raw === null) throw new Error("Alignment must be an object")
  const obj = raw as Record<string, unknown>

  if (obj.version !== 1) throw new Error(`Unsupported alignment version: ${obj.version}`)
  if (typeof obj.media !== "object" || obj.media === null) throw new Error("Missing media field")
  if (!Array.isArray(obj.sentences)) throw new Error("Missing sentences array")

  const media = obj.media as Record<string, unknown>
  if (typeof media.durationMs !== "number") throw new Error("media.durationMs must be a number")

  const sentences: AlignmentSentence[] = []
  for (let i = 0; i < obj.sentences.length; i++) {
    const s = obj.sentences[i] as Record<string, unknown>
    if (typeof s.text !== "string") throw new Error(`sentences[${i}].text must be a string`)
    if (typeof s.startMs !== "number") throw new Error(`sentences[${i}].startMs must be a number`)
    if (typeof s.endMs !== "number") throw new Error(`sentences[${i}].endMs must be a number`)
    if (!Array.isArray(s.chars)) throw new Error(`sentences[${i}].chars must be an array`)

    const chars: AlignmentChar[] = []
    for (let j = 0; j < s.chars.length; j++) {
      const c = s.chars[j] as Record<string, unknown>
      if (typeof c.ch !== "string") throw new Error(`sentences[${i}].chars[${j}].ch must be string`)
      if (typeof c.startMs !== "number") throw new Error(`sentences[${i}].chars[${j}].startMs must be number`)
      if (typeof c.endMs !== "number") throw new Error(`sentences[${i}].chars[${j}].endMs must be number`)
      chars.push({
        ch: c.ch as string,
        pinyin: (c.pinyin as string) ?? "",
        startMs: c.startMs as number,
        endMs: c.endMs as number,
      })
    }

    sentences.push({
      idx: typeof s.idx === "number" ? (s.idx as number) : i,
      text: s.text as string,
      pinyin: (s.pinyin as string) ?? "",
      startMs: s.startMs as number,
      endMs: s.endMs as number,
      charTiming: typeof s.charTiming === "string" ? (s.charTiming as string) : undefined,
      chars,
    })
  }

  return {
    version: 1,
    media: {
      file: (media.file as string) ?? "",
      durationMs: media.durationMs as number,
      lang: (media.lang as string) ?? "zh",
      asr: (media.asr as string) ?? "unknown",
    },
    sentences,
  }
}

// ---------------------------------------------------------------------------
// Time-based lookups
// ---------------------------------------------------------------------------

/**
 * Find the char being spoken at `timeMs`. Returns the sentence index and
 * char index, or null when no char covers that time.
 */
export function charAtTime(
  sentences: ReadonlyArray<AlignmentSentence>,
  timeMs: number,
): { sentenceIdx: number; charIdx: number } | null {
  for (let si = 0; si < sentences.length; si++) {
    const s = sentences[si]
    if (timeMs < s.startMs || timeMs > s.endMs) continue
    for (let ci = 0; ci < s.chars.length; ci++) {
      const c = s.chars[ci]
      if (timeMs >= c.startMs && timeMs < c.endMs) {
        return { sentenceIdx: si, charIdx: ci }
      }
    }
    // Within sentence span but between chars (gap) — match closest
    if (s.chars.length > 0) {
      // Find the last char whose startMs <= timeMs
      for (let ci = s.chars.length - 1; ci >= 0; ci--) {
        if (s.chars[ci].startMs <= timeMs) {
          return { sentenceIdx: si, charIdx: ci }
        }
      }
      return { sentenceIdx: si, charIdx: 0 }
    }
  }
  return null
}

/**
 * Find which sentence covers `timeMs`. Returns the sentence index or null.
 */
export function sentenceAtTime(
  sentences: ReadonlyArray<AlignmentSentence>,
  timeMs: number,
): number | null {
  for (let i = 0; i < sentences.length; i++) {
    if (timeMs >= sentences[i].startMs && timeMs <= sentences[i].endMs) return i
  }
  return null
}

// ---------------------------------------------------------------------------
// Pinyin tone detection (diacritic-based)
// ---------------------------------------------------------------------------

/**
 * Detect tone number from diacritic pinyin (e.g. "nǐ" → 3).
 * Returns 1–4 for toned syllables, 5 for neutral/no diacritic.
 */
export function detectTone(pinyin: string): number {
  const nfd = pinyin.normalize("NFD")
  for (const ch of nfd) {
    switch (ch) {
      case "\u0304": return 1 // macron
      case "\u0301": return 2 // acute
      case "\u030C": return 3 // caron
      case "\u0300": return 4 // grave
    }
  }
  return 5
}
