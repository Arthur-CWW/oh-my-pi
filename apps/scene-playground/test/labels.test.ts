import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { openLabels } from "../src/labels";
import { createScenePlaygroundApp, type ScenePlaygroundApp } from "../src/server";

// ---------------------------------------------------------------------------
// Labels store unit tests
// ---------------------------------------------------------------------------

describe("labels store", () => {
  test("assign and list by media", () => {
    const store = openLabels(":memory:");
    store.ensureGroup("motion", "1");
    const row = store.assign("clip.mp4", "motion");
    expect(row.media_path).toBe("clip.mp4");
    expect(row.grp).toBe("motion");
    expect(typeof row.ts).toBe("string");

    const byMedia = store.listByMedia("clip.mp4");
    expect(byMedia).toHaveLength(1);
    expect(byMedia[0]!.grp).toBe("motion");
    store.close();
  });

  test("assign is idempotent (UNIQUE constraint)", () => {
    const store = openLabels(":memory:");
    store.assign("clip.mp4", "motion");
    store.assign("clip.mp4", "motion"); // upsert, not error
    const byMedia = store.listByMedia("clip.mp4");
    expect(byMedia).toHaveLength(1);
    store.close();
  });

  test("unassign removes label", () => {
    const store = openLabels(":memory:");
    store.assign("clip.mp4", "motion");
    const removed = store.unassign("clip.mp4", "motion");
    expect(removed).toBe(true);
    expect(store.listByMedia("clip.mp4")).toHaveLength(0);

    const notThere = store.unassign("clip.mp4", "motion");
    expect(notThere).toBe(false);
    store.close();
  });

  test("multiple groups per item", () => {
    const store = openLabels(":memory:");
    store.assign("clip.mp4", "motion");
    store.assign("clip.mp4", "texture");
    expect(store.listByMedia("clip.mp4")).toHaveLength(2);
    store.close();
  });

  test("listByGroup returns items in that group", () => {
    const store = openLabels(":memory:");
    store.assign("a.mp4", "motion");
    store.assign("b.mp4", "motion");
    store.assign("c.mp4", "texture");
    const motionItems = store.listByGroup("motion");
    expect(motionItems).toHaveLength(2);
    expect(motionItems.map((r) => r.media_path).sort()).toEqual(["a.mp4", "b.mp4"]);
    store.close();
  });

  test("groupsWithCounts returns counts", () => {
    const store = openLabels(":memory:");
    store.ensureGroup("motion", "1");
    store.ensureGroup("texture", "2");
    store.assign("a.mp4", "motion");
    store.assign("b.mp4", "motion");
    store.assign("c.mp4", "texture");
    const groups = store.groupsWithCounts();
    expect(groups).toHaveLength(2);
    const motion = groups.find((g) => g.name === "motion");
    expect(motion?.count).toBe(2);
    const texture = groups.find((g) => g.name === "texture");
    expect(texture?.count).toBe(1);
    store.close();
  });

  test("ensureGroup auto-assigns digit keys 1-9", () => {
    const store = openLabels(":memory:");
    const g1 = store.ensureGroup("first");
    expect(g1.key).toBe("1");
    const g2 = store.ensureGroup("second");
    expect(g2.key).toBe("2");
    // Calling again returns existing
    const g1again = store.ensureGroup("first");
    expect(g1again.key).toBe("1");
    expect(g1again.ord).toBe(0);
    store.close();
  });

  test("ensureGroup respects explicit key", () => {
    const store = openLabels(":memory:");
    const g = store.ensureGroup("custom", "x");
    expect(g.key).toBe("x");
    store.close();
  });

  test("allLabels returns all rows", () => {
    const store = openLabels(":memory:");
    store.assign("a.mp4", "motion");
    store.assign("b.mp4", "texture");
    expect(store.allLabels()).toHaveLength(2);
    store.close();
  });
});

// ---------------------------------------------------------------------------
// Label keymap pure logic tests
// ---------------------------------------------------------------------------

import { gridMove, visualRange, effectiveIndices, nextUnlabeled, mapLabelKey, type LabelNavState } from "../src/ui/label/keymap";

