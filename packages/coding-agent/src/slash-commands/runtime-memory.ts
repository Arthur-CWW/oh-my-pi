import { heapStats, memoryUsage as jscMemoryUsage } from "bun:jsc";
import type { SlashCommandSpec } from "./types";

const GIBIBYTE = 1024 ** 3;
const TOP_TYPE_LIMIT = 5;

/**
 * Small before/after sample for the forced-GC delta. Deliberately excludes the
 * object-type histogram so a pending delta does not pin a large map across the
 * collection it is measuring.
 */
export type RuntimeMemorySnapshot = {
	coordinatorRss: number;
	jscHeapSize: number;
	jscHeapCapacity: number;
	jscExtraMemory: number;
	/** mimalloc bytes handed out to live allocations. */
	mimallocInUse: number;
	/** mimalloc bytes committed to this process; released only at exit. */
	mimallocCommitted: number;
};

/** Everything `/runtime-memory` prints, sampled once. */
export type RuntimeMemoryReport = RuntimeMemorySnapshot & {
	nodeHeapUsed: number;
	nodeHeapTotal: number;
	external: number;
	arrayBuffers: number;
	objectCount: number;
	protectedObjectCount: number;
	objectTypeCounts: Record<string, number>;
	/** Durable high-water marks. Free to read, and recorded without a sampling loop. */
	mimallocPeakInUse: number;
	mimallocPeakCommitted: number;
	pageFaults: number;
};

export type RuntimeMemoryChange = "reclaimed" | "unchanged" | "higher";

function gibibytes(bytes: number): string {
	return `${(bytes / GIBIBYTE).toFixed(2)} GiB`;
}

function signedGibibytes(delta: number): string {
	return `${delta < 0 ? "-" : "+"}${gibibytes(Math.abs(delta))}`;
}

function snapshotRuntimeMemory(): RuntimeMemorySnapshot {
	const usage = process.memoryUsage();
	const heap = heapStats();
	const mimalloc = jscMemoryUsage();
	return {
		coordinatorRss: usage.rss,
		jscHeapSize: heap.heapSize,
		jscHeapCapacity: heap.heapCapacity,
		jscExtraMemory: heap.extraMemorySize,
		mimallocInUse: mimalloc.current,
		mimallocCommitted: mimalloc.currentCommit,
	};
}

export function sampleRuntimeMemoryReport(): RuntimeMemoryReport {
	const usage = process.memoryUsage();
	const heap = heapStats();
	const mimalloc = jscMemoryUsage();
	return {
		coordinatorRss: usage.rss,
		jscHeapSize: heap.heapSize,
		jscHeapCapacity: heap.heapCapacity,
		jscExtraMemory: heap.extraMemorySize,
		mimallocInUse: mimalloc.current,
		mimallocCommitted: mimalloc.currentCommit,
		nodeHeapUsed: usage.heapUsed,
		nodeHeapTotal: usage.heapTotal,
		external: usage.external,
		arrayBuffers: usage.arrayBuffers,
		objectCount: heap.objectCount,
		protectedObjectCount: heap.protectedObjectCount,
		objectTypeCounts: heap.objectTypeCounts,
		mimallocPeakInUse: mimalloc.peak,
		mimallocPeakCommitted: mimalloc.peakCommit,
		pageFaults: mimalloc.pageFaults,
	};
}

/**
 * Classify on coordinator RSS alone. The JSC and mimalloc counters move with
 * ordinary nursery churn, so treating *any* of them falling as "reclaimed"
 * reported success while the process footprint was flat or still climbing —
 * exactly the case that forces a `/restart`.
 */
export function classifyRuntimeMemoryChange(
	before: RuntimeMemorySnapshot,
	after: RuntimeMemorySnapshot,
): RuntimeMemoryChange {
	const rssDelta = after.coordinatorRss - before.coordinatorRss;
	if (rssDelta < 0) return "reclaimed";
	if (rssDelta === 0) return "unchanged";
	return "higher";
}

function formatMemoryMetric(
	label: string,
	before: number,
	after: number,
): string {
	return `${label}: ${gibibytes(before)} → ${gibibytes(after)} (Δ ${signedGibibytes(after - before)})`;
}

