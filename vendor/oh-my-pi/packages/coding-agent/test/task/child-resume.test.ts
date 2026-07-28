import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import {
	DEFAULT_ATTEMPT_RESERVATION_BYTES,
	HostResourceAdmission,
} from "@oh-my-pi/pi-coding-agent/resource/host-resource-admission";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import {
	CHILD_LIFECYCLE_CUSTOM_TYPE,
	classifyChildResumeEvidence,
	type ChildFailureClass,
	type ChildLifecycleRecord,
} from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";
import {
	listDurableChildJobs,
	type ReAdoptedChild,
	resumeInterruptedChild,
} from "@oh-my-pi/pi-coding-agent/task/re-adopt";
import { enforceWorkerRssSample } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-client";
import {
	isResumableSubagentFailureClass,
	isTransientHostResourceFailure,
	type SubagentFailureClass,
} from "@oh-my-pi/pi-coding-agent/task/subagent-failure";

const roots: string[] = [];
const buildRevision = { digest: "0".repeat(64), version: "child-resume-test" };
const runnerInstanceIdentity = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000099",
	startedAt: "2026-01-01T00:00:00.000Z",
};

function ownership(parent: string) {
	return {
		sessionFile: parent,
		sessionId: "parent",
		ownerEpoch: "owner-epoch",
		ownerKind: "omp" as const,
		buildRevision,
		runnerInstanceIdentity,
		isCurrent: async () => true,
		release: async () => {},
	};
}

async function fixture(id: string, failureClass: ChildFailureClass = "wall_timeout") {
	const base = path.join(process.cwd(), "test/.tmp");
	await fs.mkdir(base, { recursive: true });
	const root = await fs.mkdtemp(path.join(base, "child-resume-"));
	roots.push(root);
	const parent = path.join(root, "parent.jsonl");
	const children = parent.slice(0, -".jsonl".length);
	await fs.mkdir(children);
	const timestamp = "2026-07-26T00:00:00.000Z";
	await fs.writeFile(
		parent,
		`${JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id: "parent", timestamp, cwd: root })}\n`,
	);
	const child = path.join(children, `${id}.jsonl`);
	const lifecycle: ChildLifecycleRecord = {
		version: 1,
		agentId: id,
		childSessionFile: child,
		parentSessionFile: parent,
		state: "failed",
		updatedAt: timestamp,
		failureClass,
		resumeDisposition: failureClass === "fatal" ? "unrecoverable" : "resumable",
	};
	await fs.writeFile(
		child,
		[
			JSON.stringify({ type: "session", version: CURRENT_SESSION_VERSION, id, timestamp, cwd: root }),
			JSON.stringify({
				type: "session_init",
				id: "init",
				parentId: null,
				timestamp,
				systemPrompt: "preserved system prompt",
				task: "preserved rendered assignment",
				tools: ["yield"],
				subagent: {
					agentId: id,
					parentSessionFile: parent,
					parentSessionId: "parent",
					displayName: `${id} display`,
					model: "provider/model",
					taskDepth: 1,
					parentTaskPrefix: id,
					isolation: false,
					isolated: false,
					spawnRecord: {
						version: 1,
						agentId: id,
						spawnerId: "Main",
						agentType: "implementer",
						definitionSourcePath: "embedded:implementer.md",
						assignment: "original assignment",
						context: "original context",
						prompt: "original context\n\noriginal assignment",
					},
				},
			}),
			JSON.stringify({
				type: "custom",
				id: "lifecycle",
				parentId: "init",
				timestamp,
				customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
				data: lifecycle,
			}),
		].join("\n") + "\n",
	);
	return { root, parent, child };
}

function parentJournal(parent: string) {
	return {
		getEntries: () => [],
		getSessionOwnership: () => ownership(parent),
	};
}

