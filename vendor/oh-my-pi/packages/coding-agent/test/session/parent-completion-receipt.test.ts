import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { AsyncJobManager, asyncJobCompletionAgentId } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import {
	ASYNC_JOB_RESULT_YIELD_KIND,
	admitParentCompletionReceipt,
	replayParentCompletionReceipts,
} from "@oh-my-pi/pi-coding-agent/async/parent-receipt";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionOwnershipLostError } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import type { AsyncJobCompletionReceipt } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { acquireSessionOwnership } from "@oh-my-pi/pi-coding-agent/session/session-ownership";
import { YieldQueue } from "@oh-my-pi/pi-coding-agent/session/yield-queue";
import { recordSubagentFailure } from "@oh-my-pi/pi-coding-agent/task/subagent-failure";
import { TempDir } from "@oh-my-pi/pi-utils";

function createReceiptQueue(): YieldQueue {
	const queue = new YieldQueue({
		isStreaming: () => true,
		injectIdle: async () => {},
		scheduleIdleFlush: () => {},
	});
	queue.register<AsyncJobCompletionReceipt>(ASYNC_JOB_RESULT_YIELD_KIND, {
		build: entries => ({
			role: "custom",
			customType: ASYNC_JOB_RESULT_YIELD_KIND,
			content: entries.map(entry => entry.result).join("\n"),
			display: true,
			attribution: "agent",
			timestamp: Date.now(),
		}),
	});
	return queue;
}

function drainReceiptTexts(queue: YieldQueue): string[] {
	return queue
		.drainLazy()
		.map(build => build())
		.flatMap(message => (message?.role === "custom" && typeof message.content === "string" ? [message.content] : []));
}

async function createPersistentManager(temp: TempDir): Promise<SessionManager> {
	const manager = SessionManager.create(temp.path(), path.join(temp.path(), "sessions"));
	await manager.ensureOnDisk();
	return manager;
}

async function acquireManagerOwnership(manager: SessionManager, root: string) {
	const sessionFile = manager.getSessionFile();
	if (!sessionFile) throw new Error("expected session file");
	const ownership = await acquireSessionOwnership(sessionFile, manager.getSessionId(), {
		root,
		buildRevision: { digest: "a".repeat(64), version: "ownership-loss-terminal-test" },
		runnerInstanceIdentity: {
			runnerInstanceId: randomUUID(),
			startedAt: new Date().toISOString(),
		},
	});
	manager.bindSessionOwnership(ownership);
	return ownership;
}

async function createOwnedAgentSession(temp: TempDir) {
	const manager = await createPersistentManager(temp);
	const ownershipRoot = path.join(temp.path(), "ownership");
	const ownership = await acquireManagerOwnership(manager, ownershipRoot);
	const authStorage = await AuthStorage.create(path.join(temp.path(), "auth.sqlite"));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("expected bundled test model");
	const agent = new Agent({
		initialState: {
			model,
			systemPrompt: ["ownership loss terminal test"],
			tools: [],
			messages: [],
		},
	});
	const session = new AgentSession({
		agent,
		sessionManager: manager,
		settings: Settings.isolated(),
		modelRegistry: new ModelRegistry(authStorage),
	});
	return { manager, ownership, ownershipRoot, authStorage, session };
}

