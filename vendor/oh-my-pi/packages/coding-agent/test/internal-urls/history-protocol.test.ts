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
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { listArchivedDirectChildren } from "@oh-my-pi/pi-coding-agent/internal-urls/history-protocol";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { CHILD_LIFECYCLE_CUSTOM_TYPE, type ChildLifecycleState } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ReadTool } from "@oh-my-pi/pi-coding-agent/tools/read";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "history-protocol-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

let testHome = "";
let fleetDbPath = "";
let previousHome: string | undefined;
let previousControlDb: string | undefined;

function fleetContext(): { ircDbPath: string } {
	return { ircDbPath: fleetDbPath };
}

function registerFleetPeer(sessionId: string, sessionFile: string): void {
	const bus = new IrcExternalBus(fleetDbPath);
	bus.registerPeer({ sessionId, name: sessionId, cwd: "/tmp/history-protocol", pid: process.pid, sessionFile });
	bus.close();
}

async function sha256(file: string): Promise<string> {
	return new Bun.SHA256().update(await fs.readFile(file)).digest("hex");
}

function fakeLiveSession(messages: unknown[]): AgentSession {
	return { messages } as unknown as AgentSession;
}

function createReadTool(cwd: string): ReadTool {
	const session: ToolSession = {
		cwd,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		ircDbPath: fleetDbPath,
		settings: Settings.isolated(),
	};
	return new ReadTool(session);
}

/** Minimal current-version session JSONL: header + a linear user/assistant chain. */
function sessionFixtureJsonl(withLifecycle = false): string {
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
		parentId: withLifecycle ? "lifecycle-1" : null,
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
	const lifecycleEntry = {
		type: "custom",
		customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
		data: {
			version: 1,
			agentId: "Sleeper",
			childSessionFile: "/tmp/parked.jsonl",
			parentSessionFile: "/tmp/parent.jsonl",
			state: "running",
			updatedAt: timestamp,
		},
		id: "lifecycle-1",
		parentId: null,
		timestamp,
	};
	return `${JSON.stringify(header)}\n${withLifecycle ? `${JSON.stringify(lifecycleEntry)}\n` : ""}${JSON.stringify(userEntry)}\n${JSON.stringify(assistantEntry)}\n`;
}

/**
 * Deterministic session JSONL exceeding 4MB: a linear user/assistant chain
 * padded with filler, with `markers.distinctive` in exactly one user turn and
 * `markers.duplicate` in two distinct user turns for stable-id disambiguation.
 */
function bigSessionFixtureJsonl(markers: { distinctive: string; duplicate: string }): string {
	const timestamp = new Date().toISOString();
	const header = { type: "session", version: CURRENT_SESSION_VERSION, id: "big-session", timestamp, cwd: "/tmp" };
	const filler = "lorem-ipsum-dolor-sit-amet-consectetur-adipiscing ".repeat(1000);
	const lines = [JSON.stringify(header)];
	const pairs = 100;
	const distinctivePair = 50;
	const duplicatePairA = 20;
	const duplicatePairB = 80;
	let seq = 0;
	let parentId: string | null = null;
	for (let pair = 0; pair < pairs; pair++) {
		let userText = `filler pair ${pair} ${filler}`;
		if (pair === distinctivePair) userText = `${filler} ${markers.distinctive} ${filler}`;
		else if (pair === duplicatePairA || pair === duplicatePairB)
			userText = `${filler} ${markers.duplicate} shared ${filler}`;
		const userId = `u${seq++}`;
		lines.push(
			JSON.stringify({
				type: "message",
				id: userId,
				parentId,
				timestamp,
				message: { role: "user", content: userText, timestamp: seq },
			}),
		);
		parentId = userId;
		const assistantId = `a${seq++}`;
		lines.push(
			JSON.stringify({
				type: "message",
				id: assistantId,
				parentId,
				timestamp,
				message: {
					role: "assistant",
					content: [{ type: "text", text: `reply ${pair}` }],
					api: "anthropic-messages",
					provider: "anthropic",
					model: "test-model",
					usage: {},
					stopReason: "stop",
					timestamp: seq,
				},
			}),
		);
		parentId = assistantId;
	}
	return `${lines.join("\n")}\n`;
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
		`${[
			{
				type: "session",
				version: CURRENT_SESSION_VERSION,
				id: options.agentId,
				timestamp: options.timestamp,
				cwd: "/tmp",
			},
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
			.join("\n")}\n`,
	);
}

