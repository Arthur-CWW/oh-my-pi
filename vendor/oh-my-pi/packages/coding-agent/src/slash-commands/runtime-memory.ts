import { heapStats } from "bun:jsc";
import type { SlashCommandSpec } from "./types";

const GIBIBYTE = 1024 ** 3;
const TOP_TYPE_LIMIT = 5;

function gibibytes(bytes: number): string {
	return `${(bytes / GIBIBYTE).toFixed(2)} GiB`;
}

export function buildRuntimeMemoryReport(): string {
	const usage = process.memoryUsage();
	const heap = heapStats();
	const topTypes = Object.entries(heap.objectTypeCounts)
		.sort((left, right) => right[1] - left[1])
		.slice(0, TOP_TYPE_LIMIT)
		.map(([name, count]) => `${name}=${count.toLocaleString("en-US")}`)
		.join(", ");
	return [
		`Coordinator RSS: ${gibibytes(usage.rss)}`,
		`JSC heap: ${gibibytes(heap.heapSize)} used / ${gibibytes(heap.heapCapacity)} capacity`,
		`JSC extra memory: ${gibibytes(heap.extraMemorySize)}`,
		`Node-compatible heap: ${gibibytes(usage.heapUsed)} used / ${gibibytes(usage.heapTotal)} committed`,
		`External / array buffers: ${gibibytes(usage.external)} / ${gibibytes(usage.arrayBuffers)}`,
		`Objects: ${heap.objectCount.toLocaleString("en-US")} (${heap.protectedObjectCount.toLocaleString("en-US")} protected)`,
		`Top object types: ${topTypes || "none"}`,
		"Reclaim: /restart checkpoints and replaces this coordinator; /debug → Memory Report captures a forced-GC heap snapshot.",
	].join("\n");
}

export const RUNTIME_MEMORY_COMMAND_SPEC: SlashCommandSpec = {
	name: "runtime-memory",
	description: "Explain coordinator RSS and JavaScriptCore heap retention",
	allowArgs: false,
	focusedViewSafe: true,
	handle: async (_command, runtime) => {
		await runtime.output(buildRuntimeMemoryReport());
	},
};