describe("durable child resume classification", () => {
	it("distinguishes every named failure disposition", () => {
		const base: ChildLifecycleRecord = {
			version: 1,
			agentId: "Child",
			childSessionFile: "/tmp/Child.jsonl",
			parentSessionFile: "/tmp/parent.jsonl",
			state: "failed",
			updatedAt: "2026-07-26T00:00:00.000Z",
		};
		for (const [parentFailureClass, outcome] of [
			["timeout", "wall_timeout"],
			["subprocess-abort", "subprocess_abort"],
			["host-resource", "transient_host_resource"],
			["lost-transcript", "lost_transcript"],
		] as const) {
			expect(
				classifyChildResumeEvidence({
					journal: "usable",
					lifecycle: base,
					liveOwner: false,
					isolated: false,
					parentFailureClass,
				}),
			).toEqual(expect.objectContaining({ outcome, disposition: "resumable" }));
		}
		expect(
			classifyChildResumeEvidence({
				journal: "usable",
				lifecycle: { ...base, failureClass: "fatal", resumeDisposition: "unrecoverable" },
				liveOwner: false,
				isolated: false,
			}),
		).toEqual(expect.objectContaining({ outcome: "fatal", disposition: "unrecoverable" }));
	});

	it("maps every task failure class to its durable disposition", () => {
		const resumable = new Set<SubagentFailureClass>([
			"timeout",
			"host-resource",
			"subprocess-abort",
			"lost-transcript",
		]);
		const classes: SubagentFailureClass[] = [
			"failed",
			"timeout",
			"budget",
			"network",
			"provider",
			"schema",
			"no-yield",
			"host-resource",
			"subprocess-abort",
			"lost-transcript",
		];
		for (const failureClass of classes) {
			expect(isResumableSubagentFailureClass(failureClass)).toBe(resumable.has(failureClass));
		}
		expect(isTransientHostResourceFailure("SQLITE_BUSY: database is locked")).toBe(true);
		expect(isTransientHostResourceFailure("provider rejected the request")).toBe(false);
	});
});

