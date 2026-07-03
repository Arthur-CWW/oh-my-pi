import { Database } from "bun:sqlite"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"
import { describe, expect, test } from "bun:test"
import { EvalStore } from "./eval-store"
import { route } from "./server"
import { UgcJsonStore } from "./ugc-json-store"
import type { ActionJob, AnnotationRecord, BootstrapPayload, EvalElementDetail } from "../types"

interface AnnotationWritePayload {
  key: string
  annotation: AnnotationRecord
  annotations: Record<string, AnnotationRecord>
}

interface AnnotationReadPayload {
  key: string
  annotation: AnnotationRecord
}

interface ActionJobPayload {
  job: ActionJob
}

describe("EvalStore daemon annotations and dry-run actions", () => {
  test("persists annotations and includes them in bootstrap and detail payloads", async () => {
    const { evalStore, ugcStore, annotationsPath } = createStores()

    const createResponse = await route(jsonRequest("/api/annotations", {
      targetId: "result_1",
      targetKind: "video_eval_result",
      title: "Needs tighter caption read",
      note: "Good hook, rerun with fewer frames.",
      tags: ["hook", "caption"],
      status: "needs_rerun",
      rating: 1,
    }), evalStore, ugcStore)
    expect(createResponse.status).toBe(200)
    const created = await createResponse.json() as AnnotationWritePayload
    expect(created.key).toBe("video_eval_result:result_1")
    expect(created.annotation.createdAt).toBe(created.annotation.updatedAt)
    expect(existsSync(annotationsPath)).toBe(true)

    const updateResponse = await route(jsonRequest(`/api/annotations/${encodeURIComponent(created.key)}`, {
      targetId: "result_1",
      targetKind: "video_eval_result",
      title: "Accepted rerun note",
      note: "Keep the hook and rerun selected result only.",
      tags: ["hook", "rerun"],
      status: "follow_up",
      rating: 2,
    }, "PUT"), evalStore, ugcStore)
    expect(updateResponse.status).toBe(200)
    const updated = await updateResponse.json() as AnnotationWritePayload
    expect(updated.annotation.createdAt).toBe(created.annotation.createdAt)
    expect(updated.annotation.updatedAt >= created.annotation.updatedAt).toBe(true)
    expect(updated.annotation.status).toBe("follow_up")

    const readResponse = await route(new Request(`http://127.0.0.1/api/annotations/${encodeURIComponent(created.key)}`), evalStore, ugcStore)
    const read = await readResponse.json() as AnnotationReadPayload
    expect(read.annotation.note).toContain("rerun selected")

    const bootstrapResponse = await route(new Request("http://127.0.0.1/api/bootstrap"), evalStore, ugcStore)
    const bootstrap = await bootstrapResponse.json() as BootstrapPayload
    expect(bootstrap.annotations[created.key]?.status).toBe("follow_up")

    const detailResponse = await route(new Request("http://127.0.0.1/api/elements/result_1"), evalStore, ugcStore)
    const detail = await detailResponse.json() as EvalElementDetail
    expect(detail.sectionAnnotations[created.key]?.rating).toBe(2)
    expect(readFileSync(annotationsPath, "utf8")).toContain("slotok-workbench.annotations/v1")
  })

  test("rejects unchecked annotation bodies before they reach the store", async () => {
    const { evalStore, ugcStore, annotationsPath } = createStores()

    const response = await route(jsonRequest("/api/annotations", {
      targetId: "result_1",
      targetKind: "video_eval_result",
      note: "Invalid status must not persist.",
      tags: ["bad-boundary"],
      status: "not-a-status",
      rating: 1,
    }), evalStore, ugcStore)

    expect(response.status).toBe(400)
    expect(existsSync(annotationsPath)).toBe(false)
  })

  test("plans deterministic dry-run rerun jobs without provider execution", async () => {
    const { evalStore, ugcStore } = createStores()
    const body = {
      targetId: "result_1",
      targetKind: "video_eval_result",
      scope: "selected",
      provider: "google",
      maxFrames: 4,
      maxOutputTokens: 1024,
    }

    const firstResponse = await route(jsonRequest("/api/actions/rerun", body), evalStore, ugcStore)
    const secondResponse = await route(jsonRequest("/api/actions/rerun", body), evalStore, ugcStore)
    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    const first = await firstResponse.json() as ActionJobPayload
    const second = await secondResponse.json() as ActionJobPayload

    expect(second.job.id).toBe(first.job.id)
    expect(first.job.dryRun).toBe(true)
    expect(first.job.status).toBe("completed")
    expect(first.job.command).toEqual([
      "bun",
      "scripts/eval-video-understanding.ts",
      "--videos",
      "data/videos/source.mp4",
      "--providers",
      "google",
      "--limit",
      "1",
      "--max-frames",
      "4",
      "--out",
      `data/provider-evals/video-understanding/reruns/${first.job.id}`,
      "--cache-dir",
      "data/provider-evals/video-understanding/cache",
      "--sqlite",
      evalStore.config.sqlitePath,
      "--max-output-tokens",
      "1024",
    ])
    expect(first.job.command).not.toContain("--live")
    expect(first.job.stdout).toContain("not executed")
  })

  test("rejects unchecked action bodies before planning dry-run jobs", async () => {
    const { evalStore, ugcStore } = createStores()

    const response = await route(jsonRequest("/api/actions/rerun", {
      targetId: "result_1",
      targetKind: "video_eval_result",
      maxFrames: "four",
    }), evalStore, ugcStore)

    expect(response.status).toBe(400)
  })

  test("rejects unsafe HyperFrames render requests before spawning renderer work", async () => {
    const { evalStore, ugcStore } = createStores()

    const missingBootstrapField = await route(jsonRequest("/api/ugc/hyperframes/render", {
      sampleId: "sample-1",
    }), evalStore, ugcStore)
    expect(missingBootstrapField.status).toBe(400)

    const unsafeSampleId = await route(jsonRequest("/api/ugc/hyperframes/render", {
      bootstrapRoot: ".",
      sampleId: "../sample-1",
    }), evalStore, ugcStore)
    expect(unsafeSampleId.status).toBe(400)

    const bootstrapRoot = resolve(evalStore.config.cwd, "bootstrap")
    mkdirSync(bootstrapRoot, { recursive: true })
    const missingLayerPlan = await route(jsonRequest("/api/ugc/hyperframes/render", {
      bootstrapRoot: "bootstrap",
      sampleId: "sample-1",
    }), evalStore, ugcStore)
    expect(missingLayerPlan.status).toBe(404)
    expect(await missingLayerPlan.json()).toEqual({ error: "birthrate-layer-plan.json not found" })

    const outsideRoot = mkdtempSync(resolve(tmpdir(), "slotok-daemon-outside-"))
    const outsideBootstrap = await route(jsonRequest("/api/ugc/hyperframes/render", {
      bootstrapRoot: outsideRoot,
      sampleId: "sample-1",
    }), evalStore, ugcStore)
    expect(outsideBootstrap.status).toBe(403)

    writeFileSync(resolve(bootstrapRoot, "birthrate-layer-plan.json"), "{}")
    const rendererPath = resolve(evalStore.config.cwd, "packages/hyperframes-renderer/src/render.ts")
    mkdirSync(dirname(rendererPath), { recursive: true })
    writeFileSync(rendererPath, "")
    const missingAudio = await route(jsonRequest("/api/ugc/hyperframes/render", {
      bootstrapRoot: "bootstrap",
      sampleId: "sample-1",
      audio: "missing.wav",
    }), evalStore, ugcStore)
    expect(missingAudio.status).toBe(404)
    expect(await missingAudio.json()).toEqual({ error: "audio not found" })
  })
})

