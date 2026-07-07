import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Database } from "bun:sqlite"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(SCRIPT_DIR, "..")
const REPO_ROOT = resolve(PACKAGE_DIR, "..", "..")
const DEFAULT_CEDICT_DB = resolve(REPO_ROOT, "data/primer/cedict.sqlite")
const REPORT_FILE = "audit-report.json"
const HSK_FILE_PATTERN = /^hsk5-.*\.json$/u
const HAN_RUN_PATTERN = /\p{Script=Han}+/gu
const HAN_CHAR_PATTERN = /\p{Script=Han}/u
const ANSWER_STOP_PATTERN = /[。；;.!！?？\n]/u

interface HskEntry {
  word: string
  pinyin: string
  gloss: string
  skipReason?: string
  cards?: HskCard[]
}

interface HskCard {
  type?: string
  front?: string
  back?: string
  retrievalTarget?: string
  tier?: string
}

interface KnownWordRow {
  word: string
}

interface UnknownOccurrence {
  text: string
  source: "front" | "back"
  hanRun: string
  start: number
  end: number
  glossed: boolean
  context: string
}

interface CardAudit {
  file: string
  word: string
  pinyin: string
  gloss: string
  cardIndex: number
  type: string | null
  front: string
  back: string
  retrievalTarget: string | null
  tier: string | null
  passed: boolean
  unknownCount: number
  unknowns: UnknownOccurrence[]
  frontAnswerLeak: FrontAnswerLeak | null
  issues: string[]
}

interface FrontAnswerLeak {
  answer: string
  mode: "fullBack" | "leadingAnswer"
}

interface AuditReport {
  generatedAt: string
  inputDir: string
  cedictDb: string
  knownWordCount: number
  totals: {
    files: number
    entries: number
    cards: number
    passed: number
    failed: number
    passRate: number
  }
  histograms: {
    unknownsPerCard: Record<string, number>
    issues: Record<string, number>
  }
  worstOffenders: WorstOffender[]
  cards: CardAudit[]
}

interface WorstOffender {
  file: string
  word: string
  cardIndex: number
  unknownCount: number
  issues: string[]
  why: string
}

interface CliResult {
  report: AuditReport
  reportPath: string
}

const segmenter = new Intl.Segmenter("zh", { granularity: "word" })

export async function auditHskCards(inputDir: string, cedictDb = DEFAULT_CEDICT_DB): Promise<CliResult> {
  const resolvedInputDir = resolve(inputDir)
  if (!existsSync(resolvedInputDir)) throw new Error(`Input directory does not exist: ${resolvedInputDir}`)
  if (!existsSync(cedictDb)) throw new Error(`CEDICT database does not exist: ${cedictDb}`)

  const knownWords = loadKnownWords(cedictDb)
  const files = readdirSync(resolvedInputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && HSK_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))

  const cards: CardAudit[] = []
  let entryCount = 0
  for (const file of files) {
    const parsed = parseHskFile(resolve(resolvedInputDir, file))
    entryCount += parsed.length
    for (const entry of parsed) {
      const entryCards = Array.isArray(entry.cards) ? entry.cards : []
      for (let index = 0; index < entryCards.length; index += 1) {
        cards.push(auditCard(file, entry, entryCards[index], index, knownWords))
      }
    }
  }

  const failed = cards.filter((card) => !card.passed).length
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    inputDir: resolvedInputDir,
    cedictDb,
    knownWordCount: knownWords.size,
    totals: {
      files: files.length,
      entries: entryCount,
      cards: cards.length,
      passed: cards.length - failed,
      failed,
      passRate: cards.length === 0 ? 1 : (cards.length - failed) / cards.length,
    },
    histograms: {
      unknownsPerCard: histogram(cards.map((card) => String(card.unknownCount))),
      issues: issueHistogram(cards),
    },
    worstOffenders: worstOffenders(cards),
    cards,
  }

  const reportPath = resolve(resolvedInputDir, REPORT_FILE)
  await Bun.write(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return { report, reportPath }
}

function loadKnownWords(cedictDb: string): Set<string> {
  const db = new Database(cedictDb, { readonly: true })
  try {
    const rows = db.query<KnownWordRow, []>("SELECT word FROM known_words").all()
    return new Set(rows.map((row) => row.word).filter((word) => containsHan(word)))
  } finally {
    db.close()
  }
}

function parseHskFile(path: string): HskEntry[] {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`${path}: entry ${index} is not an object`)
    const word = stringValue(entry.word)
    const pinyin = stringValue(entry.pinyin)
    const gloss = stringValue(entry.gloss)
    if (word === null || pinyin === null || gloss === null) throw new Error(`${path}: entry ${index} is missing word/pinyin/gloss`)
    const cards = Array.isArray(entry.cards) ? entry.cards.map(normalizeCard) : []
    return { word, pinyin, gloss, skipReason: stringValue(entry.skipReason) ?? undefined, cards }
  })
}

