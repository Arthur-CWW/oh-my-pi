import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { JimengArtifactLog } from "../src/artifact-log"
import type { CaptureFile, JimengSessionBundle } from "../src"

describe("dreamina-compatible CLI artifact logging", () => {
  test("--artifact-db logs dry-run command metadata and plan artifact without network", () => {
    const fixture = createCliFixture()
    try {
      const result = spawnSync(process.execPath, [
        "src/dreamina-compatible-cli.ts",
        "text2video",
        "--capture",
        fixture.capture,
        "--session-bundle",
        fixture.session,
        "--prompt",
        "new prompt",
        "--dryRun",
        "--outDir",
        fixture.outDir,
        "--artifact-db",
        fixture.db,
        "--worker",
        "JimengAutoLogWorker",
        "--artifact-notes",
        "unit dry run",
      ], { cwd: path.resolve(import.meta.dir, ".."), encoding: "utf8" })

      expect(result.status).toBe(0)
      expect(result.stdout).toContain("dry run saved")

      const log = new JimengArtifactLog({ dbPath: fixture.db })
      try {
        const snapshot = log.snapshot()
        expect(snapshot.runs).toHaveLength(1)
        const run = snapshot.runs[0]!
        expect(run.status).toBe("dry_run")
        expect(run.workerId).toBe("JimengAutoLogWorker")
        expect(run.notes).toBe("unit dry run")
        expect(run.functionName).toBe("text2video / video")
        expect(run.command).toContain("--artifact-db")
        expect(run.command).toContain("'new prompt'")
        expect(run.prompt).toBe("new prompt")
        expect(run.submitId).toMatch(/^[0-9a-f-]{36}$/)
        expect(run.resultJson).toContain("dry-run-plan.json")
        expect(run.artifacts).toHaveLength(1)
        expect(run.artifacts[0]?.kind).toBe("dry-run-plan")
        expect(run.artifacts[0]?.mime).toBe("application/json")
        expect(run.artifacts[0]?.relativePath).toMatch(/^raw\//)
      } finally {
        log.close()
      }
    } finally {
      fixture.dispose()
    }
  })

  test("--artifact-db marks the run failed when preparation fails after logging starts", () => {
    const fixture = createCliFixture({ brokenCapture: true })
    try {
      const result = spawnSync(process.execPath, [
        "src/dreamina-compatible-cli.ts",
        "text2video",
        "--capture",
        fixture.capture,
        "--session-bundle",
        fixture.session,
        "--prompt",
        "new prompt",
        "--dryRun",
        "--outDir",
        fixture.outDir,
        "--artifact-db",
        fixture.db,
      ], { cwd: path.resolve(import.meta.dir, ".."), encoding: "utf8" })

      expect(result.status).not.toBe(0)

      const log = new JimengArtifactLog({ dbPath: fixture.db })
      try {
        const snapshot = log.snapshot()
        expect(snapshot.runs).toHaveLength(1)
        expect(snapshot.runs[0]?.status).toBe("failed")
        expect(snapshot.runs[0]?.artifacts).toHaveLength(0)
      } finally {
        log.close()
      }
    } finally {
      fixture.dispose()
    }
  })
})

function createCliFixture(options: { brokenCapture?: boolean } = {}): {
  capture: string
  session: string
  outDir: string
  db: string
  dispose: () => void
} {
  const root = mkdtempSync(path.join(tmpdir(), "jimeng-dreamina-artifact-cli-"))
  const outDir = path.join(root, "out")
  mkdirSync(outDir)
  const capture = path.join(root, "capture.json")
  const session = path.join(root, "session.json")
  const db = path.join(root, "artifact-log.sqlite")
  writeFileSync(capture, `${JSON.stringify(options.brokenCapture ? { entries: [] } : videoCapture(), null, 2)}\n`)
  writeFileSync(session, `${JSON.stringify(sessionBundle(), null, 2)}\n`)
  return {
    capture,
    session,
    outDir,
    db,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}

function sessionBundle(): JimengSessionBundle {
  return {
    cookie: "sid=test",
    userAgent: "UnitTest/1.0",
    origin: "https://jimeng.jianying.com",
    referer: "https://jimeng.jianying.com/ai-tool/home/",
  }
}

function videoCapture(): CaptureFile {
  const draft = {
    component_list: [
      {
        abilities: {
          gen_video: {
            text_to_video_params: {
              video_gen_inputs: [{ prompt: "old prompt", duration_ms: 3000 }],
            },
            video_task_extra: JSON.stringify({ keep: "yes" }),
          },
        },
      },
    ],
  }

  return {
    entries: [
      {
        kind: "request",
        url: "https://jimeng.jianying.com/mweb/v1/aigc_draft/generate",
        headers: { "user-agent": "CapturedUA", origin: "https://jimeng.jianying.com" },
        postData: JSON.stringify({
          submit_id: "old-submit",
          metrics_extra: JSON.stringify({ sceneOptions: JSON.stringify([{ videoDuration: 3, reportParams: {} }]) }),
          draft_content: JSON.stringify(draft),
        }),
      },
      {
        kind: "request",
        url: "https://jimeng.jianying.com/mweb/v1/get_history_by_ids",
        headers: { "user-agent": "CapturedUA" },
        postData: JSON.stringify({ submit_ids: [] }),
      },
    ],
  }
}