describe("label keymap", () => {
  function makeState(overrides: Partial<LabelNavState> = {}): LabelNavState {
    return {
      focus: 0,
      total: 12,
      cols: 4,
      marks: new Set(),
      visualAnchor: null,
      filterFocused: false,
      inspecting: false,
      ...overrides,
    };
  }

  test("gridMove navigates correctly in a 4-col grid", () => {
    // 12 items in a 4-col grid: rows 0-2
    expect(gridMove(0, 4, 12, "right")).toBe(1);
    expect(gridMove(3, 4, 12, "right")).toBe(3); // rightmost col, no wrap
    expect(gridMove(0, 4, 12, "left")).toBe(0);  // leftmost col, no wrap
    expect(gridMove(1, 4, 12, "left")).toBe(0);
    expect(gridMove(0, 4, 12, "down")).toBe(4);
    expect(gridMove(8, 4, 12, "down")).toBe(11); // clamped to total-1
    expect(gridMove(4, 4, 12, "up")).toBe(0);
    expect(gridMove(0, 4, 12, "up")).toBe(0);    // clamped at 0
  });

  test("visualRange returns ordered [lo, hi]", () => {
    expect(visualRange(2, 5)).toEqual([2, 5]);
    expect(visualRange(5, 2)).toEqual([2, 5]);
    expect(visualRange(3, 3)).toEqual([3, 3]);
  });

  test("effectiveIndices returns visual range when active", () => {
    const s = makeState({ focus: 5, visualAnchor: 2 });
    expect(effectiveIndices(s)).toEqual([2, 3, 4, 5]);
  });

  test("effectiveIndices returns marks when set", () => {
    const s = makeState({ focus: 0, marks: new Set([1, 3, 7]) });
    expect(effectiveIndices(s)).toEqual([1, 3, 7]);
  });

  test("effectiveIndices returns focus when nothing selected", () => {
    const s = makeState({ focus: 4 });
    expect(effectiveIndices(s)).toEqual([4]);
  });

  test("nextUnlabeled skips labeled items", () => {
    const labeled = new Set([1, 2, 3]);
    expect(nextUnlabeled(0, 6, labeled)).toBe(4);
    expect(nextUnlabeled(4, 6, labeled)).toBe(5);
  });

  test("nextUnlabeled wraps around", () => {
    const labeled = new Set([3, 4, 5]);
    expect(nextUnlabeled(4, 6, labeled)).toBe(0);
  });

  test("nextUnlabeled advances by 1 when all labeled", () => {
    const labeled = new Set([0, 1, 2, 3]);
    expect(nextUnlabeled(2, 4, labeled)).toBe(3);
  });

  test("mapLabelKey j moves down", () => {
    const action = mapLabelKey("j", false, makeState({ focus: 0 }));
    expect(action.type).toBe("move");
    if (action.type === "move") expect(action.index).toBe(4); // row below in 4-col grid
  });

  test("mapLabelKey h moves left", () => {
    const action = mapLabelKey("h", false, makeState({ focus: 5 }));
    expect(action.type).toBe("move");
    if (action.type === "move") expect(action.index).toBe(4);
  });

  test("mapLabelKey digit assigns group", () => {
    const s = makeState({ focus: 2, marks: new Set([1, 3]) });
    const action = mapLabelKey("3", false, s);
    expect(action.type).toBe("assign-group");
    if (action.type === "assign-group") {
      expect(action.key).toBe("3");
      expect(action.indices).toEqual([1, 3]); // marks
    }
  });

  test("mapLabelKey v starts visual mode", () => {
    expect(mapLabelKey("v", false, makeState()).type).toBe("visual-start");
  });

  test("mapLabelKey v in visual mode clears", () => {
    const s = makeState({ visualAnchor: 2 });
    expect(mapLabelKey("v", false, s).type).toBe("visual-clear");
  });

  test("mapLabelKey / focuses filter", () => {
    expect(mapLabelKey("/", false, makeState()).type).toBe("filter-focus");
  });

  test("mapLabelKey ? toggles help", () => {
    expect(mapLabelKey("?", false, makeState()).type).toBe("help-toggle");
  });

  test("mapLabelKey returns none when filter focused", () => {
    const s = makeState({ filterFocused: true });
    expect(mapLabelKey("j", false, s).type).toBe("none");
    expect(mapLabelKey("Escape", false, s).type).toBe("filter-focus"); // Escape escapes
  });

  test("mapLabelKey returns none when inspecting (except Escape/i)", () => {
    const s = makeState({ inspecting: true });
    expect(mapLabelKey("j", false, s).type).toBe("none");
    expect(mapLabelKey("Escape", false, s).type).toBe("inspect-toggle");
    expect(mapLabelKey("i", false, s).type).toBe("inspect-toggle");
  });

  test("mapLabelKey s cycles sort", () => {
    expect(mapLabelKey("s", false, makeState()).type).toBe("cycle-sort");
  });

  test("mapLabelKey u unassigns", () => {
    const action = mapLabelKey("u", false, makeState({ focus: 3 }));
    expect(action.type).toBe("unassign");
    if (action.type === "unassign") expect(action.indices).toEqual([3]);
  });
});

// ---------------------------------------------------------------------------
// Server route tests
// ---------------------------------------------------------------------------

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

