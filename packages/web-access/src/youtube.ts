import { execFile } from "node:child_process"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { toErrorMessage } from "./schemas"

// ─── Types ────────────────────────────────────────────────────────────

export interface YouTubeTranscript {
  title: string
  description: string
  duration: number // seconds
  transcript: string // cleaned plain text with timestamps
  error: string | null
  captionsSource?: "manual" | "auto" | null
}

export interface TranscriptCue {
  start: string
  startSeconds: number
  text: string
}

// ─── Execute yt-dlp ───────────────────────────────────────────────────

function exec(args: string[], timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("yt-dlp", args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr || err.message || String(err)
        reject(new Error(msg.slice(0, 500)))
      } else {
        resolve(stdout.trim())
      }
    })
  })
}

// ─── Cleaning helpers ─────────────────────────────────────────────────

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
}

function normalizeWhitespace(text: string): string {
  return text.replace(/[\t\u00A0 ]+/g, " ").replace(/\s*\n\s*/g, " ").trim()
}

function stripStageDirections(text: string): string {
  return normalizeWhitespace(text.replace(/\[(?:music|applause|laughter|cheering|noise)\]/gi, " "))
}

export function stripCueMarkup(text: string): string {
  return normalizeWhitespace(
    decodeEntities(text)
      .replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, " ")
      .replace(/<\/?c(?:\.[^>]+)?>/g, " ")
      .replace(/<\/?(?:i|b|u|ruby|rt|v(?:\s+[^>]+)?)>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\u200B/g, " "),
  )
}

function words(text: string): string[] {
  return normalizeWhitespace(text).split(" ").filter(Boolean)
}

function sameWords(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((word, index) => word.toLowerCase() === right[index]!.toLowerCase())
}

function wordOverlap(left: string, right: string, maxWords = 24): number {
  const leftWords = words(left)
  const rightWords = words(right)
  const max = Math.min(leftWords.length, rightWords.length, maxWords)
  for (let size = max; size >= 1; size--) {
    if (sameWords(leftWords.slice(-size), rightWords.slice(0, size))) return size
  }
  return 0
}

function smartJoin(left: string, right: string): string {
  if (!left) return right
  if (!right) return left
  if (/^[,.;:!?)]/.test(right)) return `${left}${right}`
  if (/[(/\-]$/.test(left)) return `${left}${right}`
  return `${left} ${right}`
}

function mergeCueLines(lines: string[]): string {
  let merged = ""
  for (const line of lines.map((line) => stripStageDirections(stripCueMarkup(line))).filter(Boolean)) {
    if (!merged) {
      merged = line
      continue
    }
    if (line.toLowerCase().includes(merged.toLowerCase())) {
      merged = line
      continue
    }
    if (merged.toLowerCase().includes(line.toLowerCase())) continue

    const overlap = wordOverlap(merged, line)
    const suffix = overlap > 0 ? words(line).slice(overlap).join(" ") : line
    merged = normalizeWhitespace(smartJoin(merged, suffix))
  }
  return merged
}

function incrementalCueText(previous: string, current: string): string {
  if (!previous) return current
  const previousWords = words(previous)
  const currentWords = words(current)
  if (sameWords(previousWords, currentWords)) return ""
  const overlap = wordOverlap(previous, current)
  if (overlap > 0) return currentWords.slice(overlap).join(" ")
  if (current.toLowerCase().includes(previous.toLowerCase())) {
    const idx = current.toLowerCase().indexOf(previous.toLowerCase())
    return normalizeWhitespace(current.slice(idx + previous.length))
  }
  return current
}

function isNonSpeechCue(text: string): boolean {
  return !stripStageDirections(text) || /^\[(?:music|applause|laughter|cheering|noise)\]$/i.test(text)
}

function isLikelyStubCue(cue: TranscriptCue, next: TranscriptCue | undefined): boolean {
  return words(cue.text).length === 1 && cue.text.length <= 4 && Boolean(next && next.startSeconds - cue.startSeconds >= 8)
}

function parseCueTimestamp(line: string): { start: string; startSeconds: number } | null {
  const match = line.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  return {
    start: `${match[1]}:${match[2]}:${match[3]}`,
    startSeconds: hours * 3600 + minutes * 60 + seconds,
  }
}

export function parseYouTubeVtt(vtt: string): TranscriptCue[] {
  const blocks = vtt.replace(/\r\n?/g, "\n").split(/\n{2,}/)
  const visibleCues: TranscriptCue[] = []

  for (const block of blocks) {
    const lines = block.split("\n")
    const timestampLine = lines.find((line) => /^\d{2}:\d{2}:\d{2}\.\d{3}\s*-->/.test(line.trim()))
    if (!timestampLine) continue

    const timestamp = parseCueTimestamp(timestampLine.trim())
    if (!timestamp) continue

    const cueLines = lines.slice(lines.indexOf(timestampLine) + 1)
    const text = mergeCueLines(cueLines)
    if (!text || isNonSpeechCue(text)) continue

    visibleCues.push({ ...timestamp, text })
  }

  const cleaned: TranscriptCue[] = []
  let previousVisible = ""

  for (const [index, cue] of visibleCues.entries()) {
    const novelText = normalizeWhitespace(incrementalCueText(previousVisible, cue.text))
    previousVisible = cue.text
    if (!novelText || isNonSpeechCue(novelText)) continue

    if (cleaned.length > 0) {
      const last = cleaned[cleaned.length - 1]!
      if (cue.startSeconds === last.startSeconds) {
        last.text = normalizeWhitespace(smartJoin(last.text, novelText))
        continue
      }
    }

    const normalizedCue = { ...cue, text: stripStageDirections(novelText) }
    if (!normalizedCue.text || isLikelyStubCue(normalizedCue, visibleCues[index + 1])) continue

    cleaned.push(normalizedCue)
  }

  return cleaned
}

