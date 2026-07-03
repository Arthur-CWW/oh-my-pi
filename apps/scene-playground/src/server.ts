import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { openLedger, type EditRecord, type EditStats, type Ledger } from "./ledger";
import { openLabels, type LabelsStore, type GroupWithCount, type LabelRow } from "./labels";
import { appendError, caughtErrorInput, listRecentErrors, type ErrorLogEntry } from "./errors";

const APP_DIR = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(APP_DIR, "../..");
const DEFAULT_PORT = 4600;
const ASSET_EXTENSIONS: Record<string, true> = { ".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".mp3": true, ".wav": true, ".mp4": true, ".gif": true };
const IMAGE_EXTENSIONS: Record<string, true> = { ".png": true, ".jpg": true, ".jpeg": true, ".webp": true };
const AUDIO_EXTENSIONS: Record<string, true> = { ".mp3": true, ".wav": true };
const VIDEO_EXTENSIONS: Record<string, true> = { ".mp4": true };
const MAX_ASSETS = 500;
const MAX_ASSET_DEPTH = 4;
const SSE_HEARTBEAT_MS = 20_000;
const RECENT_PUT_HASH_TTL_MS = 30_000;
const WATCH_DUPLICATE_WINDOW_MS = 500;

export interface ServerOptions {
  repoRoot?: string;
  appDir?: string;
  distDir?: string;
  buildUi?: boolean;
  watchUi?: boolean;
  sseHeartbeatMs?: number;
}

interface AssetEntry {
  path: string;
  kind: "image" | "audio" | "video";
  bytes: number;
}

interface SpecEntry {
  path: string;
  mtime: string;
  bytes: number;
  lastActor: "human" | "agent" | null;
  humanEdits: number;
  agentEdits: number;
}

interface RenderEntry {
  path: string;
  mtime: string;
  bytes: number;
  manifest: JsonValue | null;
}

interface ReportEntry {
  path: string;
  title: string;
  date: string;
  agent: string;
  status: string;
  excerpt: string;
  media: string[];
  mtime: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
type JsonPayload = JsonValue | SpecEntry[] | AssetEntry[] | RenderEntry[] | ReportEntry[] | EditRecord[] | EditStats | ErrorLogEntry[] | { error: string } | { ok: true; path: string };

interface AppPaths {
  repoRoot: string;
  appDir: string;
  distDir: string;
  specsDir: string;
  rendersDir: string;
  reportsDir: string;
  thumbsDir: string;
  assetRoots: string[];
  streamRoots: string[];
  runtimePath: string;
}

interface EventClient {
  send: (event: string) => void;
  close: () => void;
}

interface RecentPutEntry {
  contentHash: string;
  ts: number;
}

interface RecentWatchHashEntry {
  contentHash: string;
  ts: number;
}

export interface ScenePlaygroundApp {
  fetch: (request: Request) => Promise<Response>;
  close: () => void;
  paths: AppPaths;
}

function jsonResponse(value: JsonPayload, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
}

function textResponse(message: string, status = 200): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}

interface ClientErrorBody {
  message: string;
  stack?: string;
  url?: string;
}

function decodeClientErrorBody(value: unknown): ClientErrorBody | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.message !== "string" || record.message.trim().length === 0) return null;
  const body: ClientErrorBody = { message: record.message };
  if (typeof record.stack === "string") body.stack = record.stack;
  if (typeof record.url === "string") body.url = record.url;
  return body;
}

function toRepoPath(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).split(sep).join("/");
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
}

function resolveSpecPath(paths: AppPaths, requestPath: string): string | null {
  const trimmed = requestPath.trim();
  if (trimmed.length === 0) return null;
  const repoPrefix = "workflows/scene-lab/specs/";
  const relativePath = trimmed.startsWith(repoPrefix) ? trimmed.slice(repoPrefix.length) : trimmed;
  const target = resolve(paths.specsDir, relativePath);
  if (!isInside(paths.specsDir, target) || !target.endsWith(".scene.json")) return null;
  return target;
}