describe("resumeInterruptedChild", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
		HostResourceAdmission.resetGlobalForTests();
	});

	afterEach(async () => {
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		HostResourceAdmission.resetGlobalForTests();
		await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
	});

	it("resumes a worker after its hard memory watermark interrupts the turn", async () => {
		const { root, parent, child } = await fixture("Interrupted");
		HostResourceAdmission.global({
			dbPath: path.join(root, "host-resource.sqlite"),
			memoryBudgetBytes: DEFAULT_ATTEMPT_RESERVATION_BYTES * 2,
			queuePollMs: 5,
		});
		const watermarkEvents: string[] = [];
		enforceWorkerRssSample(
			{ text: "4242 1\n", keptBytes: 7, totalBytes: 7, truncated: false },
			new Map([
				[
					4242,
					{
						softBytes: 512,
						hardBytes: 1024,
						onSoftWatermark: () => watermarkEvents.push("soft"),
						onHardWatermark: () => watermarkEvents.push("hard"),
						onSampleInvalid: () => watermarkEvents.push("invalid"),
					},
				],
			]),
		);
		expect(watermarkEvents).toEqual(["hard"]);
		const before = await fs.readFile(child, "utf8");
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const turn = Promise.withResolvers<string>();
		let starts = 0;
		let reopened: SessionManager | undefined;
		const options = {
			agentId: "Interrupted",
			parentSessionFile: parent,
			parentSessionId: "parent",
			parentJournal: parentJournal(parent) as never,
			manager,
			idleTtlMs: 0,
			createReviver: async (resumedChild: ReAdoptedChild) => {
				expect(resumedChild).toEqual(expect.objectContaining({
					id: "Interrupted",
					sessionFile: child,
					task: "preserved rendered assignment",
				}));
				return async () => {
					reopened = await SessionManager.open(child);
					expect(reopened.getCwd()).toBe(root);
					return {
						sessionManager: reopened,
						model: undefined,
						thinkingLevel: undefined,
						subscribe: () => () => {},
					} as never;
				};
			},
			startTurn: () => {
				starts++;
				return manager.register(
					"task",
					"Interrupted",
					async ({ markRunning }) => {
						markRunning();
						return turn.promise;
					},
					{ id: "Interrupted", replaceTerminal: true },
				);
			},
		};
		const first = resumeInterruptedChild(options);
		const second = resumeInterruptedChild(options);
		const [left, right] = await Promise.all([first, second]);
		expect(left).toEqual(expect.objectContaining({
			status: "started",
			agentId: "Interrupted",
			jobId: "Interrupted",
			transcriptUri: "history://Interrupted",
			assignment: "original assignment",
		}));
		expect(right).toEqual(left);
		expect(await resumeInterruptedChild(options)).toEqual({
			status: "already_running",
			agentId: "Interrupted",
			jobId: "Interrupted",
			transcriptUri: "history://Interrupted",
		});
		expect(starts).toBe(1);
		const after = await fs.readFile(child, "utf8");
		expect(after.startsWith(before)).toBe(true);
		expect(after).not.toBe(before);
		const appended = after
			.slice(before.length)
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as { customType?: string; data?: { agentId?: string; state?: string } });
		expect(appended).toContainEqual(expect.objectContaining({
			customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
			data: expect.objectContaining({ agentId: "Interrupted", state: "running" }),
		}));
		turn.resolve("done");
		await reopened?.flush();
	});

	it("refuses when a live owner already holds the journal", async () => {
		const { parent, child } = await fixture("LiveOwner");
		const registry = AgentRegistry.global();
		registry.register({
			id: "LiveOwner",
			displayName: "Live owner",
			kind: "sub",
			parentId: "Main",
			session: { isStreaming: true } as never,
			sessionFile: child,
			status: "running",
		});
		const result = await resumeInterruptedChild({
			agentId: "LiveOwner",
			parentSessionFile: parent,
			parentSessionId: "parent",
			parentJournal: parentJournal(parent) as never,
			manager: new AsyncJobManager({ onJobComplete: () => {} }),
			idleTtlMs: 0,
			registry,
			createReviver: async () => async () => ({}) as never,
			startTurn: () => "LiveOwner",
		});
		expect(result).toEqual(expect.objectContaining({
			status: "refused",
			reason: "a live owner still holds this child",
		}));
	});

	it("refuses a malformed lifecycle journal without invoking the reviver or changing bytes", async () => {
		const { parent, child } = await fixture("Corrupt");
		await fs.appendFile(
			child,
			`${JSON.stringify({
				type: "custom",
				id: "corrupt-lifecycle",
				parentId: "lifecycle",
				timestamp: "2026-07-26T00:01:00.000Z",
				customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
				data: { version: 99 },
			})}\n`,
		);
		const before = await fs.readFile(child, "utf8");
		let revived = false;
		const result = await resumeInterruptedChild({
			agentId: "Corrupt",
			parentSessionFile: parent,
			parentSessionId: "parent",
			parentJournal: parentJournal(parent) as never,
			manager: new AsyncJobManager({ onJobComplete: () => {} }),
			idleTtlMs: 0,
			createReviver: async () => {
				revived = true;
				return async () => ({}) as never;
			},
			startTurn: () => "Corrupt",
		});
		expect(result).toEqual(expect.objectContaining({
			status: "refused",
			reason: "the child journal is malformed or unreadable",
			classification: expect.objectContaining({
				outcome: "unusable_journal",
				disposition: "unrecoverable",
			}),
		}));
		expect(revived).toBe(false);
		expect(await fs.readFile(child, "utf8")).toBe(before);
	});

	it("projects a lost-transcript failure receipt into the durable job listing", async () => {
		const { parent } = await fixture("Other");
		const timestamp = Date.now();
		const records = await listDurableChildJobs({
			parentSessionFile: parent,
			parentSessionId: "parent",
			parentEntries: [{
				type: "custom",
				id: "failure",
				parentId: null,
				timestamp: new Date(timestamp).toISOString(),
				customType: "ui_error",
				data: {
					version: 2,
					source: "task",
					agent: "LostTranscript",
					job: "LostTranscript",
					errorClass: "lost-transcript",
					disposition: "resumable",
					message: "worker died before terminal journal write",
					historyUri: "history://LostTranscript",
					finalOutputAvailable: false,
					lastTimestamp: timestamp,
				},
			}],
		});
		expect(records).toContainEqual(expect.objectContaining({
			id: "LostTranscript",
			status: "failed",
			disposition: "resumable",
			outcome: "lost_transcript",
		}));
	});
});