export function renderTranscriptParagraphs(cues: TranscriptCue[]): string {
  if (!cues.length) return ""

  const paragraphs: Array<{ start: string; endSeconds: number; text: string }> = []
  let current = {
    start: cues[0]!.start,
    endSeconds: cues[0]!.startSeconds,
    text: cues[0]!.text,
  }

  for (const cue of cues.slice(1)) {
    const gap = cue.startSeconds - current.endSeconds
    const shouldBreak = gap >= 12 || (current.text.length >= 280 && /[.!?]["')\]]?$/.test(current.text))
    if (shouldBreak) {
      paragraphs.push(current)
      current = {
        start: cue.start,
        endSeconds: cue.startSeconds,
        text: cue.text,
      }
      continue
    }

    current = {
      start: current.start,
      endSeconds: cue.startSeconds,
      text: normalizeWhitespace(smartJoin(current.text, cue.text)),
    }
  }

  paragraphs.push(current)
  return paragraphs.map((paragraph) => `[${paragraph.start}] ${paragraph.text}`).join("\n\n")
}

// ─── Extract metadata ─────────────────────────────────────────────────

async function extractMetadata(url: string): Promise<{
  title: string
  description: string
  duration: number
}> {
  try {
    const json = await exec(["--dump-json", "--no-playlist", url], 15_000)
    const data = JSON.parse(json) as {
      title?: string
      description?: string
      duration?: number
    }
    return {
      title: data.title ?? "Unknown",
      description: data.description ?? "",
      duration: data.duration ?? 0,
    }
  } catch {
    return { title: "Unknown", description: "", duration: 0 }
  }
}

// ─── Extract subtitles ────────────────────────────────────────────────

async function downloadSubtitles(url: string, auto: boolean): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), "pi-youtube-"))
  try {
    const out = join(workDir, "%(id)s.%(ext)s")
    await exec([
      auto ? "--write-auto-subs" : "--write-subs",
      "--sub-lang", "en.*",
      "--convert-subs", "vtt",
      "--skip-download",
      "-o", out,
      "--no-playlist",
      url,
    ], 45_000)

    const files = (await readdir(workDir)).filter((file) => file.endsWith(".vtt")).sort()
    if (!files.length) return ""
    return await readFile(join(workDir, files[0]!), "utf8")
  } catch {
    return ""
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function extractSubtitles(url: string): Promise<{ transcript: string; source: "manual" | "auto" | null }> {
  const manualVtt = await downloadSubtitles(url, false)
  if (manualVtt) {
    const transcript = renderTranscriptParagraphs(parseYouTubeVtt(manualVtt))
    if (transcript) return { transcript, source: "manual" }
  }

  const autoVtt = await downloadSubtitles(url, true)
  if (autoVtt) {
    const transcript = renderTranscriptParagraphs(parseYouTubeVtt(autoVtt))
    if (transcript) return { transcript, source: "auto" }
  }

  return { transcript: "", source: null }
}

// ─── Effect API ───────────────────────────────────────────────────────

/** Extract video title, description, and transcript from a YouTube URL */
export const getTranscript = Effect.fn("getTranscript")(function* (url: string) {
  try { new URL(url) } catch { return yield* Effect.fail(new Error("Invalid URL")) }

  const videoId = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1]
  if (!videoId) return yield* Effect.fail(new Error("Not a YouTube URL"))

  const [metaResult, subsResult] = yield* Effect.all([
    Effect.tryPromise({
      try: () => extractMetadata(url),
      catch: (err) => {
        const msg = toErrorMessage(err)
        if (msg.includes("ENOENT")) throw new Error("yt-dlp not installed. Run: brew install yt-dlp")
        throw new Error(`Metadata extraction failed: ${msg}`)
      },
    }),
    Effect.tryPromise({
      try: () => extractSubtitles(url),
      catch: () => ({ transcript: "", source: null as "manual" | "auto" | null }),
    }),
  ], { concurrency: 2 })

  const meta = metaResult
  const captionsLine = subsResult.source === "manual"
    ? "**Captions:** manual English subtitles"
    : subsResult.source === "auto"
      ? "**Captions:** auto-generated English captions"
      : "**Captions:** none available"

  const headerLines = [
    `# ${meta.title}`,
    "",
    `**Duration:** ${formatDuration(meta.duration)}`,
    captionsLine,
  ]
  if (meta.description) {
    headerLines.push("", `**Description:** ${meta.description.slice(0, 500)}${meta.description.length > 500 ? "..." : ""}`)
  }
  headerLines.push("", "---", "")
  const header = headerLines.join("\n")

  return {
    title: meta.title,
    description: meta.description,
    duration: meta.duration,
    transcript: header + (subsResult.transcript || "(No captions available)"),
    error: subsResult.transcript ? null : "No captions available",
    captionsSource: subsResult.source,
  }
})

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}
