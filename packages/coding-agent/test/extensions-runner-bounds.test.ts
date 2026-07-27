import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { MAX_EXEC_OUTPUT_BYTES } from "@oh-my-pi/pi-coding-agent/exec/exec";
import { discoverAndLoadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import {
	EXTENSION_HANDLER_TIMEOUT_MS,
	ExtensionRunner,
	testSetExtensionHandlerTimeoutMs,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import type { ExtensionActions, ExtensionContextActions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

type BoundsGlobals = typeof globalThis & {
	__hr130HandlerRuns?: number;
	__hr130ExecResult?: { stdout: string; stderr: string; killed: boolean; stdoutTruncated?: boolean };
	__hr130HandlerSignal?: AbortSignal;
	__hr130Gate?: Promise<void>;
	__hr130Entered?: () => void;
};

const globals = globalThis as BoundsGlobals;

// This integration assertion observes OS process-tree teardown; fake timers cannot
// advance kernel process state, so poll the real liveness boundary.
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = performance.now() + timeoutMs;
	while (performance.now() < deadline) {
		if (predicate()) return true;
		await Bun.sleep(10);
	}
	return predicate();
}

function processIsAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("ExtensionRunner resource bounds", () => {
	let sharedTempDir: TempDir;
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let sessionManager: SessionManager;

	beforeAll(async () => {
		sharedTempDir = TempDir.createSync("@pi-runner-bounds-shared-");
		authStorage = await AuthStorage.create(path.join(sharedTempDir.path(), "auth.db"));
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterAll(() => {
		authStorage.close();
		sharedTempDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-runner-bounds-");
		sessionManager = SessionManager.inMemory();
	});

	afterEach(() => {
		testSetExtensionHandlerTimeoutMs(EXTENSION_HANDLER_TIMEOUT_MS);
		delete globals.__hr130HandlerRuns;
		delete globals.__hr130ExecResult;
		delete globals.__hr130HandlerSignal;
		delete globals.__hr130Gate;
		delete globals.__hr130Entered;
		tempDir.removeSync();
	});

	async function createRunner(extensionPaths: string[]): Promise<ExtensionRunner> {
		const loaded = await discoverAndLoadExtensions(extensionPaths, tempDir.path());
		const accepted = new Set(extensionPaths.map(candidate => path.resolve(candidate)));
		const extensions = loaded.extensions.filter(extension => accepted.has(path.resolve(extension.path)));
		expect(loaded.errors.filter(error => accepted.has(path.resolve(error.path)))).toEqual([]);
		expect(extensions).toHaveLength(extensionPaths.length);
		return new ExtensionRunner(extensions, loaded.runtime, tempDir.path(), sessionManager, modelRegistry);
	}

	function initializeRunner(runner: ExtensionRunner, sentMessages: unknown[] = []): void {
		const actions: ExtensionActions = {
			sendMessage: message => sentMessages.push(message),
			sendUserMessage: content => sentMessages.push(content),
			appendEntry: () => {},
			setLabel: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: async () => {},
			getCommands: () => [],
			setModel: async () => false,
			getThinkingLevel: () => undefined,
			setThinkingLevel: () => {},
			getSessionName: () => undefined,
			setSessionName: async () => {},
		};
		const contextActions: ExtensionContextActions = {
			getModel: () => undefined,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			compact: async () => {},
			getSystemPrompt: () => [],
		};
		runner.initialize(actions, contextActions);
	}

	it("aborts timed-out handler exec process trees and emits a typed timeout record", async () => {
		const parentPidPath = path.join(tempDir.path(), "exec-parent.pid");
		const childPidPath = path.join(tempDir.path(), "exec-child.pid");
		const childScriptPath = path.join(tempDir.path(), "sleep-tree.ts");
		fs.writeFileSync(
			childScriptPath,
			`import * as fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(parentPidPath)}, String(process.pid));\nconst child = Bun.spawn(["/bin/sh", "-c", 'echo $$ > "$1"; exec sleep 30', "sh", ${JSON.stringify(childPidPath)}], { stdout: "ignore", stderr: "ignore" });\nawait child.exited;\n`,
		);
		const extensionPath = path.join(tempDir.path(), "timeout-extension.ts");
		fs.writeFileSync(
			extensionPath,
			`export default function(pi) {\n  pi.on("session_start", async (_event, ctx) => {\n    globalThis.__hr130HandlerSignal = ctx.signal;\n    globalThis.__hr130ExecResult = await pi.exec(${JSON.stringify(process.execPath)}, [${JSON.stringify(childScriptPath)}]);\n  });\n}\n`,
		);
		const runner = await createRunner([extensionPath]);
		testSetExtensionHandlerTimeoutMs(300);

		await runner.emit({ type: "session_start" });
		expect(await waitUntil(() => fs.existsSync(parentPidPath) && fs.existsSync(childPidPath), 1_000)).toBe(true);
		const parentPid = Number(fs.readFileSync(parentPidPath, "utf8"));
		const childPid = Number(fs.readFileSync(childPidPath, "utf8"));
		expect(globals.__hr130HandlerSignal?.aborted).toBe(true);
		expect(await waitUntil(() => !processIsAlive(parentPid) && !processIsAlive(childPid), 1_500)).toBe(true);

		const timeout = runner.getViolationRecords().find(record => record.kind === "timeout");
		expect(timeout).toMatchObject({
			kind: "timeout",
			extensionId: extensionPath,
			event: "session_start",
			action: "abort_handler_and_process_tree",
			timeoutMs: 300,
			elapsedMs: expect.any(Number),
			timestamp: expect.any(String),
		});
	});

	it("coalesces reentrant same-event emissions for one session", async () => {
		const extensionPath = path.join(tempDir.path(), "reentrant-extension.ts");
		fs.writeFileSync(
			extensionPath,
			`export default function(pi) {\n  pi.on("session_start", async () => {\n    globalThis.__hr130HandlerRuns = (globalThis.__hr130HandlerRuns ?? 0) + 1;\n    globalThis.__hr130Entered?.();\n    await globalThis.__hr130Gate;\n  });\n}\n`,
		);
		const runner = await createRunner([extensionPath]);
		const gate = Promise.withResolvers<void>();
		const entered = Promise.withResolvers<void>();
		globals.__hr130Gate = gate.promise;
		globals.__hr130Entered = entered.resolve;

		const first = runner.emit({ type: "session_start" });
		await entered.promise;
		const second = runner.emit({ type: "session_start" });
		gate.resolve();
		await Promise.all([first, second]);

		expect(globals.__hr130HandlerRuns).toBe(1);
		expect(runner.getViolationRecords()).toContainEqual(
			expect.objectContaining({
				kind: "reentrancy",
				extensionId: extensionPath,
				event: "session_start",
				action: "coalesce_with_in_flight",
			}),
		);
	});

	it("bounds exec output and records truncation with a marker", async () => {
		const outputScriptPath = path.join(tempDir.path(), "large-output.ts");
		fs.writeFileSync(outputScriptPath, `process.stdout.write("x".repeat(${MAX_EXEC_OUTPUT_BYTES + 4096}));\n`);
		const extensionPath = path.join(tempDir.path(), "output-extension.ts");
		fs.writeFileSync(
			extensionPath,
			`export default function(pi) {\n  pi.on("session_start", async () => {\n    globalThis.__hr130ExecResult = await pi.exec(${JSON.stringify(process.execPath)}, [${JSON.stringify(outputScriptPath)}]);\n  });\n}\n`,
		);
		const runner = await createRunner([extensionPath]);

		await runner.emit({ type: "session_start" });

		expect(globals.__hr130ExecResult?.stdoutTruncated).toBe(true);
		expect(globals.__hr130ExecResult?.stdout).toContain("[output truncated: 4096 bytes omitted]");
		expect(runner.getViolationRecords()).toContainEqual(
			expect.objectContaining({
				kind: "output_overflow",
				extensionId: extensionPath,
				event: "session_start",
				action: "truncate_output",
				stream: "stdout",
				limitBytes: MAX_EXEC_OUTPUT_BYTES,
			}),
		);
	});

	it("bounds extension messages queued during session_start", async () => {
		const extensionPath = path.join(tempDir.path(), "message-overflow-extension.ts");
		fs.writeFileSync(
			extensionPath,
			`export default function(pi) {\n  pi.on("session_start", () => {\n    for (let i = 0; i < 40; i++) pi.sendMessage({ customType: "bounded", content: String(i), display: true });\n  });\n}\n`,
		);
		const runner = await createRunner([extensionPath]);
		const sentMessages: unknown[] = [];
		initializeRunner(runner, sentMessages);

		await runner.emit({ type: "session_start" });

		expect(sentMessages).toHaveLength(32);
		expect(runner.getViolationRecords()).toContainEqual(
			expect.objectContaining({
				kind: "message_overflow",
				extensionId: extensionPath,
				event: "session_start",
				action: "drop_message",
				limit: 32,
			}),
		);
	});
});
