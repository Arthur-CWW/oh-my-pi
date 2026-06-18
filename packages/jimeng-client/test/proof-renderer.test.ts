import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { renderJimengProofReportSync } from "../src"

describe("Jimeng proof renderer", () => {
  test("renders local HTML and Markdown previews with relative artifact links", () => {
    const fixture = createProofFixture()
    try {
      const result = renderJimengProofReportSync({ inputPath: fixture.root, title: "Live Jimeng proof" })
      const html = readFileSync(result.htmlFile, "utf8")
      const markdown = readFileSync(result.markdownFile, "utf8")

      expect(result.runs).toHaveLength(1)
      expect(result.runs[0]?.prompt).toBe("韩系美妆创作者说 English dialogue")
      expect(existsSync(result.htmlFile)).toBe(true)
      expect(existsSync(result.markdownFile)).toBe(true)
      expect(html).toContain("<video controls src=\"../artifacts/video.mp4\"></video>")
      expect(html).toContain("normalized/text2video-result.json")
      expect(html).toContain("https://cdn.example.test/video.mp4")
      expect(html).not.toContain("secret-token")
      expect(html).not.toContain(fixture.root)
      expect(markdown).toContain("# Live Jimeng proof")
      expect(markdown).toContain("artifacts/video.mp4")
    } finally {
      fixture.dispose()
    }
  })

  test("writes one HTML page per Jimeng function", () => {
    const fixture = createMultiFunctionFixture()
    try {
      const result = renderJimengProofReportSync({ inputPath: fixture.root, title: "Multi function proof" })
      const indexHtml = readFileSync(result.htmlFile, "utf8")

      expect(result.functionPages.map((page) => page.functionName)).toEqual([
        "text2image / image",
        "text2video / video",
      ])
      expect(result.functionPages).toHaveLength(2)
      expect(indexHtml).toContain("functions/text2image-image.html")
      expect(indexHtml).toContain("functions/text2video-video.html")

      const imagePage = readFileSync(path.join(result.outDir, "functions", "text2image-image.html"), "utf8")
      const videoPage = readFileSync(path.join(result.outDir, "functions", "text2video-video.html"), "utf8")
      expect(imagePage).toContain("<h1>text2image / image</h1>")
      expect(imagePage).toContain("<img src=\"../../artifacts/still.png\" alt=\"generated artifact\">")
      expect(imagePage).not.toContain("<video controls")
      expect(videoPage).toContain("<h1>text2video / video</h1>")
      expect(videoPage).toContain("<video controls src=\"../../artifacts/clip.mp4\"></video>")
      expect(videoPage).not.toContain("<img src=")
    } finally {
      fixture.dispose()
    }
  })

  test("renders an empty proof root without failing", () => {
    const fixture = createEmptyFixture()
    try {
      const result = renderJimengProofReportSync({ inputPath: fixture.root })
      const html = readFileSync(result.htmlFile, "utf8")
      expect(result.runs).toHaveLength(0)
      expect(html).toContain("No <code>normalized/*-result.json</code> files found.")
    } finally {
      fixture.dispose()
    }
  })
})

function createProofFixture(): { root: string; dispose: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "jimeng-proof-renderer-"))
  const normalized = path.join(root, "normalized")
  const artifacts = path.join(root, "artifacts")
  mkdirSync(normalized)
  mkdirSync(artifacts)
  const video = path.join(artifacts, "video.mp4")
  writeFileSync(video, "fake mp4 bytes")
  writeFileSync(path.join(normalized, "text2video-result.json"), `${JSON.stringify({
    plan: {
      command: "text2video",
      op: "video",
      submit_body: {
        draft_content: JSON.stringify({
          text_to_video_params: {
            prompt: "韩系美妆创作者说 English dialogue",
          },
        }),
      },
    },
    submit: {
      submitId: "submit-001",
      historyId: "history-001",
    },
    pollTrace: [
      { status: 30, itemCount: 0, httpStatus: 200 },
      { status: 50, itemCount: 1, httpStatus: 200 },
    ],
    artifacts: [
      {
        kind: "video",
        url: "https://cdn.example.test/video.mp4?token=secret-token",
        saved_file: video,
      },
    ],
  }, null, 2)}\n`)
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function createMultiFunctionFixture(): { root: string; dispose: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "jimeng-proof-renderer-multi-"))
  const normalized = path.join(root, "normalized")
  const artifacts = path.join(root, "artifacts")
  mkdirSync(normalized)
  mkdirSync(artifacts)
  const image = path.join(artifacts, "still.png")
  const video = path.join(artifacts, "clip.mp4")
  writeFileSync(image, "fake png bytes")
  writeFileSync(video, "fake mp4 bytes")
  writeResultFile(path.join(normalized, "text2image-result.json"), {
    command: "text2image",
    op: "image",
    prompt: "中文图像提示 with English copy",
    artifactKind: "image",
    artifactFile: image,
    status: 50,
  })
  writeResultFile(path.join(normalized, "text2video-result.json"), {
    command: "text2video",
    op: "video",
    prompt: "中文视频提示 with English dialogue",
    artifactKind: "video",
    artifactFile: video,
    status: 50,
  })
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}

function writeResultFile(file: string, input: { command: string; op: string; prompt: string; artifactKind: string; artifactFile: string; status: number }): void {
  writeFileSync(file, `${JSON.stringify({
    plan: {
      command: input.command,
      op: input.op,
      submit_body: { prompt: input.prompt },
    },
    submit: {
      submitId: `${input.command}-submit`,
      historyId: `${input.command}-history`,
    },
    pollTrace: [{ status: input.status, itemCount: 1, httpStatus: 200 }],
    artifacts: [
      {
        kind: input.artifactKind,
        saved_file: input.artifactFile,
      },
    ],
  }, null, 2)}\n`)
}

function createEmptyFixture(): { root: string; dispose: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "jimeng-proof-renderer-empty-"))
  mkdirSync(path.join(root, "normalized"))
  return { root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