export function formatRuntimeMemoryChange(
	before: RuntimeMemorySnapshot,
	after: RuntimeMemorySnapshot,
): string {
	return [
		"Forced GC (measured):",
		formatMemoryMetric("Coordinator RSS", before.coordinatorRss, after.coordinatorRss),
		formatMemoryMetric("JSC heap size", before.jscHeapSize, after.jscHeapSize),
		formatMemoryMetric("JSC heap capacity", before.jscHeapCapacity, after.jscHeapCapacity),
		formatMemoryMetric("JSC extra memory", before.jscExtraMemory, after.jscExtraMemory),
		formatMemoryMetric("mimalloc in use", before.mimallocInUse, after.mimallocInUse),
		formatMemoryMetric("mimalloc committed", before.mimallocCommitted, after.mimallocCommitted),
		`Measured change (coordinator RSS): ${classifyRuntimeMemoryChange(before, after)}`,
		"Only RSS decides that verdict; the JSC and mimalloc counters above are informational.",
	].join("\n");
}

function formatTopObjectTypes(objectTypeCounts: Record<string, number>): string {
	const topTypes: Array<[string, number]> = [];
	for (const name in objectTypeCounts) {
		if (!Object.prototype.hasOwnProperty.call(objectTypeCounts, name)) continue;
		const count = objectTypeCounts[name];
		let index = 0;
		while (index < topTypes.length && topTypes[index][1] >= count) index++;
		if (index >= TOP_TYPE_LIMIT) continue;
		topTypes.splice(index, 0, [name, count]);
		if (topTypes.length > TOP_TYPE_LIMIT) topTypes.pop();
	}
	let result = "";
	for (let index = 0; index < topTypes.length; index++) {
		if (index > 0) result += ", ";
		result += `${topTypes[index][0]}=${topTypes[index][1].toLocaleString("en-US")}`;
	}
	return result || "none";
}

export function formatRuntimeMemoryReport(sample: RuntimeMemoryReport): string {
	return [
		`Coordinator RSS: ${gibibytes(sample.coordinatorRss)}`,
		`JSC heap: ${gibibytes(sample.jscHeapSize)} used / ${gibibytes(sample.jscHeapCapacity)} capacity`,
		`JSC extra memory: ${gibibytes(sample.jscExtraMemory)}`,
		`mimalloc: ${gibibytes(sample.mimallocInUse)} in use / ${gibibytes(sample.mimallocCommitted)} committed`,
		`mimalloc peak: ${gibibytes(sample.mimallocPeakInUse)} in use / ${gibibytes(sample.mimallocPeakCommitted)} committed`,
		`Node-compatible heap: ${gibibytes(sample.nodeHeapUsed)} used / ${gibibytes(sample.nodeHeapTotal)} committed`,
		`External / array buffers: ${gibibytes(sample.external)} / ${gibibytes(sample.arrayBuffers)}`,
		`Objects: ${sample.objectCount.toLocaleString("en-US")} (${sample.protectedObjectCount.toLocaleString("en-US")} protected)`,
		`Page faults: ${sample.pageFaults.toLocaleString("en-US")}`,
		`Top object types: ${formatTopObjectTypes(sample.objectTypeCounts)}`,
		// Bun allocates JSC payloads through mimalloc, and `Bun.gc(true)` reaches
		// mimalloc only as `mi_collect(false)`: a non-forced collect of the
		// calling thread's heap. It never force-purges arenas or other threads'
		// page caches, and no JS API exposes `mi_collect(true)`.
		"Reclaim: /runtime-memory gc forces two JSC collections plus a non-forced mimalloc collect of this thread only.",
		"Committed mimalloc pages (see peak) are returned to the OS by process exit, so /restart is the only lever that lowers RSS.",
		"/debug → Memory Report captures a heap snapshot for attributing the JSC side.",
	].join("\n");
}

export async function collectRuntimeGarbage(): Promise<string> {
	const before = snapshotRuntimeMemory();
	Bun.gc(true);
	await Bun.sleep(0);
	Bun.gc(true);
	await Bun.sleep(0);
	const after = snapshotRuntimeMemory();
	return formatRuntimeMemoryChange(before, after);
}

export const RUNTIME_MEMORY_COMMAND_SPEC: SlashCommandSpec = {
	name: "runtime-memory",
	description: "Explain or explicitly collect coordinator runtime memory",
	allowArgs: true,
	focusedViewSafe: true,
	subcommands: [{ name: "gc", description: "Force two full JSC collections and report measured memory changes" }],
	handle: async (command, runtime) => {
		const action = command.args.trim();
		if (action === "gc")
			await runtime.output(`${await collectRuntimeGarbage()}\n${formatRuntimeMemoryReport(sampleRuntimeMemoryReport())}`);
		else if (action.length === 0) await runtime.output(formatRuntimeMemoryReport(sampleRuntimeMemoryReport()));
		else await runtime.output("Usage: /runtime-memory [gc]");
	},
};
