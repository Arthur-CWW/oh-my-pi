import { SubagentWorkerPool } from "../src/task/subagent-worker-pool";

function processExists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const coordinatorPid = process.pid;
const coordinatorRssBefore = process.memoryUsage().rss;
const deliveries: Array<{ value: number; pid: number; attempt: number; rssBytes: number }> = [];
const pool = new SubagentWorkerPool({
	width: 1,
	maxTurnsPerWorker: 3,
	maxWorkerRssBytes: Number.MAX_SAFE_INTEGER,
});

try {
	for (let value = 1; value <= 6; value += 1) {
		const result = await pool.run({
			value,
			allocateBytes: value === 3 ? 64 * 1024 * 1024 : undefined,
		});
		deliveries.push({
			value: result.payload as number,
			pid: result.workerPid,
			attempt: result.attempt,
			rssBytes: result.workerRssBytes,
		});
	}

	const firstWorkerPid = deliveries[0]!.pid;
	const replacementWorkerPid = deliveries[3]!.pid;
	const proof = {
		coordinatorPid,
		coordinatorIdentityStable: process.pid === coordinatorPid,
		coordinatorRssBefore,
		coordinatorRssAfter: process.memoryUsage().rss,
		deliveries,
		orderedSingleDelivery: deliveries.map(({ value }) => value).join(",") === "1,2,3,4,5,6",
		firstWorkerPid,
		replacementWorkerPid,
		workerRecycled: firstWorkerPid !== replacementWorkerPid,
		firstWorkerExited: !processExists(firstWorkerPid),
		allocatedWorkerPeakRssBytes: deliveries[2]!.rssBytes,
	};
	for (const [name, value] of Object.entries(proof)) {
		if (typeof value === "boolean" && !value) throw new Error(`worker proof failed: ${name}`);
	}
	process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
} finally {
	await pool.close();
}
