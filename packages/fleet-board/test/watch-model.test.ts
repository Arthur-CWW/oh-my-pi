import { describe, expect, it } from "bun:test";
import {
  hashForSession,
  normalizeFleet,
  renderMarkdown,
  selectSessionId,
  sessionIdFromHash,
  type FleetSession,
} from "../public/watch.ts";

const session = (sessionId: string): FleetSession => ({
  sessionId,
  name: sessionId,
  state: "working",
  workstream: "harness",
  objective: "observe",
  summary: "summary",
  spawnName: "spawn",
  todoHead: "todo",
  lastSeen: "2026-07-18T12:00:00.000Z",
  cwd: "/tmp",
  pid: 1,
  journal: "/tmp/session.jsonl",
  version: "1.0.0",
  digest: "abc123",
});

describe("watch model", () => {
  it("selects the hash-routed session and encodes session ids", () => {
    const sessions = [session("alpha"), session("session/with spaces")];
    expect(sessionIdFromHash("#session%2Fwith%20spaces")).toBe("session/with spaces");
    expect(hashForSession("session/with spaces")).toBe("#session%2Fwith%20spaces");
    expect(selectSessionId(sessions, "#session%2Fwith%20spaces")).toBe("session/with spaces");
    expect(selectSessionId(sessions, "#missing", "alpha")).toBe("alpha");
  });

  it("renders the small markdown subset while escaping raw HTML", () => {
    const rendered = renderMarkdown([
      "# Digest",
      "",
      "- one",
      "- [live thread](history://session-1)",
      "",
      "```ts",
      "<script>alert('x')</script>",
      "```",
      "",
      "<img src=x onerror=alert(1)>",
    ].join("\n"));
    expect(rendered).toContain("<h1>Digest</h1>");
    expect(rendered).toContain("<ul><li>one</li><li><a href=\"history://session-1\">live thread</a></li></ul>");
    expect(rendered).toContain("<pre><code class=\"language-ts\">&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;</code></pre>");
    expect(rendered).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(rendered).not.toContain("<script>");
    expect(rendered).not.toContain("<img");
  });

  it("keeps the selected session across fleet refreshes", () => {
    const first = [session("alpha"), session("beta")];
    const refreshed = [session("beta"), session("alpha"), session("gamma")];
    const stillSelected = selectSessionId(refreshed, "#alpha", "alpha");
    expect(stillSelected).toBe("alpha");
    expect(selectSessionId(refreshed, "", stillSelected)).toBe("alpha");
    expect(selectSessionId([session("beta")], "#alpha", "alpha")).toBe("beta");
    expect(normalizeFleet({ generatedAt: "now", sessions: first }).sessions.map(item => item.sessionId)).toEqual([
      "alpha",
      "beta",
    ]);
  });
});
