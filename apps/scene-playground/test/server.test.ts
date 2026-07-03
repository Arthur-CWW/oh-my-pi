import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "bun:test";
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

const servers: TestServer[] = [];

async function startTestServer(options: { sseHeartbeatMs?: number } = {}): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "scene-playground-"));
  await mkdir(join(root, "workflows/scene-lab/specs"), { recursive: true });
  await mkdir(join(root, "workflows/scene-lab/assets"), { recursive: true });
  await mkdir(join(root, "data/video-recreation"), { recursive: true });
  const appOptions = { repoRoot: root, appDir: join(import.meta.dir, ".."), distDir: join(root, "dist"), buildUi: false };
  const app = await createScenePlaygroundApp(options.sseHeartbeatMs === undefined ? appOptions : { ...appOptions, sseHeartbeatMs: options.sseHeartbeatMs });
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const testServer: TestServer = { app, server, baseUrl: `http://127.0.0.1:${server.port}`, root };
  servers.push(testServer);
  return testServer;
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

describe("scene playground routes", () => {
  test("lists scene specs with repo-relative paths and mtimes", async () => {
    const testServer = await startTestServer();
    const specPath = join(testServer.root, "workflows/scene-lab/specs/beat-wall.scene.json");
    await writeFile(specPath, "{\"schemaVersion\":\"scene.v1\"}", "utf8");

    const response = await fetch(`${testServer.baseUrl}/api/specs`);
    expect(response.status).toBe(200);
    const specs = (await response.json()) as Array<{ path: string; mtime: string; bytes: number }>;

    expect(specs).toHaveLength(1);
    expect(specs[0]?.path).toBe("workflows/scene-lab/specs/beat-wall.scene.json");
    expect(typeof specs[0]?.mtime).toBe("string");
    expect(specs[0]?.bytes).toBeGreaterThan(0);
  });

  test("rejects spec path traversal on read and write", async () => {
    const testServer = await startTestServer();
    const readResponse = await fetch(`${testServer.baseUrl}/api/spec?path=${encodeURIComponent("../escape.scene.json")}`);
    const writeResponse = await fetch(`${testServer.baseUrl}/api/spec?path=${encodeURIComponent("../../escape.scene.json")}`, { method: "PUT", body: "{}" });

    expect(readResponse.status).toBe(400);
    expect(writeResponse.status).toBe(400);
  });

  test("streams allowed media and rejects files outside stream roots", async () => {
    const testServer = await startTestServer();
    const assetPath = join(testServer.root, "workflows/scene-lab/assets/hit.png");
    const outsidePath = join(testServer.root, "private.png");
    await writeFile(assetPath, new Uint8Array([137, 80, 78, 71]));
    await writeFile(outsidePath, new Uint8Array([1, 2, 3, 4]));

    const allowed = await fetch(`${testServer.baseUrl}/asset?path=${encodeURIComponent("workflows/scene-lab/assets/hit.png")}`);
    const rejected = await fetch(`${testServer.baseUrl}/asset?path=${encodeURIComponent("private.png")}`);

    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("content-type")).toBe("image/png");
    expect(await allowed.arrayBuffer()).toHaveProperty("byteLength", 4);
    expect(rejected.status).toBe(403);
  });

  test("reports an unbuilt scene runtime with a helpful 404", async () => {
    const testServer = await startTestServer();
    const response = await fetch(`${testServer.baseUrl}/runtime.js`);
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("Scene runtime not built");
  });

  test("keeps events streams alive with heartbeat comments", async () => {
    const testServer = await startTestServer({ sseHeartbeatMs: 15 });
    const controller = new AbortController();
    const response = await fetch(`${testServer.baseUrl}/events`, { signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    const deadline = Date.now() + 500;
    while (Date.now() < deadline && !body.includes(": ping")) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    controller.abort();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(body).toContain("data: {\"type\":\"ready\",\"path\":\"\"}");
    expect(body).toContain(": ping");
  });
});

describe("report routes", () => {
  test("lists reports with parsed front matter and media", async () => {
    const testServer = await startTestServer();
    const reportDir = join(testServer.root, "workflows/scene-lab/reports/2026-07-03-test-report");
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "report.md"), "title: Test Report\ndate: 2026-07-03\nagent: TestBot\nstatus: shipped\n\nThis is the excerpt paragraph.\n\n## Details\n\nMore content here.", "utf8");
    await writeFile(join(reportDir, "screenshot.png"), new Uint8Array([137, 80, 78, 71]));
    await writeFile(join(reportDir, "demo.mp4"), new Uint8Array([0, 0, 0]));

    const response = await fetch(`${testServer.baseUrl}/api/reports`);
    expect(response.status).toBe(200);
    const reports = (await response.json()) as ReportJson[];
    expect(reports).toHaveLength(1);

    const report = reports[0]!;
    expect(report.title).toBe("Test Report");
    expect(report.date).toBe("2026-07-03");
    expect(report.agent).toBe("TestBot");
    expect(report.status).toBe("shipped");
    expect(report.excerpt).toBe("This is the excerpt paragraph.");
    expect(report.path).toBe("workflows/scene-lab/reports/2026-07-03-test-report");
    expect(report.media).toContain("workflows/scene-lab/reports/2026-07-03-test-report/screenshot.png");
    expect(report.media).toContain("workflows/scene-lab/reports/2026-07-03-test-report/demo.mp4");
    expect(report.media).not.toContain("workflows/scene-lab/reports/2026-07-03-test-report/report.md");
  });

  test("excerpt skips heading lines and takes first prose paragraph", async () => {
    const testServer = await startTestServer();
    const reportDir = join(testServer.root, "workflows/scene-lab/reports/2026-07-03-heading-test");
    await mkdir(reportDir, { recursive: true });
    await writeFile(
      join(reportDir, "report.md"),
      "title: Heading Test\ndate: 2026-07-03\nagent: Bot\nstatus: shipped\n\n# Big Heading\n\n## Sub Heading\n\nActual prose paragraph here.\n\nMore content.",
      "utf8",
    );

    const response = await fetch(`${testServer.baseUrl}/api/reports`);
    const reports = (await response.json()) as ReportJson[];
    const report = reports.find((r) => r.title === "Heading Test");
    expect(report).toBeDefined();
    expect(report!.excerpt).toBe("Actual prose paragraph here.");
  });

  test("serves report files inside reports directory", async () => {
    const testServer = await startTestServer();
    const reportDir = join(testServer.root, "workflows/scene-lab/reports/2026-07-03-serve-test");
    await mkdir(reportDir, { recursive: true });
    await writeFile(join(reportDir, "report.md"), "title: Serve Test\ndate: 2026-07-03\nagent: Bot\nstatus: shipped\n\nBody here.", "utf8");
    await writeFile(join(reportDir, "proof.png"), new Uint8Array([137, 80, 78, 71]));

    const mdResponse = await fetch(`${testServer.baseUrl}/report?path=${encodeURIComponent("workflows/scene-lab/reports/2026-07-03-serve-test/report.md")}`);
    expect(mdResponse.status).toBe(200);
    expect(mdResponse.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    const mdBody = await mdResponse.text();
    expect(mdBody).toContain("Serve Test");

    const imgResponse = await fetch(`${testServer.baseUrl}/report?path=${encodeURIComponent("workflows/scene-lab/reports/2026-07-03-serve-test/proof.png")}`);
    expect(imgResponse.status).toBe(200);
    expect(imgResponse.headers.get("content-type")).toBe("image/png");
  });

  test("rejects report path traversal", async () => {
    const testServer = await startTestServer();
    const response = await fetch(`${testServer.baseUrl}/report?path=${encodeURIComponent("../../../etc/passwd")}`);
    expect(response.status).toBe(403);

    const response2 = await fetch(`${testServer.baseUrl}/report?path=${encodeURIComponent("workflows/scene-lab/specs/secret.json")}`);
    expect(response2.status).toBe(403);
  });

  test("emits report-added SSE on new report", async () => {
    const testServer = await startTestServer();

    // Collect SSE events via a persistent connection
    const controller = new AbortController();
    const events: string[] = [];
    const sseReady = new Promise<void>((resolve) => {
      void fetch(`${testServer.baseUrl}/events`, { signal: controller.signal })
        .then(async (response) => {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split("\n\n");
            buf = parts.pop()!;
            for (const part of parts) {
              const dataLine = part.split("\n").find((l) => l.startsWith("data: "));
              if (dataLine !== undefined) {
                events.push(dataLine.slice(6));
                if (events[0]?.includes('"ready"')) resolve();
              }
            }
          }
        })
        .catch(() => {});
    });

    await sseReady;
    expect(events.length).toBeGreaterThanOrEqual(1);

    // Create a new report dir then write report.md after a brief settle so
    // fs.watch registers the subdir before seeing the file (macOS batches
    // rapid mkdir+write into a single rename event otherwise).
    const reportDir = join(testServer.root, "workflows/scene-lab/reports/2026-07-03-sse-test");
    await mkdir(reportDir, { recursive: true });
    await Bun.sleep(150);
    await writeFile(join(reportDir, "report.md"), "title: SSE Test\ndate: 2026-07-03\nagent: Bot\nstatus: shipped\n\nBody.", "utf8");

    // Poll events array (fs.watch is async; real-timer wait is inherent to integration testing)
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !events.some((e) => e.includes("report-added"))) {
      await Bun.sleep(50);
    }

    controller.abort();
    const reportEvent = events.find((e) => e.includes("report-added"));
    expect(reportEvent).toBeDefined();
    expect(reportEvent).toContain("2026-07-03-sse-test");
  });
});

interface ReportJson {
  path: string;
  title: string;
  date: string;
  agent: string;
  status: string;
  excerpt: string;
  media: string[];
  mtime: string;
}
