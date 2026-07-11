/**
 * Contracts: history:// protocol handler (rework-contracts.md §6), resolved
 * through `InternalUrlRouter.instance().resolve(...)` like real callers.
 *
 * - Bare `history://` renders an index listing registered agent ids.
 * - `history://<id>` with a live ref renders the in-memory transcript.
 * - A parked ref (session null, sessionFile retained) renders read-only from
 *   the JSONL session file.
 * - An unknown id fails with an error listing the known ids.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { CHILD_LIFECYCLE_CUSTOM_TYPE, type ChildLifecycleState } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import { listArchivedDirectChildren } from "@oh-my-pi/pi-coding-agent/internal-urls/history-protocol";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "history-protocol-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function fakeLiveSession(messages: unknown[]): AgentSession {
	return { messages } as unknown as AgentSession;
}

/** Minimal current-version session JSONL: header + a linear user/assistant chain. */
function sessionFixtureJsonl(): string {
	const timestamp = new Date().toISOString();
	const header = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: "fixture-session",
		timestamp,
		cwd: "/tmp",
	};
	const userEntry = {
		type: "message",
		id: "m1",
		parentId: null,
		timestamp,
		message: { role: "user", content: "parked hello", timestamp: 1 },
	};
	const assistantEntry = {
		type: "message",
		id: "m2",
		parentId: "m1",
		timestamp,
		message: {
			role: "assistant",
			content: [{ type: "text", text: "parked reply" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test-model",
			usage: {},
			stopReason: "stop",
			timestamp: 2,
		},
	};
	return `${JSON.stringify(header)}\n${JSON.stringify(userEntry)}\n${JSON.stringify(assistantEntry)}\n`;
}

async function writeDirectChildJournal(options: {
	file: string;
	parentFile: string;
	agentId: string;
	timestamp: string;
	lifecycleState?: ChildLifecycleState;
	metadataParentFile?: string;
	lifecycleChildFile?: string;
}): Promise<void> {
	const lifecycle = options.lifecycleState
		? [
				{
					type: "custom",
					id: "lifecycle",
					parentId: null,
					timestamp: options.timestamp,
					customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
					data: {
						version: 1,
						agentId: options.agentId,
						childSessionFile: options.lifecycleChildFile ?? options.file,
						parentSessionFile: options.parentFile,
						state: options.lifecycleState,
						updatedAt: options.timestamp,
						modelId: "openai-codex/gpt-5.6-terra",
						thinkingLevel: "medium",
					},
				},
			]
		: [];
	await Bun.write(
		options.file,
		[
			{ type: "session", version: CURRENT_SESSION_VERSION, id: options.agentId, timestamp: options.timestamp, cwd: "/tmp" },
			{
				type: "session_init",
				id: "init",
				parentId: null,
				timestamp: options.timestamp,
				systemPrompt: "child",
				task: "task",
				tools: [],
				subagent: {
					agentId: options.agentId,
					parentSessionFile: options.metadataParentFile ?? options.parentFile,
					parentSessionId: "parent",
					displayName: options.agentId,
					model: "openai-codex/gpt-5.6-terra",
					taskDepth: 1,
					parentTaskPrefix: options.agentId,
					isolated: false,
				},
			},
			...lifecycle,
		]
			.map(entry => JSON.stringify(entry))
			.join("\n") + "\n",
	);
}

describe("history:// protocol", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		InternalUrlRouter.resetForTests();
	});

	afterEach(() => {
		InternalUrlRouter.resetForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("bare history:// renders an index listing registered agents", async () => {
		AgentRegistry.global().register({
			id: "HubAgent",
			displayName: "task",
			kind: "sub",
			session: fakeLiveSession([]),
			status: "idle",
		});

		const resource = await InternalUrlRouter.instance().resolve("history://");

		expect(resource.contentType).toBe("text/markdown");
		expect(resource.content).toContain("# Agents");
		expect(resource.content).toContain("| HubAgent | idle | sub |");
	});

	it("history://<id> renders a live ref's in-memory transcript", async () => {
		AgentRegistry.global().register({
			id: "HubAgent",
			displayName: "task",
			kind: "sub",
			session: fakeLiveSession([{ role: "user", content: "hello from live", timestamp: 1 }]),
			status: "idle",
		});

		const resource = await InternalUrlRouter.instance().resolve("history://HubAgent");

		expect(resource.content).toContain("# HubAgent (idle)");
		expect(resource.content).toContain("## user");
		expect(resource.content).toContain("hello from live");
		expect(resource.notes).toContain("Source: live session");
	});

	it("resolves agent ids case-insensitively", async () => {
		AgentRegistry.global().register({
			id: "HubAgent",
			displayName: "task",
			kind: "sub",
			session: fakeLiveSession([{ role: "user", content: "hello from live", timestamp: 1 }]),
			status: "idle",
		});

		const resource = await InternalUrlRouter.instance().resolve("history://hubagent");
		expect(resource.content).toContain("# HubAgent (idle)");
	});

	it("history://<id> renders a parked ref read-only from its session file", async () => {
		await withTempDir(async dir => {
			const sessionFile = path.join(dir, "parked.jsonl");
			await Bun.write(sessionFile, sessionFixtureJsonl());
			AgentRegistry.global().register({
				id: "Sleeper",
				displayName: "task",
				kind: "sub",
				session: null,
				sessionFile,
				status: "parked",
			});

			const resource = await InternalUrlRouter.instance().resolve("history://Sleeper");

			expect(resource.content).toContain("# Sleeper (parked)");
			expect(resource.content).toContain("parked hello");
			expect(resource.content).toContain("parked reply");
			expect(resource.sourcePath).toBe(sessionFile);
			expect(resource.notes?.join("\n")).toContain("read-only");
		});
	});

	it("separates active agents from archived child journals while retaining archive transcripts", async () => {
		await withTempDir(async dir => {
			const parentFile = path.join(dir, "parent.jsonl");
			const childrenDir = parentFile.slice(0, -".jsonl".length);
			await fs.mkdir(childrenDir);
			await Bun.write(parentFile, sessionFixtureJsonl());
			const timestamp = new Date().toISOString();
			const terminalFile = path.join(childrenDir, "Terminal.jsonl");
			await Bun.write(
				terminalFile,
				`${sessionFixtureJsonl()}${JSON.stringify({ type: "custom", id: "lifecycle", parentId: null, timestamp, customType: CHILD_LIFECYCLE_CUSTOM_TYPE, data: { version: 1, agentId: "Terminal", childSessionFile: terminalFile, parentSessionFile: parentFile, state: "completed", updatedAt: timestamp } })}\n`,
			);
			await Bun.write(path.join(childrenDir, "Legacy.jsonl"), sessionFixtureJsonl());
			AgentRegistry.global().register({ id: "Main", displayName: "main", kind: "main", session: null, sessionFile: parentFile, status: "parked" });
			AgentRegistry.global().register({ id: "ReviveMe", displayName: "task", kind: "sub", session: fakeLiveSession([]), status: "idle" });

			const index = await InternalUrlRouter.instance().resolve("history://");
			expect(index.content).toContain("## Active and revivable");
			expect(index.content).toContain("| ReviveMe | idle | sub |");
			expect(index.content).toContain("## Archived");
			expect(index.content).toContain("| Terminal | completed |");
			expect(index.content).toContain("| Legacy | legacy |");

			const transcript = await InternalUrlRouter.instance().resolve("history://Terminal");
			expect(transcript.content).toContain("# Terminal (archived)");
			expect(transcript.content).toContain("parked hello");
		});
	});

	it("lists only unique direct terminal and legacy child descriptors newest first", async () => {
		await withTempDir(async dir => {
			const parentFile = path.join(dir, "parent.jsonl");
			const childrenDir = parentFile.slice(0, -".jsonl".length);
			await fs.mkdir(childrenDir);
			await Bun.write(parentFile, sessionFixtureJsonl());
			const terminalFile = path.join(childrenDir, "Terminal.jsonl");
			await writeDirectChildJournal({
				file: terminalFile,
				parentFile,
				agentId: "Terminal",
				timestamp: "2026-07-10T12:00:00.000Z",
				lifecycleState: "completed",
			});
			await writeDirectChildJournal({
				file: path.join(childrenDir, "Legacy.jsonl"),
				parentFile,
				agentId: "Legacy",
				timestamp: "2026-07-10T11:00:00.000Z",
			});
			await writeDirectChildJournal({
				file: path.join(childrenDir, "Running.jsonl"),
				parentFile,
				agentId: "Running",
				timestamp: "2026-07-10T13:00:00.000Z",
				lifecycleState: "running",
			});
			await writeDirectChildJournal({
				file: path.join(childrenDir, "Foreign.jsonl"),
				parentFile,
				metadataParentFile: path.join(dir, "foreign.jsonl"),
				agentId: "Foreign",
				timestamp: "2026-07-10T14:00:00.000Z",
				lifecycleState: "failed",
			});
			await writeDirectChildJournal({
				file: path.join(childrenDir, "Duplicate-a.jsonl"),
				parentFile,
				agentId: "Duplicate",
				timestamp: "2026-07-10T15:00:00.000Z",
				lifecycleState: "failed",
			});
			await writeDirectChildJournal({
				file: path.join(childrenDir, "Duplicate-b.jsonl"),
				parentFile,
				agentId: "Duplicate",
				timestamp: "2026-07-10T16:00:00.000Z",
				lifecycleState: "interrupted",
			});

			const children = await listArchivedDirectChildren(parentFile);

			expect(children).toEqual([
				expect.objectContaining({
					agentId: "Terminal",
					childSessionFile: terminalFile,
					state: "completed",
					modelId: "openai-codex/gpt-5.6-terra",
					thinkingLevel: "medium",
				}),
				expect.objectContaining({ agentId: "Legacy", state: "legacy" }),
			]);
		});
	});

	it("rejects an unknown id with the list of known agents", async () => {
		AgentRegistry.global().register({
			id: "HubAgent",
			displayName: "task",
			kind: "sub",
			session: fakeLiveSession([]),
			status: "idle",
		});

		const error = await InternalUrlRouter.instance()
			.resolve("history://Nope")
			.then(
				() => null,
				err => err as Error,
			);

		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toContain("Unknown agent: Nope");
		expect(error?.message).toContain("HubAgent");
	});

	it("rejects a ref with neither session nor session file", async () => {
		AgentRegistry.global().register({
			id: "Husk",
			displayName: "task",
			kind: "sub",
			session: null,
			sessionFile: null,
			status: "aborted",
		});

		const error = await InternalUrlRouter.instance()
			.resolve("history://Husk")
			.then(
				() => null,
				err => err as Error,
			);

		expect(error?.message).toContain("no transcript");
	});
});
