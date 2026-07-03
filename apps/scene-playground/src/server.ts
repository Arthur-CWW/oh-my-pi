import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";

const APP_DIR = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(APP_DIR, "../..");
const DEFAULT_PORT = 4600;
const ASSET_EXTENSIONS: Record<string, true> = { ".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".mp3": true, ".wav": true, ".mp4": true };
const IMAGE_EXTENSIONS: Record<string, true> = { ".png": true, ".jpg": true, ".jpeg": true, ".webp": true };
const AUDIO_EXTENSIONS: Record<string, true> = { ".mp3": true, ".wav": true };
const VIDEO_EXTENSIONS: Record<string, true> = { ".mp4": true };
const MAX_ASSETS = 500;
const MAX_ASSET_DEPTH = 4;
const SSE_HEARTBEAT_MS = 20_000;

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
type JsonPayload = JsonValue | SpecEntry[] | AssetEntry[] | RenderEntry[] | ReportEntry[] | { error: string } | { ok: true; path: string };

interface AppPaths {
  repoRoot: string;
  appDir: string;
  distDir: string;
  specsDir: string;
  rendersDir: string;
  reportsDir: string;
  assetRoots: string[];
  streamRoots: string[];
  runtimePath: string;
}

interface EventClient {
  send: (event: string) => void;
  close: () => void;
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
}

async function listSpecs(paths: AppPaths): Promise<SpecEntry[]> {
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
        entries.push({ path: toRepoPath(paths.repoRoot, childPath), mtime: info.mtime.toISOString(), bytes: info.size });
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

async function serveFile(path: string): Promise<Response> {
  const info = await stat(path);
  if (!info.isFile()) return textResponse("Not found", 404);
  return new Response(Bun.file(path), { headers: { "content-type": mimeFor(path) } });
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

function watchLab(paths: AppPaths, clients: Set<EventClient>): FSWatcher[] {
  const watchers: FSWatcher[] = [];
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
  let port = DEFAULT_PORT;
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
    assetRoots: [join(repoRoot, "data/video-recreation"), join(repoRoot, "workflows/scene-lab/assets")],
    streamRoots: [join(repoRoot, "data/video-recreation"), join(repoRoot, "workflows/scene-lab/assets"), join(repoRoot, "workflows/scene-lab/renders")],
    runtimePath: join(repoRoot, "packages/scene-renderer/dist/runtime.js"),
  };
  await ensureLabDirs(paths);
  if (options.buildUi ?? true) await buildUi(appDir, distDir);
  const clients = new Set<EventClient>();
  const sseHeartbeatMs = options.sseHeartbeatMs ?? SSE_HEARTBEAT_MS;
  const watchers = [...watchLab(paths, clients), ...(options.watchUi ? watchUi(appDir, distDir) : [])];

  const fetchHandler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/specs" && request.method === "GET") {
        return jsonResponse(await listSpecs(paths));
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
        await writeFile(specPath, await request.text(), "utf8");
        return jsonResponse({ ok: true, path: toRepoPath(paths.repoRoot, specPath) });
      }
      if (url.pathname === "/api/assets" && request.method === "GET") {
        return jsonResponse(await listAssets(paths));
      }
      if (url.pathname === "/asset" && request.method === "GET") {
        const assetPath = resolveAssetPath(paths, url.searchParams.get("path") ?? "");
        if (assetPath === null) return jsonResponse({ error: "Asset path must be an allowed media file inside data/video-recreation, workflows/scene-lab/assets, or workflows/scene-lab/renders" }, { status: 403 });
        return serveFile(assetPath);
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
      if (url.pathname === "/api/reports" && request.method === "GET") {
        return jsonResponse(await listReports(paths));
      }
      if (url.pathname === "/report" && request.method === "GET") {
        const reportPath = resolveReportPath(paths, url.searchParams.get("path") ?? "");
        if (reportPath === null) return jsonResponse({ error: "Path must be inside workflows/scene-lab/reports and be .md, .png, .mp4, or .json" }, { status: 403 });
        return serveFile(reportPath);
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
      const message = error instanceof Error ? error.message : "Unexpected server error";
      return jsonResponse({ error: message }, { status: 500 });
    }
  };

  return {
    fetch: fetchHandler,
    paths,
    close() {
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.close();
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