function normalizeCard(value: unknown): HskCard {
  if (!isRecord(value)) return {}
  return {
    type: stringValue(value.type) ?? undefined,
    front: stringValue(value.front) ?? undefined,
    back: stringValue(value.back) ?? undefined,
    retrievalTarget: stringValue(value.retrievalTarget) ?? undefined,
    tier: stringValue(value.tier) ?? undefined,
  }
}

function auditCard(file: string, entry: HskEntry, card: HskCard, cardIndex: number, knownWords: Set<string>): CardAudit {
  const front = stringValue(card.front) ?? ""
  const back = stringValue(card.back) ?? ""
  const unknowns = [...findUnknowns(front, "front", entry.word, knownWords), ...findUnknowns(back, "back", entry.word, knownWords)]
  const frontAnswerLeak = findFrontAnswerLeak(front, back)
  const issues: string[] = []

  if (unknowns.length > 1) issues.push(`unknowns>${1}: ${unknowns.map((unknown) => unknown.text).join(", ")}`)
  if (unknowns.length === 1 && !unknowns[0].glossed) issues.push(`one unglossed unknown: ${unknowns[0].text}`)
  if (frontAnswerLeak !== null) issues.push(`front contains ${frontAnswerLeak.mode === "fullBack" ? "full back" : "leading back answer"}: ${frontAnswerLeak.answer}`)

  return {
    file,
    word: entry.word,
    pinyin: entry.pinyin,
    gloss: entry.gloss,
    cardIndex,
    type: stringValue(card.type),
    front,
    back,
    retrievalTarget: stringValue(card.retrievalTarget),
    tier: stringValue(card.tier),
    passed: issues.length === 0,
    unknownCount: unknowns.length,
    unknowns,
    frontAnswerLeak,
    issues,
  }
}

function findUnknowns(text: string, source: "front" | "back", targetWord: string, knownWords: Set<string>): UnknownOccurrence[] {
  const targetPieces = targetHanPieces(targetWord)
  const unknowns: UnknownOccurrence[] = []
  for (const run of hanRuns(text)) {
    for (const segment of segmenter.segment(run.text)) {
      const segmentText = segment.segment
      if (!containsHan(segmentText)) continue
      const absoluteStart = run.start + segment.index
      for (const piece of unknownPieces(segmentText, targetPieces, knownWords)) {
        const start = absoluteStart + piece.start
        const end = absoluteStart + piece.end
        unknowns.push({
          text: piece.text,
          source,
          hanRun: run.text,
          start,
          end,
          glossed: hasAdjacentGloss(text, start, end),
          context: contextFor(text, start, end),
        })
      }
    }
  }
  return unknowns
}

function unknownPieces(segment: string, targetPieces: Set<string>, knownWords: Set<string>): Array<{ text: string; start: number; end: number }> {
  if (isKnownOrTarget(segment, targetPieces, knownWords)) return []

  const unknowns: Array<{ text: string; start: number; end: number }> = []
  let offset = 0
  while (offset < segment.length) {
    const match = longestKnownOrTargetPrefix(segment, offset, targetPieces, knownWords)
    if (match > 0) {
      offset += match
      continue
    }

    const start = offset
    offset += charLengthAt(segment, offset)
    while (offset < segment.length && longestKnownOrTargetPrefix(segment, offset, targetPieces, knownWords) === 0) {
      offset += charLengthAt(segment, offset)
    }
    const text = segment.slice(start, offset)
    if (containsHan(text)) unknowns.push({ text, start, end: offset })
  }
  return unknowns
}

function longestKnownOrTargetPrefix(segment: string, offset: number, targetPieces: Set<string>, knownWords: Set<string>): number {
  for (let end = segment.length; end > offset; end -= 1) {
    if (isLowSurrogateAt(segment, end)) continue
    const candidate = segment.slice(offset, end)
    if (isKnownOrTarget(candidate, targetPieces, knownWords)) return end - offset
  }
  return 0
}

function isKnownOrTarget(text: string, targetPieces: Set<string>, knownWords: Set<string>): boolean {
  return knownWords.has(text) || targetPieces.has(text) || isComposedOnlyOfTargetChars(text, targetPieces)
}

function targetHanPieces(targetWord: string): Set<string> {
  const pieces = new Set<string>()
  for (const run of hanRuns(targetWord)) {
    pieces.add(run.text)
    for (const char of Array.from(run.text)) pieces.add(char)
  }
  return pieces
}

function isComposedOnlyOfTargetChars(text: string, targetPieces: Set<string>): boolean {
  const chars = Array.from(text).filter((char) => HAN_CHAR_PATTERN.test(char))
  return chars.length > 0 && chars.every((char) => targetPieces.has(char))
}