function resolveAssetPath(paths: AppPaths, requestPath: string): string | null {
  const trimmed = requestPath.trim();
  if (trimmed.length === 0) return null;
  const relativeRequestPath = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const target = resolve(paths.repoRoot, relativeRequestPath);
  if (!paths.streamRoots.some((root) => isInside(root, target))) return null;
  const extension = extname(target).toLowerCase();
  if (ASSET_EXTENSIONS[extension] !== true) return null;
  return target;
}

const REPORT_MEDIA_RE = /\.(png|mp4|json)$/i;

function resolveReportPath(paths: AppPaths, requestPath: string): string | null {
  const trimmed = requestPath.trim();
  if (trimmed.length === 0) return null;
  const rel = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const target = resolve(paths.repoRoot, rel);
  if (!isInside(paths.reportsDir, target)) return null;
  const ext = extname(target).toLowerCase();
  if (ext !== ".md" && ext !== ".png" && ext !== ".mp4" && ext !== ".json") return null;
  return target;
}

function assetKind(path: string): AssetEntry["kind"] {
  const extension = extname(path).toLowerCase();
  if (IMAGE_EXTENSIONS[extension] === true) return "image";
  if (AUDIO_EXTENSIONS[extension] === true) return "audio";
  if (VIDEO_EXTENSIONS[extension] === true) return "video";
  return "image";
}

async function ensureLabDirs(paths: AppPaths): Promise<void> {
  await mkdir(paths.specsDir, { recursive: true });
  await mkdir(paths.rendersDir, { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  await mkdir(paths.thumbsDir, { recursive: true });
}

async function listSpecs(paths: AppPaths, ledger: Ledger): Promise<SpecEntry[]> {
  await mkdir(paths.specsDir, { recursive: true });
  const entries: SpecEntry[] = [];
  async function walk(dir: string): Promise<void> {
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children) {
      const childPath = join(dir, child.name);
      if (child.isDirectory()) {
        await walk(childPath);
      } else if (child.isFile() && child.name.endsWith(".scene.json")) {
        const info = await stat(childPath);
        const path = toRepoPath(paths.repoRoot, childPath);
        const stats = ledger.statsForPath(path);
        entries.push({ path, mtime: info.mtime.toISOString(), bytes: info.size, lastActor: stats.lastActor, humanEdits: stats.humanEdits, agentEdits: stats.agentEdits });
      }
    }
  }
  await walk(paths.specsDir);
  entries.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return entries;
}

async function listAssets(paths: AppPaths): Promise<AssetEntry[]> {
  const entries: AssetEntry[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (entries.length >= MAX_ASSETS || depth > MAX_ASSET_DEPTH || !existsSync(dir)) return;
    const children = await readdir(dir, { withFileTypes: true });
    for (const child of children) {
      if (entries.length >= MAX_ASSETS) return;
      const childPath = join(dir, child.name);
      if (child.isDirectory()) {
        await walk(childPath, depth + 1);
      } else if (child.isFile()) {
        const extension = extname(child.name).toLowerCase();
        if (ASSET_EXTENSIONS[extension] !== true) continue;
        const info = await stat(childPath);
        entries.push({ path: toRepoPath(paths.repoRoot, childPath), kind: assetKind(childPath), bytes: info.size });
      }
    }
  }
  for (const root of paths.assetRoots) await walk(root, 0);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return entries;
}

async function listRenders(paths: AppPaths): Promise<RenderEntry[]> {
  if (!existsSync(paths.rendersDir)) return [];
  const entries: RenderEntry[] = [];
  const children = await readdir(paths.rendersDir, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const scenePath = join(paths.rendersDir, child.name, "scene.mp4");
    if (!existsSync(scenePath)) continue;
    const info = await stat(scenePath);
    const manifestPath = join(paths.rendersDir, child.name, "manifest.json");
    let manifest: JsonValue | null = null;
    if (existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8")) as JsonValue;
      } catch {
        manifest = { error: "manifest.json is not valid JSON" };
      }
    }
    entries.push({ path: toRepoPath(paths.repoRoot, scenePath), mtime: info.mtime.toISOString(), bytes: info.size, manifest });
  }
  entries.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return entries;
}

