import { appendFile, mkdir } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const RUN_POINTER = join(ROOT, "data/provider-evals/video-understanding/runs/latest-antigravity-native.json");
const LABEL_DIR = join(ROOT, "data/provider-evals/video-understanding/labels");
const LABEL_FILE = join(LABEL_DIR, "labels.jsonl");
const APP_DATA_DIR = join(ROOT, "data/video-eval-viewer");
const ERROR_FILE = join(APP_DATA_DIR, "errors.log");
const INDEX_FILE = join(import.meta.dir, "public/index.html");

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };
type Clip = { clipId: string; videoPath: string; durationSeconds: number; width: number; height: number; provider: Obj; parsed: Obj | null; frames: string[]; promptPath: string };
type Label = { clipId: string; lane: string; dimension?: string; checkId?: string; label: string; note?: string; ts: number };

function isObj(value: Json): value is Obj { return typeof value === "object" && value !== null && !Array.isArray(value); }
function str(value: Json | undefined): string | null { return typeof value === "string" ? value : null; }
function num(value: Json | undefined): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function arr(value: Json | undefined): Json[] { return Array.isArray(value) ? value : []; }
async function readJson(path: string): Promise<Json | null> { try { return JSON.parse(await Bun.file(path).text()) as Json; } catch { return null; } }
function withinRoot(path: string): string | null { const absolute = resolve(ROOT, normalize(path)); return absolute === ROOT || absolute.startsWith(`${ROOT}/`) ? absolute : null; }

async function loadData(): Promise<{ clips: Clip[]; runId: string; promptPath: string }> {
  const pointer = await readJson(RUN_POINTER); const po = isObj(pointer) ? pointer : {};
  const manifestPath = str(po.manifest); const resultsPath = str(po.results);
  const manifest = manifestPath ? await readJson(withinRoot(manifestPath) ?? "") : null;
  const results = resultsPath ? await readJson(withinRoot(resultsPath) ?? "") : null;
  const mo = isObj(manifest) ? manifest : {}; const rows = arr(results ?? null);
  const promptPath = str(mo.promptFile) ?? ""; const runId = str(mo.runId) ?? "unknown";
  const clips: Clip[] = [];
  for (const row of rows) {
    if (!isObj(row)) continue;
    const sample = isObj(row.sample) ? row.sample : {};
    const videoPath = str(row.video) ?? str(sample.inputPath); if (!videoPath) continue;
    const providers = arr(row.providers).filter(isObj); const provider = providers[0] ?? {};
    const parsedPath = str(provider.parsedPath); const parsedJson = parsedPath ? await readJson(withinRoot(parsedPath) ?? "") : null;
    const frames = arr(sample.frames).flatMap((frame) => isObj(frame) ? [str(frame.path) ?? str(frame.file)].filter((x): x is string => x !== null) : []);
    const clipId = str(sample.id) ?? videoPath.split("/").pop() ?? `clip-${clips.length + 1}`;
    clips.push({ clipId, videoPath, durationSeconds: num(sample.durationSeconds) ?? 0, width: num(sample.width) ?? 0, height: num(sample.height) ?? 0, provider, parsed: isObj(parsedJson) ? parsedJson : null, frames, promptPath });
  }
  return { clips, runId, promptPath };
}


async function appendLine(path: string, line: string): Promise<void> {
  await appendFile(path, line);
}
await Promise.all([mkdir(LABEL_DIR, { recursive: true }), mkdir(APP_DATA_DIR, { recursive: true })]);
await Promise.all([appendFile(LABEL_FILE, ""), appendFile(ERROR_FILE, "")]);
function json(data: Json, status = 200): Response { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
const server = Bun.serve({ port: Number(Bun.env.PORT ?? 3000), async fetch(req) {
  const url = new URL(req.url);
  try {
    if (url.pathname === "/" && req.method === "GET") {
      return new Response(Bun.file(INDEX_FILE), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === "/api/labels" && req.method === "POST") { const body = await req.json() as Json; if (!isObj(body) || !str(body.clipId) || !str(body.lane) || !str(body.label) || !num(body.ts)) return json({ error: "invalid label" }, 400); await appendLine(LABEL_FILE, `${JSON.stringify(body)}\n`); return json({ ok: true }); }
    if (url.pathname === "/api/client-errors" && req.method === "POST") { const body = await req.json() as Json; await appendLine(ERROR_FILE, `${JSON.stringify(body)}\n`); return json({ ok: true }); }
    if (url.pathname === "/healthz") return json({ ok: true });
    if (url.pathname === "/api/data") return json(await loadData() as unknown as Json);
    if (url.pathname === "/artifact") { const path = url.searchParams.get("path"); const absolute = path ? withinRoot(path) : null; if (!absolute) return new Response("bad path", { status: 400 }); const file = Bun.file(absolute); return file.size ? new Response(file) : new Response("not found", { status: 404 }); }
    return new Response("not found", { status: 404 });
  } catch (error) { await appendLine(ERROR_FILE, `${JSON.stringify({ message: error instanceof Error ? error.message : "server error", ts: Date.now() })}\n`); return json({ error: "server error" }, 500); }
}}); console.log(`video-eval-viewer listening on ${server.port}`);
