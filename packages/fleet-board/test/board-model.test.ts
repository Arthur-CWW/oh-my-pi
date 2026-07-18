import { describe, expect, test } from "bun:test";
import {
  applyBoardPatches,
  buildBoardModel,
  columnForRegisterStatus,
  columnForSessionState,
  diffBoardModels,
  isVersionSkewed,
  modalVersion,
  type BoardRenderState,
  type FleetSession,
  type RegisterCard,
} from "../public/board";

const session = (overrides: Partial<FleetSession> = {}): FleetSession => ({
  session_id: "session-1",
  name: "Worker one",
  state: "working",
  workstream: "harness",
  summary: "Observer summary",
  todo_head: "Ship the board",
  version: "v1",
  last_seen: "2026-07-18T12:00:00.000Z",
  ...overrides,
});

const card = (overrides: Partial<RegisterCard> = {}): RegisterCard => ({
  id: "HR-200",
  intent: "Build the fleet board",
  status: "REQUESTED",
  phase: "v1",
  ...overrides,
});

describe("board column assignment", () => {
  test("assigns every register state to its PM column", () => {
    expect(columnForRegisterStatus("REQUESTED")).toBe("needs-arthur");
    expect(columnForRegisterStatus("awaiting")).toBe("needs-arthur");
    expect(columnForRegisterStatus("IN PROGRESS")).toBe("in-progress");
    expect(columnForRegisterStatus("HELD")).toBe("held-deferred");
    expect(columnForRegisterStatus("DEFERRED")).toBe("held-deferred");
    expect(columnForRegisterStatus("IMPLEMENTED")).toBe("recently-implemented");
  });

  test("assigns every live session state to its PM column", () => {
    expect(columnForSessionState("waiting_input")).toBe("needs-arthur");
    expect(columnForSessionState("working")).toBe("in-progress");
    expect(columnForSessionState("held")).toBe("held-deferred");
    expect(columnForSessionState("completed")).toBe("recently-implemented");
  });

  test("sorts implemented register rows by newest HR id", () => {
    const model = buildBoardModel([], [card({ id: "HR-198", status: "IMPLEMENTED" }), card({ id: "HR-204", status: "IMPLEMENTED" })]);
    expect(model.columns["recently-implemented"].map((item) => item.key)).toEqual(["card:HR-204", "card:HR-198"]);
  });
});

describe("version skew", () => {
  test("uses the modal version and flags only differing known versions", () => {
    const rows = [session({ session_id: "a", version: "v1" }), session({ session_id: "b", version: "v1" }), session({ session_id: "c", version: "v2" })];
    expect(modalVersion(rows)).toBe("v1");
    expect(isVersionSkewed("v1", "v1")).toBe(false);
    expect(isVersionSkewed("v2", "v1")).toBe(true);
    expect(isVersionSkewed(null, "v1")).toBe(false);
    expect(isVersionSkewed("v1", null)).toBe(false);
  });
});

describe("minimal board patches", () => {
  test("emits no patch for identical snapshots", () => {
    const before = buildBoardModel([session()], [card()]);
    const after = buildBoardModel([session()], [card()]);
    expect(diffBoardModels(before, after)).toEqual([]);
  });

  test("updates only the changed session cell", () => {
    const before = buildBoardModel([session()], []);
    const after = buildBoardModel([session({ summary: "New observer summary" })], []);
    expect(diffBoardModels(before, after)).toEqual([{ op: "update", key: "session:session-1", fields: ["summary"] }]);
  });

  test("separates a column move from changed cells", () => {
    const before = buildBoardModel([session({ state: "working" })], []);
    const after = buildBoardModel([session({ state: "waiting_input" })], []);
    expect(diffBoardModels(before, after)).toEqual([
      { op: "move", key: "session:session-1", column: "needs-arthur", index: 0 },
      { op: "update", key: "session:session-1", fields: ["state"] },
    ]);
  });
});

class MiniElement {
  className = "";
  dataset: Record<string, string> = {};
  hidden = false;
  textContent = "";
  readonly children: MiniElement[] = [];
  parent: MiniElement | null = null;
  private _innerHTML = "";

