import * as os from "node:os";
import { matchesProcessIdentity, type ProcessIdentity } from "./process-identity";

const GIB = 1_073_741_824;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1_048_576;
const DEFAULT_MAX_PROCESSES = 100_000;
const DEFAULT_TIMEOUT_MS = 2_000;
const PS_COMMAND = Object.freeze(["/bin/ps", "-axo", "pid=,ppid=,rss="] as const);

export const DEFAULT_ATTEMPT_RESERVATION_BYTES = Math.floor(1.5 * GIB);

/** Default host pool budget: sixty percent of RAM, capped at 52 GiB. */
export function defaultHostMemoryBudgetBytes(totalBytes = os.totalmem()): number {
	const boundedTotal = Number.isSafeInteger(totalBytes) && totalBytes > 0 ? totalBytes : 52 * GIB;
	return Math.min(52 * GIB, Math.floor(boundedTotal * 0.6));
}

export interface LeaseProcessTarget {
	readonly leaseId: string;
	readonly holderProcess: ProcessIdentity;
	readonly childProcess?: ProcessIdentity;
}

export interface LeaseProcessTreeSample {
	readonly sampledAtMs: number;
	readonly observedBytesByLease: ReadonlyMap<string, number>;
	readonly aggregateObservedBytes: number;
	readonly processCount: number;
}

export interface HostResourceSamplerOptions {
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly maxProcesses?: number;
}

interface ProcessRow {
	readonly pid: number;
	readonly ppid: number;
	readonly rssBytes: number;
}

export class HostResourceSamplerError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "HostResourceSamplerError";
	}
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

async function readBounded(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
	onOverflow: () => void,
): Promise<Uint8Array> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const next = await reader.read();
			if (next.done) break;
			total += next.value.byteLength;
			if (total > maxBytes) {
				onOverflow();
				throw new HostResourceSamplerError(`/bin/ps output exceeded ${maxBytes} bytes`);
			}
			chunks.push(next.value);
		}
	} finally {
		reader.releaseLock();
	}
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function parsePsRows(output: Uint8Array, maxProcesses: number): readonly ProcessRow[] {
	const text = new TextDecoder().decode(output);
	const rows: ProcessRow[] = [];
	const seen = new Set<number>();
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (!line.trim()) continue;
		const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
		if (!match) throw new HostResourceSamplerError(`Malformed /bin/ps row ${index + 1}`);
		const pid = Number(match[1]);
		const ppid = Number(match[2]);
		const rssKb = Number(match[3]);
		if (
			!Number.isSafeInteger(pid) ||
			pid <= 0 ||
			!Number.isSafeInteger(ppid) ||
			ppid < 0 ||
			!Number.isSafeInteger(rssKb) ||
			rssKb < 0 ||
			seen.has(pid)
		) {
			throw new HostResourceSamplerError(`Invalid /bin/ps row ${index + 1}`);
		}
		seen.add(pid);
		rows.push({ pid, ppid, rssBytes: rssKb * 1_024 });
		if (rows.length > maxProcesses) {
			throw new HostResourceSamplerError(`/bin/ps returned more than ${maxProcesses} processes`);
		}
	}
	return rows;
}

async function readProcessRows(options: HostResourceSamplerOptions): Promise<readonly ProcessRow[]> {
	const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
	const maxOutputBytes = positiveInteger(options.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES);
	const maxProcesses = positiveInteger(options.maxProcesses, DEFAULT_MAX_PROCESSES);
	const child = Bun.spawn({ cmd: [...PS_COMMAND], stdout: "pipe", stderr: "pipe" });
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill("SIGKILL");
	}, timeoutMs);
	timer.unref?.();
	const killOnOverflow = () => child.kill("SIGKILL");
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			readBounded(child.stdout, maxOutputBytes, killOnOverflow),
			readBounded(child.stderr, 64 * 1_024, killOnOverflow),
			child.exited,
		]);
		if (timedOut) throw new HostResourceSamplerError(`/bin/ps exceeded ${timeoutMs}ms`);
		if (exitCode !== 0) {
			const diagnostics = new TextDecoder().decode(stderr).trim();
			throw new HostResourceSamplerError(`/bin/ps exited ${exitCode}: ${diagnostics || "no diagnostics"}`);
		}
		return parsePsRows(stdout, maxProcesses);
	} catch (error) {
		if (error instanceof HostResourceSamplerError) throw error;
		throw new HostResourceSamplerError("Unable to sample host process RSS", { cause: error });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Samples all lease-holder process trees from one bounded full-host ps snapshot.
 * PIDs are attributed to the nearest lease root and counted once globally.
 */
export async function sampleLeaseProcessTrees(
	targets: readonly LeaseProcessTarget[],
	options: HostResourceSamplerOptions = {},
): Promise<LeaseProcessTreeSample> {
	const sampledAtMs = Date.now();
	if (targets.length === 0) {
		return { sampledAtMs, observedBytesByLease: new Map(), aggregateObservedBytes: 0, processCount: 0 };
	}

	const roots = new Map<number, { identity: ProcessIdentity; leaseIds: string[] }>();
	for (const target of targets) {
		const identity = target.childProcess ?? target.holderProcess;
		const existing = roots.get(identity.pid);
		if (existing) existing.leaseIds.push(target.leaseId);
		else roots.set(identity.pid, { identity, leaseIds: [target.leaseId] });
	}
	for (const [pid, root] of roots) {
		if (!matchesProcessIdentity(root.identity)) roots.delete(pid);
	}

	const rows = await readProcessRows(options);
	const byPid = new Map(rows.map(row => [row.pid, row] as const));
	const rootPids = new Set([...roots.keys()].filter(pid => byPid.has(pid)));
	const ownerCache = new Map<number, number | null>();
	const nearestRoot = (pid: number): number | null => {
		if (ownerCache.has(pid)) return ownerCache.get(pid)!;
		const trail: number[] = [];
		const seen = new Set<number>();
		let cursor: number | undefined = pid;
		let owner: number | null = null;
		while (cursor !== undefined && !seen.has(cursor)) {
			if (ownerCache.has(cursor)) {
				owner = ownerCache.get(cursor)!;
				break;
			}
			if (rootPids.has(cursor)) {
				owner = cursor;
				break;
			}
			seen.add(cursor);
			trail.push(cursor);
			cursor = byPid.get(cursor)?.ppid;
		}
		for (const visited of trail) ownerCache.set(visited, owner);
		ownerCache.set(pid, owner);
		return owner;
	};

	const bytesByRoot = new Map<number, number>();
	let aggregateObservedBytes = 0;
	let processCount = 0;
	for (const row of rows) {
		const owner = nearestRoot(row.pid);
		if (owner === null) continue;
		bytesByRoot.set(owner, (bytesByRoot.get(owner) ?? 0) + row.rssBytes);
		aggregateObservedBytes += row.rssBytes;
		processCount += 1;
	}

	const observedBytesByLease = new Map<string, number>();
	for (const [pid, root] of roots) {
		root.leaseIds.sort();
		const total = bytesByRoot.get(pid) ?? 0;
		const quotient = Math.floor(total / root.leaseIds.length);
		let remainder = total - quotient * root.leaseIds.length;
		for (const leaseId of root.leaseIds) {
			observedBytesByLease.set(leaseId, quotient + (remainder > 0 ? 1 : 0));
			if (remainder > 0) remainder -= 1;
		}
	}
	return { sampledAtMs, observedBytesByLease, aggregateObservedBytes, processCount };
}
