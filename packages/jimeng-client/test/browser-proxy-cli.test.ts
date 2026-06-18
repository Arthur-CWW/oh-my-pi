import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import {
  parseJimengBrowserProxyFlags,
  redactJimengProofForNormalized,
} from "../src/browser-proxy-cli"
import { JimengArtifactLog } from "../src/artifact-log"
import { type JsonObject } from "../src"

describe("jimeng-browser-proxy normalized proof redaction", () => {
  test("preserves explicit empty flag values", () => {
    expect(parseJimengBrowserProxyFlags([
      "--channel",
      "asset",
      "--keyword",
      "",
      "--transport",
      "replay",
      "--cassette=data/jimeng-lab/cassettes/example.json",
      "--dryRun",
    ])).toEqual({
      channel: "asset",
      keyword: "",
      transport: "replay",
      cassette: "data/jimeng-lab/cassettes/example.json",
      dryRun: "true",
    })
  })

  test("redacts tokenized Jimeng URLs, signed media URLs, and credential fields", () => {
    const redacted = redactJimengProofForNormalized({
      plan: {
        submit_url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?aid=513695&msToken=secret&a_bogus=secret",
        poll_url: "https://jimeng.jianying.com/mweb/v1/get_history_by_ids?aid=513695&msToken=secret",
        submit_headers: {
          cookie: "sid=secret",
          "user-agent": "UnitTest/1.0",
        },
      },
      artifacts: [
        {
          kind: "video",
          url: "https://p11-dreamina-sign.byteimg.com/tos-cn-i/video.mp4?x-signature=secret&x-expires=123",
          saved_file: "/tmp/video.mp4",
        },
      ],
    }) as JsonObject

    expect(JSON.stringify(redacted)).not.toContain("msToken=secret")
    expect(JSON.stringify(redacted)).not.toContain("a_bogus=secret")
    expect(JSON.stringify(redacted)).not.toContain("x-signature=secret")
    expect(JSON.stringify(redacted)).not.toContain("sid=secret")
    expect(redacted).toMatchObject({
      plan: {
        submit_url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate?[REDACTED_QUERY]",
        poll_url: "https://jimeng.jianying.com/mweb/v1/get_history_by_ids?[REDACTED_QUERY]",
        submit_headers: {
          cookie: "[REDACTED 10 chars]",
          "user-agent": "UnitTest/1.0",
        },
      },
      artifacts: [
        {
          kind: "video",
          url: "[SIGNED_URL_REDACTED]",
          saved_file: "/tmp/video.mp4",
        },
      ],
    })
  })

  test("packet-plan command writes a sessionless manifest bundle", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "jimeng-packet-cli-"))
    const result = spawnSync(process.execPath, [
      "src/browser-proxy-cli.ts",
      "packet-plan",
      "--packet",
      "persona-voice",
      "--outDir",
      outDir,
    ], {
      cwd: path.resolve(import.meta.dir, ".."),
      encoding: "utf8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("packet-plan saved packet=persona-voice")

    const manifestJson = path.join(outDir, "normalized", "packet-plan", "packet-manifest.json")
    const manifestMarkdown = path.join(outDir, "normalized", "packet-plan", "packet-manifest.md")
    const approvalPrompt = path.join(outDir, "normalized", "packet-plan", "approval-prompt.txt")
    const rawInputs = path.join(outDir, "raw", "packet-plan-inputs.json")

    expect(existsSync(manifestJson)).toBe(true)
    expect(existsSync(manifestMarkdown)).toBe(true)
    expect(existsSync(approvalPrompt)).toBe(true)
    expect(existsSync(rawInputs)).toBe(true)
    expect(readFileSync(manifestMarkdown, "utf8")).toContain("# Jimeng Packet Plan: persona-voice")
  })

  test("contract-infer command writes scaffold outputs from fixture plans", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "jimeng-contract-infer-cli-"))
    const fixtureDir = path.join("test", "fixtures", "contract-infer", "persona-voice-mini")
    const result = spawnSync(process.execPath, [
      "src/browser-proxy-cli.ts",
      "contract-infer",
      "--input",
      fixtureDir,
      "--outDir",
      outDir,
    ], {
      cwd: path.resolve(import.meta.dir, ".."),
      encoding: "utf8",
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("contract-infer saved endpoints=4 documents=4")

    const summaryJson = path.join(outDir, "normalized", "contract", "contract-summary.json")
    const summaryMarkdown = path.join(outDir, "normalized", "contract", "contract-summary.md")
    const schemaIr = path.join(outDir, "normalized", "contract", "effect-schema-ir.json")
    const registryPatch = path.join(outDir, "normalized", "contract", "registry-patch-draft.json")

    expect(existsSync(summaryJson)).toBe(true)
    expect(existsSync(summaryMarkdown)).toBe(true)
    expect(existsSync(schemaIr)).toBe(true)
    expect(existsSync(registryPatch)).toBe(true)
    expect(readFileSync(summaryMarkdown, "utf8")).toContain("/mweb/v1/voice/submit_task")
  })

  test("proof-report command renders a sessionless local report", () => {
    const proofRoot = mkdtempSync(path.join(tmpdir(), "jimeng-proof-report-cli-"))
    try {
      const normalized = path.join(proofRoot, "normalized")
      const artifacts = path.join(proofRoot, "artifacts")
      mkdirSync(normalized)
      mkdirSync(artifacts)
      const video = path.join(artifacts, "clip.mp4")
      writeFileSync(video, "fake video")
      writeFileSync(path.join(normalized, "text2video-result.json"), `${JSON.stringify({
        plan: {
          command: "text2video",
          op: "video",
          submit_body: { prompt: "中文提示 with English dialogue" },
        },
        submit: { submitId: "submit-proof-report", historyId: "history-proof-report" },
        pollTrace: [{ status: 50, itemCount: 1, httpStatus: 200 }],
        artifacts: [{ kind: "video", saved_file: video }],
      }, null, 2)}\n`)

      const result = spawnSync(process.execPath, [
        "src/browser-proxy-cli.ts",
        "proof-report",
        "--input",
        proofRoot,
        "--title",
        "CLI proof report",
      ], {
        cwd: path.resolve(import.meta.dir, ".."),
        encoding: "utf8",
      })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain("proof-report html=")
      const htmlFile = path.join(proofRoot, "report", "index.html")
      const markdownFile = path.join(proofRoot, "report", "index.md")
      expect(existsSync(htmlFile)).toBe(true)
      expect(existsSync(markdownFile)).toBe(true)
      expect(readFileSync(htmlFile, "utf8")).toContain("<video controls src=\"../artifacts/clip.mp4\"></video>")
    } finally {
      rmSync(proofRoot, { recursive: true, force: true })
    }
  })

  test("--artifact-db logs a dry-run proof command and output files", () => {
    const outDir = mkdtempSync(path.join(tmpdir(), "jimeng-browser-proxy-artifact-db-"))
    const db = path.join(outDir, "artifact-log.sqlite3")
    try {
      const result = spawnSync(process.execPath, [
        "src/browser-proxy-cli.ts",
        "text2image-plan",
        "--prompt",
        "fixture prompt",
        "--dryRun",
        "--outDir",
        outDir,
        "--artifact-db",
        db,
        "--worker",
        "BrowserProxyLogWorker",
        "--artifact-notes",
        "fixture dry run",
      ], {
        cwd: path.resolve(import.meta.dir, ".."),
        encoding: "utf8",
      })

      expect(result.status).toBe(0)

      expect(result.stdout).toContain("text2image-plan saved")

      const log = new JimengArtifactLog({ dbPath: db })
      try {
        const snapshot = log.snapshot()
        expect(snapshot.runs).toHaveLength(1)
        const run = snapshot.runs[0]!
        expect(run.status).toBe("dry_run")
        expect(run.workerId).toBe("BrowserProxyLogWorker")
        expect(run.notes).toBe("fixture dry run")
        expect(run.functionName).toBe("browser-proxy / text2image-plan")
        expect(run.prompt).toBe("fixture prompt")
        expect(run.command).toContain("bun packages/jimeng-client/src/browser-proxy-cli.ts text2image-plan")
        expect(run.proofRoot).toBe(path.resolve(outDir))
        expect(run.resultJson).toContain(`${path.sep}normalized${path.sep}`)
        expect(run.artifacts.map((artifact) => artifact.kind).sort()).toEqual(["normalized-json", "raw-json"])
        expect(run.artifacts.every((artifact) => !artifact.relativePath.startsWith("artifact-log.sqlite3"))).toBe(true)
        expect(run.artifacts.every((artifact) => artifact.path.startsWith(path.resolve(outDir)))).toBe(true)
      } finally {
        log.close()
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  })
})
