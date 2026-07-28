import { describe, expect, it } from "bun:test";
import { buildTimeoutPartialProgress, extractTimeoutFileOps } from "@oh-my-pi/pi-coding-agent/task/executor";

describe("task timeout partial progress", () => {
	it("assembles file progress and last assistant text from synthetic tool-call events", () => {
		const events = [
			{ toolName: "write", args: { path: "src/new.ts", content: "export const x = 1;" } },
			{ toolName: "edit", args: { path: "src/existing.ts", patch: "..." } },
			{ toolName: "write", args: { path: "src/new.ts", content: "export const x = 2;" } },
			{ toolName: "read", args: { path: "src/ignored.ts" } },
		];

		expect(extractTimeoutFileOps(events)).toEqual({
			filesCreated: ["src/new.ts"],
			filesModified: ["src/existing.ts"],
		});

		expect(buildTimeoutPartialProgress(events, "  Last useful update.  ", "Agent Foo is idle.")).toEqual({
			filesCreated: ["src/new.ts"],
			filesModified: ["src/existing.ts"],
			lastAssistantText: "Last useful update.",
			ircNote: "Agent Foo is idle.",
		});
	});
});
