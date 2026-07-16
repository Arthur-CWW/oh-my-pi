import { readFileSync } from "node:fs"
import { Schema } from "effect"

const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const NonEmptyString = Schema.String.check(Schema.isMinLength(1))
const CJK_RE =
  /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u{20000}-\u{2a6df}\u{2f800}-\u{2fa1f}]/u

const PhoneBlockSchema = Schema.Struct({
  p: NonEmptyString,
  startMs: NonNegativeInteger,
  endMs: NonNegativeInteger,
})

const CharBlockSchema = Schema.Struct({
  ch: NonEmptyString,
  pinyin: NonEmptyString,
  startMs: NonNegativeInteger,
  endMs: NonNegativeInteger,
  phones: Schema.optionalKey(Schema.NullOr(Schema.Array(PhoneBlockSchema))),
})

const SentenceBlockSchema = Schema.Struct({
  idx: NonNegativeInteger,
  text: NonEmptyString,
  pinyin: NonEmptyString,
  startMs: NonNegativeInteger,
  endMs: NonNegativeInteger,
  chars: Schema.Array(CharBlockSchema),
  charTiming: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.Literal("native"), Schema.Literal("interpolated")]))),
})

const MediaBlockSchema = Schema.Struct({
  file: NonEmptyString,
  durationMs: PositiveInteger,
  lang: Schema.Literal("zh"),
  asr: NonEmptyString,
  kind: Schema.optionalKey(Schema.Union([Schema.Literal("audio"), Schema.Literal("video")])),
})

export const AlignmentSchema = Schema.Struct({
  version: Schema.Literal(1),
  media: MediaBlockSchema,
  sentences: Schema.Array(SentenceBlockSchema),
})

export type Alignment = Schema.Schema.Type<typeof AlignmentSchema>

const CONTRACT_ERROR = "alignment JSON does not match shadowing contract"

export class AlignmentReadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AlignmentReadError"
  }
}

export function parseAlignment(input: unknown): Alignment {
  try {
    const alignment = Schema.decodeUnknownSync(AlignmentSchema)(input)
    validateAlignmentContract(alignment)
    return alignment
  } catch {
    throw new AlignmentReadError(CONTRACT_ERROR)
  }
}

export function readAlignment(path: string): Alignment {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"))
  } catch {
    throw new AlignmentReadError("malformed alignment JSON")
  }
  return parseAlignment(parsed)
}

function validateAlignmentContract(alignment: Alignment): void {
  for (const [expectedIdx, sentence] of alignment.sentences.entries()) {
    if (sentence.idx !== expectedIdx) throw new AlignmentReadError(CONTRACT_ERROR)
    if (sentence.endMs < sentence.startMs) throw new AlignmentReadError(CONTRACT_ERROR)

    const expectedChars = cjkChars(sentence.text)
    if (sentence.chars.length !== expectedChars.length) throw new AlignmentReadError(CONTRACT_ERROR)

    let previousStart = sentence.startMs
    let previousEnd = sentence.startMs
    for (const [charIdx, char] of sentence.chars.entries()) {
      if (char.ch !== expectedChars[charIdx]) throw new AlignmentReadError(CONTRACT_ERROR)
      if (char.endMs < char.startMs) throw new AlignmentReadError(CONTRACT_ERROR)
      if (char.startMs < sentence.startMs || char.endMs > sentence.endMs) throw new AlignmentReadError(CONTRACT_ERROR)
      if (char.startMs < previousStart || char.endMs < previousEnd) throw new AlignmentReadError(CONTRACT_ERROR)
      previousStart = char.startMs
      previousEnd = char.endMs
      for (const phone of char.phones ?? []) {
        if (phone.endMs < phone.startMs) throw new AlignmentReadError(CONTRACT_ERROR)
      }
    }
  }
}

function cjkChars(text: string): string[] {
  const chars: string[] = []
  for (const char of text) {
    if (CJK_RE.test(char)) chars.push(char)
  }
  return chars
}
