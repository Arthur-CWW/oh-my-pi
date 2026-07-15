import { appendFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { snapshot } from "./data.ts";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const PUBLIC_DIR = resolve(PACKAGE_ROOT, "public");
const ERROR_DIR = resolve(PACKAGE_ROOT, "data/omp-perf-explorer");
const ERROR_FILE = resolve(ERROR_DIR, "errors.log");
const PORT = Number.parseInt(Bun.env.PORT ?? "1355", 10);
const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

type ClientError = { readonly message?: unknown; readonly source?: unknown; readonly line?: unknown; readonly column?: unknown; readonly stack?: unknown; readonly kind?: unknown };
interface ProcessSample {
  readonly pid: number;
  readonly ppid: number;
  readonly cpu: number;
  readonly rssMiB: number;
  readonly elapsedSeconds: number;
  readonly command: string;
  readonly name: string;
}

interface MachineSnapshot {
  readonly capturedAt: string;
  readonly memory: { readonly physicalGiB: number; readonly usedGiB: number; readonly pressure: "nominal" | "warning" | "critical" };
  readonly groups: readonly { readonly name: string; readonly count: number; readonly rssGiB: number; readonly cpu: number }[];
  readonly top: readonly ProcessSample[];
  readonly orphanCandidates: readonly (ProcessSample & { readonly reason: string })[];
}

let machineCache: { readonly expiresAt: number; readonly value: MachineSnapshot } | null = null;

async function commandText(argv: readonly string[]): Promise<string> {
  const process = Bun.spawn([...argv], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  if (exitCode !== 0) throw new Error(`${argv[0]} failed: ${stderr.trim()}`);
  return stdout;
}

function elapsedSeconds(value: string): number {
  const dayParts = value.split("-");
  const days = dayParts.length === 2 ? Number(dayParts[0]) : 0;
  const clock = dayParts.at(-1)?.split(":").map(Number) ?? [];
  const [hours, minutes, seconds] = clock.length === 3 ? clock : [0, clock[0] ?? 0, clock[1] ?? 0];
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

function processGroup(command: string): "Browsers" | "OMP runner/view" | "MCP helpers" | "cmux hooks" | "Dev servers" | "Other" {
  const text = command.toLowerCase();
  if (text.includes("chrome") || text.includes("chromium") || text.includes("playwright") || text.includes("puppeteer")) return "Browsers";
  if (text.includes("cmux hooks") || text.includes("session-start")) return "cmux hooks";
  if (text.includes("mcp") || text.includes("modelcontextprotocol")) return "MCP helpers";
  if (text.includes("omp") || text.includes("oh-my-pi")) return "OMP runner/view";
  if (text.includes("vite") || text.includes("next dev") || text.includes("bun run dev")) return "Dev servers";
  return "Other";
}

function parseProcesses(text: string): ProcessSample[] {
  const rows: ProcessSample[] = [];
  for (const line of text.trim().split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const command = match[6] ?? "";
    const executable = command.trim().split(/\s+/)[0] ?? command;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]), rssMiB: Number(match[4]) / 1024, elapsedSeconds: elapsedSeconds(match[5] ?? "0:00"), command, name: executable.split("/").at(-1) ?? executable });
  }
  return rows;
}

function parseVmStat(text: string): { readonly pageSize: number; readonly usedPages: number } {
  const pageSize = Number(text.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
  const fields = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = line.match(/^([^:]+):\s+([\d.]+)\.?$/);
    if (match) fields.set(match[1] ?? "", Number(match[2]));
  }
  const usedPages = (fields.get("Pages active") ?? 0) + (fields.get("Pages wired down") ?? 0) + (fields.get("Pages occupied by compressor") ?? 0) + (fields.get("Pages speculative") ?? 0);
  return { pageSize, usedPages };
}

