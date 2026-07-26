import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { resolveSubagentDefinition, resolveSubagentLspEnabled } from "@oh-my-pi/pi-coding-agent/task";
import { resolveSubagentWorkingDirectory } from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { SessionManager } from "../../src/session/session-manager";

type LspPolicySession = Pick<ToolSession, "enableLsp" | "settings">;

function createSession(options: { parentEnableLsp?: boolean; taskEnableLsp?: boolean } = {}): LspPolicySession {
	return {
		enableLsp: options.parentEnableLsp,
		settings: Settings.isolated({
			...(options.taskEnableLsp !== undefined ? { "task.enableLsp": options.taskEnableLsp } : {}),
		}),
	};
}

function taskAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return {
		name: "task",
		description: "Task agent",
		systemPrompt: "Use normal tools.",
		source: "bundled",
		tools: ["lsp"],
		...overrides,
	};
}

describe("subagent LSP availability", () => {
	it("disables LSP for subagents by default", () => {
		expect(resolveSubagentLspEnabled(createSession())).toBe(false);
	});

	it("enables subagent LSP when task.enableLsp is set", () => {
		expect(resolveSubagentLspEnabled(createSession({ taskEnableLsp: true }))).toBe(true);
	});

	it("keeps subagent LSP disabled when the parent session disables LSP", () => {
		expect(resolveSubagentLspEnabled(createSession({ parentEnableLsp: false, taskEnableLsp: true }))).toBe(false);
	});

	it("uses the isolated worktree cwd while LSP remains disabled by default", () => {
		expect(resolveSubagentWorkingDirectory("/repo", "/tmp/isolated-subagent")).toBe("/tmp/isolated-subagent");
		expect(resolveSubagentLspEnabled(createSession())).toBe(false);
	});

	it("opens an isolated persisted session with the resolved worktree cwd", async () => {
		const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-isolated-session-cwd-"));
		const worktree = path.join(tempDir, "isolated-subagent");
		await fs.mkdir(worktree);
		const sessionManager = await SessionManager.open(path.join(tempDir, "parent.jsonl"), undefined, undefined, {
			initialCwd: resolveSubagentWorkingDirectory(tempDir, worktree),
		});
		try {
			expect(sessionManager.getCwd()).toBe(worktree);
		} finally {
			await sessionManager.close();
			await fs.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("applies plan-mode subagent tools, preserves read-only specialty tools, and honors task.enableLsp", () => {
		const effectiveAgent = resolveSubagentDefinition(
			taskAgent({ tools: ["bash", "ast_grep", "report_finding", "memory_edit", "retain", "todo"] }),
			true,
		);

		expect(resolveSubagentLspEnabled(createSession({ taskEnableLsp: true }))).toBe(true);
		expect(effectiveAgent.tools).toEqual([
			"read",
			"search",
			"find",
			"lsp",
			"web_search",
			"ast_grep",
			"report_finding",
		]);
		expect(effectiveAgent.tools).not.toContain("bash");
		expect(effectiveAgent.tools).not.toContain("memory_edit");
		expect(effectiveAgent.tools).not.toContain("retain");
		expect(effectiveAgent.tools).not.toContain("todo");
	});
});
