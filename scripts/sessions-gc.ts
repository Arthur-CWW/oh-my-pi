#!/usr/bin/env bun
import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

const root = join(homedir(), ".omp/agent/sessions");
const manifest = join(homedir(), ".omp/agent/sessions-archive-manifest.jsonl");
const args = Bun.argv.slice(2);
let days: number | undefined;
let apply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--older-than") days = Number(args[++i]);
  else if (args[i] === "--apply") apply = true;
  else if (args[i] === "--dry-run") apply = false;
  else throw new Error(`Unknown argument: ${args[i]}`);
}
if (!Number.isFinite(days) || days! < 0) throw new Error("Usage: sessions-gc.ts --older-than <days> [--dry-run|--apply]");

const cutoff = Date.now() - days! * 86_400_000;
const tool = Bun.which("zstd") ? "zstd" : Bun.which("xz") ? "xz" : undefined;
if (!tool) throw new Error("Neither zstd nor xz is available on PATH");
const extension = tool === "zstd" ? ".zst" : ".xz";

type Candidate = { path: string; sessionDir: string; bytes: number };
const candidates: Candidate[] = [];

async function walk(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (entry.isFile() && (entry.name.endsWith(".jsonl") || entry.name.endsWith(".log"))) {
      if (entry.name.endsWith(".zst") || entry.name.endsWith(".xz")) continue;
      const sessionDir = await resolveSessionDir(path);
      const sessionStat = await stat(sessionDir);
      if (sessionStat.mtimeMs < cutoff) candidates.push({ path, sessionDir, bytes: (await stat(path)).size });
    }
  }
}

async function resolveSessionDir(path: string): Promise<string> {
  let dir = dirname(path);
  while (dir !== root && dirname(dir) !== root) {
    if (/^\d{4}-\d{2}-\d{2}T/.test(basename(dir))) return dir;
    dir = dirname(dir);
  }
  if (dirname(path) === dir && path.endsWith(".jsonl")) {
    const sibling = path.slice(0, -".jsonl".length);
    try { if ((await stat(sibling)).isDirectory()) return sibling; } catch {}
  }
  return dirname(path);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function run(argv: string[], output?: string): Promise<void> {
  const proc = Bun.spawn(argv, {
    stdout: output ? Bun.file(output) : "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`${argv[0]} failed with exit ${exitCode}`);
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

await walk(root);
candidates.sort((a, b) => a.path.localeCompare(b.path));
const before = candidates.reduce((sum, item) => sum + item.bytes, 0);
let after = 0;
let completed = 0;

if (apply) {
  await mkdir(dirname(manifest), { recursive: true });
  for (const item of candidates) {
    const destination = item.path + extension;
    const compressedTmp = destination + `.tmp-${process.pid}`;
    const decodedTmp = item.path + `.verify-${process.pid}`;
    try {
      if (tool === "zstd") await run(["zstd", "-q", "-T0", "-19", "-o", compressedTmp, item.path]);
      else await run(["xz", "-9", "-T0", "-c", item.path], compressedTmp);
      if (tool === "zstd") await run(["zstd", "-q", "-d", "-f", compressedTmp, "-o", decodedTmp]);
      else await run(["xz", "-d", "-c", compressedTmp], decodedTmp);
      const [originalHash, decodedHash] = await Promise.all([sha256(item.path), sha256(decodedTmp)]);
      if (originalHash !== decodedHash) throw new Error(`Verification checksum mismatch: ${item.path}`);
      await rename(compressedTmp, destination);
      const compBytes = (await stat(destination)).size;
      await appendFile(manifest, JSON.stringify({
        path: item.path,
        sha256: originalHash,
        origBytes: item.bytes,
        compBytes,
        tool,
        date: new Date().toISOString(),
      }) + "\n");
      await rm(item.path);
      after += compBytes;
      completed++;
    } finally {
      await rm(compressedTmp, { force: true });
      await rm(decodedTmp, { force: true });
    }
  }
}

const rows = [
  ["mode", apply ? "apply" : "dry-run"],
  ["cutoff", new Date(cutoff).toISOString()],
  ["tool", tool],
  ["files", String(apply ? completed : candidates.length)],
  ["bytes before", `${before} (${formatBytes(before)})`],
  ["bytes after", apply ? `${after} (${formatBytes(after)})` : "not computed (dry-run)"],
  ["reclaimed", apply ? `${before - after} (${formatBytes(before - after)})` : "not computed (dry-run)"],
];
const width = Math.max(...rows.map(([key]) => key.length));
console.log(rows.map(([key, value]) => `${key.padEnd(width)} | ${value}`).join("\n"));