function hasAdjacentGloss(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 6), start)
  const after = text.slice(end, Math.min(text.length, end + 6))
  const window = `${before}${after}`
  if (/[A-Za-z]/u.test(window)) return true
  if (/[(（][^）)]*$/u.test(before) || /^[^（(]*[)）]/u.test(after)) return true
  if (/^\s*[(（]/u.test(after) || /[)）]\s*$/u.test(before)) return true
  return false
}

function findFrontAnswerLeak(front: string, back: string): FrontAnswerLeak | null {
  const normalizedFront = normalizeLeakText(front)
  const normalizedBack = normalizeLeakText(back)
  if (normalizedBack.length > 0 && normalizedFront.includes(normalizedBack)) return { answer: normalizedBack, mode: "fullBack" }

  const leadingAnswer = leadingBackAnswer(back)
  if (leadingAnswer.length > 0 && normalizeLeakText(front).includes(leadingAnswer)) return { answer: leadingAnswer, mode: "leadingAnswer" }
  return null
}

function leadingBackAnswer(back: string): string {
  const trimmed = back.trim()
  if (trimmed.length === 0) return ""
  const stop = trimmed.search(ANSWER_STOP_PATTERN)
  const leading = stop === -1 ? trimmed : trimmed.slice(0, stop)
  return normalizeLeakText(leading.replace(/^答案[:：]\s*/u, "").replace(/[：:]\s*$/u, ""))
}

function normalizeLeakText(text: string): string {
  return text.replace(/\s+/gu, "").trim()
}

function hanRuns(text: string): Array<{ text: string; start: number }> {
  const runs: Array<{ text: string; start: number }> = []
  for (const match of text.matchAll(HAN_RUN_PATTERN)) runs.push({ text: match[0], start: match.index ?? 0 })
  return runs
}

function contextFor(text: string, start: number, end: number): string {
  return text.slice(Math.max(0, start - 12), Math.min(text.length, end + 12))
}

function histogram(values: string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const value of values) result[value] = (result[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => Number(left) - Number(right)))
}

function issueHistogram(cards: CardAudit[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const card of cards) {
    if (card.unknownCount > 1) result["unknowns>1"] = (result["unknowns>1"] ?? 0) + 1
    if (card.unknownCount === 1 && !card.unknowns[0]?.glossed) result["one-unglossed-unknown"] = (result["one-unglossed-unknown"] ?? 0) + 1
    if (card.frontAnswerLeak !== null) result["front-answer-leak"] = (result["front-answer-leak"] ?? 0) + 1
  }
  return result
}

function worstOffenders(cards: CardAudit[]): WorstOffender[] {
  return cards
    .filter((card) => !card.passed)
    .map((card) => ({
      file: card.file,
      word: card.word,
      cardIndex: card.cardIndex,
      unknownCount: card.unknownCount,
      issues: card.issues,
      why: card.issues.join("; "),
    }))
    .sort((left, right) => right.unknownCount - left.unknownCount || right.issues.length - left.issues.length || left.word.localeCompare(right.word))
    .slice(0, 10)
}

function formatConsoleReport(report: AuditReport, reportPath: string): string {
  const passPercent = (report.totals.passRate * 100).toFixed(1)
  const lines = [
    `HSK card audit: ${report.totals.cards} cards across ${report.totals.files} files`,
    `Pass rate: ${report.totals.passed}/${report.totals.cards} (${passPercent}%)`,
    `Unknowns/card: ${formatHistogram(report.histograms.unknownsPerCard)}`,
    `Issues: ${formatHistogram(report.histograms.issues)}`,
    "Top 10 worst offenders:",
  ]
  if (report.worstOffenders.length === 0) {
    lines.push("  none")
  } else {
    for (const offender of report.worstOffenders) lines.push(`  ${offender.word} (${offender.file}#${offender.cardIndex}): ${offender.why}`)
  }
  lines.push(`Report: ${reportPath}`)
  return lines.join("\n")
}

function formatHistogram(histogram: Record<string, number>): string {
  const entries = Object.entries(histogram)
  if (entries.length === 0) return "none"
  return entries.map(([key, value]) => `${key}=${value}`).join(", ")
}

function containsHan(text: string): boolean {
  return HAN_CHAR_PATTERN.test(text)
}

function charLengthAt(text: string, offset: number): number {
  const code = text.charCodeAt(offset)
  return code >= 0xd800 && code <= 0xdbff ? 2 : 1
}

function isLowSurrogateAt(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false
  const code = text.charCodeAt(offset)
  return code >= 0xdc00 && code <= 0xdfff
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseArgs(argv: string[]): string {
  if (argv.length !== 1 || argv[0] === "-h" || argv[0] === "--help") {
    throw new Error("Usage: bun scripts/audit-hsk-cards.ts <dir-of-slice-jsons>")
  }
  return argv[0]
}

if (import.meta.main) {
  try {
    const inputDir = parseArgs(Bun.argv.slice(2))
    const result = await auditHskCards(inputDir)
    console.log(formatConsoleReport(result.report, result.reportPath))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
