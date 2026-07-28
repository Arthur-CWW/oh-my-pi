/**
 * Process-global owner of the host lease handbacks an authority has not
 * finished.
 *
 * A refused release is not a finished one. The durable row stays granted to
 * this live process, and expiry reaping deliberately refuses to reclaim a slot
 * whose holder is provably alive, so the only way that slot ever comes back is
 * this process offering it again. Something therefore has to keep offering, and
 * it cannot be a lifecycle manager: managers are replaced while releases
 * started under them are still in flight, and the authority that granted a
 * lease can close while the row it granted is still owed.
 *
 * This service owns that retry instead, on three rules:
 *
 * - **Ownership starts when a release starts.** The record is written before
 *   the first statement runs, so a manager that disappears mid-flight — or a
 *   cleanup that only completes after it was discarded — can never hold the
 *   last reference to a live row.
 * - **Records are durable identities, not handles.** The key is the authority
 *   database plus lease id and fence token, so a handle whose authority has
 *   closed is replaceable: the retry rebinds to an authority opened on the same
 *   database and hands the row back through it.
 * - **Waiting happens on the schedule, never on the thread.** The authority's
 *   write lock is contended exactly when a release is refused; waiting it out
 *   costs the whole busy budget on the thread that runs every timer in this
 *   process. Attempts fail fast and the bounded backoff below is what waits.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";
import {
	HostAdmissionCorruptError,
	HostAdmissionFencedError,
	HostResourceAdmission,
	type HostResourceLease,
} from "./host-resource-admission";

/**
 * What one caller's handback work actually achieved. `released` counts durable
 * rows this work removed — the only honest measure of relief, because a park
 * whose release the authority refused frees nothing. `pending` is what it left
 * owed; the service retries those on its own schedule. Corruption is handed
 * back because nothing downstream repairs it.
 */
export interface LeaseReleaseTally {
	readonly corruption: HostAdmissionCorruptError[];
	released: number;
	pending: number;
}

export function leaseReleaseTally(): LeaseReleaseTally {
	return { corruption: [], released: 0, pending: 0 };
}

/**
 * Pause before each successive attempt on one row. The last entry repeats:
 * retrying is not optional, because a row this process holds can only be handed
 * back by this process, so what is bounded is the interval rather than the
 * number of attempts. Timers are unref'd — an owed row must never be the reason
 * a process refuses to exit.
 */
const RETRY_DELAYS_MS = [25, 50, 100, 250, 500, 1_000, 2_500, 5_000] as const;

/** Attempts before the retry stops being a transient and starts being reported. */
const RETRY_WARN_AFTER_ATTEMPTS = 8;

interface PendingRelease {
	readonly dbPath: string;
	readonly leaseId: string;
	readonly fenceToken: number;
	/** Agent the row was granted for: scopes an agent's own cleanup, and names the row in logs. */
	agentId: string;
	/** The granting handle, while it can still speak for the row. */
	lease: HostResourceLease | undefined;
	attempts: number;
	timer: NodeJS.Timeout | undefined;
}

function recordKey(dbPath: string, leaseId: string, fenceToken: number): string {
	return `${dbPath}\u0000${leaseId}\u0000${fenceToken}`;
}

export class PendingHostLeaseReleases {
	static #global: PendingHostLeaseReleases | undefined;

	static global(): PendingHostLeaseReleases {
		PendingHostLeaseReleases.#global ??= new PendingHostLeaseReleases();
		return PendingHostLeaseReleases.#global;
	}

	/** Cancel scheduled retries and forget what is owed. Test-only. */
	static resetForTests(): void {
		const current = PendingHostLeaseReleases.#global;
		PendingHostLeaseReleases.#global = undefined;
		if (current) current.#abandon();
	}

	readonly #records = new Map<string, PendingRelease>();
	readonly #settledWaiters = new Set<() => void>();

	/**
	 * Take ownership of this row and offer it back once, without waiting. The
	 * record exists before the attempt runs on purpose: a caller that dies, is
	 * replaced, or is reset between the attempt and its outcome must not be able
	 * to take the row with it.
	 */
	handBack(
		agentId: string,
		lease: HostResourceLease,
		tally: LeaseReleaseTally = leaseReleaseTally(),
	): LeaseReleaseTally {
		const dbPath = path.resolve(lease.dbPath);
		const key = recordKey(dbPath, lease.leaseId, lease.fenceToken);
		const existing = this.#records.get(key);
		const record: PendingRelease = existing ?? {
			dbPath,
			leaseId: lease.leaseId,
			fenceToken: lease.fenceToken,
			agentId,
			lease,
			attempts: 0,
			timer: undefined,
		};
		if (existing) {
			existing.agentId = agentId;
			existing.lease ??= lease;
		} else this.#records.set(key, record);
		this.#attempt(record, tally);
		return tally;
	}

