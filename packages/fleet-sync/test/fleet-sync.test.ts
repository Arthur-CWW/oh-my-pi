import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
  type Policy,
  pull,
  push,
  scan,
  verify,
} from "../src/core";
import { renderTimerArtifacts } from "../src/schedule";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fleet-sync-test-"));
  tempRoots.push(root);
  return root;
}

async function put(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
}

function digest(contents: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

function policy(hostId: string, root: string, peerId: string, peerRoot: string, sourceRoot: string, publicKey: string, maxBytesPerRun = 1024 * 1024): Policy {
  return {
    schemaVersion: 1,
    hostId,
    stateRoot: join(root, "state"),
    maxBytesPerRun,
    schedule: { intervalSeconds: 300, jitterSeconds: 45, backoffSeconds: [60, 300, 900, 3600] },
    peers: [{ id: peerId, endpoint: { kind: "local", root: peerRoot } }],
    sources: {
      laneReceiptRoots: [join(sourceRoot, "lanes")],
      journalRoots: [join(sourceRoot, "journals")],
      assetManifestRoots: [join(sourceRoot, "asset-manifests")],
      configSnapshotRoots: [join(sourceRoot, "config")],
      assetRoots: [join(sourceRoot, "assets")],
    },
    excludedPathParts: ["secret", "secrets", "cache", "override", "socket"],
    trustedConfigKeys: { test: publicKey },
  };
}

async function fixture(): Promise<{
  root: string;
  source: string;
  a: Policy;
  b: Policy;
  journal: string;
  checkpoint: string;
}> {
  const root = await tempRoot();
  const source = join(root, "A-source");
  const aRoot = join(root, "A");
  const bRoot = join(root, "B");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const bundle = join(source, "lanes", "named-change.bundle");
  await put(bundle, "bundle-object-bytes");
  await put(
    join(source, "lanes", "named-change.receipt.json"),
    JSON.stringify({
      version: 1,
      lane: "fleet-sync",
      stream: "harness",
      change_id: "uyyrmqpo",
      commit_id: "0123456789abcdef",
      parent_commit_id: "abcdef0123456789",
      bundle,
      bundle_ref: "refs/heads/harness-lane-bundle-fleet-sync-123",
      receipt: join(source, "lanes", "named-change.receipt.json"),
      sparse_patterns: ["packages/fleet-sync"],
    }),
  );
  const journal = join(source, "journals", "sessions", "segment-0001.jsonl");
  const journalBytes = '{"event":"closed"}\n';
  await put(journal, journalBytes);
  const checkpoint = join(source, "journals", "segment-0001.checkpoint.json");
  await put(
    checkpoint,
    JSON.stringify({
      version: 1,
      sessionId: "session-a",
      ownerEpoch: 7,
      segment: "sessions/segment-0001.jsonl",
      bytes: Buffer.byteLength(journalBytes),
      sha256: digest(journalBytes),
      closed: true,
    }),
  );
  await put(join(source, "journals", "sessions", "active-tail.jsonl"), '{"event":"mutable"}\n');
  const assetBytes = Buffer.from("asset-object-content");
  await put(join(source, "assets", "models", "mesh.bin"), assetBytes);
  const cacheBytes = Buffer.from("host-local-cache");
  await put(join(source, "assets", "cache", "derived.bin"), cacheBytes);
  await put(
    join(source, "asset-manifests", "models.asset-manifest.json"),
    JSON.stringify({
      version: 1,
      objects: [
        { path: "models/mesh.bin", sha256: digest(assetBytes), bytes: assetBytes.length },
        { path: "cache/derived.bin", sha256: digest(cacheBytes), bytes: cacheBytes.length },
      ],
    }),
  );
  const configBytes = Buffer.from('{"feature":true}\n');
  const configDigest = digest(configBytes);
  await put(join(source, "config", "tracked", "app.json"), configBytes);
  const message = Buffer.from(`fleet-sync-config-v1\ntracked/app.json\n${configDigest}\n${configBytes.length}`);
  await put(
    join(source, "config", "app.config-snapshot.json"),
    JSON.stringify({
      version: 1,
      path: "tracked/app.json",
      sha256: configDigest,
      bytes: configBytes.length,
      keyId: "test",
      signature: sign(null, message, privateKey).toString("base64"),
    }),
  );
  const secretBytes = Buffer.from("do-not-copy");
  const secretDigest = digest(secretBytes);
  await put(join(source, "config", "secret", "token.txt"), secretBytes);
  await put(
    join(source, "config", "secret.config-snapshot.json"),
    JSON.stringify({
      version: 1,
      path: "secret/token.txt",
      sha256: secretDigest,
      bytes: secretBytes.length,
      keyId: "test",
      signature: sign(null, Buffer.from(`fleet-sync-config-v1\nsecret/token.txt\n${secretDigest}\n${secretBytes.length}`), privateKey).toString("base64"),
    }),
  );
  const a = policy("A", aRoot, "B", join(bRoot, "state"), source, publicPem);
  const b = policy("B", bRoot, "A", join(aRoot, "state"), join(root, "B-source"), publicPem);
  return { root, source, a, b, journal, checkpoint };
}

describe("fleet immutable replication", () => {
  test("resumes interrupted staging, remains idempotent, and excludes mutable, secret, and cache state", async () => {
    const { a, b } = await fixture();
    const scanned = await scan(a);
    expect(scanned.skippedActiveJournalTails).toBe(1);
    expect(scanned.skippedExcludedPaths).toBe(2);
    expect(scanned.items.map((item) => item.kind).sort()).toEqual(["asset", "config", "git", "journal"]);

    await expect(push(a, "B", { interruptAfterFiles: 1 })).rejects.toMatchObject({ code: "INTERRUPTED" });
    const stageRoot = join(b.stateRoot, "inbox", "A", ".staging");
    expect((await readdir(stageRoot)).length).toBe(1);

    const published = await push(a, "B");
    expect(published.items).toBe(4);
    const applied = await pull(b);
    expect(applied.applied).toBe(4);
    expect(applied.receipts).toHaveLength(1);
    expect((await push(a, "B")).items).toBe(0);
    expect((await pull(b)).applied).toBe(0);
    expect(await verify(b)).toMatchObject({ ok: true, checkedRuns: 1 });

    const replicaFiles = await recursiveFiles(join(b.stateRoot, "replicas"));
    expect(replicaFiles.some((path) => path.includes("active-tail"))).toBe(false);
    expect(replicaFiles.some((path) => path.includes("token"))).toBe(false);
    expect(replicaFiles.some((path) => path.includes("secret"))).toBe(false);
    expect(replicaFiles.some((path) => path.includes("cache"))).toBe(false);
  });

  test("refuses divergent same-key immutable journal segments", async () => {
    const { a, b, journal, checkpoint } = await fixture();
    await push(a, "B");
    await pull(b);

    const changed = '{"event":"different immutable bytes"}\n';
    await put(journal, changed);
    const cp = JSON.parse(await readFile(checkpoint, "utf8")) as Record<string, unknown>;
    cp.bytes = Buffer.byteLength(changed);
    cp.sha256 = digest(changed);
    await put(checkpoint, JSON.stringify(cp));
    await push(a, "B");

    await expect(pull(b)).rejects.toMatchObject({ code: "DIVERGENT_IMMUTABLE" });
    const index = JSON.parse(await readFile(join(b.stateRoot, "immutable-index.json"), "utf8")) as Record<string, string>;
    expect(index["journal:session-a:7:sessions/segment-0001.jsonl"]).not.toBe(digest(changed));
  });

  test("never moves source bookmarks while publishing named lane bundles", async () => {
    const { a, b, source } = await fixture();
    const repo = join(source, "repo");
    await mkdir(repo, { recursive: true });
    await run(["git", "init", "-q"], repo);
    await run(["git", "config", "user.email", "fleet@example.invalid"], repo);
    await run(["git", "config", "user.name", "Fleet Test"], repo);
    await put(join(repo, "tracked.txt"), "tracked\n");
    await run(["git", "add", "tracked.txt"], repo);
    await run(["git", "commit", "-qm", "named change"], repo);
    const before = await run(["git", "show-ref", "--heads"], repo);

    await scan(a);
    await push(a, "B");
    await pull(b);
    const after = await run(["git", "show-ref", "--heads"], repo);
    expect(after).toBe(before);
  });

  test("enforces the aggregate byte ceiling without deleting pending items", async () => {
    const { root, a } = await fixture();
    const scanned = await scan(a);
    const smallest = [...scanned.items].sort((left, right) => left.bytes - right.bytes)[0];
    expect(smallest).toBeDefined();
    const cState = join(root, "C", "state");
    const bounded: Policy = {
      ...a,
      maxBytesPerRun: smallest?.bytes ?? 1,
      peers: [{ id: "C", endpoint: { kind: "local", root: cState } }],
    };
    const first = await push(bounded, "C");
    expect(first.bytes).toBeLessThanOrEqual(bounded.maxBytesPerRun);
    expect(first.items).toBe(1);
    const pending = await scan(bounded);
    expect(pending.items.length).toBeGreaterThan(first.items);
    expect((await stat(join(cState, "inbox", "A", "runs", first.runId ?? "", "manifest.json"))).isFile()).toBe(true);
  });

  test("renders launchd and systemd-user timers from the same typed schedule", async () => {
    const { a } = await fixture();
    const artifacts = renderTimerArtifacts(a, "/usr/bin/bun", "/opt/fleet-sync/cli.ts", "/etc/fleet-sync.json");
    expect(artifacts.schedule).toEqual(a.schedule);
    expect(artifacts.launchd.contents).toContain("<integer>300</integer>");
    expect(artifacts.launchd.contents).toContain("--jitter-seconds");
    expect(artifacts.launchd.contents).toContain("<string>45</string>");
    expect(artifacts.systemdTimer.contents).toContain("OnUnitActiveSec=300s");
    expect(artifacts.systemdTimer.contents).toContain("RandomizedDelaySec=45s");
    expect(artifacts.systemdService.contents).toContain('"/usr/bin/bun" "/opt/fleet-sync/cli.ts"');
  });
});

async function recursiveFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await recursiveFiles(path)));
    else files.push(path);
  }
  return files;
}

async function run(command: string[], cwd: string): Promise<string> {
  const processHandle = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited,
  ]);
  if (code !== 0) throw new Error(`${command.join(" ")} failed: ${stderr}`);
  return stdout;
}
