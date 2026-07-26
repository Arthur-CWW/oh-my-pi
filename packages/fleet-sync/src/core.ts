import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const SCHEMA_VERSION = 1 as const;
export const DIGEST_PREFIX = "sha256:";

export type Schedule = {
  intervalSeconds: number;
  jitterSeconds: number;
  backoffSeconds: number[];
};

export type LocalEndpoint = { kind: "local"; root: string };
export type SshEndpoint = { kind: "ssh"; host: string; root: string };
export type Endpoint = LocalEndpoint | SshEndpoint;

export type Peer = { id: string; endpoint: Endpoint };
export type SourcePolicy = {
  laneReceiptRoots: string[];
  journalRoots: string[];
  assetManifestRoots: string[];
  configSnapshotRoots: string[];
  assetRoots: string[];
};
export type Policy = {
  schemaVersion: 1;
  hostId: string;
  stateRoot: string;
  maxBytesPerRun: number;
  schedule: Schedule;
  peers: Peer[];
  sources: SourcePolicy;
  excludedPathParts: string[];
  trustedConfigKeys: Record<string, string>;
};

export type FleetCatalog = {
  schemaVersion: 1;
  schedule: Schedule;
  defaults: {
    maxBytesPerRun: number;
    excludedPathParts: string[];
    trustedConfigKeys: Record<string, string>;
  };
  hosts: Record<
    string,
    {
      stateRoot: string;
      peers: Peer[];
      sources: SourcePolicy;
      maxBytesPerRun?: number;
    }
  >;
};

type TransferFile = {
  sourcePath: string;
  targetPath: string;
  digest: string;
  bytes: number;
};

export type TransferItem = {
  kind: "git" | "journal" | "asset" | "config";
  logicalKey: string;
  logicalDigest: string;
  files: TransferFile[];
  bytes: number;
};

export type ScanResult = {
  schemaVersion: 1;
  hostId: string;
  scannedAt: string;
  items: TransferItem[];
  skippedActiveJournalTails: number;
  skippedExcludedPaths: number;
  totalBytes: number;
};

type BatchFile = Omit<TransferFile, "sourcePath">;
type BatchItem = Omit<TransferItem, "files"> & { files: BatchFile[] };
type BatchManifest = {
  schemaVersion: 1;
  sourceHost: string;
  destinationHost: string;
  runId: string;
  createdAt: string;
  bytes: number;
  items: BatchItem[];
};

type ImmutableIndex = Record<string, string>;

export class FleetSyncError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function expandHome(path: string): string {
  if (path === "~") return process.env.HOME ?? path;
  if (path.startsWith("~/")) return join(process.env.HOME ?? "~", path.slice(2));
  return path;
}

export function resolvePolicy(catalog: FleetCatalog, hostId: string): Policy {
  if (catalog.schemaVersion !== SCHEMA_VERSION) {
    throw new FleetSyncError("Unsupported fleet sync catalog schema", "SCHEMA");
  }
  const host = catalog.hosts[hostId];
  if (!host) throw new FleetSyncError(`Unknown fleet host: ${hostId}`, "HOST");
  return {
    schemaVersion: SCHEMA_VERSION,
    hostId,
    stateRoot: expandHome(host.stateRoot),
    maxBytesPerRun: host.maxBytesPerRun ?? catalog.defaults.maxBytesPerRun,
    schedule: catalog.schedule,
    peers: host.peers.map((peer) => ({
      ...peer,
      endpoint:
        peer.endpoint.kind === "local"
          ? { ...peer.endpoint, root: expandHome(peer.endpoint.root) }
          : { ...peer.endpoint, root: expandHome(peer.endpoint.root) },
    })),
    sources: {
      laneReceiptRoots: host.sources.laneReceiptRoots.map(expandHome),
      journalRoots: host.sources.journalRoots.map(expandHome),
      assetManifestRoots: host.sources.assetManifestRoots.map(expandHome),
      configSnapshotRoots: host.sources.configSnapshotRoots.map(expandHome),
      assetRoots: host.sources.assetRoots.map(expandHome),
    },
    excludedPathParts: catalog.defaults.excludedPathParts,
    trustedConfigKeys: catalog.defaults.trustedConfigKeys,
  };
}