function parseFrontMatter(content: string): { meta: Record<string, string>; body: string } {
  const lines = content.split("\n");
  const meta: Record<string, string> = {};
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === "") {
      bodyStart = i + 1;
      break;
    }
    const colon = line.indexOf(":");
    if (colon < 0) {
      bodyStart = i;
      break;
    }
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: lines.slice(bodyStart).join("\n").trim() };
}

function extractExcerpt(body: string): string {
  for (const block of body.split("\n\n")) {
    const trimmed = block.trim();
    if (trimmed.length === 0) continue;
    if (/^#{1,6}\s/.test(trimmed)) continue;
    if (/^[-*]\s/.test(trimmed)) continue;
    if (trimmed.startsWith("```")) continue;
    return trimmed;
  }
  return "";
}

async function listReports(paths: AppPaths): Promise<ReportEntry[]> {
  if (!existsSync(paths.reportsDir)) return [];
  const entries: ReportEntry[] = [];
  const children = await readdir(paths.reportsDir, { withFileTypes: true });
  for (const child of children) {
    if (!child.isDirectory()) continue;
    const reportPath = join(paths.reportsDir, child.name, "report.md");
    if (!existsSync(reportPath)) continue;
    const content = await readFile(reportPath, "utf8");
    const { meta, body } = parseFrontMatter(content);
    const dirInfo = await stat(join(paths.reportsDir, child.name));
    const dirFiles = await readdir(join(paths.reportsDir, child.name));
    const dirRepoPath = toRepoPath(paths.repoRoot, join(paths.reportsDir, child.name));
    const media = dirFiles
      .filter((f) => f !== "report.md" && REPORT_MEDIA_RE.test(f))
      .map((f) => `${dirRepoPath}/${f}`);
    const excerpt = extractExcerpt(body);
    entries.push({
      path: dirRepoPath,
      title: meta.title ?? child.name,
      date: meta.date ?? "",
      agent: meta.agent ?? "",
      status: meta.status ?? "",
      excerpt,
      media,
      mtime: dirInfo.mtime.toISOString(),
    });
  }
  entries.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return entries;
}

function mimeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".json") return "application/json; charset=utf-8";
  if (extension === ".md") return "text/markdown; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".mp3") return "audio/mpeg";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".mp4") return "video/mp4";
  return "application/octet-stream";
}

interface ParsedRange {
  start: number;
  end: number;
}

function parseByteRange(rangeHeader: string | null, size: number): ParsedRange | null {
  if (rangeHeader === null) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
  if (match === null) return null;
  const startText = match[1]!;
  const endText = match[2]!;
  const start = Number.parseInt(startText, 10);
  if (!Number.isSafeInteger(start) || start >= size) return null;
  const end = endText === "" ? size - 1 : Number.parseInt(endText, 10);
  if (!Number.isSafeInteger(end) || end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function serveFile(path: string, request?: Request): Promise<Response> {
  const info = await stat(path);
  if (!info.isFile()) return textResponse("Not found", 404);
  if (request === undefined) return new Response(Bun.file(path), { headers: { "content-type": mimeFor(path) } });
  const isHead = request.method === "HEAD";
  const size = info.size;
  const contentType = mimeFor(path);
  const rangeHeader = request.headers.get("range");
  const baseHeaders = {
    "accept-ranges": "bytes",
    "content-type": contentType,
  };
  if (rangeHeader === null) {
    return new Response(isHead ? null : Bun.file(path), {
      headers: { ...baseHeaders, "content-length": String(size) },
    });
  }
  const range = parseByteRange(rangeHeader, size);
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "content-range": `bytes */${size}`, "content-length": "0" },
    });
  }
  const contentLength = range.end - range.start + 1;
  return new Response(isHead ? null : Bun.file(path).slice(range.start, range.end + 1), {
    status: 206,
    headers: {
      ...baseHeaders,
      "content-length": String(contentLength),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}

async function buildUi(appDir: string, distDir: string): Promise<void> {
  await mkdir(distDir, { recursive: true });
  await Bun.build({
    entrypoints: [join(appDir, "src/ui/main.ts")],
    outdir: distDir,
    target: "browser",
    format: "esm",
    sourcemap: "external",
    minify: false,
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
  });
  await copyFile(join(appDir, "src/ui/index.html"), join(distDir, "index.html"));
  const tokensPath = join(appDir, "src/ui/tokens.css");
  if (existsSync(tokensPath)) await copyFile(tokensPath, join(distDir, "tokens.css"));
}

function watchUi(appDir: string, distDir: string): FSWatcher[] {
  const uiDir = join(appDir, "src/ui");
  let building = false;
  let queued = false;
  const rebuild = (): void => {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    buildUi(appDir, distDir)
      .catch((error: Error) => console.error(`[scene-playground] UI build failed: ${error.message}`))
      .finally(() => {
        building = false;
        if (queued) {
          queued = false;
          rebuild();
        }
      });
  };
  return [watch(uiDir, { recursive: true }, rebuild)];
}

function emitEvent(clients: Set<EventClient>, event: JsonValue): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) client.send(payload);
}

