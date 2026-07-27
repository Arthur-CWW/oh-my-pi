import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { resolveSubagentDefinition, resolveSubagentLspEnabled } from "@oh-my-pi/pi-coding-agent/task";
import { resolveSubagentWorkingDirectory } from "@oh-my-pi/pi-coding-agent/task/executor";
import { SessionControlBus } from "@oh-my-pi/pi-coding-agent/session/session-control";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { IsoBackendKind } from "@oh-my-pi/pi-natives";
import { SessionManager } from "../../src/session/session-manager";

type LspPolicySession = Pick<ToolSession, "enableLsp" | "settings">;

interface ProcessReceipt {
	project: string;
	agentName: string;
	advertised: boolean;
	projectAgentsDir: string | null;
	ircDb: string;
	configRoot: string;
	configPath: string;
	controlDb: string;
	configDigest: string;
	stateDigest: string;
	configValue: boolean;
	controlSessionId: string;
	controlOwnerEpoch: string;
	toolNames: string[];
	registryCwd: string;
	persistedCwd: string;
	marker: string;
	sessionFile: string;
	agentSource: string;
	routeSelector: string;
	liveChildrenAfterExecute: number;
	isolationBackend: IsoBackendKind;
	worktreeExistsAfterExecute: boolean;
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

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

	it("creates a real isolated child with discovered tools, LSP, and persisted worktree cwd", async () => {
		const runsRoot = path.join(os.homedir(), "test-runs");
		await fs.mkdir(runsRoot, { recursive: true });
		const root = await fs.mkdtemp(path.join(runsRoot, "omp-subagent-lsp-"));
		try {
			const hostileHome = path.join(root, "hostile-home");
			const project = path.join(root, "project");
			const configRoot = path.join(root, "explicit-omp-config");
			const controlDb = path.join(root, "explicit-session-control.sqlite");
			const ircDb = path.join(hostileHome, ".omp", "agent", "irc-bus.sqlite");
			await Promise.all([fs.mkdir(hostileHome, { recursive: true }), fs.mkdir(project, { recursive: true })]);

			const env = { ...process.env };
			for (const key of Object.keys(env)) {
				if (key.startsWith("OMP_") || key.startsWith("PI_")) delete env[key];
			}
			const fallbackConfigRoot = path.join(hostileHome, ".omp");
			const fallbackControlDb = path.join(fallbackConfigRoot, "agent", "session-control.sqlite");
			expect(configRoot).not.toBe(fallbackConfigRoot);
			expect(controlDb).not.toBe(fallbackControlDb);
			Object.assign(env, {
				HOME: hostileHome,
				XDG_CONFIG_HOME: path.join(root, "xdg-config"),
				XDG_DATA_HOME: path.join(root, "xdg-data"),
				XDG_STATE_HOME: path.join(root, "xdg-state"),
				OMP_CONFIG_ROOT: configRoot,
				OMP_SESSION_CONTROL_DB: controlDb,
				IRC_DB: ircDb,
				TEST_ROOT: root,
				PROJECT_DIR: project,
				SESSIONS_DIR: path.join(root, "sessions"),
			});

			const child = Bun.spawn({
				cmd: [process.execPath, path.resolve(import.meta.dir, "../fixtures/subagent-lsp-process.ts")],
				cwd: path.resolve(import.meta.dir, "../.."),
				env,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (exitCode !== 0) throw new Error(`Fixture exited ${exitCode}: ${stderr || stdout}`);
			expect(stderr).toBe("");
			const receipt = JSON.parse(stdout) as ProcessReceipt;
			expect(receipt).toMatchObject({
				project,
				agentName: "subagent-lsp-process-proof-7f3b",
				advertised: true,
				projectAgentsDir: path.join(project, ".omp", "agents"),
				ircDb,
				configRoot,
				configPath: path.join(configRoot, "agent", "config.yml"),
				controlDb,
				configValue: false,
				controlSessionId: "subagent-lsp-process-control-7f3b",
				controlOwnerEpoch: "owner-7f3b",
				marker: "tracked-marker-7f3b",
				agentSource: "project",
				routeSelector: "subagent-lsp-process-provider/scripted-yield:low",
				liveChildrenAfterExecute: 0,
				worktreeExistsAfterExecute: false,
				isolationBackend: IsoBackendKind.Rcopy,
			});
			expect(receipt.toolNames).toEqual(expect.arrayContaining(["lsp", "ast_grep", "irc", "yield"]));
			expect(receipt.registryCwd).not.toBe(project);
			expect(receipt.persistedCwd).toBe(receipt.registryCwd);
			expect(receipt.sessionFile.startsWith(path.join(root, "sessions"))).toBe(true);
			expect(receipt.configRoot).not.toBe(fallbackConfigRoot);
			expect(receipt.controlDb).not.toBe(fallbackControlDb);
			const configContents = await fs.readFile(receipt.configPath, "utf8");
			expect(receipt.configDigest).toBe(digest(configContents));
			const control = new SessionControlBus(receipt.controlDb, { readonly: true });
			try {
				expect(control.getTargetOwnerEpoch(receipt.controlSessionId)).toBe(receipt.controlOwnerEpoch);
			} finally {
				control.close();
			}
			const controlStateDigest = digest(`${receipt.controlSessionId}\0${receipt.controlOwnerEpoch}`);
			expect(receipt.stateDigest).toBe(digest(`${receipt.configDigest}\0${controlStateDigest}`));
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	}, 70_000);
});
