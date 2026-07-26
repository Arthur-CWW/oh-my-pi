import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { PROVIDER_RECOVERY_CUSTOM_TYPE } from "@oh-my-pi/pi-coding-agent/session/provider-recovery";
import { reattachDetachedChildTask, respawnReAdoptedChildTask } from "@oh-my-pi/pi-coding-agent/task";
import { reAdoptDirectChildren } from "@oh-my-pi/pi-coding-agent/task/re-adopt";
import { CHILD_LIFECYCLE_CUSTOM_TYPE, type ChildLifecycleState } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";

const tempDirs: string[] = [];
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "re-adopt-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000007",
	startedAt: "2026-01-01T00:00:00.000Z",
};

function ownership(parent: string, current: () => boolean = () => true) {
	return {
		sessionFile: parent,
		sessionId: "parent",
		ownerEpoch: "test-epoch",
		ownerKind: "omp" as const,
		buildRevision: TEST_BUILD_REVISION,
		runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
		isCurrent: async () => current(),
		release: async () => {},
	};
}

async function makeParent(): Promise<{ parent: string; children: string }> {
	const tempRoot = path.join(process.cwd(), "test/.tmp");
	await fs.mkdir(tempRoot, { recursive: true });
	const root = await fs.mkdtemp(path.join(tempRoot, "re-adopt-"));
	tempDirs.push(root);
	const parent = path.join(root, "parent.jsonl");
	const children = parent.slice(0, -".jsonl".length);
	await fs.mkdir(children);
	await fs.writeFile(parent, `${JSON.stringify({ type: "session", id: "parent", timestamp: new Date().toISOString(), cwd: root })}\n`);
	return { parent, children };
}

async function writeChild(options: {
	children: string;
	parent: string;
	id: string;
	fileName?: string;
	isolated?: boolean;
	parentFile?: string;
	corrupt?: boolean;
	lifecycleState?: ChildLifecycleState;
	legacy?: boolean;
	parkedTimeline?: boolean;
	providerRecovery?: "auth-invalid" | "rate-limit";
}): Promise<string> {
	const file = path.join(options.children, `${options.fileName ?? options.id}.jsonl`);
	if (options.corrupt) {
		await fs.writeFile(file, "not json\n");
		return file;
	}
	const timestamp = new Date().toISOString();
	await fs.writeFile(
		file,
		[
			JSON.stringify({ type: "session", id: options.id, timestamp, cwd: "/tmp" }),
			JSON.stringify({
				type: "session_init",
				id: "init",
				parentId: null,
				timestamp,
				systemPrompt: "child prompt",
				task: "child task",
				tools: ["irc"],
				subagent: {
					agentId: options.id,
					parentSessionFile: options.parentFile ?? options.parent,
					displayName: `${options.id} display`,
					parentSessionId: "parent",
					model: "provider/model",
					taskDepth: 1,
					parentTaskPrefix: options.id,
					isolated: options.isolated ?? false,
				},
			}),
			JSON.stringify({ type: "message", id: "unfinished", parentId: "init", timestamp, message: { role: "assistant", content: [] } }),
			...(options.legacy
				? []
				: [
					JSON.stringify({
						type: "custom",
						id: "lifecycle",
						parentId: "init",
						timestamp,
						customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
						data: {
							version: 1,
							agentId: options.id,
							childSessionFile: file,
							parentSessionFile: options.parentFile ?? options.parent,
							state: options.lifecycleState ?? "running",
							updatedAt: timestamp,
						},
					}),
				]),
			...(options.providerRecovery
				? [
						JSON.stringify({
							type: "custom",
							id: "provider-recovery",
							parentId: "lifecycle",
							timestamp,
							customType: PROVIDER_RECOVERY_CUSTOM_TYPE,
							data: {
								version: 1,
								agentId: options.id,
								provider: "openai-codex",
								model: "gpt-test",
								route: "openai-codex/gpt-test",
								kind: options.providerRecovery,
								state: "waiting",
								userAction:
									options.providerRecovery === "auth-invalid" ? "refresh-credentials" : "wait-for-reset",
								attempt: 1,
								maxAttempts: 3,
								deadlineAt: Date.now() + 60_000,
								...(options.providerRecovery === "rate-limit" ? { retryAt: Date.now() + 1_000 } : {}),
								updatedAt: timestamp,
							},
						}),
					]
				: []),
			...(options.parkedTimeline
				? [
						JSON.stringify({
							type: "custom",
							id: "parked-timeline",
							parentId: "lifecycle",
							timestamp,
							customType: "omp:agent-timeline:v1",
							data: { agentId: options.id, toState: "parked" },
						}),
					]
				: []),
		].join("\n") + "\n",
	);
	return file;
}

