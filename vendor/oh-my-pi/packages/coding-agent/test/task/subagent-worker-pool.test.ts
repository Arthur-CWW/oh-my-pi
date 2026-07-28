import { afterEach, describe, expect, it } from "bun:test";
import { SubagentWorkerPool } from "@oh-my-pi/pi-coding-agent/task/subagent-worker-pool";

const pools = new Set<SubagentWorkerPool>();

function createPool(overrides: Partial<ConstructorParameters<typeof SubagentWorkerPool>[0]> = {}): SubagentWorkerPool {
	const pool = new SubagentWorkerPool({
		width: 2,
		maxTurnsPerWorker: 100,
		softWorkerRssBytes: 0,
		hardWorkerRssBytes: 0,
		...overrides,
	});
	pools.add(pool);
	return pool;
}

afterEach(async () => {
	await Promise.all([...pools].map(pool => pool.close()));
	pools.clear();
});

describe("SubagentWorkerPool real process boundary", () => {
	it("runs at bounded width but delivers completions in admission order", async () => {
		const pool = createPool({ width: 2 });
		const delivered: string[] = [];
		const slow = pool.run({ value: "first", delayMs: 80 }).then(result => {
			delivered.push(result.payload as string);
			return result;
		});
		const fast = pool.run({ value: "second" }).then(result => {
			delivered.push(result.payload as string);
			return result;
		});

		const [first, second] = await Promise.all([slow, fast]);
		expect(delivered).toEqual(["first", "second"]);
		expect(first.workerPid).not.toBe(second.workerPid);
		expect(pool.coordinatorPid).toBe(process.pid);
	});

	it("retries a pre-result crash once on a fresh worker", async () => {
		const pool = createPool({ width: 1 });
		const before = await pool.run({ value: "before" });
		let deliveries = 0;
		const recovered = await pool.run({ value: { status: "recovered" }, crash: "before-result" }).then(result => {
			deliveries += 1;
			return result;
		});

		expect(recovered.attempt).toBe(2);
		expect(recovered.workerPid).not.toBe(before.workerPid);
		expect(recovered.payload).toEqual({ status: "recovered" });
		expect(deliveries).toBe(1);
		expect(pool.coordinatorPid).toBe(process.pid);
	});

	it("commits a result once before recycling the acknowledged worker", async () => {
		const pool = createPool({ width: 1 });
		let deliveries = 0;
		const result = await pool.run({ value: "committed", crash: "after-result-before-ack" }).then(value => {
			deliveries += 1;
			return value;
		});
		const following = await pool.run({ value: "following" });

		expect(result.attempt).toBe(1);
		expect(deliveries).toBe(1);
		expect(following.workerPid).not.toBe(result.workerPid);
		expect(following.payload).toBe("following");
	});

	it("drains a max-turn worker before replacing its process", async () => {
		const pool = createPool({ width: 1, maxTurnsPerWorker: 2 });
		const first = await pool.run({ value: 1 });
		const second = await pool.run({ value: 2 });
		const third = await pool.run({ value: 3 });

		expect(second.workerPid).toBe(first.workerPid);
		expect(second.workerTurnsCompleted).toBe(2);
		expect(third.workerPid).not.toBe(first.workerPid);
		expect(third.workerTurnsCompleted).toBe(1);
	});

	it("touches requested pages, reports RSS, then recycles at the soft watermark", async () => {
		const pool = createPool({ width: 1, softWorkerRssBytes: 1 });
		const allocated = await pool.run({ value: "allocated", allocateBytes: 8 * 1024 * 1024 });
		const replacement = await pool.run({ value: "replacement" });

		expect(allocated.workerRssBytes).toBeGreaterThan(8 * 1024 * 1024);
		expect(allocated.workerMemoryWatermark).toBe("soft");
		expect(replacement.workerPid).not.toBe(allocated.workerPid);
		expect(pool.coordinatorPid).toBe(process.pid);
	});

	it("reports a hard crossing while still committing the turn that crossed it", async () => {
		const pool = createPool({ width: 1, softWorkerRssBytes: 1, hardWorkerRssBytes: 1 });
		const allocated = await pool.run({ value: "allocated", allocateBytes: 8 * 1024 * 1024 });
		const replacement = await pool.run({ value: "replacement" });

		// The hard crossing degrades the worker: its result is still delivered
		// and the pool replaces it — the coordinator never kills it mid-turn.
		expect(allocated.payload).toBe("allocated");
		expect(allocated.workerMemoryWatermark).toBe("hard");
		expect(replacement.workerPid).not.toBe(allocated.workerPid);
		expect(replacement.workerMemoryWatermark).toBeUndefined();
	});
});