	/**
	 * Offer every owed row back now, ahead of its scheduled retry. Scoped to one
	 * agent on its own cleanup paths; unscoped where a caller is about to need
	 * host capacity and cannot tell which child is holding it.
	 */
	sweep(agentId?: string, tally: LeaseReleaseTally = leaseReleaseTally()): LeaseReleaseTally {
		// Snapshot: a terminal attempt deletes from the map being walked.
		for (const record of [...this.#records.values()]) {
			if (agentId !== undefined && record.agentId !== agentId) continue;
			this.#attempt(record, tally);
		}
		return tally;
	}

	/** Durable rows this process still owes back, in total or for one agent. */
	owed(agentId?: string): number {
		if (agentId === undefined) return this.#records.size;
		let count = 0;
		for (const record of this.#records.values()) if (record.agentId === agentId) count++;
		return count;
	}

	/**
	 * Resolves once nothing is owed. The retry schedule is what makes progress;
	 * this only observes it, so a shutdown path — or a caller that must see the
	 * slot come back — does not reimplement the backoff.
	 */
	whenSettled(): Promise<void> {
		if (this.#records.size === 0) return Promise.resolve();
		return new Promise<void>(resolve => {
			this.#settledWaiters.add(resolve);
		});
	}

	/**
	 * One attempt at one row. Terminal outcomes forget the record; anything else
	 * reschedules it, so every row has exactly one live retry owner and never
	 * two timers racing over the same statement.
	 */
	#attempt(record: PendingRelease, tally: LeaseReleaseTally): void {
		clearTimeout(record.timer);
		record.timer = undefined;
		record.attempts++;
		let outcome: "released" | "contended";
		try {
			outcome = this.#offer(record);
		} catch (error) {
			if (error instanceof HostAdmissionCorruptError) {
				// Damage that never heals: retrying it forever would spin against a
				// broken database and hide the failure that matters.
				this.#forget(record);
				tally.corruption.push(error);
				return;
			}
			if (error instanceof HostAdmissionFencedError) {
				// A newer fence owns the row. It was never this handle's to return.
				logger.warn("PendingHostLeaseReleases: lease was fenced before it could be returned", {
					agentId: record.agentId,
					leaseId: record.leaseId,
				});
				this.#forget(record);
				return;
			}
			logger.warn("PendingHostLeaseReleases: host lease release failed", {
				agentId: record.agentId,
				leaseId: record.leaseId,
				error: String(error),
			});
			outcome = "contended";
		}
		if (outcome === "released") {
			this.#forget(record);
			tally.released++;
			return;
		}
		tally.pending++;
		this.#schedule(record);
	}

	/**
	 * Offer the row back through whatever can still speak for it. The granting
	 * handle is preferred while its authority is open — it is the only thing
	 * that can also mark itself finished — and a handle whose authority closed
	 * is replaced rather than trusted: its `release` would report success while
	 * the durable row it named stayed granted to this live process.
	 */
	#offer(record: PendingRelease): "released" | "contended" {
		if (record.lease) {
			const outcome = record.lease.tryRelease();
			if (outcome !== "unbound") return outcome;
			record.lease = undefined;
		}
		// The database is the row. If it is gone, so is everything it granted.
		if (!fs.existsSync(record.dbPath)) return "released";
		const live = HostResourceAdmission.openFor(record.dbPath);
		if (live) return live.tryReleaseLease(record.leaseId, record.fenceToken);
		return this.#offerThroughReopenedAuthority(record);
	}

	/**
	 * Nothing in this process speaks for that database any more, so open an
	 * authority just long enough to hand the row back and dispose of it again.
	 * Its busy budget is zero: a contended writer must cost this attempt, not
	 * the event loop, and the schedule already owns the waiting.
	 *
	 * It is also a stranger to the pool it is finishing. None of the budgets
	 * that sized this database reach it, so it returns the row through the
	 * handback path that writes the row and its receipt and leaves the shared
	 * pressure decision to the authority that can actually price it.
	 */
	#offerThroughReopenedAuthority(record: PendingRelease): "released" | "contended" {
		let reopened: HostResourceAdmission | undefined;
		try {
			reopened = new HostResourceAdmission({
				dbPath: record.dbPath,
				busyTimeoutMs: 0,
				// Nothing here samples or admits; this authority exists for one statement.
				sampleIntervalMs: 60_000,
				coordinatorRoots: () => [],
			});
			return reopened.tryReleaseForeignLease(record.leaseId, record.fenceToken);
		} catch (error) {
			if (error instanceof HostAdmissionCorruptError || error instanceof HostAdmissionFencedError) throw error;
			// Opening lost the same race the release would have: retry, do not
			// strand. A construction that failed already returned its own
			// connection, so repeating this costs a scheduled attempt and nothing
			// else.
			return "contended";
		} finally {
			try {
				reopened?.close();
			} catch (error) {
				logger.warn("PendingHostLeaseReleases: reopened authority failed to close", {
					dbPath: record.dbPath,
					error: String(error),
				});
			}
		}
	}

	#schedule(record: PendingRelease): void {
		const delay = RETRY_DELAYS_MS[Math.min(record.attempts, RETRY_DELAYS_MS.length) - 1] ?? 0;
		if (record.attempts === RETRY_WARN_AFTER_ATTEMPTS) {
			logger.warn("PendingHostLeaseReleases: host authority keeps refusing a lease this process owns", {
				agentId: record.agentId,
				leaseId: record.leaseId,
				attempts: record.attempts,
			});
		}
		const timer = setTimeout(() => {
			record.timer = undefined;
			const tally = leaseReleaseTally();
			this.#attempt(record, tally);
			for (const corruption of tally.corruption) {
				// A scheduled retry has no caller to raise to. The log is the only
				// place a damaged host database found here is ever visible.
				logger.error("PendingHostLeaseReleases: host resource authority is corrupt", {
					agentId: record.agentId,
					leaseId: record.leaseId,
					error: String(corruption),
				});
			}
		}, delay);
		timer.unref?.();
		record.timer = timer;
	}

	#forget(record: PendingRelease): void {
		clearTimeout(record.timer);
		record.timer = undefined;
		record.lease = undefined;
		this.#records.delete(recordKey(record.dbPath, record.leaseId, record.fenceToken));
		this.#notifyIfSettled();
	}

	#abandon(): void {
		for (const record of this.#records.values()) {
			clearTimeout(record.timer);
			record.timer = undefined;
		}
		this.#records.clear();
		this.#notifyIfSettled();
	}

	#notifyIfSettled(): void {
		if (this.#records.size > 0) return;
		for (const resolve of this.#settledWaiters) resolve();
		this.#settledWaiters.clear();
	}
}
