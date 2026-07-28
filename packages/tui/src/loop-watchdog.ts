import { performance } from "node:perf_hooks";
import { logger, takeRecentLoopPhase } from "@oh-my-pi/pi-utils";

/**
 * Timer handle the watchdog arms. `cancel`, when present, is invoked on
 * stop() so a stopped watchdog leaves no armed timer to wake the loop even once.
 */
interface LoopWatchdogTimer {
	unref?(): void;
	cancel?(): void;
}

export interface LoopWatchdogViolation {
	readonly timestamp: number;
	readonly blockedMs: number;
	readonly phase: string;
	readonly pid: number;
	readonly attribution?: string;
}

export interface LoopWatchdogCounters {
	readonly totalViolations: number;
	readonly maxBlockedMs: number;
}

export interface LoopWatchdogSnapshot extends LoopWatchdogCounters {
	readonly violations: readonly LoopWatchdogViolation[];
}

export interface LoopWatchdogOptions {
	/** How far ahead each probe tick is scheduled, in ms. Default 250. */
	intervalMs?: number;
	/** A tick later than this past its deadline counts as a block. Default 250. */
	thresholdMs?: number;
	/** Monotonic clock source; injectable for tests. Default `performance.now`. */
	now?: () => number;
	/** Epoch timestamp source for violation records; injectable for tests. Default `Date.now`. */
	timestamp?: () => number;
	/** Timer source; injectable for tests. Default `setTimeout`. */
	schedule?: (cb: () => void, ms: number) => LoopWatchdogTimer;
	/** Maximum number of violation records retained in the ring. Default 64. */
	maxViolations?: number;
	/** Optional host-defined label attached to new violation records. */
	attribution?: string;
}

/**
 * Always-on event-loop lag probe. Each tick is scheduled `intervalMs` ahead of
 * a recorded deadline; a tick that fires `thresholdMs` past its deadline means
 * the loop was blocked that long. The overshoot is logged once on the rising
 * edge (one block ⇒ one line, deduped via `#wasBlocked`), tagged with the phase
 * active during the elapsed interval via {@link takeRecentLoopPhase} — which
 * survives the synchronous push/pop the instrumented hot paths do before this
 * delayed tick can run — so the stall names its cause instead of "unknown".
 *
 * The handle is `unref`'d so the probe never keeps the process alive, and stop()
 * cancels the armed timer when the handle exposes `cancel` (the default
 * `setTimeout` handle does, via `clearTimeout`). The `#generation` guard remains
 * as a fallback for injected handles that cannot cancel.
 */
export class LoopWatchdog {
	#intervalMs: number;
	#thresholdMs: number;
	#now: () => number;
	#timestamp: () => number;
	#schedule: (cb: () => void, ms: number) => LoopWatchdogTimer;
	#maxViolations: number;
	#attribution: string | undefined;
	#violations: LoopWatchdogViolation[] = [];
	#totalViolations = 0;
	#maxBlockedMs = 0;
	#expected = 0;
	#wasBlocked = false;
	#running = false;
	// Bumped by stop(); each scheduled tick captures the generation it was armed
	// under and no-ops if it no longer matches, so a start()→stop()→start() cycle
	// cannot leave the pre-stop timer chain rescheduling itself in parallel.
	#generation = 0;
	#handle: LoopWatchdogTimer | undefined;

	constructor(options: LoopWatchdogOptions = {}) {
		this.#intervalMs = options.intervalMs ?? 250;
		this.#thresholdMs = options.thresholdMs ?? 250;
		this.#now = options.now ?? (() => performance.now());
		this.#timestamp = options.timestamp ?? (() => Date.now());
		const maxViolations = options.maxViolations ?? 64;
		this.#maxViolations = Number.isFinite(maxViolations) ? Math.max(1, Math.floor(maxViolations)) : 64;
		this.#attribution = options.attribution;
		this.#schedule =
			options.schedule ??
			((cb, ms) => {
				const timer = setTimeout(cb, ms);
				return { unref: () => timer.unref?.(), cancel: () => clearTimeout(timer) };
			});
	}

	/** Number of rising-edge violations observed since construction. */
	get totalViolations(): number {
		return this.#totalViolations;
	}

	/** Largest rounded blocked duration observed since construction. */
	get maxBlockedMs(): number {
		return this.#maxBlockedMs;
	}

	/** A frozen copy of the retained violation ring, oldest record first. */
	get violations(): readonly LoopWatchdogViolation[] {
		return Object.freeze(this.#violations.slice());
	}

	/** Returns frozen counters and a frozen copy of the retained violation ring. */
	getSnapshot(): LoopWatchdogSnapshot {
		return Object.freeze({
			totalViolations: this.#totalViolations,
			maxBlockedMs: this.#maxBlockedMs,
			violations: this.violations,
		});
	}

	/** Sets the host-defined label attached to subsequently recorded violations. */
	setAttribution(attribution?: string): void {
		this.#attribution = attribution;
	}

	/** Returns the current host-defined violation attribution label. */
	getAttribution(): string | undefined {
		return this.#attribution;
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		this.#wasBlocked = false;
		this.#armTick();
	}

	stop(): void {
		this.#running = false;
		this.#wasBlocked = false;
		this.#generation++;
		this.#handle?.cancel?.();
		this.#handle = undefined;
	}

	#armTick(): void {
		const generation = this.#generation;
		this.#expected = this.#now() + this.#intervalMs;
		this.#handle = this.#schedule(() => this.#tick(generation), this.#intervalMs);
		this.#handle.unref?.();
	}

	#recordViolation(blockedMs: number, phase: string): void {
		this.#totalViolations++;
		this.#maxBlockedMs = Math.max(this.#maxBlockedMs, blockedMs);
		const record: LoopWatchdogViolation = Object.freeze({
			timestamp: this.#timestamp(),
			blockedMs,
			phase,
			pid: process.pid,
			...(this.#attribution === undefined ? {} : { attribution: this.#attribution }),
		});
		this.#violations.push(record);
		if (this.#violations.length > this.#maxViolations) this.#violations.shift();
	}

	#tick(generation: number): void {
		if (!this.#running || generation !== this.#generation) return;
		const blockedMs = this.#now() - this.#expected;
		// Consume the recent phase every tick (block or not) so attribution is
		// scoped to the just-elapsed interval and never carries a stale phase
		// forward to a later, phase-less block.
		const phase = takeRecentLoopPhase();
		if (blockedMs > this.#thresholdMs) {
			if (!this.#wasBlocked) {
				this.#wasBlocked = true;
				this.#recordViolation(Math.round(blockedMs), phase ?? "unknown");
				logger.warn("ui.loop-blocked", {
					blockedMs: Math.round(blockedMs),
					phase: phase ?? "unknown",
				});
			}
		} else {
			this.#wasBlocked = false;
		}
		this.#armTick();
	}
}
