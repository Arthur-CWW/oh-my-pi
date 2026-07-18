import { describe, expect, test } from "bun:test";
import {
  buildBoardModel,
  columnForRegisterStatus,
  columnForSessionState,
  diffBoardModels,
  isVersionSkewed,
  modalVersion,
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
  test("emits no patch when nothing changed", () => {
    const model = buildBoardModel([session()], [card()]);
    expect(diffBoardModels(model, model)).toEqual([]);
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