async function startTestServer(): Promise<TestServer> {
  const root = await mkdtemp(join(tmpdir(), "label-test-"));
  await mkdir(join(root, "workflows/scene-lab/specs"), { recursive: true });
  await mkdir(join(root, "workflows/scene-lab/assets"), { recursive: true });
  await mkdir(join(root, "data/video-recreation"), { recursive: true });
  await mkdir(join(root, "data/inspiration/pleometric"), { recursive: true });
  const app = await createScenePlaygroundApp({
    repoRoot: root,
    appDir: join(import.meta.dir, ".."),
    distDir: join(root, "dist"),
    buildUi: false,
  });
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const testServer: TestServer = { app, server, baseUrl: `http://127.0.0.1:${server.port}`, root };
  servers.push(testServer);
  return testServer;
}

afterEach(async () => {
  while (servers.length > 0) {
    const s = servers.pop()!;
    s.app.close();
    s.server.stop(true);
    await rm(s.root, { recursive: true, force: true });
  }
});

describe("label routes", () => {
  test("GET /api/corpus returns items with labels array", async () => {
    const { baseUrl, root } = await startTestServer();
    const manifest = {
      schemaVersion: "pleometric-corpus.v1",
      items: [
        { tweetId: "123", mediaType: "video", file: "123-1.mp4" },
        { tweetId: "456", mediaType: "gif", file: "456-1.mp4" },
      ],
    };
    await writeFile(join(root, "data/inspiration/pleometric/manifest.json"), JSON.stringify(manifest));
    const res = await fetch(`${baseUrl}/api/corpus`);
    expect(res.status).toBe(200);
    const corpus = (await res.json()) as Array<{ tweetId: string; labels: string[] }>;
    expect(corpus).toHaveLength(2);
    expect(corpus[0]!.labels).toEqual([]);
    expect(corpus[0]!.tweetId).toBe("123");
  });

  test("PUT /api/labels assigns and GET returns rows", async () => {
    const { baseUrl } = await startTestServer();
    const putRes = await fetch(`${baseUrl}/api/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: "123-1.mp4", group: "motion", op: "add" }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await fetch(`${baseUrl}/api/labels`);
    const labels = (await getRes.json()) as Array<{ media_path: string; grp: string }>;
    expect(labels).toHaveLength(1);
    expect(labels[0]!.media_path).toBe("123-1.mp4");
    expect(labels[0]!.grp).toBe("motion");
  });

  test("PUT /api/labels remove deletes label", async () => {
    const { baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: "123-1.mp4", group: "motion", op: "add" }),
    });
    const removeRes = await fetch(`${baseUrl}/api/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: "123-1.mp4", group: "motion", op: "remove" }),
    });
    expect(removeRes.status).toBe(200);
    const labels = (await (await fetch(`${baseUrl}/api/labels`)).json()) as unknown[];
    expect(labels).toHaveLength(0);
  });

  test("PUT /api/labels rejects paths outside data/inspiration", async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: "../../etc/passwd", group: "evil", op: "add" }),
    });
    expect(res.status).toBe(403);
  });

  test("PUT /api/labels rejects invalid body", async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: "x.mp4" }), // missing group and op
    });
    expect(res.status).toBe(400);
  });

  test("GET /api/label-groups returns groups with counts", async () => {
    const { baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/label-groups`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "motion" }),
    });
    const res = await fetch(`${baseUrl}/api/label-groups`);
    const groups = (await res.json()) as Array<{ name: string; count: number }>;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("motion");
    expect(groups[0]!.count).toBe(0);
  });

  test("label ops record provenance in ledger", async () => {
    const { baseUrl } = await startTestServer();
    await fetch(`${baseUrl}/api/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: "clip.mp4", group: "motion", op: "add" }),
    });
    const ledgerRes = await fetch(`${baseUrl}/api/ledger?limit=5`);
    const records = (await ledgerRes.json()) as Array<{ path: string; actor: string }>;
    const labelRecord = records.find((r) => r.path.includes("clip.mp4"));
    expect(labelRecord).toBeDefined();
    expect(labelRecord!.actor).toBe("human");
  });

  test("corpus join reflects assigned labels", async () => {
    const { baseUrl, root } = await startTestServer();
    const manifest = {
      schemaVersion: "pleometric-corpus.v1",
      items: [{ tweetId: "t1", mediaType: "video", file: "t1-1.mp4" }],
    };
    await writeFile(join(root, "data/inspiration/pleometric/manifest.json"), JSON.stringify(manifest));
    // Assign label
    await fetch(`${baseUrl}/api/labels`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mediaPath: "t1-1.mp4", group: "motion", op: "add" }),
    });
    const res = await fetch(`${baseUrl}/api/corpus`);
    const corpus = (await res.json()) as Array<{ file: string; labels: string[] }>;
    expect(corpus[0]!.labels).toEqual(["motion"]);
  });
});
