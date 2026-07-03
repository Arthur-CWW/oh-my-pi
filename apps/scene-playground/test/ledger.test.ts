import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { openLedger, type EditActor, type EditRecord } from "../src/ledger";
import { createScenePlaygroundApp, type ScenePlaygroundApp } from "../src/server";

interface BunServer {
  port: number | undefined;
  stop(closeActiveConnections?: boolean): void;
}

interface TestServer {
  app: ScenePlaygroundApp;
  server: BunServer;
  baseUrl: string;
  root: string;
}

interface LedgerStatsJson {
  humanEdits: number;
  agentEdits: number;
  lastActor: EditActor | null;
  lastTs: string | null;
}

interface SpecJson {
  path: string;
  mtime: string;
  bytes: number;
  lastActor: EditActor | null;
  humanEdits: number;
  agentEdits: number;
}

interface ErrorEntryJson {
  source: "server" | "client";
  message: string;
  stack?: string;
  url?: string;
  ts: string;
}

const servers: TestServer[] = [];

async function startTestServer(): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "scene-playground-ledger-"));
  await mkdir(join(root, "workflows/scene-lab/specs"), { recursive: true });
  await mkdir(join(root, "workflows/scene-lab/assets"), { recursive: true });
  await mkdir(join(root, "data/video-recreation"), { recursive: true });
  const app = await createScenePlaygroundApp({ repoRoot: root, appDir: join(import.meta.dir, ".."), distDir: join(root, "dist"), buildUi: false });
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const testServer = { app, server, baseUrl: `http://127.0.0.1:${server.port}`, root };
  servers.push(testServer);
  return testServer;
}

async function readRecent(baseUrl: string, limit = 20): Promise<EditRecord[]> {
  const response = await fetch(`${baseUrl}/api/ledger?limit=${limit}`);
  expect(response.status).toBe(200);
  return (await response.json()) as EditRecord[];
}

async function waitForLedgerRow(testServer: TestServer, path: string, actor: EditActor): Promise<EditRecord> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await readRecent(testServer.baseUrl);
    const row = rows.find((candidate) => candidate.path === path && candidate.actor === actor);
    if (row !== undefined) return row;
    // Real fs.watch delivery is the behavior under test here; poll the HTTP ledger API until the OS event is observed.
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${actor} ledger row at ${path}`);
}

async function waitForLedgerRows(testServer: TestServer, path: string, actor: EditActor, count: number): Promise<EditRecord[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = (await readRecent(testServer.baseUrl)).filter((candidate) => candidate.path === path && candidate.actor === actor);
    if (rows.length >= count) return rows;
    // Real fs.watch delivery is the behavior under test here; poll the HTTP ledger API until the OS event is observed.
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${count} ${actor} ledger rows at ${path}`);
}

afterEach(async () => {
  while (servers.length > 0) {
    const testServer = servers.pop();
    if (testServer === undefined) continue;
    testServer.server.stop(true);
    testServer.app.close();
    await rm(testServer.root, { recursive: true, force: true });
  }
});

