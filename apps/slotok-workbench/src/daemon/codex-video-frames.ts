import type { CodexAnalyzeOperation } from "@wirebabel/ugc-cli"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

export type CodexFramePreparationStatus = "not-video" | "supplied-reference-frames" | "skipped" | "extracted"
export type CodexFramePreparationSource = "none" | "referenceFrameUrls" | "posterUrl" | "ffmpeg"

export interface CodexFramePreparationInput {
  readonly workspaceDir: string
  readonly mediaUrl: string
  readonly operation: CodexAnalyzeOperation
  readonly posterUrl?: string | null
  readonly referenceFrameUrls?: readonly string[]
  readonly targetId?: string
  readonly candidateId?: string
  readonly extractLocalFrames?: boolean
  readonly frameExtractor?: CodexVideoFrameExtractor
}

export interface CodexLocalFrameExtractionInput {
  readonly mediaPath: string
  readonly outputDir: string
  readonly frameCount: number
}

export interface CodexVideoFrameExtractor {
  extract(input: CodexLocalFrameExtractionInput): Promise<readonly string[]>
}

export interface CodexFramePreparationMetadata {
  readonly status: CodexFramePreparationStatus
  readonly source: CodexFramePreparationSource
  readonly requested: boolean
  readonly reason: string | null
  readonly frameCount: number
  readonly outputDir: string | null
  readonly targetId: string | null
  readonly candidateId: string | null
}

export interface CodexFramePreparation {
  readonly mediaUrl: string
  readonly referenceFrameUrls: readonly string[]
  readonly artifactPaths: readonly string[]
  readonly extraction: CodexFramePreparationMetadata
}

const DEFAULT_FRAME_COUNT = 3

export async function prepareCodexVideoFrames(input: CodexFramePreparationInput): Promise<CodexFramePreparation> {
  const mediaUrl = normalizeMediaUrl(input.mediaUrl)
  const targetId = input.targetId ?? null
  const candidateId = input.candidateId ?? null
  if (input.operation !== "video-understand") {
    return {
      mediaUrl,
      referenceFrameUrls: normalizeReferenceFrameUrls(input.referenceFrameUrls),
      artifactPaths: [],
      extraction: {
        status: "not-video",
        source: "none",
        requested: false,
        reason: "operation-is-not-video-understand",
        frameCount: 0,
        outputDir: null,
        targetId,
        candidateId,
      },
    }
  }

  const suppliedReferenceFrameUrls = normalizeReferenceFrameUrls(input.referenceFrameUrls)
  if (suppliedReferenceFrameUrls.length > 0) {
    return {
      mediaUrl,
      referenceFrameUrls: suppliedReferenceFrameUrls,
      artifactPaths: [],
      extraction: {
        status: "supplied-reference-frames",
        source: "referenceFrameUrls",
        requested: false,
        reason: null,
        frameCount: suppliedReferenceFrameUrls.length,
        outputDir: null,
        targetId,
        candidateId,
      },
    }
  }

  const posterUrl = normalizeOptionalUrl(input.posterUrl)
  if (mediaUrl.startsWith("fixture://")) {
    return {
      mediaUrl,
      referenceFrameUrls: posterUrl ? [posterUrl] : [],
      artifactPaths: [],
      extraction: {
        status: "skipped",
        source: posterUrl ? "posterUrl" : "none",
        requested: false,
        reason: posterUrl ? "fixture-media" : "fixture-media-without-poster",
        frameCount: posterUrl ? 1 : 0,
        outputDir: null,
        targetId,
        candidateId,
      },
    }
  }

  const localMediaPath = localPathFromMediaUrl(mediaUrl)
  const requested = input.extractLocalFrames !== false && localMediaPath !== null
  if (!requested) {
    return {
      mediaUrl,
      referenceFrameUrls: posterUrl ? [posterUrl] : [],
      artifactPaths: [],
      extraction: {
        status: "skipped",
        source: posterUrl ? "posterUrl" : "none",
        requested: false,
        reason: localMediaPath === null ? "media-url-is-not-local" : "local-frame-extraction-disabled",
        frameCount: posterUrl ? 1 : 0,
        outputDir: null,
        targetId,
        candidateId,
      },
    }
  }

  const outputDir = path.join(input.workspaceDir, "assets", "generated", "codex-frames", frameSetId(input))
  await fs.mkdir(outputDir, { recursive: true })
  const extractor = input.frameExtractor ?? defaultCodexVideoFrameExtractor
  const framePaths = await extractor.extract({
    mediaPath: localMediaPath,
    outputDir,
    frameCount: DEFAULT_FRAME_COUNT,
  })
  const normalizedFramePaths = framePaths.map((framePath) => path.resolve(framePath))
  if (normalizedFramePaths.length === 0) {
    throw new Error(`Codex video frame extraction produced no frames for ${mediaUrl}`)
  }

  return {
    mediaUrl,
    referenceFrameUrls: normalizedFramePaths.map((framePath) => pathToFileURL(framePath).href),
    artifactPaths: normalizedFramePaths.map((framePath) => workspaceRelativePath(input.workspaceDir, framePath)),
    extraction: {
      status: "extracted",
      source: "ffmpeg",
      requested: true,
      reason: null,
      frameCount: normalizedFramePaths.length,
      outputDir: workspaceRelativePath(input.workspaceDir, outputDir),
      targetId,
      candidateId,
    },
  }
}

