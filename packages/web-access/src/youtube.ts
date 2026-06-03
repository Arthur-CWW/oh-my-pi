import { execFile } from "node:child_process"
import { Effect } from "effect"
import { toErrorMessage } from "./schemas"

// ─── Types ────────────────────────────────────────────────────────────

export interface YouTubeTranscript {
  title: string
  description: string
  duration: number // seconds
  transcript: string // plain text with timestamps
  error: string | null
}

// ─── Execute yt-dlp ───────────────────────────────────────────────────

function exec(args: string[], timeoutMs = 30000): Promise<string> {
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

// ─── Extract metadata ─────────────────────────────────────────────────

async function extractMetadata(url: string): Promise<{
  title: string
  description: string
  duration: number
}> {
  try {
    const json = await exec(["--dump-json", "--no-playlist", url], 15000)
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

async function extractSubtitles(url: string): Promise<string> {
  // Try auto-generated English subtitles as VTT (simpler to parse than SRT)
  const vtt = await exec([
    "--write-auto-subs",
    "--sub-lang", "en",
    "--convert-subs", "vtt",
    "--skip-download",
    "-o", "-",
    "--no-playlist",
    url,
  ], 30000)

  if (!vtt || vtt.length < 50) return ""

  // Parse VTT to plain text with timestamps
  const lines: string[] = []
  let currentTime = ""

  for (const raw of vtt.split("\n")) {
    const line = raw.trim()
    if (!line || line === "WEBVTT" || line.startsWith("NOTE")) continue

    // Timestamp line: 00:00:01.000 --> 00:00:04.000
    const timeMatch = line.match(/^(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/)
    if (timeMatch) {
      currentTime = timeMatch[1]!.slice(0, 8) // Keep HH:MM:SS
      continue
    }

    // Skip VTT metadata lines
    if (/^\d+$/.test(line)) continue
    if (line.startsWith("Kind:") || line.startsWith("Language:")) continue

    // Content line
    if (currentTime && line) {
      lines.push(`[${currentTime}] ${line}`)
    }
  }

  return lines.join("\n")
}

// ─── Effect API ───────────────────────────────────────────────────────

/** Extract video title, description, and transcript from a YouTube URL */
export const getTranscript = Effect.fn("getTranscript")(function* (url: string) {
  // Validate URL
  try { new URL(url) } catch { return yield* Effect.fail(new Error("Invalid URL")) }

  const videoId = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1]
  if (!videoId) return yield* Effect.fail(new Error("Not a YouTube URL"))

  // Extract metadata and subtitles in parallel
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
      catch: () => "",
    }),
  ], { concurrency: 2 })

  // Build formatted output
  const meta = metaResult
  const header = [
    `# ${meta.title}`,
    "",
    `**Duration:** ${formatDuration(meta.duration)}`,
    meta.description ? `\n**Description:** ${meta.description.slice(0, 500)}${meta.description.length > 500 ? "..." : ""}` : "",
    "",
    "---",
    "",
  ].filter(Boolean).join("\n")

  return {
    title: meta.title,
    description: meta.description,
    duration: meta.duration,
    transcript: header + (subsResult || "(No auto-generated captions available)"),
    error: subsResult ? null : "No captions available",
  }
})

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}
