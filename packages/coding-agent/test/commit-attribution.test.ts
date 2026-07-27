import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { appendCommitTrailers, resolveCommitAttribution } from "../src/commit/attribution";

const originalSessionFile = process.env.PI_SESSION_FILE;
const temporaryRoots: string[] = [];

afterEach(async () => {
  if (originalSessionFile === undefined) delete process.env.PI_SESSION_FILE;
  else process.env.PI_SESSION_FILE = originalSessionFile;
  await Promise.all(temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("commit attribution trailers", () => {
  it("emits Session and Agent from the canonical live session journal", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-commit-trailer-"));
    temporaryRoots.push(root);
    const sessionId = "019f0000-0000-7000-8000-000000000001";
    const sessionFile = path.join(root, "BrowserContext.jsonl");
    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: "session", id: sessionId, cwd: root }),
      JSON.stringify({ type: "session_init", subagent: { agentId: "BrowserContext" } }),
    ].join("\n"));
    process.env.PI_SESSION_FILE = sessionFile;
    const attribution = await resolveCommitAttribution(root);
    expect(attribution).toEqual({ sessionId, agentId: "BrowserContext" });
    expect(appendCommitTrailers("feat: indexed sessions", attribution)).toBe(
      `feat: indexed sessions\n\nSession: ${sessionId}\nAgent: BrowserContext`,
    );
  });
});
