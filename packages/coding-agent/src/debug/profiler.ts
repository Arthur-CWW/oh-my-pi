import { Session } from "node:inspector/promises";

/**
 * CPU and heap profiling wrappers for debug reports.
 */

export const DEFAULT_CPU_PROFILE_DURATION_MS = 30_000;
const CPU_PROFILE_SAMPLING_INTERVAL_US = 100;

export interface CpuProfile {
	data: string;
	markdown: string;
}

export interface ProfilerSession {
	/** Resolves when the maximum profiling duration elapses. */
	readonly expired: Promise<void>;
	/** Stop profiling and return the profile data. Repeated calls return the same promise. */
	stop(): Promise<CpuProfile>;
}

export interface CpuProfileOptions {
	/** Maximum profiling duration. Defaults to 30 seconds. */
	durationMs?: number;
}

/** V8 CPU Profile node structure */
interface CpuProfileNode {
	id: number;
	callFrame?: {
		functionName?: string;
		url?: string;
		lineNumber?: number;
	};
	hitCount?: number;
	children?: number[];
}

/** V8 CPU Profile structure */
interface CpuProfileData {
	nodes?: CpuProfileNode[];
	samples?: number[];
	timeDeltas?: number[];
	startTime?: number;
	endTime?: number;
}

/**
 * Format CPU profile data as markdown for LLM analysis.
 * Extracts top functions by self time and call counts.
 */
export function formatProfileAsMarkdown(profileJson: string): string {
	try {
		const profile = JSON.parse(profileJson) as CpuProfileData;
		const nodes = profile.nodes ?? [];

		interface NodeInfo {
			id: number;
			functionName: string;
			url: string;
			lineNumber: number;
			selfTime: number;
			hitCount: number;
		}

		const nodeMap = new Map<number, NodeInfo>();
		for (const node of nodes) {
			nodeMap.set(node.id, {
				id: node.id,
				functionName: node.callFrame?.functionName ?? "(anonymous)",
				url: node.callFrame?.url ?? "",
				lineNumber: node.callFrame?.lineNumber ?? 0,
				selfTime: 0,
				hitCount: node.hitCount ?? 0,
			});
		}

		// Distribute sample times to nodes
		const samples = profile.samples ?? [];
		const timeDeltas = profile.timeDeltas ?? [];
		for (let i = 0; i < samples.length; i++) {
			const nodeId = samples[i];
			const info = nodeId !== undefined ? nodeMap.get(nodeId) : undefined;
			const delta = timeDeltas[i] ?? 0;
			if (info) {
				info.selfTime += delta;
			}
		}

		// Percentages describe the complete profile, not only the displayed top 30.
		const significantNodes = Array.from(nodeMap.values()).filter(
			n => n.selfTime > 0 && n.functionName !== "(root)" && n.functionName !== "(idle)",
		);
		const totalTime = significantNodes.reduce((sum, n) => sum + n.selfTime, 0);
		const sorted = significantNodes.sort((a, b) => b.selfTime - a.selfTime).slice(0, 30);

		if (sorted.length === 0) {
			return "# CPU Profile Summary\n\nNo significant CPU activity recorded.";
		}

		const lines = ["# CPU Profile Summary", ""];
		lines.push(`Total profiled time: ${(totalTime / 1000).toFixed(1)}ms`);
		lines.push("");
		lines.push("## Top Functions by Self Time");
		lines.push("");
		lines.push("| Function | Self Time (ms) | % | Location |");
		lines.push("|----------|----------------|---|----------|");

		for (const node of sorted) {
			const selfMs = (node.selfTime / 1000).toFixed(1);
			const pct = ((node.selfTime / totalTime) * 100).toFixed(1);
			const location = node.url ? `${node.url}:${node.lineNumber}` : "-";
			lines.push(`| ${node.functionName} | ${selfMs} | ${pct}% | ${location} |`);
		}

		return lines.join("\n");
	} catch {
		return "# CPU Profile Summary\n\nFailed to parse profile data.";
	}
}

/**
 * Start CPU profiling.
 * Returns a session that can be stopped to get the profile data.
 */
export async function startCpuProfile(options?: CpuProfileOptions): Promise<ProfilerSession> {
	const durationMs = options?.durationMs ?? DEFAULT_CPU_PROFILE_DURATION_MS;
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new RangeError("CPU profile duration must be a positive finite number");
	}

	const session = new Session();
	session.connect();

	try {
		await session.post("Profiler.enable");
		// A 100µs interval avoids attributing sparse await-resumption samples to
		// async wait time. The 30s default cap bounds a session to roughly 300,000
		// samples at this interval.
		await session.post("Profiler.setSamplingInterval", { interval: CPU_PROFILE_SAMPLING_INTERVAL_US });
		await session.post("Profiler.start");
	} catch (error) {
		try {
			await session.post("Profiler.disable");
		} catch {
			// Preserve the profiler startup failure after best-effort cleanup.
		}
		try {
			session.disconnect();
		} catch {
			// Preserve the profiler startup failure after best-effort cleanup.
		}
		throw error;
	}

	const expiration = Promise.withResolvers<void>();
	let stopPromise: Promise<CpuProfile> | undefined;
	let timer: NodeJS.Timeout;

	const stop = (): Promise<CpuProfile> => {
		if (stopPromise) return stopPromise;
		clearTimeout(timer);

		stopPromise = (async () => {
			let profile: CpuProfileData | undefined;
			let stopError: unknown;
			try {
				const result = await session.post("Profiler.stop");
				profile = result.profile as CpuProfileData;
			} catch (error) {
				stopError = error;
			}

			let cleanupError: unknown;
			try {
				await session.post("Profiler.disable");
			} catch (error) {
				cleanupError = error;
			}
			try {
				session.disconnect();
			} catch (error) {
				cleanupError ??= error;
			}

			if (stopError !== undefined) throw stopError;
			if (cleanupError !== undefined) throw cleanupError;

			if (!profile) throw new Error("CPU profiler stopped without returning profile data");
			const data = JSON.stringify(profile, null, 2);
			const markdown = formatProfileAsMarkdown(data);
			return { data, markdown };
		})();

		return stopPromise;
	};

	timer = setTimeout(() => {
		expiration.resolve();
		void stop().catch(() => {
			// The same failure remains observable to callers awaiting stop().
		});
	}, durationMs);
	timer.unref?.();

	return { expired: expiration.promise, stop };
}

export interface HeapSnapshot {
	data: ArrayBuffer;
}

/**
 * Generate a V8 heap snapshot as an ArrayBuffer.
 *
 * Uses the `"arraybuffer"` return overload so the snapshot never
 * materialises as a JS string in the coordinator heap.
 */
export function generateHeapSnapshotData(): HeapSnapshot {
	// Force GC before snapshot
	Bun.gc(true);

	// Use V8 format for Chrome DevTools compatibility; arraybuffer overload
	// avoids creating a retained JS string (~100 MB+ for large heaps).
	const data = Bun.generateHeapSnapshot("v8", "arraybuffer") as ArrayBuffer;

	return { data };
}
