import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { runSyntheticSpawnWorkerWorkload } from "@oh-my-pi/pi-coding-agent/task/spawn-worker-client";
import type { RenderScheduler, RenderTimer } from "@oh-my-pi/pi-tui";
import { TUI } from "@oh-my-pi/pi-tui";
import { VirtualTerminal } from "../../../tui/test/virtual-terminal";

const CHILDREN = 30;
const KEY_DISPATCHES = 100;
const KEY_INTERVAL_MS = 5;

class ManualRenderScheduler implements RenderScheduler {
	#now = 0;
	#queue: Array<{ callback: () => void; canceled: boolean }> = [];

	now(): number {
		return this.#now;
	}

	scheduleImmediate(callback: () => void): void {
		this.#queue.push({ callback, canceled: false });
	}

	scheduleRender(callback: () => void, _delayMs: number): RenderTimer {
		const scheduled = { callback, canceled: false };
		this.#queue.push(scheduled);
		return { cancel: () => (scheduled.canceled = true) };
	}

	advance(ms: number): void {
		this.#now += ms;
	}

	flush(): void {
		const pending = this.#queue;
		this.#queue = [];
		for (const scheduled of pending) {
			if (!scheduled.canceled) scheduled.callback();
		}
	}
}

function percentile(sorted: readonly number[], quantile: number): number {
	return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)] ?? Number.POSITIVE_INFINITY;
}

let tmpDir = "";
let previousControlDb: string | undefined;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-spawn-wave-"));
	previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.OMP_SESSION_CONTROL_DB = path.join(tmpDir, "session-control.sqlite");
});

afterEach(async () => {
	if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("spawn-wave subprocess performance", () => {
	test(
		"admits 30 setup workers without starving parent key timers",
		async () => {
			const completions: string[] = [];
			const manager = new AsyncJobManager({
				maxRunningJobs: CHILDREN,
				retentionMs: 0,
				onJobComplete: async jobId => {
					completions.push(jobId);
				},
			});
			const terminal = new VirtualTerminal(120, 40, 20_000);
			const scheduler = new ManualRenderScheduler();
			const tui = new TUI(terminal, undefined, { renderScheduler: scheduler });
			const dueTimes: number[] = [];
			const lateness: number[] = [];
			const keysDone = Promise.withResolvers<void>();
			tui.addInputListener(() => {
				const dueAt = dueTimes.shift();
				if (dueAt !== undefined) lateness.push(Math.max(0, performance.now() - dueAt));
				tui.requestRender();
				if (lateness.length === KEY_DISPATCHES) keysDone.resolve();
				return { consume: true };
			});
			tui.start();
			// This proof intentionally uses the platform clock: fake timers cannot
			// measure event-loop starvation or timer lateness under subprocess load.
			const renderPump = setInterval(() => {
				scheduler.advance(16);
				scheduler.flush();
			}, 16);
			const keyTimers: Timer[] = [];
			const firstDue = performance.now() + 25;
			for (let index = 0; index < KEY_DISPATCHES; index++) {
				const dueAt = firstDue + index * KEY_INTERVAL_MS;
				keyTimers.push(
					setTimeout(() => {
						dueTimes.push(dueAt);
						terminal.sendInput("x");
					}, Math.max(0, dueAt - performance.now())),
				);
			}

			const accepted: string[] = [];
			let hungJobId = "";
			try {
				for (let index = 0; index < CHILDREN; index++) {
					const hung = index === CHILDREN - 1;
					const jobId = manager.register(
						"task",
						`spawn-wave-${index}`,
						async ({ signal, markRunning }) => {
							markRunning();
							const result = await runSyntheticSpawnWorkerWorkload(
								{ spinMs: 15, allocateBytes: 1024 * 1024, ...(hung ? { hangMs: 1_200 } : {}) },
								{
									signal,
									timeoutMs: 5_000,
									memoryWatermarks: { softBytes: 0, hardBytes: 512 * 1024 * 1024 },
								},
							);
							return `allocated ${result.allocatedBytes}`;
						},
						{ id: `SpawnWave${index}`, queued: true },
					);
					accepted.push(jobId);
					if (hung) hungJobId = jobId;
				}

				expect(accepted).toHaveLength(CHILDREN);
				expect(new Set(accepted).size).toBe(CHILDREN);
				await keysDone.promise;
				expect(manager.getJob(hungJobId)?.status).toBe("running");
				await manager.waitForAll();
				await manager.drainDeliveries({ timeoutMs: 2_000 });

				const sorted = [...lateness].sort((a, b) => a - b);
				const measurements = {
					children: accepted.length,
					keys: sorted.length,
					p50Ms: percentile(sorted, 0.5),
					p95Ms: percentile(sorted, 0.95),
					p99Ms: percentile(sorted, 0.99),
				};
				console.log("spawn-wave timer lateness", measurements);
				expect(sorted).toHaveLength(KEY_DISPATCHES);
				expect(measurements.p99Ms).toBeLessThan(50);
				expect(completions).toHaveLength(CHILDREN);
			} finally {
				for (const timer of keyTimers) clearTimeout(timer);
				clearInterval(renderPump);
				tui.stop();
				await manager.dispose({ timeoutMs: 2_000 });
			}
		},
		20_000,
	);

	test("abort hard-kills a hung spawn worker", async () => {
		const controller = new AbortController();
		let reachedRunPhase = false;
		const pending = runSyntheticSpawnWorkerWorkload(
			{ spinMs: 0, allocateBytes: 1024, hangMs: 10_000 },
			{
				signal: controller.signal,
				memoryWatermarks: { softBytes: 0, hardBytes: 512 * 1024 * 1024 },
				onPhase: phase => {
					if (phase !== "run") return;
					reachedRunPhase = true;
					controller.abort();
				},
			},
		);
		await expect(pending).rejects.toMatchObject({ code: "aborted" });
		expect(reachedRunPhase).toBe(true);
	});
});
