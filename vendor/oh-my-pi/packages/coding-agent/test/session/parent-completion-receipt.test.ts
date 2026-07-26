import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { AsyncJobManager, asyncJobCompletionAgentId } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import {
	ASYNC_JOB_RESULT_YIELD_KIND,
	admitParentCompletionReceipt,
	replayParentCompletionReceipts,
} from "@oh-my-pi/pi-coding-agent/async/parent-receipt";
import type { AsyncJobCompletionReceipt } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { YieldQueue } from "@oh-my-pi/pi-coding-agent/session/yield-queue";
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
});