describe("history:// protocol", () => {
	beforeEach(async () => {
		AgentRegistry.resetGlobalForTests();
		InternalUrlRouter.resetForTests();
		previousHome = process.env.HOME;
		previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		testHome = await fs.mkdtemp(path.join(os.tmpdir(), "history-protocol-home-"));
		fleetDbPath = path.join(testHome, ".omp", "agent", "irc-bus.sqlite");
		process.env.HOME = testHome;
		process.env.OMP_SESSION_CONTROL_DB = path.join(testHome, "session-control.sqlite");
	});

	afterEach(async () => {
		InternalUrlRouter.resetForTests();
		AgentRegistry.resetGlobalForTests();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
		await fs.rm(testHome, { recursive: true, force: true });
		testHome = "";
		fleetDbPath = "";
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
			await Bun.write(sessionFile, sessionFixtureJsonl(true));
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
			AgentRegistry.global().register({
				id: "Main",
				displayName: "main",
				kind: "main",
				session: null,
				sessionFile: parentFile,
				status: "parked",
			});
			AgentRegistry.global().register({
				id: "ReviveMe",
				displayName: "task",
				kind: "sub",
				session: fakeLiveSession([]),
				status: "idle",
			});

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
			.resolve("history://Nope", fleetContext())
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

	it("resolves a reserved starting agent as starting rather than unknown", async () => {
		AgentRegistry.global().register({
			id: "Queued",
			displayName: "task",
			kind: "sub",
			parentId: "Main",
			session: null,
			sessionFile: null,
			status: "running",
			starting: true,
		});

		const resource = await InternalUrlRouter.instance().resolve("history://Queued");

		expect(resource.content).toContain("# Queued (starting)");
		expect(resource.content).toContain("queued and starting up");
		expect(resource.notes?.join("\n")).toContain("starting");

		// A genuinely unknown id still fails as unknown.
		const error = await InternalUrlRouter.instance()
			.resolve("history://NeverReserved")
			.then(
				() => null,
				err => err as Error,
			);
		expect(error?.message).toContain("Unknown agent: NeverReserved");
	});
	it("prefers a local one-segment ref over an identically named fleet session", async () => {
		await withTempDir(async dir => {
			const remoteFile = path.join(dir, "remote.jsonl");
			await Bun.write(remoteFile, sessionFixtureJsonl());
			registerFleetPeer("Shared", remoteFile);
			AgentRegistry.global().register({
				id: "Shared",
				displayName: "local",
				kind: "sub",
				session: fakeLiveSession([{ role: "user", content: "local transcript", timestamp: 1 }]),
				status: "idle",
			});

			const resource = await InternalUrlRouter.instance().resolve("history://Shared", fleetContext());

			expect(resource.content).toContain("local transcript");
			expect(resource.content).not.toContain("parked hello");
		});
	});

	it("falls back to a fleet session for an unmatched one-segment id", async () => {
		await withTempDir(async dir => {
			const remoteFile = path.join(dir, "remote.jsonl");
			await Bun.write(remoteFile, sessionFixtureJsonl());
			registerFleetPeer("remote-session", remoteFile);
			const beforeJournal = await sha256(remoteFile);
			const beforeDatabase = await sha256(fleetDbPath);

			const resource = await InternalUrlRouter.instance().resolve("history://remote-session", fleetContext());

			expect(resource.content).toContain("# remote-session (remote)");
			expect(resource.content).toContain("parked hello");
			expect(resource.sourcePath).toBe(remoteFile);
			expect(resource.immutable).toBe(true);
			expect(await sha256(remoteFile)).toBe(beforeJournal);
			expect(await sha256(fleetDbPath)).toBe(beforeDatabase);
		});
	});

	it("resolves remote Main and child journals through a two-segment URL", async () => {
		await withTempDir(async dir => {
			const parentFile = path.join(dir, "parent.jsonl");
			const childrenDir = parentFile.slice(0, -".jsonl".length);
			const childFile = path.join(childrenDir, "Child.jsonl");
			await fs.mkdir(childrenDir);
			await Bun.write(parentFile, sessionFixtureJsonl());
			await Bun.write(childFile, sessionFixtureJsonl());
			registerFleetPeer("remote-parent", parentFile);

			const main = await InternalUrlRouter.instance().resolve("history://remote-parent/Main", fleetContext());
			const child = await InternalUrlRouter.instance().resolve("history://remote-parent/Child", fleetContext());

			expect(main.sourcePath).toBe(parentFile);
			expect(main.content).toContain("# remote-parent (remote)");
			expect(child.sourcePath).toBe(childFile);
			expect(child.content).toContain("# Child (remote)");
			expect(child.content).toContain("parked hello");
		});
	});

	it("reads local, global, child, colon-bearing, selected, raw, and queried histories end to end", async () => {
		await withTempDir(async dir => {
			const localFile = path.join(dir, "local.jsonl");
			await Bun.write(localFile, sessionFixtureJsonl());
			for (const id of ["LocalAgent", "Team:Worker"]) {
				AgentRegistry.global().register({
					id,
					displayName: "task",
					kind: "sub",
					session: null,
					sessionFile: localFile,
					status: "parked",
				});
			}

			const sessionId = "019f9bf1-6914-72c7-98ce-d41bc464cdc2";
			const parentFile = path.join(dir, "global.jsonl");
			const childrenDir = parentFile.slice(0, -".jsonl".length);
			const childFile = path.join(childrenDir, "Worker.jsonl");
			await fs.mkdir(childrenDir);
			await Bun.write(parentFile, sessionFixtureJsonl());
			await Bun.write(childFile, sessionFixtureJsonl());
			registerFleetPeer(sessionId, parentFile);

			const tool = createReadTool(dir);
			let call = 0;
			const readText = async (target: string): Promise<string> => {
				const result = await tool.execute(`history-read-${++call}`, { path: target });
				return result.content.flatMap(block => (block.type === "text" ? [block.text] : [])).join("\n");
			};

			expect(await readText("history://LocalAgent")).toContain("# LocalAgent (parked)");
			expect(await readText(`history://${sessionId}`)).toContain(`# ${sessionId} (remote)`);
			expect(await readText(`history://${sessionId}/Worker`)).toContain("# Worker (remote)");
			expect(await readText("history://Team:Worker")).toContain("# Team:Worker (parked)");

			const oneLine = await readText("history://LocalAgent:1");
			const lineRange = await readText("history://LocalAgent:3-4");
			expect(oneLine).toContain("# LocalAgent (parked)");
			expect(lineRange).toContain("parked hello");

			const raw = await readText("history://LocalAgent:raw");
			const direct = await InternalUrlRouter.instance().resolve("history://LocalAgent");
			expect(raw).toBe(direct.content);

			const queryTarget = "history://LocalAgent:raw?op=search&q=parked%20hello";
			const query = await readText(queryTarget);
			expect(query).toContain("1 match");
			expect(query).toContain("parked hello");

			await expect(readText("history://DefinitelyMissing")).rejects.toThrow("Unknown agent: DefinitelyMissing");
		});
	});

	it("rejects malformed, dot, extra, and encoded-slash child segments", async () => {
		for (const input of [
			"history://remote-parent/",
			"history://remote-parent/.",
			"history://remote-parent/..",
			"history://remote-parent/Child/extra",
			"history://remote-parent/%2FChild",
			"history://remote-parent/%ZZ",
		]) {
			const error = await InternalUrlRouter.instance()
				.resolve(input, fleetContext())
				.then(
					() => null,
					err => err as Error,
				);
			expect(error?.message).toContain("Malformed history URL");
		}
	});

	it("reports missing peers, empty session files, and missing journals distinctly", async () => {
		const fleetDb = new IrcExternalBus(fleetDbPath);
		fleetDb.close();
		const missing = await InternalUrlRouter.instance()
			.resolve("history://missing-session/Main", fleetContext())
			.then(
				() => null,
				err => err as Error,
			);
		const emptyFileId = "empty-session";
		registerFleetPeer(emptyFileId, "");
		const empty = await InternalUrlRouter.instance()
			.resolve(`history://${emptyFileId}/Main`, fleetContext())
			.then(
				() => null,
				err => err as Error,
			);
		const missingJournalId = "missing-journal";
		const missingJournal = path.join(testHome, "does-not-exist.jsonl");
		registerFleetPeer(missingJournalId, missingJournal);
		const nonexistent = await InternalUrlRouter.instance()
			.resolve(`history://${missingJournalId}/Main`, fleetContext())
			.then(
				() => null,
				err => err as Error,
			);

		expect(missing?.message).toContain("Unknown session: missing-session");
		expect(empty?.message).toContain(`Session ${emptyFileId} has no session_file`);
		expect(nonexistent?.message).toContain(`Session ${missingJournalId} journal does not exist`);
		expect(new Set([missing?.message, empty?.message, nonexistent?.message]).size).toBe(3);
	});

	it("continues offering local history references in completions", async () => {
		AgentRegistry.global().register({
			id: "CompletionAgent",
			displayName: "task",
			kind: "sub",
			session: fakeLiveSession([]),
			status: "idle",
		});

		const completions = await InternalUrlRouter.instance().complete("history", "");

		expect(completions?.some(completion => completion.value === "CompletionAgent")).toBe(true);
	});

	it("op=search finds a distinctive phrase in a >4MB journal without returning the whole transcript", async () => {
		await withTempDir(async dir => {
			const sessionFile = path.join(dir, "big.jsonl");
			const distinctive = "xyzzy-needle-42-unique-marker";
			const jsonl = bigSessionFixtureJsonl({ distinctive, duplicate: "plugh-recurring-marker" });
			expect(Buffer.byteLength(jsonl, "utf-8")).toBeGreaterThan(4 * 1024 * 1024);
			await Bun.write(sessionFile, jsonl);
			AgentRegistry.global().register({
				id: "Big",
				displayName: "task",
				kind: "sub",
				session: null,
				sessionFile,
				status: "parked",
			});

			const resource = await InternalUrlRouter.instance().resolve(
				`history://Big?op=search&q=${encodeURIComponent(distinctive)}`,
			);

			expect(resource.contentType).toBe("text/markdown");
			expect(resource.content).toContain(distinctive);
			expect(resource.content).toContain("1 match");
			// Bounded projection: the multi-MB transcript is never echoed back.
			expect(resource.content.length).toBeLessThan(2000);
		});
	}, 20000);

	it("op=search disambiguates duplicate matches by stable record id", async () => {
		await withTempDir(async dir => {
			const sessionFile = path.join(dir, "dup.jsonl");
			const duplicate = "plugh-recurring-marker";
			await Bun.write(sessionFile, bigSessionFixtureJsonl({ distinctive: "unused-distinctive-marker", duplicate }));
			AgentRegistry.global().register({
				id: "Dup",
				displayName: "task",
				kind: "sub",
				session: null,
				sessionFile,
				status: "parked",
			});

			const resource = await InternalUrlRouter.instance().resolve(
				`history://Dup?op=search&q=${encodeURIComponent(duplicate)}`,
			);

			expect(resource.content).toContain("2 matches");
			const ids = [...resource.content.matchAll(/## #(\d+) ·/g)].map(match => match[1]);
			expect(ids.length).toBe(2);
			expect(new Set(ids).size).toBe(2);
		});
	}, 20000);

	it("op=record reads the exact decoded record a search hit points to", async () => {
		await withTempDir(async dir => {
			const sessionFile = path.join(dir, "record.jsonl");
			const distinctive = "xyzzy-needle-42-unique-marker";
			await Bun.write(sessionFile, bigSessionFixtureJsonl({ distinctive, duplicate: "plugh-recurring-marker" }));
			AgentRegistry.global().register({
				id: "Rec",
				displayName: "task",
				kind: "sub",
				session: null,
				sessionFile,
				status: "parked",
			});

			const search = await InternalUrlRouter.instance().resolve(
				`history://Rec?op=search&q=${encodeURIComponent(distinctive)}`,
			);
			const idMatch = search.content.match(/## #(\d+) ·/);
			expect(idMatch).not.toBeNull();
			const id = idMatch![1];

			const record = await InternalUrlRouter.instance().resolve(`history://Rec?op=record&id=${id}`);
			expect(record.content).toContain("# Records · Rec (parked)");
			expect(record.content).toContain(`## #${id} · user (user)`);
			expect(record.content).toContain(distinctive);
			expect(record.sourcePath).toBe(sessionFile);
		});
	}, 20000);

	it("op=search over a live ref reports an explicit miss and leaves bare rendering intact", async () => {
		AgentRegistry.global().register({
			id: "Live",
			displayName: "task",
			kind: "sub",
			session: fakeLiveSession([
				{ role: "user", content: "find the salient beacon token here", timestamp: 1 },
				{ role: "user", content: "unrelated chatter", timestamp: 2 },
			]),
			status: "idle",
		});

		const hit = await InternalUrlRouter.instance().resolve("history://Live?op=search&q=salient%20beacon");
		expect(hit.content).toContain("1 match");
		expect(hit.content).toContain("salient beacon");
		expect(hit.content).toContain("· user (user)");

		const miss = await InternalUrlRouter.instance().resolve("history://Live?op=search&q=absent-phrase-zzz");
		expect(miss.content).toContain("No matches for");
		expect(miss.content).toContain("absent-phrase-zzz");

		const bare = await InternalUrlRouter.instance().resolve("history://Live");
		expect(bare.content).toContain("# Live (idle)");
		expect(bare.content).toContain("find the salient beacon token here");
		expect(bare.content).not.toContain("No matches");
	});

	it("op=search runs over a fleet session and still enforces scope", async () => {
		await withTempDir(async dir => {
			const remoteFile = path.join(dir, "remote.jsonl");
			await Bun.write(remoteFile, sessionFixtureJsonl());
			registerFleetPeer("remote-search", remoteFile);

			const resource = await InternalUrlRouter.instance().resolve(
				"history://remote-search?op=search&q=parked%20hello",
				fleetContext(),
			);
			expect(resource.content).toContain("parked hello");
			expect(resource.content).toContain("1 match");
			expect(resource.sourcePath).toBe(remoteFile);

			const unknown = await InternalUrlRouter.instance()
				.resolve("history://ghost-session?op=search&q=x", fleetContext())
				.then(
					() => null,
					error => error as Error,
				);
			expect(unknown?.message).toContain("Unknown agent: ghost-session");
		});
	});

	it("rejects malformed query ops and targetless queries", async () => {
		AgentRegistry.global().register({
			id: "Q",
			displayName: "task",
			kind: "sub",
			session: fakeLiveSession([{ role: "user", content: "hi", timestamp: 1 }]),
			status: "idle",
		});

		const cases: Array<[string, string]> = [
			["history://Q?op=search", "requires a non-empty 'q'"],
			["history://Q?op=bogus", "Unsupported history:// op: bogus"],
			["history://Q?op=record", "requires 'id="],
			["history://Q?op=record&id=-1", "non-negative"],
			["history://?op=search&q=hi", "query ops require a target"],
		];
		for (const [input, fragment] of cases) {
			const error = await InternalUrlRouter.instance()
				.resolve(input)
				.then(
					() => null,
					err => err as Error,
				);
			expect(error).toBeInstanceOf(Error);
			expect(error?.message).toContain(fragment);
		}
	});
});