export const defaultCodexVideoFrameExtractor: CodexVideoFrameExtractor = {
  async extract(input) {
    await fs.rm(input.outputDir, { recursive: true, force: true })
    await fs.mkdir(input.outputDir, { recursive: true })
    const outputPattern = path.join(input.outputDir, "frame-%02d.jpg")
    const child = Bun.spawn([
      "ffmpeg",
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      input.mediaPath,
      "-vf",
      "fps=1/3",
      "-frames:v",
      String(input.frameCount),
      outputPattern,
    ], {
      stdout: "ignore",
      stderr: "pipe",
    })
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      readStreamText(child.stderr),
    ])
    if (exitCode !== 0) {
      const detail = stderr.trim()
      throw new Error(detail ? `ffmpeg frame extraction failed: ${detail}` : "ffmpeg frame extraction failed")
    }
    const entries = await fs.readdir(input.outputDir)
    return entries
      .filter((entry) => entry.endsWith(".jpg"))
      .sort()
      .map((entry) => path.join(input.outputDir, entry))
  },
}

function normalizeReferenceFrameUrls(value: readonly string[] | undefined): readonly string[] {
  if (!value) return []
  return value.map((item) => item.trim()).filter((item) => item.length > 0)
}

function normalizeOptionalUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? normalizeMediaUrl(trimmed) : null
}

function normalizeMediaUrl(value: string): string {
  const trimmed = value.trim()
  return path.isAbsolute(trimmed) ? pathToFileURL(trimmed).href : trimmed
}

function localPathFromMediaUrl(mediaUrl: string): string | null {
  if (mediaUrl.startsWith("file://")) return fileURLToPath(mediaUrl)
  return path.isAbsolute(mediaUrl) ? mediaUrl : null
}

function frameSetId(input: Pick<CodexFramePreparationInput, "candidateId" | "targetId" | "operation" | "mediaUrl">): string {
  const id = input.candidateId ?? input.targetId ?? `${input.operation}_${Bun.hash(input.mediaUrl).toString(36)}`
  return slugPathSegment(id)
}

function slugPathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "video"
}

function workspaceRelativePath(workspaceDir: string, absolutePath: string): string {
  const relative = path.relative(workspaceDir, absolutePath)
  return relative.startsWith("..") || path.isAbsolute(relative) ? absolutePath : relative
}

async function readStreamText(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (!stream) return ""
  return await new Response(stream).text()
}