function startDetachedSleeper(): Bun.Subprocess<"ignore", "ignore", "ignore"> {
	return Bun.spawn({
		cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		detached: true,
	});
}

describe("restart child re-adoption", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	afterEach(async () => {
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
		await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
	});

	it("re-adopts idle and parked children but never fabricates an unverifiable running child", async () => {
		const { parent, children } = await makeParent();
		await writeChild({ parent, children, id: "Running", lifecycleState: "running" });
		await writeChild({ parent, children, id: "Idle", lifecycleState: "idle" });
		const childFile = await writeChild({ parent, children, id: "Parked", lifecycleState: "parked" });
		let revived = 0;
		const fakeSession = { subscribe: () => () => {}, sessionManager: SessionManager.inMemory() };
		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			idleTtlMs: 0,
			parentSessionId: "parent",
			ownership: ownership(parent),
			createReviver: async () => {
				return async () => {
					revived += 1;
					return fakeSession as never;
				};
			},
		});

		expect(result.adopted.map(child => child.id).sort()).toEqual(["Idle", "Parked"]);
		expect(result.diagnostics).toEqual([expect.objectContaining({ reason: "detached_process_unverifiable" })]);
		expect(AgentRegistry.global().get("Parked")).toEqual(
			expect.objectContaining({ status: "parked", session: null, sessionFile: childFile }),
		);
		await AgentLifecycleManager.global().ensureLive("Parked");
		expect(revived).toBe(1);
	});

	it("re-adopts a parked child after its completed turn wrote a terminal lifecycle record", async () => {
		const { parent, children } = await makeParent();
		await writeChild({ parent, children, id: "ParkedAfterTurn", lifecycleState: "failed", parkedTimeline: true });

		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
		});

		expect(result.diagnostics).toEqual([]);
		expect(result.adopted.map(child => child.id)).toEqual(["ParkedAfterTurn"]);
		expect(AgentRegistry.global().get("ParkedAfterTurn")?.status).toBe("parked");
	});

	it("re-adopts a waiting-provider child with the same id, journal, and recovery state", async () => {
		const { parent, children } = await makeParent();
		const childFile = await writeChild({
			parent,
			children,
			id: "Waiting",
			lifecycleState: "waiting-provider",
			providerRecovery: "auth-invalid",
		});

		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
		});

		expect(result.diagnostics).toEqual([]);
		expect(result.adopted).toEqual([
			expect.objectContaining({
				id: "Waiting",
				sessionFile: childFile,
				lifecycleState: "waiting-provider",
				providerRecovery: expect.objectContaining({ kind: "auth-invalid", state: "waiting" }),
			}),
		]);
		expect(AgentRegistry.global().get("Waiting")).toEqual(
			expect.objectContaining({ status: "parked", sessionFile: childFile }),
		);
	});

	it("keeps terminal, legacy, foreign, duplicate-id, isolated, corrupt, and unavailable children history-only", async () => {
		const { parent, children } = await makeParent();
		await writeChild({ parent, children, id: "Good", lifecycleState: "idle" });
		await writeChild({ parent, children, id: "Terminal", lifecycleState: "completed" });
		await writeChild({ parent, children, id: "Legacy", legacy: true });
		await writeChild({ parent, children, id: "Foreign", parentFile: path.join(children, "other.jsonl") });
		await writeChild({ parent, children, id: "Duplicate", lifecycleState: "idle" });
		await writeChild({ parent, children, id: "Duplicate", fileName: "Duplicate-copy", lifecycleState: "idle" });
		await writeChild({ parent, children, id: "Isolated", isolated: true });
		await writeChild({ parent, children, id: "Corrupt", corrupt: true });
		await writeChild({ parent, children, id: "Unavailable", lifecycleState: "idle" });
		AgentRegistry.global().register({ id: "Unavailable", displayName: "live", kind: "sub", session: {} as never });

		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
		});

		expect(result.adopted.map(child => child.id)).toEqual(["Good"]);
		expect(result.diagnostics.map(entry => entry.reason).sort()).toEqual([
			"corrupt_journal",
			"id_collision",
			"id_collision",
			"id_collision",
			"isolated",
			"legacy_journal",
			"stale_parent",
			"terminal_state",
		]);
		expect(AgentRegistry.global().get("Isolated")).toBeUndefined();
	});

	it("keeps a non-terminal child archived when a terminal direct journal claims its id", async () => {
		const { parent, children } = await makeParent();
		await writeChild({ parent, children, id: "Shared", lifecycleState: "idle" });
		await writeChild({ parent, children, id: "Shared", fileName: "Shared-completed", lifecycleState: "completed" });

		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
		});

		expect(result.adopted).toEqual([]);
		expect(result.diagnostics.map(entry => entry.reason).sort()).toEqual(["id_collision", "terminal_state"]);
		expect(AgentRegistry.global().get("Shared")).toBeUndefined();
	});

	it("does not replace a child that becomes live while its reviver is created", async () => {
		const { parent, children } = await makeParent();
		await writeChild({ parent, children, id: "Raced", lifecycleState: "idle" });

		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			createReviver: async child => {
				AgentRegistry.global().register({ id: child.id, displayName: "live", kind: "sub", session: {} as never, status: "idle" });
				return async () => ({ subscribe: () => () => {} }) as never;
			},
		});

		expect(result.adopted).toEqual([]);
		expect(result.diagnostics).toEqual([expect.objectContaining({ reason: "id_collision" })]);
		expect(AgentRegistry.global().get("Raced")).toEqual(expect.objectContaining({ displayName: "live", status: "idle" }));
	});

	it("restarts only the running child named by the predecessor handoff", async () => {
		const { parent, children } = await makeParent();
		const runningFile = await writeChild({ parent, children, id: "Running", lifecycleState: "running" });
		const parkedFile = await writeChild({ parent, children, id: "Parked", lifecycleState: "parked" });
		let resumed = 0;
		const sessions = new Map<string, SessionManager>();
		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			predecessorOwnerEpoch: "old-epoch",
			restartManifest: [
				{ agentId: "Running", state: "running", journalPath: runningFile, queueCheckpoint: "queue-7" },
				{ agentId: "Parked", state: "parked", journalPath: parkedFile, queueCheckpoint: null },
			],
			createReviver: async child => async () => {
				const sessionManager = await SessionManager.open(child.sessionFile);
				sessions.set(child.id, sessionManager);
				return {
					subscribe: () => () => {},
					sessionManager,
					dispose: async () => sessionManager.close(),
				} as never;
			},
			resumeInterruptedTurn: async child => {
				expect(child.id).toBe("Running");
				resumed += 1;
			},
		});

		expect(result.diagnostics).toEqual([]);
		expect(resumed).toBe(1);
		expect(AgentRegistry.global().get("Running")?.status).toBe("idle");
		expect(AgentRegistry.global().get("Parked")?.status).toBe("parked");
		const runningEntries = sessions.get("Running")?.getEntries() ?? [];
		expect(
			runningEntries.filter(
				entry =>
					entry.type === "custom" &&
					entry.customType === "child_restart" &&
					(entry.data as { status?: string }).status === "resumed",
			),
		).toHaveLength(1);
	});

	it("retries a durably resuming turn after a crash before admission", async () => {
		const { parent, children } = await makeParent();
		const runningFile = await writeChild({ parent, children, id: "Retry", lifecycleState: "running" });
		const manifest = [{ agentId: "Retry", state: "running" as const, journalPath: runningFile, queueCheckpoint: null }];
		const opened: SessionManager[] = [];
		const createReviver = async (child: { sessionFile: string }) => async () => {
			const sessionManager = await SessionManager.open(child.sessionFile);
			opened.push(sessionManager);
			return { subscribe: () => () => {}, sessionManager, dispose: async () => sessionManager.close() } as never;
		};

		const crashed = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			predecessorOwnerEpoch: "old-epoch",
			restartManifest: manifest,
			createReviver,
			resumeInterruptedTurn: async () => {
				throw new Error("replacement killed before admission");
			},
		});
		expect(crashed.diagnostics).toEqual([expect.objectContaining({ reason: "reviver_unavailable" })]);
		await Promise.all(opened.splice(0).map(manager => manager.close()));
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();

		let admitted = 0;
		const recovered = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			predecessorOwnerEpoch: "old-epoch",
			restartManifest: manifest,
			createReviver,
			resumeInterruptedTurn: async () => {
				admitted += 1;
			},
		});
		expect(recovered.diagnostics).toEqual([]);
		expect(admitted).toBe(1);
		const entries = opened.at(-1)?.getEntries() ?? [];
		expect(
			entries.filter(
				entry =>
					entry.type === "custom" &&
					entry.customType === "child_restart" &&
					(entry.data as { status?: string }).status === "resumed",
			),
		).toHaveLength(1);
	});

	it("diagnoses a manifest child whose journal is not visible", async () => {
		const { parent, children } = await makeParent();
		const missing = path.join(children, "Missing.jsonl");
		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent),
			predecessorOwnerEpoch: "old-epoch",
			restartManifest: [{ agentId: "Missing", state: "running", journalPath: missing, queueCheckpoint: null }],
			createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
		});
		expect(result.adopted).toEqual([]);
		expect(result.diagnostics).toEqual([
			expect.objectContaining({ file: missing, reason: "manifest_unadopted" }),
		]);
	});

	it("persists a corrupt manifest child diagnostic and excludes it from auto-resume", async () => {
		const { parent, children } = await makeParent();
		const corrupt = await writeChild({ parent, children, id: "Corrupt", corrupt: true });
		const journal = await SessionManager.open(parent);
		try {
			const result = await reAdoptDirectChildren({
				parentSessionFile: parent,
				parentSessionId: "parent",
				idleTtlMs: 0,
				ownership: ownership(parent),
				predecessorOwnerEpoch: "old-epoch",
				restartManifest: [{ agentId: "Corrupt", state: "running", journalPath: corrupt, queueCheckpoint: null }],
				diagnosticJournal: journal,
				deferInterruptedResume: true,
				createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
			});
			expect(result.outcome).toBe("ReAdoptionDegraded");
			expect(result.autoResumeCandidates).toEqual([]);
			expect(
				journal.getEntries().filter(
					entry =>
						entry.type === "custom" &&
						entry.customType === "re-adoption-diagnostic" &&
						(entry.data as { file?: string }).file === corrupt,
				),
			).toHaveLength(2);
		} finally {
			await journal.close();
		}
	});

	it("rolls back all rows when ownership changes before a later registration", async () => {
		const { parent, children } = await makeParent();
		await writeChild({ parent, children, id: "First", lifecycleState: "idle" });
		await writeChild({ parent, children, id: "Second", lifecycleState: "idle" });
		let checks = 0;
		const result = await reAdoptDirectChildren({
			parentSessionFile: parent,
			parentSessionId: "parent",
			idleTtlMs: 0,
			ownership: ownership(parent, () => ++checks < 3),
			createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
		});
		expect(result.adopted).toEqual([]);
		expect(result.diagnostics).toEqual([expect.objectContaining({ reason: "ownership_lost" })]);
		expect(AgentRegistry.global().list()).toEqual([]);
	});

	it("re-adopts one fingerprint-verified detached process as the same addressable async job", async () => {
		const { parent, children } = await makeParent();
		const childFile = await writeChild({ parent, children, id: "LiveDetached", lifecycleState: "running" });
		const worker = startDetachedSleeper();
		const bus = new IrcExternalBus(path.join(children, "irc.sqlite"), { registrationEnabled: true });
		bus.registerPeer({
			sessionId: "LiveDetached",
			agentId: "LiveDetached",
			name: "LiveDetached",
			cwd: children,
			pid: worker.pid,
			sessionFile: childFile,
		});
		const manager = new AsyncJobManager({ maxRunningJobs: 4, onJobComplete: () => {} });
		let resumed = 0;
		try {
			const adopt = (withRestartManifest = false) =>
				reAdoptDirectChildren({
					parentSessionFile: parent,
					parentSessionId: "parent",
					idleTtlMs: 0,
					ownership: ownership(parent),
					externalBus: bus,
					...(withRestartManifest
						? {
								predecessorOwnerEpoch: "previous-parent",
								restartManifest: [
									{ agentId: "LiveDetached", state: "running" as const, journalPath: childFile, queueCheckpoint: null },
								],
							}
						: {}),
					createReviver: async () => async () => ({ subscribe: () => () => {} }) as never,
					reattachRunningChild: child => {
						reattachDetachedChildTask({ manager, child });
					},
					resumeInterruptedTurn: async () => {
						resumed += 1;
					},
				});
			const first = await adopt();
			const second = await adopt(true);
			expect(first.diagnostics).toEqual([]);
			expect(second.diagnostics).toEqual([]);
			expect(first.adopted).toEqual([
				expect.objectContaining({
					id: "LiveDetached",
					sessionFile: childFile,
					turnState: "detached_live",
				}),
			]);
			expect(AgentRegistry.global().get("LiveDetached")).toEqual(
				expect.objectContaining({ id: "LiveDetached", status: "running", session: null, sessionFile: childFile }),
			);
			expect(manager.getRunningJobs().map(job => job.id)).toEqual(["LiveDetached"]);
			expect(bus.findPeerByName("LiveDetached")?.processIdentity).toEqual(
				expect.objectContaining({ pid: worker.pid }),
			);
			expect(resumed).toBe(0);
		} finally {
			manager.cancel("LiveDetached");
			await manager.getJob("LiveDetached")?.promise;
			await manager.dispose();
			bus.close();
			try {
				process.kill(-worker.pid, "SIGKILL");
			} catch {}
			await worker.exited;
		}
	});

	it("respawns only a fingerprint-proven dead child under its stable id and journal", async () => {
		const { parent, children } = await makeParent();
		const childFile = await writeChild({ parent, children, id: "DeadDetached", lifecycleState: "running" });
		const worker = startDetachedSleeper();
		const bus = new IrcExternalBus(path.join(children, "dead-irc.sqlite"), { registrationEnabled: true });
		bus.registerPeer({
			sessionId: "DeadDetached",
			agentId: "DeadDetached",
			name: "DeadDetached",
			cwd: children,
			pid: worker.pid,
			sessionFile: childFile,
		});
		process.kill(-worker.pid, "SIGKILL");
		await worker.exited;
		const manager = new AsyncJobManager({ maxRunningJobs: 4, onJobComplete: () => {} });
		let continued = 0;
		let reopened: SessionManager | undefined;
		try {
			const result = await reAdoptDirectChildren({
				parentSessionFile: parent,
				parentSessionId: "parent",
				idleTtlMs: 0,
				ownership: ownership(parent),
				externalBus: bus,
				createReviver: async child => async () => {
					reopened = await SessionManager.open(child.sessionFile);
					return {
						agent: {
							continue: async () => {
								continued += 1;
							},
							abort: () => {},
						},
						subscribe: () => () => {},
						sessionManager: reopened,
						dispose: async () => reopened?.close(),
					} as never;
				},
				resumeInterruptedTurn: async (child, childSession) => {
					respawnReAdoptedChildTask({ manager, child, session: childSession });
				},
			});
			const job = manager.getJob("DeadDetached");
			await job?.promise;
			expect(result.adopted).toEqual([
				expect.objectContaining({
					id: "DeadDetached",
					sessionFile: childFile,
					turnState: "interrupted_by_restart",
				}),
			]);
			expect(result.autoResumeCandidates.map(child => child.id)).toEqual(["DeadDetached"]);
			expect(result.diagnostics).toEqual([expect.objectContaining({ reason: "detached_process_dead" })]);
			expect(bus.findPeerByName("DeadDetached")).toBeUndefined();
			expect(continued).toBe(1);
			expect(job?.status).toBe("completed");
			expect(reopened?.getSessionFile()).toBe(childFile);
			expect(AgentRegistry.global().get("DeadDetached")).toEqual(
				expect.objectContaining({ id: "DeadDetached", sessionFile: childFile, status: "idle" }),
			);
			expect(AgentRegistry.global().get("DeadDetached-2")).toBeUndefined();
		} finally {
			await manager.dispose();
			await AgentLifecycleManager.global().release("DeadDetached");
			bus.close();
		}
	});
});
