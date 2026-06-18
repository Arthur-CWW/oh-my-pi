import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ingestJimengProofIntoArtifactLog, JimengArtifactLog, JimengArtifactLogEffectClient } from "../src/artifact-log"
import { main, serveJimengArtifactDashboard } from "../src/artifact-dashboard"

describe("Jimeng artifact dashboard registry", () => {
  test("ingests proof runs, artifacts, and implementation status into SQLite", () => {
    const fixture = createProofFixture()
    try {
      const snapshot = ingestJimengProofIntoArtifactLog({
        dbPath: fixture.db,
        proofRoot: fixture.root,
        workerId: "JimengWorker",
        command: "bun jimeng-dreamina text2video --prompt '中文 with English dialogue'",
        commandCwd: fixture.root,
        notes: "live proof",
        nowMs: () => 1000,
      })
      expect(snapshot.runs).toHaveLength(1)
      expect(snapshot.runs[0]?.functionName).toBe("text2video / video")
      expect(snapshot.runs[0]?.artifacts[0]?.mime).toBe("video/mp4")
      expect(snapshot.runs[0]?.artifacts[0]?.relativePath).toBe("artifacts/clip.mp4")

      const log = new JimengArtifactLog({ dbPath: fixture.db, nowMs: () => 2000 })
      try {
        log.upsertWorkItem({
          id: "gen-parity",
          title: "Generation parity",
          status: "partial",
          owner: "Main",
          category: "jimeng-api",
          summary: "Text-to-video is live-proven; text-to-image still blocked by permission capture.",
          nextAction: "Refresh text-to-image capture and rerun live submit.",
        })
        const afterStatus = log.snapshot()
        expect(afterStatus.workItems).toHaveLength(1)
        expect(afterStatus.workItems[0]?.status).toBe("partial")
        expect(afterStatus.workItems[0]?.nextAction).toContain("Refresh text-to-image")
      } finally {
        log.close()
      }
    } finally {
      fixture.dispose()
    }
  })

  test("sets, claims, and serves packet ledger rows", async () => {
    const fixture = createProofFixture()
    try {
      const setOutput = await captureConsoleLog(() => main([
        "packet",
        "set",
        "--db",
        fixture.db,
        "--id",
        "packet-a",
        "--title",
        "Template mining",
        "--family",
        "jimeng-api",
        "--category",
        "generation",
        "--priority",
        "10",
        "--status",
        "todo",
        "--next",
        "bun probe template",
      ]))
      await captureConsoleLog(() => main([
        "packet",
        "set",
        "--db",
        fixture.db,
        "--id",
        "packet-b",
        "--title",
        "Renderer review",
        "--priority",
        "20",
        "--status",
        "review",
      ]))
      expect(setOutput).toContain("packet saved id=packet-a status=todo")

      const log = new JimengArtifactLog({ dbPath: fixture.db, nowMs: () => 3000 })
      try {
        const snapshot = log.snapshot()
        expect(snapshot.packets.map((packet) => packet.id)).toEqual(["packet-a", "packet-b"])
        expect(log.nextPacket()?.id).toBe("packet-a")
      } finally {
        log.close()
      }

      const nextOutput = await captureConsoleLog(() => main(["packet", "next", "--db", fixture.db, "--claim", "JimengWorker"]))
      expect(nextOutput).toContain("packet claimed id=packet-a status=in_progress")

      const afterClaim = new JimengArtifactLog({ dbPath: fixture.db })
      try {
        const packet = afterClaim.snapshot().packets[0]
        expect(packet?.id).toBe("packet-a")
        expect(packet?.status).toBe("in_progress")
        expect(packet?.currentWorker).toBe("JimengWorker")
        expect(afterClaim.nextPacket()?.id).toBe("packet-b")
      } finally {
        afterClaim.close()
      }

      ingestJimengProofIntoArtifactLog({ dbPath: fixture.db, proofRoot: fixture.root })
      const server = serveJimengArtifactDashboard({ dbPath: fixture.db, rootDir: fixture.root, port: 0 })
      try {
        const html = await (await fetch(server.url)).text()
        const snapshot = await (await fetch(new URL("/api/snapshot", server.url))).json()
        const media = await fetch(new URL(`/file?path=${encodeURIComponent(fixture.video)}`, server.url))
        expect(html).toContain("Packet queue")
        expect(snapshot.packets).toHaveLength(2)
        expect(snapshot.packets[0]?.id).toBe("packet-a")
        expect(snapshot.runs).toHaveLength(1)
        expect(media.status).toBe(200)
        expect(media.headers.get("content-type")).toBe("video/mp4")
      } finally {
        server.stop()
      }
    } finally {
      fixture.dispose()
    }
  })

  test("packet next ignores non-claimable statuses through the Effect boundary", async () => {
    const fixture = createProofFixture()
    const log = new JimengArtifactLog({ dbPath: fixture.db, nowMs: () => 1000 })
    try {
      for (const status of ["in_progress", "blocked", "done", "skipped"] as const) {
        log.upsertPacket({
          id: `packet-${status}`,
          title: status,
          priority: 0,
          status,
        })
      }
      log.upsertPacket({
        id: "packet-review",
        title: "Reviewable",
        priority: 10,
        status: "review",
      })
      log.upsertPacket({
        id: "packet-todo",
        title: "Todo",
        priority: 5,
        status: "todo",
      })

      const client = new JimengArtifactLogEffectClient(log)
      const next = await Effect.runPromise(client.nextPacket())
      const snapshot = await Effect.runPromise(client.snapshot())

      expect(next?.id).toBe("packet-todo")
      expect(snapshot.packets.map((packet) => packet.id)).toEqual([
        "packet-in_progress",
        "packet-blocked",
        "packet-done",
        "packet-skipped",
        "packet-todo",
        "packet-review",
      ])
    } finally {
      log.close()
      fixture.dispose()
    }
  })
})

async function captureConsoleLog(run: () => Promise<void>): Promise<string> {
  const original = console.log
  const lines: string[] = []
  console.log = (...values: Parameters<typeof console.log>) => {
    lines.push(values.map(String).join(" "))
  }
  try {
    await run()
    return lines.join("\n")
  } finally {
    console.log = original
  }
}

function createProofFixture(): { root: string; db: string; video: string; dispose: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "jimeng-artifact-dashboard-"))
  const normalized = path.join(root, "normalized")
  const artifacts = path.join(root, "artifacts")
  mkdirSync(normalized)
  mkdirSync(artifacts)
  const video = path.join(artifacts, "clip.mp4")
  writeFileSync(video, "fake video")
  writeFileSync(path.join(normalized, "text2video-result.json"), `${JSON.stringify({
    plan: {
      command: "text2video",
      op: "video",
      submit_id: "submit-001",
      submit_body: { prompt: "中文提示 with English dialogue" },
    },
    submit: { submitId: "submit-001", historyId: "history-001" },
    pollTrace: [{ status: 50, itemCount: 1, httpStatus: 200 }],
    artifacts: [{ kind: "video", saved_file: video, url: "https://cdn.example.test/video.mp4?token=secret" }],
  }, null, 2)}\n`)
  return {
    root,
    db: path.join(root, "artifact-log.sqlite"),
    video,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  }
}