async function machineSnapshot(): Promise<MachineSnapshot> {
  const now = Date.now();
  if (machineCache && machineCache.expiresAt > now) return machineCache.value;
  const [psText, physicalText, vmText] = await Promise.all([
    commandText(["ps", "-axo", "pid=,ppid=,%cpu=,rss=,etime=,command="]),
    commandText(["sysctl", "-n", "hw.memsize"]),
    commandText(["vm_stat"]),
  ]);
  const processes = parseProcesses(psText);
  const physicalBytes = Number(physicalText.trim());
  const vm = parseVmStat(vmText);
  const usedBytes = Math.min(physicalBytes, vm.usedPages * vm.pageSize);
  const usedRatio = physicalBytes > 0 ? usedBytes / physicalBytes : 0;
  const groups = new Map<string, { count: number; rssMiB: number; cpu: number }>();
  for (const process of processes) {
    const name = processGroup(process.command);
    const group = groups.get(name) ?? { count: 0, rssMiB: 0, cpu: 0 };
    group.count += 1; group.rssMiB += process.rssMiB; group.cpu += process.cpu; groups.set(name, group);
  }
  const knownHelper = (process: ProcessSample) => processGroup(process.command) !== "Other";
  const orphanCandidates = processes.flatMap((process) => {
    if (process.ppid === 1 && knownHelper(process) && process.rssMiB >= 25) return [{ ...process, reason: "Known helper with PPID 1" }];
    if (process.elapsedSeconds >= 86400 && process.cpu < 0.1 && process.rssMiB >= 200) return [{ ...process, reason: "Over 24h old, idle, and over 200 MiB" }];
    return [];
  }).sort((a, b) => b.rssMiB - a.rssMiB).slice(0, 8);
  const value: MachineSnapshot = {
    capturedAt: new Date(now).toISOString(),
    memory: { physicalGiB: physicalBytes / 1073741824, usedGiB: usedBytes / 1073741824, pressure: usedRatio > 0.9 ? "critical" : usedRatio > 0.75 ? "warning" : "nominal" },
    groups: [...groups].map(([name, group]) => ({ name, count: group.count, rssGiB: group.rssMiB / 1024, cpu: group.cpu })).sort((a, b) => b.rssGiB - a.rssGiB),
    top: [...processes].sort((a, b) => Math.max(b.rssMiB / 20, b.cpu) - Math.max(a.rssMiB / 20, a.cpu)).slice(0, 12),
    orphanCandidates,
  };
  machineCache = { expiresAt: now + 4000, value };
  return value;
}

await mkdir(ERROR_DIR, { recursive: true });
await Bun.write(ERROR_FILE, "");

function json(value: object, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

async function logError(kind: "browser" | "backend", detail: object): Promise<void> {
  await appendFile(ERROR_FILE, `${JSON.stringify({ ts: new Date().toISOString(), kind, ...detail })}\n`);
}

function publicFile(pathname: string): string | null {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!relative || relative.includes("..") || relative.includes("\\")) return null;
  const path = resolve(PUBLIC_DIR, relative);
  return path.startsWith(`${PUBLIC_DIR}/`) ? path : null;
}

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/healthz" && request.method === "GET") return json({ ok: true, service: "omp-perf-explorer" });
    if (url.pathname === "/api/snapshot" && request.method === "GET") return json(snapshot);
    if (url.pathname === "/api/machine" && request.method === "GET") return json(await machineSnapshot());
    if (url.pathname === "/api/client-errors" && request.method === "POST") {
      const body = await request.json() as ClientError;
      await logError("browser", { message: String(body.message ?? "Unknown browser error"), source: body.source ?? null, line: body.line ?? null, column: body.column ?? null, stack: body.stack ?? null, errorKind: body.kind ?? null });
      return json({ ok: true });
    }
    if (request.method === "GET") {
      const path = publicFile(url.pathname);
      if (path) {
        const file = Bun.file(path);
        if (await file.exists()) return new Response(file, { headers: { "content-type": contentTypes[extname(path)] ?? "application/octet-stream", "cache-control": "no-store" } });
      }
    }
    return new Response("Not found", { status: 404 });
  } catch (error) {
    await logError("backend", { message: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack ?? null : null, method: request.method, path: url.pathname });
    return json({ error: "Internal server error" }, 500);
  }
}

if (import.meta.main) {
  const server = Bun.serve({ port: PORT, fetch: handleRequest });
  console.log(`OMP performance explorer listening on http://localhost:${server.port}`);
}
