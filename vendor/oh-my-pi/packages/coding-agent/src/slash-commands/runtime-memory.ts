import { heapStats } from "bun:jsc";
import type { SlashCommandSpec } from "./types";

const GIBIBYTE = 1024 ** 3;
const TOP_TYPE_LIMIT = 5;

export type RuntimeMemorySnapshot = {
	coordinatorRss: number;
	jscHeapSize: number;
	jscHeapCapacity: number;
	jscExtraMemory: number;
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
	return {
		coordinatorRss: usage.rss,
		jscHeapSize: heap.heapSize,
		jscHeapCapacity: heap.heapCapacity,
		jscExtraMemory: heap.extraMemorySize,
	};
}

export function classifyRuntimeMemoryChange(
	before: RuntimeMemorySnapshot,
	after: RuntimeMemorySnapshot,
): RuntimeMemoryChange {
	const rssDelta = after.coordinatorRss - before.coordinatorRss;
	const heapSizeDelta = after.jscHeapSize - before.jscHeapSize;
	const heapCapacityDelta = after.jscHeapCapacity - before.jscHeapCapacity;
	const extraMemoryDelta = after.jscExtraMemory - before.jscExtraMemory;
	if (rssDelta < 0 || heapSizeDelta < 0 || heapCapacityDelta < 0 || extraMemoryDelta < 0) {
		return "reclaimed";
	}
	if (rssDelta === 0 && heapSizeDelta === 0 && heapCapacityDelta === 0 && extraMemoryDelta === 0) {
		return "unchanged";
	}
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
		`Measured change: ${classifyRuntimeMemoryChange(before, after)}`,
		"Native RSS release is not guaranteed by this measurement.",
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

export function buildRuntimeMemoryReport(): string {
	const usage = process.memoryUsage();
	const heap = heapStats();
	return [
		`Coordinator RSS: ${gibibytes(usage.rss)}`,
		`JSC heap: ${gibibytes(heap.heapSize)} used / ${gibibytes(heap.heapCapacity)} capacity`,
		`JSC extra memory: ${gibibytes(heap.extraMemorySize)}`,
		`Node-compatible heap: ${gibibytes(usage.heapUsed)} used / ${gibibytes(usage.heapTotal)} committed`,
		`External / array buffers: ${gibibytes(usage.external)} / ${gibibytes(usage.arrayBuffers)}`,
		`Objects: ${heap.objectCount.toLocaleString("en-US")} (${heap.protectedObjectCount.toLocaleString("en-US")} protected)`,
		`Top object types: ${formatTopObjectTypes(heap.objectTypeCounts)}`,
		"Reclaim: /runtime-memory gc forces two full collections; /restart replaces this coordinator; /debug → Memory Report captures a heap snapshot.",
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
		if (action === "gc") await runtime.output(`${await collectRuntimeGarbage()}\n${buildRuntimeMemoryReport()}`);
		else if (action.length === 0) await runtime.output(buildRuntimeMemoryReport());
		else await runtime.output("Usage: /runtime-memory [gc]");
	},
};