function createStores(): { evalStore: EvalStore; ugcStore: UgcJsonStore; annotationsPath: string } {
  const cwd = mkdtempSync(resolve(tmpdir(), "slotok-daemon-"))
  const sqlitePath = resolve(cwd, "evals.sqlite")
  const annotationsPath = resolve(cwd, "annotations.json")
  seedEvalDb(sqlitePath)
  return {
    evalStore: new EvalStore({ cwd, sqlitePath, annotationsPath, startedAt: "2026-06-13T00:00:00.000Z" }),
    ugcStore: new UgcJsonStore({ cwd, root: "ugc-workspaces", now: () => "2026-06-13T00:00:00.000Z" }),
    annotationsPath,
  }
}

function seedEvalDb(sqlitePath: string): void {
  mkdirSync(dirname(sqlitePath), { recursive: true })
  const db = new Database(sqlitePath)
  try {
    db.run(`
      CREATE TABLE eval_runs (
        run_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        live INTEGER NOT NULL,
        providers_json TEXT NOT NULL,
        videos_json TEXT NOT NULL,
        video_count INTEGER NOT NULL,
        limit_count INTEGER NOT NULL,
        max_frames INTEGER NOT NULL,
        frame_every_seconds REAL NOT NULL,
        max_output_tokens INTEGER,
        prompt_hash TEXT NOT NULL,
        google_model TEXT,
        kie_model TEXT,
        out_dir TEXT NOT NULL,
        cache_dir TEXT NOT NULL
      )
    `)
    db.run(`
      CREATE TABLE eval_results (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        video_id TEXT NOT NULL,
        video_path TEXT NOT NULL,
        duration_seconds REAL,
        width INTEGER,
        height INTEGER,
        frame_count INTEGER NOT NULL,
        frames_json TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        cache_status TEXT NOT NULL,
        cache_path TEXT NOT NULL,
        response_path TEXT,
        parsed_path TEXT,
        error TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        thoughts_tokens INTEGER,
        usage_json TEXT,
        latency_ms INTEGER,
        estimated_cost_usd REAL,
        avoided_cost_usd REAL,
        raw_credits_consumed REAL,
        finish_reason TEXT,
        output_chars INTEGER,
        parsed_ok INTEGER
      )
    `)
    db.query(`
      INSERT INTO eval_runs (
        run_id, created_at, live, providers_json, videos_json, video_count, limit_count,
        max_frames, frame_every_seconds, max_output_tokens, prompt_hash, google_model, kie_model, out_dir, cache_dir
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run_1",
      "2026-06-13T00:00:00.000Z",
      0,
      JSON.stringify(["google"]),
      JSON.stringify(["data/videos/source.mp4"]),
      1,
      1,
      6,
      3,
      4096,
      "prompt_hash",
      "gemini-2.5-pro",
      null,
      "data/provider-evals/video-understanding/runs/run_1",
      "data/provider-evals/video-understanding/cache",
    )
    db.query(`
      INSERT INTO eval_results (
        id, run_id, created_at, video_id, video_path, duration_seconds, width, height,
        frame_count, frames_json, provider, model, status, request_hash, cache_status,
        cache_path, response_path, parsed_path, error, prompt_tokens, completion_tokens,
        total_tokens, thoughts_tokens, usage_json, latency_ms, estimated_cost_usd,
        avoided_cost_usd, raw_credits_consumed, finish_reason, output_chars, parsed_ok
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "result_1",
      "run_1",
      "2026-06-13T00:00:00.000Z",
      "video_1",
      "data/videos/source.mp4",
      8,
      720,
      1280,
      2,
      JSON.stringify([{ path: "frame-0001.jpg", sha256: "abc", mimeType: "image/jpeg", timestampSeconds: 0, index: 0 }]),
      "google",
      "gemini-2.5-pro",
      "dry_run",
      "request_hash_1",
      "miss_dry_run",
      "data/provider-evals/video-understanding/cache/google/request_hash_1.json",
      null,
      null,
      null,
      10,
      20,
      30,
      null,
      JSON.stringify({ totalTokenCount: 30 }),
      0,
      0,
      0.01,
      null,
      "stop",
      128,
      1,
    )
  } finally {
    db.close()
  }
}

function jsonRequest(path: string, body: object, method = "POST"): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}