function watchLab(paths: AppPaths, clients: Set<EventClient>, ledger: Ledger, recentPuts: Map<string, RecentPutEntry>, recentWatchHashes: Map<string, RecentWatchHashEntry>): FSWatcher[] {
  const watchers: FSWatcher[] = [];
  const recordAgentEditFromDisk = (fullPath: string, checkRecentPut: boolean): void => {
    void (async () => {
      if (!existsSync(fullPath)) return;
      const content = await readFile(fullPath, "utf8");
      const contentHash = createHash("sha256").update(content).digest("hex");
      const now = Date.now();
      if (checkRecentPut) {
        const recentPut = recentPuts.get(fullPath);
        if (recentPut !== undefined) {
          if (now - recentPut.ts > RECENT_PUT_HASH_TTL_MS) {
            recentPuts.delete(fullPath);
          } else if (recentPut.contentHash === contentHash) {
            recentPuts.delete(fullPath);
            return;
          }
        }
      }

      const recentWatchHash = recentWatchHashes.get(fullPath);
      if (recentWatchHash !== undefined && recentWatchHash.contentHash === contentHash && now - recentWatchHash.ts < WATCH_DUPLICATE_WINDOW_MS) return;
      const path = toRepoPath(paths.repoRoot, fullPath);
      const latest = ledger.latestForPath(path);
      if (latest?.contentHash === contentHash) {
        recentWatchHashes.set(fullPath, { contentHash, ts: now });
        return;
      }

      const agentId = process.env.SCENE_AGENT_ID;
      ledger.recordEdit({ path, actor: "agent", agentHint: agentId && agentId.length > 0 ? agentId : null, content });
      recentWatchHashes.set(fullPath, { contentHash, ts: now });
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[scene-playground] failed to record ledger edit for ${fullPath}: ${message}`);
    });
  };
  const addWatch = (dir: string, type: "spec-changed" | "render-added" | "report-added"): void => {
    if (!existsSync(dir)) return;
    watchers.push(
      watch(dir, { recursive: true }, (_event, filename) => {
        const name = typeof filename === "string" ? filename : "";
        if (name.length === 0) return;
        const fullPath = resolve(dir, name);
        if (type === "spec-changed" && !fullPath.endsWith(".scene.json")) return;
        if (type === "render-added" && basename(fullPath) !== "scene.mp4" && basename(fullPath) !== "manifest.json") return;
        if (type === "report-added" && basename(fullPath) !== "report.md") return;
        if (type === "spec-changed") recordAgentEditFromDisk(fullPath, true);
        if (type === "report-added") recordAgentEditFromDisk(fullPath, false);
        const emitPath = type === "report-added" ? dirname(fullPath) : fullPath;
        emitEvent(clients, { type, path: toRepoPath(paths.repoRoot, emitPath) });
      }),
    );
  };
  addWatch(paths.specsDir, "spec-changed");
  addWatch(paths.rendersDir, "render-added");
  addWatch(paths.reportsDir, "report-added");
  return watchers;
}

function parseArgs(argv: string[]): { port: number; open: boolean } {
  const envPort = process.env.PORT !== undefined ? Number.parseInt(process.env.PORT, 10) : Number.NaN;
  let port = Number.isInteger(envPort) && envPort > 0 ? envPort : DEFAULT_PORT;
  let open = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--open") {
      open = true;
    } else if (arg === "--port") {
      const next = argv[index + 1];
      if (next === undefined) throw new Error("--port requires a number");
      port = Number.parseInt(next, 10);
      index += 1;
    } else if (arg?.startsWith("--port=")) {
      port = Number.parseInt(arg.slice("--port=".length), 10);
    }
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error("--port must be a positive integer");
  return { port, open };
}

// ---------------------------------------------------------------------------
// Thumbnail generation (ffmpeg frame extraction with concurrency limit)
// ---------------------------------------------------------------------------

const THUMB_MAX_CONCURRENT = 3;
const THUMB_WIDTH = 360;

/** In-flight ffmpeg jobs keyed by cache path. Waiters share the same promise. */
const thumbInflight = new Map<string, Promise<string | null>>();
let thumbActive = 0;
const thumbQueue: Array<() => void> = [];

function thumbCacheKey(mediaPath: string): string {
  return createHash("sha1").update(mediaPath).digest("hex") + ".jpg";
}

async function acquireThumbSlot(): Promise<void> {
  if (thumbActive < THUMB_MAX_CONCURRENT) { thumbActive++; return; }
  await new Promise<void>((resolve) => thumbQueue.push(resolve));
  thumbActive++;
}

function releaseThumbSlot(): void {
  thumbActive--;
  const next = thumbQueue.shift();
  if (next) next();
}

async function generateThumb(
  mediaAbsPath: string,
  cachePath: string,
  durationHint?: number,
): Promise<string | null> {
  // Seek to 10% of duration or 0.5s, whichever is positive
  const seekSec = durationHint !== undefined && durationHint > 1
    ? Math.max(0.1, durationHint * 0.1)
    : 0.5;

  await acquireThumbSlot();
  try {
    const proc = Bun.spawn([
      "ffmpeg", "-y",
      "-ss", String(seekSec),
      "-i", mediaAbsPath,
      "-frames:v", "1",
      "-vf", `scale=${THUMB_WIDTH}:-2`,
      "-q:v", "5",
      cachePath,
    ], { stdout: "ignore", stderr: "ignore" });
    const exitCode = await proc.exited;
    if (exitCode !== 0 || !existsSync(cachePath)) return null;
    return cachePath;
  } catch {
    return null;
  } finally {
    releaseThumbSlot();
  }
}

async function getOrCreateThumb(
  paths: AppPaths,
  requestPath: string,
): Promise<string | null> {
  // Validate: same guard as /asset — must be inside streamRoots and be a video/gif
  const trimmed = requestPath.trim();
  if (trimmed.length === 0) return null;
  const rel = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const target = resolve(paths.repoRoot, rel);
  if (!paths.streamRoots.some((root) => isInside(root, target))) return null;
  const ext = extname(target).toLowerCase();
  if (ext !== ".mp4" && ext !== ".gif") return null;
  if (!existsSync(target)) return null;

  const cacheFile = thumbCacheKey(rel);
  const cachePath = join(paths.thumbsDir, cacheFile);

  // Serve from cache
  if (existsSync(cachePath)) return cachePath;

  // Deduplicate in-flight
  const existing = thumbInflight.get(cachePath);
  if (existing) return existing;

  const promise = generateThumb(target, cachePath).finally(() => {
    thumbInflight.delete(cachePath);
  });
  thumbInflight.set(cachePath, promise);
  return promise;
}

export async function createScenePlaygroundApp(options: ServerOptions = {}): Promise<ScenePlaygroundApp> {
  const appDir = resolve(options.appDir ?? APP_DIR);
  const repoRoot = resolve(options.repoRoot ?? REPO_ROOT);
  const distDir = resolve(options.distDir ?? join(appDir, "dist"));
  const paths: AppPaths = {
    repoRoot,
    appDir,
    distDir,
    specsDir: join(repoRoot, "workflows/scene-lab/specs"),
    rendersDir: join(repoRoot, "workflows/scene-lab/renders"),
    reportsDir: join(repoRoot, "workflows/scene-lab/reports"),
    thumbsDir: join(repoRoot, "data/scene-lab/thumbs"),
    assetRoots: [join(repoRoot, "data/video-recreation"), join(repoRoot, "workflows/scene-lab/assets"), join(repoRoot, "data/inspiration")],
    streamRoots: [join(repoRoot, "data/video-recreation"), join(repoRoot, "workflows/scene-lab/assets"), join(repoRoot, "workflows/scene-lab/renders"), join(repoRoot, "data/inspiration")],
    runtimePath: join(repoRoot, "packages/scene-renderer/dist/runtime.js"),
  };
  await ensureLabDirs(paths);
  if (options.buildUi ?? true) await buildUi(appDir, distDir);
  const errorLogPath = join(repoRoot, "data/scene-lab/errors.log");
  const ledger = openLedger(join(repoRoot, "data/scene-lab/ledger.sqlite"));
  const labels = openLabels(join(repoRoot, "data/scene-lab/labels.sqlite"));
  const clients = new Set<EventClient>();
  const recentPuts = new Map<string, RecentPutEntry>();
  const recentWatchHashes = new Map<string, RecentWatchHashEntry>();
  const sseHeartbeatMs = options.sseHeartbeatMs ?? SSE_HEARTBEAT_MS;
  const watchers = [...watchLab(paths, clients, ledger, recentPuts, recentWatchHashes), ...(options.watchUi ? watchUi(appDir, distDir) : [])];
  const appendServerError = async (error: unknown, requestUrl?: string): Promise<void> => {
    try {
      await appendError(caughtErrorInput("server", error, requestUrl), errorLogPath);
    } catch (appendFailure) {
      console.error("[scene-playground] failed to append server error", appendFailure);
    }
  };
  const onUnhandledRejection = (reason: unknown): void => {
    void appendServerError(reason);
  };
  const onUncaughtException = (error: Error): void => {
    void appendServerError(error);
  };
  process.on("unhandledRejection", onUnhandledRejection);
  process.on("uncaughtException", onUncaughtException);

  const fetchHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/specs" && request.method === "GET") {
        return jsonResponse(await listSpecs(paths, ledger));
      }
      if (url.pathname === "/api/spec" && request.method === "GET") {
        const specPath = resolveSpecPath(paths, url.searchParams.get("path") ?? "");
        if (specPath === null) return jsonResponse({ error: "Spec path must stay inside workflows/scene-lab/specs and end with .scene.json" }, { status: 400 });
        return new Response(await readFile(specPath, "utf8"), { headers: { "content-type": "application/json; charset=utf-8" } });
      }
      if (url.pathname === "/api/spec" && request.method === "PUT") {
        const specPath = resolveSpecPath(paths, url.searchParams.get("path") ?? "");
        if (specPath === null) return jsonResponse({ error: "Spec path must stay inside workflows/scene-lab/specs and end with .scene.json" }, { status: 400 });
        await mkdir(dirname(specPath), { recursive: true });
        const content = await request.text();
        const path = toRepoPath(paths.repoRoot, specPath);
        const edit = ledger.recordEdit({ path, actor: "human", content });
        recentPuts.set(specPath, { contentHash: edit.contentHash, ts: Date.now() });
        await writeFile(specPath, content, "utf8");
        return jsonResponse({ ok: true, path });
      }
      if (url.pathname === "/healthz") {
        return jsonResponse({ ok: true, app: "scene-playground", ts: new Date().toISOString() });
      }
      if (url.pathname === "/api/ledger" && request.method === "GET") {
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 50 : Number.parseInt(rawLimit, 10);
        return jsonResponse(ledger.listRecent(limit));
      }
      if (url.pathname === "/api/ledger/stats" && request.method === "GET") {
        const specPath = resolveSpecPath(paths, url.searchParams.get("path") ?? "");
        if (specPath === null) return jsonResponse({ error: "Spec path must stay inside workflows/scene-lab/specs and end with .scene.json" }, { status: 400 });
        return jsonResponse(ledger.statsForPath(toRepoPath(paths.repoRoot, specPath)));
      }
      if (url.pathname === "/api/client-errors" && request.method === "POST") {
        let parsed: unknown;
        try {
          parsed = await request.json();
        } catch {
          return jsonResponse({ error: "Body must be JSON with message (string), optional stack, optional url" }, { status: 400 });
        }
        const body = decodeClientErrorBody(parsed);
        if (body === null) return jsonResponse({ error: "Body must include message (non-empty string), optional stack, optional url" }, { status: 400 });
        const errorInput = { source: "client", message: body.message, ...(body.stack === undefined ? {} : { stack: body.stack }), ...(body.url === undefined ? {} : { url: body.url }) } as const;
        await appendError(errorInput, errorLogPath);
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/api/errors" && request.method === "GET") {
        const rawLimit = url.searchParams.get("limit");
        const limit = rawLimit === null ? 50 : Number.parseInt(rawLimit, 10);
        return jsonResponse(await listRecentErrors(limit, errorLogPath));
      }
      if (url.pathname === "/api/assets" && request.method === "GET") {
        return jsonResponse(await listAssets(paths));
      }
      if (url.pathname === "/asset" && (request.method === "GET" || request.method === "HEAD")) {
        const assetPath = resolveAssetPath(paths, url.searchParams.get("path") ?? "");
        if (assetPath === null) return jsonResponse({ error: "Asset path must be an allowed media file inside data/video-recreation, workflows/scene-lab/assets, or workflows/scene-lab/renders" }, { status: 403 });
        return serveFile(assetPath, request);
      }
      if (url.pathname === "/api/thumb" && request.method === "GET") {
        const thumbPath = await getOrCreateThumb(paths, url.searchParams.get("path") ?? "");
        if (thumbPath === null) return textResponse("Not found or unsupported media type", 404);
        return new Response(Bun.file(thumbPath), {
          headers: {
            "content-type": "image/jpeg",
            "cache-control": "public, max-age=86400, immutable",
          },
        });
      }
      if (url.pathname === "/api/renders" && request.method === "GET") {
        return jsonResponse(await listRenders(paths));
      }
      if (url.pathname === "/events" && request.method === "GET") {
        let client: EventClient | null = null;
        let heartbeat: ReturnType<typeof setInterval> | null = null;
        const stream = new ReadableStream<string>({
          start(controller) {
            client = {
              send(event) {
                controller.enqueue(event);
              },
              close() {
                if (heartbeat !== null) clearInterval(heartbeat);
                controller.close();
              },
            };
            clients.add(client);
            client.send(`data: ${JSON.stringify({ type: "ready", path: "" })}\n\n`);
            heartbeat = setInterval(() => {
              client?.send(": ping\n\n");
            }, sseHeartbeatMs);
          },
          cancel() {
            if (heartbeat !== null) clearInterval(heartbeat);
            if (client !== null) clients.delete(client);
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }
      // ---- Label routes ----
      if (url.pathname === "/api/corpus" && request.method === "GET") {
        const manifestPath = join(repoRoot, "data/inspiration/pleometric/manifest.json");
        if (!existsSync(manifestPath)) return jsonResponse([]);
        const raw = JSON.parse(await readFile(manifestPath, "utf8")) as { items?: Array<Record<string, unknown>> };
        const items = raw.items ?? [];
        const allLabels = labels.allLabels();
        const labelsByMedia = new Map<string, string[]>();
        for (const l of allLabels) {
          const arr = labelsByMedia.get(l.media_path);
          if (arr !== undefined) arr.push(l.grp);
          else labelsByMedia.set(l.media_path, [l.grp]);
        }
        const corpus = items.map((item) => ({
          ...item,
          labels: labelsByMedia.get(item.file as string) ?? [],
        }));
        return jsonResponse(corpus as unknown as JsonPayload);
      }
      if (url.pathname === "/api/labels" && request.method === "GET") {
        const all = labels.allLabels();
        return jsonResponse(all as unknown as JsonPayload);
      }
      if (url.pathname === "/api/labels" && request.method === "PUT") {
        const body = (await request.json()) as { mediaPath?: string; group?: string; op?: string };
        const mediaPath = body.mediaPath;
        const group = body.group;
        const op = body.op;
        if (typeof mediaPath !== "string" || typeof group !== "string" || (op !== "add" && op !== "remove")) {
          return jsonResponse({ error: "Body requires mediaPath (string), group (string), op ('add'|'remove')" }, { status: 400 });
        }
        // Guard: only allow media paths inside data/inspiration
        const inspirationRoot = join(repoRoot, "data/inspiration");
        const target = resolve(inspirationRoot, mediaPath);
        if (!isInside(inspirationRoot, target)) {
          return jsonResponse({ error: "Media path must be inside data/inspiration" }, { status: 403 });
        }
        if (op === "add") {
          labels.assign(mediaPath, group);
        } else {
          labels.unassign(mediaPath, group);
        }
        // Provenance: record in ledger
        const content = JSON.stringify({ op, mediaPath, group });
        ledger.recordEdit({ path: `data/inspiration/pleometric/${mediaPath}`, actor: "human", content });
        return jsonResponse({ ok: true } as unknown as JsonPayload);
      }
      if (url.pathname === "/api/label-groups" && request.method === "GET") {
        return jsonResponse(labels.groupsWithCounts() as unknown as JsonPayload);
      }
      if (url.pathname === "/api/label-groups" && request.method === "PUT") {
        const body = (await request.json()) as { name?: string; key?: string };
        if (typeof body.name !== "string" || body.name.trim().length === 0) {
          return jsonResponse({ error: "Body requires name (non-empty string)" }, { status: 400 });
        }
        const row = labels.ensureGroup(body.name.trim(), body.key ?? undefined);
        return jsonResponse(row as unknown as JsonPayload);
      }
      if (url.pathname === "/api/reports" && request.method === "GET") {
        return jsonResponse(await listReports(paths));
      }
      if (url.pathname === "/report" && (request.method === "GET" || request.method === "HEAD")) {
        const reportPath = resolveReportPath(paths, url.searchParams.get("path") ?? "");
        if (reportPath === null) return jsonResponse({ error: "Path must be inside workflows/scene-lab/reports and be .md, .png, .mp4, or .json" }, { status: 403 });
        return serveFile(reportPath, request);
      }
      if (url.pathname === "/runtime.js" && request.method === "GET") {
        if (!existsSync(paths.runtimePath)) {
          return textResponse("Scene runtime not built. Run the scene-renderer build before using live preview.", 404);
        }
        return serveFile(paths.runtimePath);
      }
      if (request.method !== "GET") return textResponse("Method not allowed", 405);
      const staticPath = url.pathname === "/" ? join(paths.distDir, "index.html") : resolve(paths.distDir, `.${url.pathname}`);
      if (!isInside(paths.distDir, staticPath) || !existsSync(staticPath)) return textResponse("Not found", 404);
      return serveFile(staticPath);
    } catch (error) {
      await appendServerError(error, url.href);
      const message = error instanceof Error ? error.message : "Unexpected server error";
      return jsonResponse({ error: message }, { status: 500 });
    }
  };

  return {
    fetch: fetchHandler,
    paths,
    close() {
      for (const watcher of watchers) watcher.close();
      recentWatchHashes.clear();
      recentPuts.clear();
      for (const client of clients) client.close();
      process.off("unhandledRejection", onUnhandledRejection);
      process.off("uncaughtException", onUncaughtException);
      ledger.close();
      labels.close();
      clients.clear();
    },
  };
}

if (import.meta.main) {
  const { port, open } = parseArgs(Bun.argv.slice(2));
  const app = await createScenePlaygroundApp({ watchUi: true });
  Bun.serve({ port, fetch: app.fetch, idleTimeout: 0 });
  const url = `http://127.0.0.1:${port}`;
  console.log(`[scene-playground] listening on ${url}`);
  if (open) console.log(url);
}
