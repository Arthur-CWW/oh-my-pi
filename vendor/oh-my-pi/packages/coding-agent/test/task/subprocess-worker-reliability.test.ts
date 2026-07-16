import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { Settings, resetSettingsForTest, settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import {
	recoverSpawnWorkerResultFromJournal,
	runSyntheticSpawnWorkerWorkload,
} from "@oh-my-pi/pi-coding-agent/task/spawn-worker-client";
import type { SpawnWorkerRunRequest } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-protocol";
import { initializeSpawnWorkerSettings } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-entry";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { IrcTool } from "@oh-my-pi/pi-coding-agent/tools/irc";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";

let tmpDir = "";
let previousHome: string | undefined;
let previousControlDb: string | undefined;
let previousWorkerMarker: string | undefined;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-worker-reliability-"));
	previousHome = process.env.HOME;
	previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	previousWorkerMarker = process.env.OMP_SUBPROCESS_WORKER;
	process.env.HOME = tmpDir;
	process.env.OMP_SESSION_CONTROL_DB = path.join(tmpDir, "session-control.sqlite");
	delete process.env.OMP_SUBPROCESS_WORKER;
});

afterEach(async () => {
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	if (previousWorkerMarker === undefined) delete process.env.OMP_SUBPROCESS_WORKER;
	else process.env.OMP_SUBPROCESS_WORKER = previousWorkerMarker;
	resetSettingsForTest();
	AgentRegistry.resetGlobalForTests();
	await fs.rm(tmpDir, { recursive: true, force: true });
});

function requestFor(sessionFile: string): SpawnWorkerRunRequest {
	return {
		version: 1,
		type: "run",
		requestId: "request-1",
		options: {
			cwd: tmpDir,
			id: "child-1",
			task: "report result",
			agent: { name: "task", description: "test", systemPrompt: "test", source: "bundled" },
			index: 0,
			sessionFile,
			outputSchema: undefined,
		},
		settings: {},
		registry: [],
	};
}

describe("subprocess worker reliability", () => {
	it("recovers a durable yield when the final pipe record is absent", async () => {
		const sessionFile = path.join(tmpDir, "child-1.jsonl");
		const timestamp = new Date().toISOString();
		await Bun.write(
			sessionFile,
			[
				JSON.stringify({ type: "session", version: 4, id: "session-1", timestamp, cwd: tmpDir }),
				JSON.stringify({
					type: "message",
					id: "yield-message",
					parentId: null,
					timestamp,
					message: {
						role: "toolResult",
						toolCallId: "yield-call",
						toolName: "yield",
						content: [{ type: "text", text: "Result submitted." }],
						details: { status: "success", data: { ok: true } },
					},
				}),
			].join("\n") + "\n",
		);

		const result = await recoverSpawnWorkerResultFromJournal(requestFor(sessionFile));
		expect(result?.exitCode).toBe(0);
		expect(result?.output).toContain('"ok": true');
		expect(result?.extractedToolData?.yield).toHaveLength(1);
	});

	it("initializes settings in the worker bootstrap for the edit guard seam", async () => {
		await initializeSpawnWorkerSettings({
			...requestFor(path.join(tmpDir, "child-1.jsonl")),
			settings: { "edit.mode": "hashline" },
		});
		expect(settings.get("edit.mode")).toBe("hashline");
	});

	it("exits the real worker subprocess promptly after its terminal record", async () => {
		const result = await runSyntheticSpawnWorkerWorkload({ spinMs: 0, allocateBytes: 1024 });
		expect(result.allocatedBytes).toBe(1024);
	});

	it("returns a typed local-peer refusal instead of external IRC loopback", async () => {
		const registry = AgentRegistry.global();
		registry.register({ id: "Main", displayName: "main", kind: "main", status: "running", session: null });
		process.env.OMP_SUBPROCESS_WORKER = "1";
		const toolSession: ToolSession = {
			cwd: tmpDir,
			hasUI: false,
			settings: Settings.isolated(),
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			agentRegistry: registry,
			getAgentId: () => "child-1",
		};
		const result = await new IrcTool(toolSession, new IrcExternalBus(path.join(tmpDir, "irc.sqlite"))).execute("irc", {
			op: "send",
			to: "Main",
			message: "hello",
		});
		expect(result.isError).toBe(true);
		expect(result.content[0]?.type === "text" ? result.content[0].text : "").toContain("coordinator IPC");
		expect(result.details?.receipts?.[0]).toMatchObject({
			to: "Main",
			outcome: "failed",
			error: "subprocess-worker-peer-unavailable",
		});
	});
});