describe("durable parent completion receipts", () => {
	test("a live parent receives one completion and job acknowledgement marks its receipt", async () => {
		using temp = TempDir.createSync("@omp-parent-receipt-live-");
		const sessionManager = await createPersistentManager(temp);
		const queue = createReceiptQueue();
		const jobs = new AsyncJobManager({
			onJobComplete: async (jobId, result, job, sequence) => {
				await admitParentCompletionReceipt(sessionManager, queue, {
					agentId: job ? asyncJobCompletionAgentId(job) : jobId,
					jobId,
					sequence,
					result,
					jobType: job?.type,
					label: job?.label,
					durationMs: job ? Math.max(0, Date.now() - job.startTime) : undefined,
				});
			},
			onJobAcknowledge: async receipts => {
				await sessionManager.acknowledgeAsyncJobCompletions(receipts);
			},
		});
		const jobId = jobs.register("task", "child", async () => "child done", { id: "Child", ownerId: "Main" });
		await jobs.waitForAll();
		await jobs.drainDeliveries({ timeoutMs: 2_000 });
		expect(drainReceiptTexts(queue)).toEqual(["child done"]);
		expect(sessionManager.getUnacknowledgedAsyncJobCompletionReceipts()).toHaveLength(1);
		await jobs.acknowledgeDeliveries([jobId]);
		expect(sessionManager.getUnacknowledgedAsyncJobCompletionReceipts()).toEqual([]);
		await jobs.dispose();
		await sessionManager.close();
	});

	test("a completion admitted while the parent is disposed replays once on resume", async () => {
		using temp = TempDir.createSync("@omp-parent-receipt-resume-");
		const initial = await createPersistentManager(temp);
		const admission = await admitParentCompletionReceipt(initial, undefined, {
			agentId: "Child",
			jobId: "job-1",
			sequence: 1,
			result: "survived disposal",
			jobType: "task",
		});
		expect(admission.replayed).toBe(false);
		const sessionFile = initial.getSessionFile();
		if (!sessionFile) throw new Error("expected session file");
		await initial.close();

		const resumed = await SessionManager.open(sessionFile);
		const queue = createReceiptQueue();
		expect(replayParentCompletionReceipts(resumed, queue)).toBe(1);
		expect(drainReceiptTexts(queue)).toEqual(["survived disposal"]);
		expect(drainReceiptTexts(queue)).toEqual([]);
		await resumed.close();
	});

	test("duplicate receipt admission is ignored", async () => {
		const sessionManager = SessionManager.inMemory("/parent-receipt-duplicate");
		const queue = createReceiptQueue();
		const receipt = { agentId: "Child", jobId: "job-1", sequence: 1, result: "once" } as const;
		const first = await admitParentCompletionReceipt(sessionManager, queue, receipt);
		const duplicate = await admitParentCompletionReceipt(sessionManager, queue, receipt);
		expect(first.replayed).toBe(false);
		expect(duplicate.replayed).toBe(true);
		expect(drainReceiptTexts(queue)).toEqual(["once"]);
		expect(sessionManager.getUnacknowledgedAsyncJobCompletionReceipts()).toHaveLength(1);
	});

	test("acknowledgement survives restart", async () => {
		using temp = TempDir.createSync("@omp-parent-receipt-ack-");
		const initial = await createPersistentManager(temp);
		const receipt = await initial.appendAsyncJobCompletionReceipt({
			agentId: "Child",
			jobId: "job-1",
			sequence: 1,
			result: "already consumed",
		});
		await initial.acknowledgeAsyncJobCompletions([receipt.receipt]);
		const sessionFile = initial.getSessionFile();
		if (!sessionFile) throw new Error("expected session file");
		await initial.close();

		const resumed = await SessionManager.open(sessionFile);
		expect(resumed.getUnacknowledgedAsyncJobCompletionReceipts()).toEqual([]);
		const replay = await resumed.appendAsyncJobCompletionReceipt({
			agentId: "Child",
			jobId: "job-1",
			sequence: 1,
			result: "already consumed",
		});
		expect(replay).toMatchObject({ replayed: true, acknowledged: true });
		await resumed.close();
	});

	test("lease loss makes the stale AgentSession terminal and repeated appends stay non-writing", async () => {
		using temp = TempDir.createSync("@omp-parent-receipt-ownership-loss-");
		const fixture = await createOwnedAgentSession(temp);
		const sessionFile = fixture.manager.getSessionFile();
		if (!sessionFile) throw new Error("expected session file");
		const beforeBody = await fs.readFile(sessionFile, "utf8");
		const beforeEntries = fixture.manager.getEntries().length;
		try {
			await fixture.ownership.release();

			let firstLoss: SessionOwnershipLostError | undefined;
			for (const attempt of [1, 2]) {
				try {
					fixture.manager.appendCustomEntry("stale-callback", { attempt });
					throw new Error("stale append unexpectedly succeeded");
				} catch (error) {
					expect(error).toBeInstanceOf(SessionOwnershipLostError);
					if (firstLoss) expect(error).toBe(firstLoss);
					else firstLoss = error as SessionOwnershipLostError;
				}
			}

			expect(fixture.session.isDisposed).toBe(true);
			expect(fixture.session.ownershipLostError).toBe(firstLoss);
			await fixture.session.waitForOwnershipLossTerminal();
			await expect(fixture.session.prompt("must be refused")).rejects.toBe(firstLoss);
			expect(fixture.manager.getEntries()).toHaveLength(beforeEntries);
			expect(await fs.readFile(sessionFile, "utf8")).toBe(beforeBody);
		} finally {
			await fixture.session.dispose();
			fixture.authStorage.close();
		}
	});

	test("lease-revoked child failure finalization retargets one durable receipt to the new owner", async () => {
		using temp = TempDir.createSync("@omp-parent-receipt-owner-replay-");
		const fixture = await createOwnedAgentSession(temp);
		const sessionFile = fixture.manager.getSessionFile();
		if (!sessionFile) throw new Error("expected session file");
		let replacement: SessionManager | undefined;
		let replacementOwnership: Awaited<ReturnType<typeof acquireManagerOwnership>> | undefined;
		const queue = createReceiptQueue();
		let jobs: AsyncJobManager | undefined;
		try {
			await fixture.ownership.release();
			replacement = await SessionManager.open(sessionFile);
			replacementOwnership = await acquireManagerOwnership(replacement, fixture.ownershipRoot);

			jobs = new AsyncJobManager({
				onJobComplete: async (jobId, result, job, sequence) => {
					await admitParentCompletionReceipt(
						fixture.manager,
						undefined,
						{
							agentId: job ? asyncJobCompletionAgentId(job) : jobId,
							jobId,
							sequence,
							result,
							jobType: job?.type,
							label: job?.label,
						},
						() => (replacement ? { sessionManager: replacement, yieldQueue: queue } : undefined),
					);
				},
				onJobAcknowledge: async receipts => {
					await replacement?.acknowledgeAsyncJobCompletions(receipts);
				},
			});
			const jobId = jobs.register(
				"task",
				"child",
				async () => {
					expect(
						recordSubagentFailure(fixture.manager, {
							agent: "Child",
							job: "Child",
							operation: "async-finalize",
							errorClass: "failed",
							message: "child failed after lease revocation",
							historyUri: "history://Child",
							finalOutputUri: "agent://Child",
							finalOutputAvailable: false,
						}),
					).toBe(false);
					throw new Error("child failed after lease revocation");
				},
				{ id: "Child", ownerId: "Main" },
			);
			await jobs.waitForAll();
			await jobs.drainDeliveries({ timeoutMs: 2_000 });
			await fixture.session.waitForOwnershipLossTerminal();

			expect(fixture.manager.getUnacknowledgedAsyncJobCompletionReceipts()).toEqual([]);
			expect(replacement.getUnacknowledgedAsyncJobCompletionReceipts()).toHaveLength(1);
			expect(drainReceiptTexts(queue)).toEqual(["child failed after lease revocation"]);

			const replay = await admitParentCompletionReceipt(
				fixture.manager,
				undefined,
				{
					agentId: "Child",
					jobId,
					sequence: 1,
					result: "child failed after lease revocation",
					jobType: "task",
					label: "child",
				},
				() => (replacement ? { sessionManager: replacement, yieldQueue: queue } : undefined),
			);
			expect(replay.replayed).toBe(true);
			expect(drainReceiptTexts(queue)).toEqual([]);
			expect(
				fixture.manager
					.getEntries()
					.filter(entry => entry.type === "custom" && entry.customType === "ui_error"),
			).toEqual([]);
		} finally {
			if (jobs) await jobs.dispose();
			await fixture.session.dispose();
			fixture.authStorage.close();
			await replacement?.close();
			await replacementOwnership?.release();
		}
	});
});
