/**
 * Chinese text segmentation, sentence extraction, and word classification.
 * All helpers are pure and synchronous — no network, no side effects.
 */

// ---------------------------------------------------------------------------
// Han-script detection
// ---------------------------------------------------------------------------

const HAN_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/

/** True when `text` contains at least one CJK Unified Ideograph. */
export function isHan(text: string): boolean {
  return HAN_RE.test(text)
}

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

export interface Segment {
  /** The surface text of this segment. */
  text: string
  /** UTF-16 code-unit offset within the source string. */
  offset: number
  /** Whether the segmenter considers this a word-like unit. */
  isWordLike: boolean
}

let _segmenter: Intl.Segmenter | null = null
function segmenter(): Intl.Segmenter {
  return (_segmenter ??= new Intl.Segmenter("zh", { granularity: "word" }))
}

/** Segment a Chinese string into word-like and non-word units. */
export function segmentText(text: string): Segment[] {
  const out: Segment[] = []
  for (const s of segmenter().segment(text)) {
    out.push({ text: s.segment, offset: s.index, isWordLike: s.isWordLike ?? false })
  }
  return out
}

// ---------------------------------------------------------------------------
// Known-word classification
// ---------------------------------------------------------------------------

export type WordClass = "known" | "unknown" | "queued" | "marked"

/**
 * Classify a Han-script segment against the known-word set and pending queue.
 * Non-Han segments always return "known" (they don't need visual treatment).
 */
export function classifyWord(
  surface: string,
  knownWords: ReadonlySet<string>,
  queuedWords: ReadonlySet<string>,
  markedSurfaces: ReadonlySet<string>,
): WordClass {
  if (!isHan(surface)) return "known"
  if (markedSurfaces.has(surface)) return "marked"
  if (queuedWords.has(surface)) return "queued"
  if (knownWords.has(surface)) return "known"
  return "unknown"
}

// ---------------------------------------------------------------------------
// Sentence extraction
// ---------------------------------------------------------------------------

/**
 * Chinese sentence-ending punctuation plus common Western equivalents.
 * The regex matches any of: 。！？；?!; and splits greedily (the delimiter
 * is kept at the end of each sentence).
 */
const SENTENCE_END = /(?<=[。！？；?!;])/

/**
 * Extract the containing sentence for a word at `[start, end)` within
 * `paragraph`. Falls back to the whole paragraph when no sentence boundary
 * is found.
 */
export function extractSentence(paragraph: string, start: number, end: number): string {
  const sentences = paragraph.split(SENTENCE_END).filter((s) => s.length > 0)
  if (sentences.length <= 1) return paragraph

  let offset = 0
  for (const sentence of sentences) {
    const sentenceEnd = offset + sentence.length
    // The word's start falls within this sentence
    if (start >= offset && start < sentenceEnd) {
      return sentence.trim()
    }
    offset = sentenceEnd
  }
  // Shouldn't happen, but fallback to paragraph
  return paragraph
}

// ---------------------------------------------------------------------------
// Pinyin tone parsing & coloring
// ---------------------------------------------------------------------------

export interface PinyinSyllable {
  text: string
  tone: number // 1-5, 5 = neutral
}

/**
 * Parse a numbered-pinyin string like "ni3 hao3" into syllables with tone
 * numbers. Handles space-separated and concatenated forms.
 */
export function parsePinyin(raw: string): PinyinSyllable[] {
  if (!raw) return []
  // Match sequences of letters optionally followed by a tone digit (1-5),
  // plus the ü character which CEDICT spells as u:
  const syllableRe = /([a-zA-ZüÜ:]+)([1-5])?/g
  const result: PinyinSyllable[] = []
  let m: RegExpExecArray | null
  while ((m = syllableRe.exec(raw)) !== null) {
    result.push({ text: m[1], tone: m[2] ? Number(m[2]) : 5 })
  }
  return result
}

/** CSS class for a pinyin tone — designed for dark-mode legibility. */
export function toneColor(tone: number): string {
  switch (tone) {
    case 1: return "text-red-400"
    case 2: return "text-emerald-400"
    case 3: return "text-sky-400"
    case 4: return "text-violet-400"
    default: return "text-muted-foreground"
  }
}