  set innerHTML(value: string) {
    this._innerHTML = value;
    this.children.length = 0;
    const fields = /<([a-z0-9]+)\b([^>]*)>/gi;
    for (const match of value.matchAll(fields)) {
      const attributes = match[2] ?? "";
      const field = /\bdata-field="([^"]+)"/i.exec(attributes)?.[1];
      if (!field) continue;
      const child = new MiniElement();
      child.dataset.field = field;
      child.className = /\bclass="([^"]+)"/i.exec(attributes)?.[1] ?? "";
      child.hidden = /\bhidden(?:\s|=|$)/i.test(attributes);
      this.append(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  get classList() {
    return {
      add: (...names: string[]) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) values.add(name);
        this.className = [...values].join(" ");
      },
      remove: (...names: string[]) => {
        const values = new Set(this.className.split(/\s+/).filter(Boolean));
        for (const name of names) values.delete(name);
        this.className = [...values].join(" ");
      },
      contains: (name: string) => this.className.split(/\s+/).includes(name),
    };
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    const field = /^\[data-field="([^"]+)"\]$/.exec(selector)?.[1];
    if (!field) return null;
    for (const child of this.children) {
      if (child.dataset.field === field) return child as unknown as T;
      const nested = child.querySelector<T>(selector);
      if (nested) return nested;
    }
    return null;
  }

  append(node: MiniElement) {
    node.remove();
    node.parent = this;
    this.children.push(node);
  }

  insertBefore(node: MiniElement, before: MiniElement) {
    if (node === before) return;
    node.remove();
    const index = this.children.indexOf(before);
    if (index < 0) {
      this.append(node);
      return;
    }
    node.parent = this;
    this.children.splice(index, 0, node);
  }

  remove() {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }
}

class MiniDocument {
  readonly columns = new Map<string, MiniElement>();
  readonly counts = new Map<string, MiniElement>();

  constructor() {
    for (const column of ["needs-arthur", "in-progress", "held-deferred", "recently-implemented"]) {
      this.columns.set(column, new MiniElement());
      this.counts.set(column, new MiniElement());
    }
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    const cards = /^\[data-cards="([^"]+)"\]$/.exec(selector)?.[1];
    if (cards) return (this.columns.get(cards) as unknown as T | undefined) ?? null;
    const count = /^\[data-count="([^"]+)"\]$/.exec(selector)?.[1];
    if (count) return (this.counts.get(count) as unknown as T | undefined) ?? null;
    return null;
  }

  createElement(_tagName: string) {
    return new MiniElement() as unknown as HTMLElement;
  }
}

test("applies board patches without rebuilding card nodes", () => {
  const root = new MiniDocument();
  const state: BoardRenderState = { current: null, selectedKey: null, nodes: new Map() };
  const before = buildBoardModel(
    [session({ last_seen: null }), session({ session_id: "session-2", summary: "Stable summary", last_seen: null })],
    [],
  );
  applyBoardPatches(before, diffBoardModels(null, before), state, root);

  const firstNode = state.nodes.get("session:session-1");
  const stableNode = state.nodes.get("session:session-2");
  const selectedKey = state.selectedKey;
  const after = buildBoardModel(
    [session({ last_seen: null }), session({ session_id: "session-2", summary: "Changed summary", last_seen: null })],
    [],
  );
  const patches = diffBoardModels(before, after);
  expect(patches).toEqual([{ op: "update", key: "session:session-2", fields: ["summary"] }]);

  applyBoardPatches(after, patches, state, root);

  expect(state.nodes.get("session:session-1")).toBe(firstNode);
  expect(state.nodes.get("session:session-2")).toBe(stableNode);
  expect(state.selectedKey).toBe(selectedKey);
  expect((state.nodes.get("session:session-1") as unknown as MiniElement).classList.contains("is-selected")).toBe(true);
  expect((stableNode as unknown as MiniElement).querySelector<HTMLElement>('[data-field="summary"]')?.textContent).toBe("Changed summary");
  expect(root.columns.get("in-progress")?.children).toHaveLength(2);
});

test("does not move existing nodes when an item is inserted before them", () => {
  const before = buildBoardModel([], [card({ id: "HR-198", status: "IMPLEMENTED" })]);
  const after = buildBoardModel([], [
    card({ id: "HR-198", status: "IMPLEMENTED" }),
    card({ id: "HR-204", status: "IMPLEMENTED" }),
  ]);
  expect(diffBoardModels(before, after)).toEqual([
    { op: "insert", key: "card:HR-204", item: after.items["card:HR-204"], column: "recently-implemented", index: 0 },
  ]);
});