function sha256Bytes(bytes: Uint8Array): string {
  return `${DIGEST_PREFIX}${createHash("sha256").update(bytes).digest("hex")}`;
}

export async function sha256File(path: string): Promise<string> {
  const handle = await open(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return `${DIGEST_PREFIX}${hash.digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeRelative(path: string): string {
  if (isAbsolute(path) || path.split(/[\\/]/).some((part) => part === ".." || part === "")) {
    throw new FleetSyncError(`Unsafe relative path: ${path}`, "PATH");
  }
  return path.replaceAll("\\", "/");
}

function isWithin(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function isExcluded(path: string, excluded: string[]): boolean {
  const parts = path.toLowerCase().split(/[\\/._-]+/);
  return excluded.some((value) => parts.includes(value.toLowerCase()));
}

async function listFiles(root: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) files.push(...(await listFiles(path, suffix)));
      else if (entry.isFile() && entry.name.endsWith(suffix)) files.push(path);
    }
    return files.sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function jsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function fileRecord(sourcePath: string, targetPath: string, expected?: string): Promise<TransferFile> {
  const info = await stat(sourcePath);
  if (!info.isFile()) throw new FleetSyncError(`Source is not a file: ${sourcePath}`, "SOURCE");
  const digest = await sha256File(sourcePath);
  if (expected && digest !== expected) {
    throw new FleetSyncError(`Digest mismatch for ${sourcePath}`, "DIGEST");
  }
  return { sourcePath, targetPath: safeRelative(targetPath), digest, bytes: info.size };
}

type LaneReceipt = {
  version: number;
  change_id: string;
  commit_id: string;
  parent_commit_id: string;
  bundle: string;
  bundle_ref: string;
};

async function scanGit(policy: Policy): Promise<TransferItem[]> {
  const items: TransferItem[] = [];
  for (const root of policy.sources.laneReceiptRoots) {
    for (const receiptPath of await listFiles(root, ".receipt.json")) {
      const receipt = await jsonFile<LaneReceipt>(receiptPath);
      if (
        receipt.version !== 1 ||
        !/^[a-z]+$/.test(receipt.change_id) ||
        !/^[0-9a-f]+$/.test(receipt.commit_id) ||
        !/^[0-9a-f]+$/.test(receipt.parent_commit_id) ||
        !receipt.bundle_ref.startsWith("refs/heads/harness-lane-bundle-")
      ) {
        throw new FleetSyncError(`Invalid lane receipt: ${receiptPath}`, "LANE_RECEIPT");
      }
      const bundlePath = isAbsolute(receipt.bundle) ? receipt.bundle : resolve(dirname(receiptPath), receipt.bundle);
      if (!isWithin(root, receiptPath) || !isWithin(root, bundlePath)) {
        throw new FleetSyncError(`Lane bundle escapes allowlisted root: ${bundlePath}`, "ALLOWLIST");
      }
      const bundleDigest = await sha256File(bundlePath);
      const receiptDigest = await sha256File(receiptPath);
      const base = `git/${receipt.change_id}/${receipt.commit_id}`;
      const files = [
        await fileRecord(bundlePath, `${base}/${bundleDigest.slice(DIGEST_PREFIX.length)}.bundle`, bundleDigest),
        await fileRecord(receiptPath, `${base}/${receiptDigest.slice(DIGEST_PREFIX.length)}.receipt.json`, receiptDigest),
      ];
      const logicalDigest = sha256Bytes(Buffer.from(stableJson(files.map(({ digest, bytes }) => ({ digest, bytes }))))) ;
      items.push({ kind: "git", logicalKey: `git:${receipt.change_id}:${receipt.commit_id}`, logicalDigest, files, bytes: files.reduce((n, f) => n + f.bytes, 0) });
    }
  }
  return items;
}

type JournalCheckpoint = {
  version: number;
  sessionId: string;
  ownerEpoch: number;
  segment: string;
  bytes: number;
  sha256: string;
  closed: boolean;
};

async function scanJournals(policy: Policy): Promise<{ items: TransferItem[]; active: number; excluded: number }> {
  const items: TransferItem[] = [];
  let active = 0;
  let excluded = 0;
  for (const root of policy.sources.journalRoots) {
    const checkpoints = await listFiles(root, ".checkpoint.json");
    const allJsonl = await listFiles(root, ".jsonl");
    const referenced = new Set<string>();
    for (const checkpointPath of checkpoints) {
      const checkpoint = await jsonFile<JournalCheckpoint>(checkpointPath);
      if (checkpoint.version !== 1 || !checkpoint.sessionId || !Number.isSafeInteger(checkpoint.ownerEpoch) || checkpoint.ownerEpoch < 0) {
        throw new FleetSyncError(`Invalid journal checkpoint: ${checkpointPath}`, "JOURNAL_CHECKPOINT");
      }
      const segment = safeRelative(checkpoint.segment);
      const sourcePath = resolve(dirname(checkpointPath), segment);
      referenced.add(sourcePath);
      if (!checkpoint.closed) {
        active += 1;
        continue;
      }
      if (!isWithin(root, sourcePath)) throw new FleetSyncError(`Journal segment escapes allowlisted root: ${sourcePath}`, "ALLOWLIST");
      if (isExcluded(segment, policy.excludedPathParts)) {
        excluded += 1;
        continue;
      }
      const normalizedDigest = checkpoint.sha256.startsWith(DIGEST_PREFIX) ? checkpoint.sha256 : `${DIGEST_PREFIX}${checkpoint.sha256}`;
      const data = await fileRecord(sourcePath, `journals/${checkpoint.sessionId}/${checkpoint.ownerEpoch}/${normalizedDigest.slice(DIGEST_PREFIX.length)}.jsonl`, normalizedDigest);
      if (data.bytes !== checkpoint.bytes) throw new FleetSyncError(`Journal byte length mismatch: ${sourcePath}`, "JOURNAL_LENGTH");
      const cp = await fileRecord(checkpointPath, `journals/${checkpoint.sessionId}/${checkpoint.ownerEpoch}/${normalizedDigest.slice(DIGEST_PREFIX.length)}.checkpoint.json`);
      const logicalKey = `journal:${checkpoint.sessionId}:${checkpoint.ownerEpoch}:${segment}`;
      items.push({ kind: "journal", logicalKey, logicalDigest: normalizedDigest, files: [data, cp], bytes: data.bytes + cp.bytes });
    }
    active += allJsonl.filter((path) => !referenced.has(path)).length;
  }
  return { items, active, excluded };
}

type AssetManifest = { version: number; objects: Array<{ path: string; sha256: string; bytes: number }> };

async function scanAssets(policy: Policy): Promise<{ items: TransferItem[]; excluded: number }> {
  const items: TransferItem[] = [];
  let excluded = 0;
  for (const manifestRoot of policy.sources.assetManifestRoots) {
    for (const manifestPath of await listFiles(manifestRoot, ".asset-manifest.json")) {
      const manifest = await jsonFile<AssetManifest>(manifestPath);
      if (manifest.version !== 1 || !Array.isArray(manifest.objects)) {
        throw new FleetSyncError(`Invalid asset manifest: ${manifestPath}`, "ASSET_MANIFEST");
      }
      const manifestDigest = await sha256File(manifestPath);
      const manifestRecord = await fileRecord(manifestPath, `assets/manifests/${manifestDigest.slice(DIGEST_PREFIX.length)}.json`, manifestDigest);
      for (const object of manifest.objects) {
        const rel = safeRelative(object.path);
        if (isExcluded(rel, policy.excludedPathParts)) {
          excluded += 1;
          continue;
        }
        let sourcePath: string | undefined;
        for (const root of policy.sources.assetRoots) {
          const candidate = resolve(root, rel);
          if (isWithin(root, candidate) && (await exists(candidate))) {
            sourcePath = candidate;
            break;
          }
        }
        if (!sourcePath) throw new FleetSyncError(`Asset is outside declared roots: ${rel}`, "ALLOWLIST");
        const expected = object.sha256.startsWith(DIGEST_PREFIX) ? object.sha256 : `${DIGEST_PREFIX}${object.sha256}`;
        const data = await fileRecord(sourcePath, `assets/sha256/${expected.slice(DIGEST_PREFIX.length)}`, expected);
        if (data.bytes !== object.bytes) throw new FleetSyncError(`Asset byte length mismatch: ${sourcePath}`, "ASSET_LENGTH");
        const files = [data, manifestRecord];
        items.push({ kind: "asset", logicalKey: `asset:${expected}`, logicalDigest: expected, files, bytes: files.reduce((n, file) => n + file.bytes, 0) });
      }
    }
  }
  return { items, excluded };
}

type ConfigSnapshot = {
  version: number;
  path: string;
  sha256: string;
  bytes: number;
  keyId: string;
  signature: string;
};

function configMessage(snapshot: ConfigSnapshot, digest: string): Buffer {
  return Buffer.from(`fleet-sync-config-v1\n${snapshot.path}\n${digest}\n${snapshot.bytes}`);
}

async function scanConfigs(policy: Policy): Promise<{ items: TransferItem[]; excluded: number }> {
  const items: TransferItem[] = [];
  let excluded = 0;
  for (const root of policy.sources.configSnapshotRoots) {
    for (const snapshotPath of await listFiles(root, ".config-snapshot.json")) {
      const snapshot = await jsonFile<ConfigSnapshot>(snapshotPath);
      if (snapshot.version !== 1 || !snapshot.keyId || !snapshot.signature) {
        throw new FleetSyncError(`Invalid config snapshot: ${snapshotPath}`, "CONFIG_SNAPSHOT");
      }
      const rel = safeRelative(snapshot.path);
      if (isExcluded(rel, policy.excludedPathParts)) {
        excluded += 1;
        continue;
      }
      const sourcePath = resolve(dirname(snapshotPath), rel);
      if (!isWithin(root, sourcePath)) throw new FleetSyncError(`Config escapes allowlisted root: ${sourcePath}`, "ALLOWLIST");
      const expected = snapshot.sha256.startsWith(DIGEST_PREFIX) ? snapshot.sha256 : `${DIGEST_PREFIX}${snapshot.sha256}`;
      const data = await fileRecord(sourcePath, `config/${expected.slice(DIGEST_PREFIX.length)}/${basename(rel)}`, expected);
      if (data.bytes !== snapshot.bytes) throw new FleetSyncError(`Config byte length mismatch: ${sourcePath}`, "CONFIG_LENGTH");
      const publicKey = policy.trustedConfigKeys[snapshot.keyId];
      if (!publicKey || !verifySignature(null, configMessage(snapshot, expected), createPublicKey(publicKey), Buffer.from(snapshot.signature, "base64"))) {
        throw new FleetSyncError(`Untrusted config signature: ${snapshotPath}`, "CONFIG_SIGNATURE");
      }
      const metadata = await fileRecord(snapshotPath, `config/${expected.slice(DIGEST_PREFIX.length)}/${basename(snapshotPath)}`);
      items.push({ kind: "config", logicalKey: `config:${rel}:${expected}`, logicalDigest: expected, files: [data, metadata], bytes: data.bytes + metadata.bytes });
    }
  }
  return { items, excluded };
}

function deduplicate(items: TransferItem[]): TransferItem[] {
  const byKey = new Map<string, TransferItem>();
  for (const item of items) {
    const existing = byKey.get(item.logicalKey);
    if (existing && existing.logicalDigest !== item.logicalDigest) {
      throw new FleetSyncError(`Divergent immutable source item: ${item.logicalKey}`, "DIVERGENT_SOURCE");
    }
    if (!existing) byKey.set(item.logicalKey, item);
  }
  return [...byKey.values()].sort((a, b) => a.logicalKey.localeCompare(b.logicalKey));
}

export async function scan(policy: Policy): Promise<ScanResult> {
  const [git, journals, assets, configs] = await Promise.all([
    scanGit(policy),
    scanJournals(policy),
    scanAssets(policy),
    scanConfigs(policy),
  ]);
  const items = deduplicate([...git, ...journals.items, ...assets.items, ...configs.items]);
  return {
    schemaVersion: SCHEMA_VERSION,
    hostId: policy.hostId,
    scannedAt: new Date().toISOString(),
    items,
    skippedActiveJournalTails: journals.active,
    skippedExcludedPaths: journals.excluded + assets.excluded + configs.excluded,
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function atomicCopy(source: string, destination: string, expected: string): Promise<void> {
  if (await exists(destination)) {
    if ((await sha256File(destination)) !== expected) throw new FleetSyncError(`Existing immutable object diverges: ${destination}`, "DIVERGENT_OBJECT");
    return;
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  await copyFile(source, temporary);
  if ((await sha256File(temporary)) !== expected) {
    await rm(temporary, { force: true });
    throw new FleetSyncError(`Staged object failed verification: ${source}`, "STAGING_DIGEST");
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function readRecord(path: string): Promise<Record<string, string>> {
  try {
    return await jsonFile<Record<string, string>>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

function selectBounded(items: TransferItem[], already: Record<string, string>, limit: number): TransferItem[] {
  const selected: TransferItem[] = [];
  let used = 0;
  for (const item of items) {
    if (already[item.logicalKey] === item.logicalDigest || item.bytes > limit - used) continue;
    selected.push(item);
    used += item.bytes;
  }
  return selected;
}

function batchFor(policy: Policy, peer: Peer, items: TransferItem[]): BatchManifest {
  const projected = items.map(({ files, ...item }) => ({
    ...item,
    files: files.map(({ sourcePath: _sourcePath, ...file }) => file),
  }));
  const identity = { schemaVersion: SCHEMA_VERSION, sourceHost: policy.hostId, destinationHost: peer.id, items: projected };
  const runId = sha256Bytes(Buffer.from(stableJson(identity))).slice(DIGEST_PREFIX.length, DIGEST_PREFIX.length + 24);
  return {
    ...identity,
    runId,
    createdAt: new Date().toISOString(),
    bytes: items.reduce((sum, item) => sum + item.bytes, 0),
  };
}

export type PushOptions = { interruptAfterFiles?: number };

async function publishLocal(policy: Policy, peer: Peer & { endpoint: LocalEndpoint }, items: TransferItem[], batch: BatchManifest, options: PushOptions): Promise<void> {
  const sourceRoot = join(peer.endpoint.root, "inbox", policy.hostId);
  const complete = join(sourceRoot, "runs", batch.runId);
  if (await exists(join(complete, "manifest.json"))) return;
  const staging = join(sourceRoot, ".staging", batch.runId);
  await mkdir(staging, { recursive: true });
  let copied = 0;
  for (const item of items) {
    for (const file of item.files) {
      await atomicCopy(file.sourcePath, join(staging, "files", file.targetPath), file.digest);
      copied += 1;
      if (options.interruptAfterFiles === copied) throw new FleetSyncError("Injected interruption after durable stage copy", "INTERRUPTED");
    }
  }
  await atomicWrite(join(staging, "manifest.json"), `${stableJson(batch)}\n`);
  await mkdir(dirname(complete), { recursive: true });
  try {
    await rename(staging, complete);
  } catch (error) {
    if (!(await exists(join(complete, "manifest.json")))) throw error;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function command(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveCommand, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errors: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolveCommand();
      else reject(new FleetSyncError(`${command} failed (${code}): ${Buffer.concat(errors).toString("utf8").trim()}`, "TRANSPORT"));
    });
  });
}

async function publishSsh(policy: Policy, peer: Peer & { endpoint: SshEndpoint }, items: TransferItem[], batch: BatchManifest): Promise<void> {
  const sourceRoot = join(peer.endpoint.root, "inbox", policy.hostId);
  const stage = join(sourceRoot, ".staging", batch.runId);
  const complete = join(sourceRoot, "runs", batch.runId);
  await command("ssh", [peer.endpoint.host, `mkdir -p ${shellQuote(join(stage, "files"))} ${shellQuote(dirname(complete))}`]);
  for (const item of items) {
    for (const file of item.files) {
      const remote = join(stage, "files", file.targetPath);
      await command("ssh", [peer.endpoint.host, `mkdir -p ${shellQuote(dirname(remote))}`]);
      await command("scp", ["-p", file.sourcePath, `${peer.endpoint.host}:${shellQuote(`${remote}.tmp`)}`]);
      await command("ssh", [peer.endpoint.host, `mv -f ${shellQuote(`${remote}.tmp`)} ${shellQuote(remote)}`]);
    }
  }
  const localManifest = join(policy.stateRoot, ".transport", `${batch.runId}.manifest.json`);
  await atomicWrite(localManifest, `${stableJson(batch)}\n`);
  await command("scp", ["-p", localManifest, `${peer.endpoint.host}:${shellQuote(join(stage, "manifest.json"))}`]);
  await command("ssh", [peer.endpoint.host, `test -e ${shellQuote(join(complete, "manifest.json"))} || mv ${shellQuote(stage)} ${shellQuote(complete)}`]);
  await rm(localManifest, { force: true });
}

export async function withHostLock<T>(policy: Policy, action: () => Promise<T>): Promise<T> {
  const lock = join(policy.stateRoot, "host.lock");
  await mkdir(policy.stateRoot, { recursive: true });
  try {
    await mkdir(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new FleetSyncError(`Fleet sync already running for ${policy.hostId}`, "LOCKED");
    throw error;
  }
  await atomicWrite(join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  try {
    return await action();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function push(policy: Policy, peerId: string, options: PushOptions = {}): Promise<{ runId: string | null; items: number; bytes: number; receipt: string }> {
  const peer = policy.peers.find((candidate) => candidate.id === peerId);
  if (!peer) throw new FleetSyncError(`Unknown peer: ${peerId}`, "PEER");
  const result = await scan(policy);
  const cursorPath = join(policy.stateRoot, "cursors", `push-${peer.id}.json`);
  const cursor = await readRecord(cursorPath);
  const selected = selectBounded(result.items, cursor, policy.maxBytesPerRun);
  const receiptPath = join(policy.stateRoot, "receipts", "push", `${peer.id}.jsonl`);
  if (selected.length === 0) {
    await appendJsonLine(receiptPath, { schemaVersion: 1, at: new Date().toISOString(), peer: peer.id, result: "up-to-date", bytes: 0 });
    return { runId: null, items: 0, bytes: 0, receipt: receiptPath };
  }
  const batch = batchFor(policy, peer, selected);
  if (peer.endpoint.kind === "local") await publishLocal(policy, peer as Peer & { endpoint: LocalEndpoint }, selected, batch, options);
  else await publishSsh(policy, peer as Peer & { endpoint: SshEndpoint }, selected, batch);
  for (const item of selected) cursor[item.logicalKey] = item.logicalDigest;
  await atomicWrite(cursorPath, `${stableJson(cursor)}\n`);
  await appendJsonLine(receiptPath, { schemaVersion: 1, at: new Date().toISOString(), peer: peer.id, result: "published", runId: batch.runId, items: selected.length, bytes: batch.bytes });
  return { runId: batch.runId, items: selected.length, bytes: batch.bytes, receipt: receiptPath };
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a", 0o600);
  try {
    await handle.write(`${JSON.stringify(value)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function batchRuns(policy: Policy): Promise<Array<{ source: string; path: string }>> {
  const inbox = join(policy.stateRoot, "inbox");
  let sources: string[];
  try {
    sources = await readdir(inbox);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const runs: Array<{ source: string; path: string }> = [];
  for (const source of sources.sort()) {
    if (source.startsWith(".")) continue;
    const root = join(inbox, source, "runs");
    try {
      for (const run of (await readdir(root)).sort()) runs.push({ source, path: join(root, run) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return runs;
}

function validateBatch(batch: BatchManifest, source: string, policy: Policy): void {
  if (batch.schemaVersion !== 1 || batch.sourceHost !== source || batch.destinationHost !== policy.hostId || !batch.runId) {
    throw new FleetSyncError(`Invalid batch manifest for ${source}`, "BATCH_MANIFEST");
  }
}

export async function pull(policy: Policy): Promise<{ applied: number; bytes: number; receipts: string[] }> {
  const indexPath = join(policy.stateRoot, "immutable-index.json");
  const index = await readRecord(indexPath);
  let applied = 0;
  let bytes = 0;
  const receipts: string[] = [];
  for (const run of await batchRuns(policy)) {
    const batch = await jsonFile<BatchManifest>(join(run.path, "manifest.json"));
    validateBatch(batch, run.source, policy);
    const receiptPath = join(policy.stateRoot, "receipts", "pull", run.source, `${batch.runId}.json`);
    if (await exists(receiptPath)) continue;
    for (const item of batch.items) {
      const existing = index[item.logicalKey];
      if (existing && existing !== item.logicalDigest && (item.kind === "journal" || item.kind === "git")) {
        throw new FleetSyncError(`Divergent immutable item refused: ${item.logicalKey}`, "DIVERGENT_IMMUTABLE");
      }
      for (const file of item.files) {
        const source = join(run.path, "files", safeRelative(file.targetPath));
        if ((await stat(source)).size !== file.bytes || (await sha256File(source)) !== file.digest) {
          throw new FleetSyncError(`Inbound batch file failed verification: ${source}`, "INBOUND_DIGEST");
        }
      }
    }
    for (const item of batch.items) {
      for (const file of item.files) {
        await atomicCopy(join(run.path, "files", file.targetPath), join(policy.stateRoot, "replicas", run.source, file.targetPath), file.digest);
      }
      index[item.logicalKey] = item.logicalDigest;
    }
    await atomicWrite(indexPath, `${stableJson(index)}\n`);
    await atomicWrite(receiptPath, `${stableJson({ schemaVersion: 1, sourceHost: run.source, destinationHost: policy.hostId, runId: batch.runId, verifiedAt: new Date().toISOString(), items: batch.items.length, bytes: batch.bytes })}\n`);
    receipts.push(receiptPath);
    applied += batch.items.length;
    bytes += batch.bytes;
  }
  return { applied, bytes, receipts };
}

export async function verify(policy: Policy): Promise<{ ok: true; checkedFiles: number; checkedRuns: number }> {
  let checkedFiles = 0;
  let checkedRuns = 0;
  const index = await readRecord(join(policy.stateRoot, "immutable-index.json"));
  const seen = new Map<string, string>();
  for (const run of await batchRuns(policy)) {
    const batch = await jsonFile<BatchManifest>(join(run.path, "manifest.json"));
    validateBatch(batch, run.source, policy);
    checkedRuns += 1;
    for (const item of batch.items) {
      const prior = seen.get(item.logicalKey) ?? index[item.logicalKey];
      if (prior && prior !== item.logicalDigest && (item.kind === "journal" || item.kind === "git")) {
        throw new FleetSyncError(`Divergent immutable item: ${item.logicalKey}`, "DIVERGENT_IMMUTABLE");
      }
      seen.set(item.logicalKey, item.logicalDigest);
      for (const file of item.files) {
        const inboundPath = join(run.path, "files", safeRelative(file.targetPath));
        if ((await sha256File(inboundPath)) !== file.digest) throw new FleetSyncError(`Verification failed: ${inboundPath}`, "VERIFY_DIGEST");
        checkedFiles += 1;
        const receiptPath = join(policy.stateRoot, "receipts", "pull", run.source, `${batch.runId}.json`);
        if (await exists(receiptPath)) {
          const replicaPath = join(policy.stateRoot, "replicas", run.source, file.targetPath);
          if ((await sha256File(replicaPath)) !== file.digest) throw new FleetSyncError(`Replica verification failed: ${replicaPath}`, "VERIFY_REPLICA_DIGEST");
          checkedFiles += 1;
        }
      }
    }
  }
  for (const [key, digest] of Object.entries(index)) {
    if (seen.has(key) && seen.get(key) !== digest) throw new FleetSyncError(`Replica index diverges: ${key}`, "INDEX_DIVERGENCE");
  }
  return { ok: true, checkedFiles, checkedRuns };
}

export async function recordError(policy: Policy, operation: string, error: unknown): Promise<void> {
  const failurePath = join(policy.stateRoot, "errors.jsonl");
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof FleetSyncError ? error.code : "UNEXPECTED";
  await appendJsonLine(failurePath, { schemaVersion: 1, at: new Date().toISOString(), hostId: policy.hostId, operation, code, message });
  const backoffPath = join(policy.stateRoot, "backoff.json");
  const previous = await jsonFile<{ failures: number }>(backoffPath).catch(() => ({ failures: 0 }));
  const failures = previous.failures + 1;
  const seconds = policy.schedule.backoffSeconds[Math.min(failures - 1, policy.schedule.backoffSeconds.length - 1)] ?? 3600;
  await atomicWrite(backoffPath, `${JSON.stringify({ failures, nextAttemptAt: new Date(Date.now() + seconds * 1000).toISOString() })}\n`);
}

export async function recordSuccess(policy: Policy): Promise<void> {
  await atomicWrite(join(policy.stateRoot, "backoff.json"), `${JSON.stringify({ failures: 0, nextAttemptAt: null })}\n`);
  await atomicWrite(join(policy.stateRoot, "health.json"), `${JSON.stringify({ schemaVersion: 1, hostId: policy.hostId, healthy: true, lastSuccessAt: new Date().toISOString() })}\n`);
}

export async function backoffActive(policy: Policy): Promise<{ active: boolean; nextAttemptAt: string | null }> {
  try {
    const state = await jsonFile<{ nextAttemptAt: string | null }>(join(policy.stateRoot, "backoff.json"));
    return { active: state.nextAttemptAt !== null && Date.parse(state.nextAttemptAt) > Date.now(), nextAttemptAt: state.nextAttemptAt };
  } catch {
    return { active: false, nextAttemptAt: null };
  }
}

export async function status(policy: Policy): Promise<Record<string, unknown>> {
  const scanResult = await scan(policy);
  const lock = await exists(join(policy.stateRoot, "host.lock"));
  const backoff = await backoffActive(policy);
  const pushCursors = await Promise.all(policy.peers.map((peer) => readRecord(join(policy.stateRoot, "cursors", `push-${peer.id}.json`))));
  const pendingByPeer = policy.peers.map((peer, index) => {
    const pending = scanResult.items.filter((item) => pushCursors[index]?.[item.logicalKey] !== item.logicalDigest);
    return { peer: peer.id, items: pending.length, bytes: pending.reduce((sum, item) => sum + item.bytes, 0) };
  });
  let lastError: { at?: string } | null = null;
  try {
    const lines = (await readFile(join(policy.stateRoot, "errors.jsonl"), "utf8")).trim().split("\n");
    if (lines[0]) lastError = JSON.parse(lines[lines.length - 1] ?? "null") as { at?: string } | null;
  } catch {}
  const health = await jsonFile<{ lastSuccessAt?: string }>(join(policy.stateRoot, "health.json")).catch(
    (): { lastSuccessAt?: string } => ({}),
  );
  const recovered = Boolean(health.lastSuccessAt && (!lastError?.at || Date.parse(health.lastSuccessAt) >= Date.parse(lastError.at)));
  return {
    schemaVersion: 1,
    hostId: policy.hostId,
    healthy: !lock && !backoff.active && (lastError === null || recovered),
    lockHeld: lock,
    backoff,
    pendingByPeer,
    skippedActiveJournalTails: scanResult.skippedActiveJournalTails,
    skippedExcludedPaths: scanResult.skippedExcludedPaths,
    lastError,
    errorLog: join(policy.stateRoot, "errors.jsonl"),
  };
}
