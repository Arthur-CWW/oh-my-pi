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
		"Reclaim: /runtime-memory gc forces two full collections; /restart replaces this coordinator; /debug → Memory Report captures a heap snapshot.",
	].join("\n");
}
export async function collectRuntimeGarbage(): Promise<string> {
	const before = process.memoryUsage().rss;
	Bun.gc(true);
	await Bun.sleep(0);
	Bun.gc(true);
	await Bun.sleep(0);
	const after = process.memoryUsage().rss;
	return `Forced GC RSS: ${gibibytes(before)} → ${gibibytes(after)} (${gibibytes(Math.abs(after - before))} ${
		after <= before ? "reclaimed" : "higher"
	})`;
}

export const RUNTIME_MEMORY_COMMAND_SPEC: SlashCommandSpec = {
	name: "runtime-memory",
	description: "Explain or explicitly collect coordinator runtime memory",
	allowArgs: true,
	focusedViewSafe: true,
	subcommands: [{ name: "gc", description: "Force two full JSC collections and report RSS change" }],
	handle: async (command, runtime) => {
		const action = command.args.trim();
		if (action === "gc") await runtime.output(`${await collectRuntimeGarbage()}\n${buildRuntimeMemoryReport()}`);
		else if (action.length === 0) await runtime.output(buildRuntimeMemoryReport());
		else await runtime.output("Usage: /runtime-memory [gc]");
	},
};
