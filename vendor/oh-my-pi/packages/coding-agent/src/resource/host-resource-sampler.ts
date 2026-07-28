import { Effect, Result } from "effect";
import { currentBootId, type ProcessIdentity } from "./process-identity";
import { bunPsSnapshotSource, type PsSnapshotRow, type PsSnapshotSource } from "./ps-command";

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
	readonly rootCount: number;
}

export interface HostResourceSamplerOptions {
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly maxProcesses?: number;
	readonly coordinatorRoots?: readonly ProcessIdentity[];
	/**
	 * Decoded-row seam. Everything downstream is pure attribution arithmetic, so
	 * tests drive PID-reuse and identity-mismatch cases through this instead of
	 * racing the real process table.
	 */
	readonly snapshotSource?: PsSnapshotSource;
	/**
	 * Host-identity seam, mirroring `hostResourceProbe` on the admission options.
	 * An empty string models a platform that cannot prove a boot identity, which
	 * rejects every root rather than trusting a bare start time.
	 */
	readonly hostBootId?: string;
}

/** One lease or coordinator process-tree root, interned by its full identity triple. */
interface SamplerRoot {
	readonly identity: ProcessIdentity;
	readonly leaseIds: string[];
	observedBytes: number;
}

/** Shared by every path that proves no root, so those paths allocate nothing. */
const NO_LEASE_BYTES: ReadonlyMap<string, number> = new Map();

function unobservedSample(sampledAtMs: number): LeaseProcessTreeSample {
	return {
		sampledAtMs,
		observedBytesByLease: NO_LEASE_BYTES,
		aggregateObservedBytes: 0,
		processCount: 0,
		rootCount: 0,
	};
}

/**
 * Samples all lease-holder process trees from one bounded full-host ps snapshot.
 * PIDs are attributed to the nearest lease root and counted once globally.
 *
 * A root is its whole `(bootId, pid, startFingerprint)` identity, never the PID
 * alone. Two leases — or a lease and a coordinator — can name one PID with
 * different fingerprints, and folding them together on the shared PID either
 * credits a dead identity with a live tree or erases the live one. Roots are
 * therefore interned by the full triple: identities differing in any component
 * stay separate records and can never merge or overwrite each other, and the
 * result no longer depends on which target was seen first.
 *
 * Each root is then proven against the *same snapshot* that supplies its bytes,
 * matched on its own identity: a PID recycled between recording the lease and
 * reading the table carries a different start fingerprint, so that root is
 * dropped. Proof also requires the host boot identity, and an unprovable boot
 * identity rejects every root — a start time that survives a reboot is not
 * proof of the same process.
 *
 * Dropping is the conservative direction: an unproven root contributes zero
 * observed bytes and its lease keeps charging the declared reservation until a
 * later snapshot proves a live tree.
 */
export async function sampleLeaseProcessTrees(
	targets: readonly LeaseProcessTarget[],
	options: HostResourceSamplerOptions = {},
): Promise<LeaseProcessTreeSample> {
	const sampledAtMs = Date.now();
	const coordinatorRoots = options.coordinatorRoots ?? [];
	if (targets.length === 0 && coordinatorRoots.length === 0) return unobservedSample(sampledAtMs);

	// Boot identity gates every root, so an unprovable one short-circuits before
	// paying for a host-wide ps snapshot whose rows could not prove anything.
	const bootId = options.hostBootId ?? currentBootId();
	if (!bootId) return unobservedSample(sampledAtMs);

	// Bucketing by PID keeps the triple comparison allocation-free: the PID picks
	// the bucket, the other two components are compared field-wise inside it.
	const rootsByPid = new Map<number, SamplerRoot[]>();
	const internRoot = (identity: ProcessIdentity): SamplerRoot => {
		const bucket = rootsByPid.get(identity.pid);
		if (bucket === undefined) {
			const root: SamplerRoot = { identity, leaseIds: [], observedBytes: 0 };
			rootsByPid.set(identity.pid, [root]);
			return root;
		}
		for (const root of bucket) {
			if (root.identity.bootId === identity.bootId && root.identity.startFingerprint === identity.startFingerprint) {
				return root;
			}
		}
		const root: SamplerRoot = { identity, leaseIds: [], observedBytes: 0 };
		bucket.push(root);
		return root;
	};
	for (const identity of coordinatorRoots) internRoot(identity);
	for (const target of targets) internRoot(target.childProcess ?? target.holderProcess).leaseIds.push(target.leaseId);

	const source = options.snapshotSource ?? bunPsSnapshotSource;
	const outcome = await Effect.runPromise(
		Effect.result(
			source({
				timeoutMs: options.timeoutMs,
				maxOutputBytes: options.maxOutputBytes,
				maxProcesses: options.maxProcesses,
			}),
		),
	);
	if (Result.isFailure(outcome)) throw outcome.failure;
	const rows: readonly PsSnapshotRow[] = outcome.success;

	const byPid = new Map<number, PsSnapshotRow>();
	for (const row of rows) byPid.set(row.pid, row);

	const provenByPid = new Map<number, SamplerRoot>();
	for (const [pid, bucket] of rootsByPid) {
		const row = byPid.get(pid);
		if (row === undefined) continue;
		for (const root of bucket) {
			if (root.identity.startFingerprint !== row.startFingerprint || root.identity.bootId !== bootId) continue;
			// The row pins one start fingerprint and the host pins one boot id, so at
			// most one interned identity per PID clears both: proving a root here can
			// never displace a different one.
			provenByPid.set(pid, root);
			break;
		}
	}
	if (provenByPid.size === 0) return unobservedSample(sampledAtMs);

	// Reused across the whole walk: one row per PID means these are scratch space,
	// not state, and re-allocating them per row costs two objects per host process.
	const trail: number[] = [];
	const seen = new Set<number>();
	const ownerCache = new Map<number, SamplerRoot | null>();
	const nearestRoot = (pid: number): SamplerRoot | null => {
		const cached = ownerCache.get(pid);
		if (cached !== undefined) return cached;
		trail.length = 0;
		seen.clear();
		let cursor: number | undefined = pid;
		let owner: SamplerRoot | null = null;
		while (cursor !== undefined && !seen.has(cursor)) {
			const memo = ownerCache.get(cursor);
			if (memo !== undefined) {
				owner = memo;
				break;
			}
			const root = provenByPid.get(cursor);
			if (root !== undefined) {
				owner = root;
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

	let aggregateObservedBytes = 0;
	let processCount = 0;
	for (const row of rows) {
		const owner = nearestRoot(row.pid);
		if (owner === null) continue;
		owner.observedBytes += row.rssBytes;
		aggregateObservedBytes += row.rssBytes;
		processCount += 1;
	}

	const observedBytesByLease = new Map<string, number>();
	for (const root of provenByPid.values()) {
		if (root.leaseIds.length === 0) continue;
		root.leaseIds.sort();
		const quotient = Math.floor(root.observedBytes / root.leaseIds.length);
		let remainder = root.observedBytes - quotient * root.leaseIds.length;
		for (const leaseId of root.leaseIds) {
			const share = quotient + (remainder > 0 ? 1 : 0);
			if (remainder > 0) remainder -= 1;
			// Accumulate rather than assign: a lease named by two proven roots owns
			// both trees, and overwriting would silently under-report it.
			observedBytesByLease.set(leaseId, (observedBytesByLease.get(leaseId) ?? 0) + share);
		}
	}
	return { sampledAtMs, observedBytesByLease, aggregateObservedBytes, processCount, rootCount: provenByPid.size };
}