describe("ledger persistence", () => {
  test("recordEdit chains previous hashes and byte deltas", async () => {
    const root = await mkdtemp(join(tmpdir(), "scene-ledger-sqlite-"));
    const ledger = openLedger(join(root, "ledger.sqlite"));
    try {
      const path = "workflows/scene-lab/specs/hash-chain.scene.json";
      const first = ledger.recordEdit({ path, actor: "agent", agentHint: "SceneBot", content: "one" });
      const second = ledger.recordEdit({ path, actor: "human", content: "one-two" });

      expect(first.prevHash).toBeNull();
      expect(first.deltaBytes).toBeNull();
      expect(second.prevHash).toBe(first.contentHash);
      expect(second.deltaBytes).toBe(Buffer.byteLength("one-two", "utf8") - Buffer.byteLength("one", "utf8"));
      expect(ledger.latestForPath(path)?.id).toBe(second.id);
      expect(ledger.statsForPath(path)).toMatchObject({ humanEdits: 1, agentEdits: 1, lastActor: "human" });
      expect(ledger.listRecent(2).map((row) => row.id)).toEqual([second.id, first.id]);
    } finally {
      ledger.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("ledger routes and watchers", () => {
  test("PUT /api/spec records a human edit and exposes provenance in routes", async () => {
    const testServer = await startTestServer();
    const path = "workflows/scene-lab/specs/human-route.scene.json";
    const response = await fetch(`${testServer.baseUrl}/api/spec?path=${encodeURIComponent(path)}`, { method: "PUT", body: "{\"schemaVersion\":\"scene.v1\"}" });
    expect(response.status).toBe(200);

    const rows = await readRecent(testServer.baseUrl, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path, actor: "human", prevHash: null, deltaBytes: null });

    const statsResponse = await fetch(`${testServer.baseUrl}/api/ledger/stats?path=${encodeURIComponent(path)}`);
    expect(statsResponse.status).toBe(200);
    const stats = (await statsResponse.json()) as LedgerStatsJson;
    expect(stats.humanEdits).toBe(1);
    expect(stats.agentEdits).toBe(0);
    expect(stats.lastActor).toBe("human");
    expect(typeof stats.lastTs).toBe("string");

    const specsResponse = await fetch(`${testServer.baseUrl}/api/specs`);
    expect(specsResponse.status).toBe(200);
    const specs = (await specsResponse.json()) as SpecJson[];
    const spec = specs.find((candidate) => candidate.path === path);
    expect(spec).toMatchObject({ lastActor: "human", humanEdits: 1, agentEdits: 0 });
  });

  test("a spec write without a recent PUT records an agent edit", async () => {
    const testServer = await startTestServer();
    const path = "workflows/scene-lab/specs/agent-watch.scene.json";
    await writeFile(join(testServer.root, path), "{\"schemaVersion\":\"scene.v1\",\"agent\":true}", "utf8");

    const row = await waitForLedgerRow(testServer, path, "agent");
    expect(row.agentHint).toBeNull();
    expect(row.bytes).toBeGreaterThan(0);

    const statsResponse = await fetch(`${testServer.baseUrl}/api/ledger/stats?path=${encodeURIComponent(path)}`);
    const stats = (await statsResponse.json()) as LedgerStatsJson;
    expect(stats).toMatchObject({ humanEdits: 0, agentEdits: 1, lastActor: "agent" });
  });

  test("rapid distinct spec writes record distinct agent edits", async () => {
    const testServer = await startTestServer();
    const path = "workflows/scene-lab/specs/rapid-agent-watch.scene.json";
    await writeFile(join(testServer.root, path), "{\"schemaVersion\":\"scene.v1\",\"step\":1}", "utf8");
    // Keep the writes inside the old debounce window while still giving fs.watch a chance to deliver both events.
    await Bun.sleep(75);
    await writeFile(join(testServer.root, path), "{\"schemaVersion\":\"scene.v1\",\"step\":2}", "utf8");

    const rows = await waitForLedgerRows(testServer, path, "agent", 2);
    expect(new Set(rows.map((row) => row.contentHash)).size).toBeGreaterThanOrEqual(2);
    expect(rows[0]?.prevHash).toBe(rows[1]?.contentHash);
  });

  test("delayed watcher event for a PUT hash stays human-only", async () => {
    const testServer = await startTestServer();
    const path = "workflows/scene-lab/specs/delayed-human-watch.scene.json";
    const content = "{\"schemaVersion\":\"scene.v1\",\"human\":true}";
    const response = await fetch(`${testServer.baseUrl}/api/spec?path=${encodeURIComponent(path)}`, { method: "PUT", body: content });
    expect(response.status).toBe(200);

    // This deliberately crosses the old 3s time-only gate; hash suppression should still recognize the PUT content.
    await Bun.sleep(3_100);
    await writeFile(join(testServer.root, path), content, "utf8");
    await Bun.sleep(800);

    const rows = (await readRecent(testServer.baseUrl)).filter((row) => row.path === path);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor).toBe("human");
  });

  test("new report.md files record agent edits", async () => {
    const testServer = await startTestServer();
    const reportDir = join(testServer.root, "workflows/scene-lab/reports/2026-07-03-ledger-report");
    await mkdir(reportDir, { recursive: true });
    // Give the recursive OS watcher a chance to attach to the new report directory before writing report.md.
    await Bun.sleep(150);
    const path = "workflows/scene-lab/reports/2026-07-03-ledger-report/report.md";
    await writeFile(join(testServer.root, path), "title: Ledger Report\n\nBody", "utf8");

    const row = await waitForLedgerRow(testServer, path, "agent");
    expect(row.path).toBe(path);
    expect(row.bytes).toBe(Buffer.byteLength("title: Ledger Report\n\nBody", "utf8"));
  });
});

describe("error routes", () => {
  test("server route errors are appended and returned newest first", async () => {
    const testServer = await startTestServer();
    const response = await fetch(`${testServer.baseUrl}/api/spec?path=${encodeURIComponent("missing.scene.json")}`);
    expect(response.status).toBe(500);

    const errorsResponse = await fetch(`${testServer.baseUrl}/api/errors?limit=5`);
    expect(errorsResponse.status).toBe(200);
    const errors = (await errorsResponse.json()) as ErrorEntryJson[];
    expect(errors[0]?.source).toBe("server");
    expect(errors[0]?.message).toContain("missing.scene.json");
    expect(errors[0]?.url).toContain("/api/spec");
  });

  test("client error posts append client log lines", async () => {
    const testServer = await startTestServer();
    const response = await fetch(`${testServer.baseUrl}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "client boom", stack: "stack here", url: "http://client.test/studio" }),
    });
    expect(response.status).toBe(204);

    const errorsResponse = await fetch(`${testServer.baseUrl}/api/errors?limit=1`);
    const errors = (await errorsResponse.json()) as ErrorEntryJson[];
    expect(errors[0]).toMatchObject({ source: "client", message: "client boom", stack: "stack here", url: "http://client.test/studio" });
  });

  test("client error posts reject malformed bodies", async () => {
    const testServer = await startTestServer();
    const response = await fetch(`${testServer.baseUrl}/api/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stack: "missing message" }),
    });
    expect(response.status).toBe(400);
  });
});
