import {
	h1CheckTrace,
	type H1Event,
	type H1StateName,
	type H1Violation,
} from "./model/h1-model";

export type H1FaultProfile = "clean" | "lossy-pipe" | "kill-happy" | "race-heavy";

export type H1DstActionKind =
	| "childProgress"
	| "childYield"
	| "childCrash"
	| "interruptRequest"
	| "wallClockTick"
	| "parkTtl"
	| "revive"
	| "parentPoll"
	| "parentRestart"
	| "reap";

export interface H1DstAction {
	readonly id: number;
	readonly kind: H1DstActionKind;
	readonly at: number;
}

export interface H1DstFaultStats {
	readonly messageDrops: number;
	readonly messageDuplicates: number;
	readonly messageReorders: number;
	readonly messageDelays: number;
	readonly killBoundaries: number;
	readonly timeoutYieldRaces: number;
	readonly interruptYieldRaces: number;
	readonly reviveReapRaces: number;
	readonly parentRestarts: number;
}

export interface H1DstRun {
	readonly seed: number;
	readonly profile: H1FaultProfile;
	readonly actions: readonly H1DstAction[];
	readonly trace: readonly H1Event[];
	readonly violations: readonly H1Violation[];
	readonly shrunkTrace: readonly H1Event[];
	readonly faultStats: H1DstFaultStats;
}

export interface H1DstOptions {
	readonly seed: number;
	readonly profile: H1FaultProfile;
	readonly maxActions?: number;
}

type MutableFaultStats = {
	messageDrops: number;
	messageDuplicates: number;
	messageReorders: number;
	messageDelays: number;
	killBoundaries: number;
	timeoutYieldRaces: number;
	interruptYieldRaces: number;
	reviveReapRaces: number;
	parentRestarts: number;
};

function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = Math.imul(state ^ (state >>> 15), 1 | state);
		value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function makeActions(random: () => number, count: number): readonly H1DstAction[] {
	const kinds: readonly H1DstActionKind[] = [
		"childProgress",
		"childYield",
		"childCrash",
		"interruptRequest",
		"wallClockTick",
		"parkTtl",
		"revive",
		"parentPoll",
		"parentRestart",
		"reap",
	];
	const actions: H1DstAction[] = [];
	let at = 0;
	for (let id = 0; id < count; id += 1) {
		at += 1 + Math.floor(random() * 3);
		actions.push({ id, kind: kinds[Math.floor(random() * kinds.length)]!, at });
	}
	return actions;
}

function receiptFor(state: H1StateName, delivered: boolean): string {
	if (delivered) {
		if (state === "interrupted") return "cancelled";
		if (state === "crashed" || state === "timedOut") return "typedError";
		return "result";
	}
	return state;
}

function toTraceEvent(kind: string, childId: string, seq: number, at: number, cause?: string): H1Event {
	if (cause === undefined) return { kind, childId, seq, at };
	return { kind, childId, seq, at, cause };
}

function defaultStats(): MutableFaultStats {
	return {
		messageDrops: 0,
		messageDuplicates: 0,
		messageReorders: 0,
		messageDelays: 0,
		killBoundaries: 0,
		timeoutYieldRaces: 0,
		interruptYieldRaces: 0,
		reviveReapRaces: 0,
		parentRestarts: 0,
	};
}

function cloneStats(stats: MutableFaultStats): H1DstFaultStats {
	return { ...stats };
}

function append(
	trace: H1Event[],
	childId: string,
	sequence: { value: number },
	kind: string,
	at: number,
	cause?: string,
): void {
	sequence.value += 1;
	trace.push(toTraceEvent(kind, childId, sequence.value, at, cause));
}

function shouldDropProgress(profile: H1FaultProfile, random: () => number): boolean {
	return profile === "lossy-pipe" && random() < 0.35;
}

function shouldDuplicatePoll(profile: H1FaultProfile, random: () => number): boolean {
	return profile === "lossy-pipe" && random() < 0.25;
}

function shouldDelay(profile: H1FaultProfile, random: () => number): boolean {
	return profile !== "clean" && random() < 0.25;
}

function shouldKillBoundary(profile: H1FaultProfile, random: () => number): boolean {
	return profile === "kill-happy" || (profile === "race-heavy" && random() < 0.4);
}

function terminalState(state: H1StateName): boolean {
	return state === "yielded" || state === "crashed" || state === "interrupted" || state === "timedOut" || state === "parked";
}

function emitDelivery(
	trace: H1Event[],
	childId: string,
	sequence: { value: number },
	clock: number,
	state: H1StateName,
): boolean {
	if (!terminalState(state)) return false;
	const outcome = state === "interrupted" ? "cancelled" : state === "crashed" || state === "timedOut" ? "typedError" : "result";
	append(trace, childId, sequence, "delivered", clock, `outcome=${outcome}`);
	return true;
}

/** Execute one deterministic schedule and judge its observable trace. */
export function runH1Dst(options: H1DstOptions): H1DstRun {
	const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) : 1;
	const random = mulberry32(seed);
	const maxActions = options.maxActions ?? 48;
	const actions = makeActions(random, maxActions);
	const stats = defaultStats();
	const trace: H1Event[] = [];
	const sequence = { value: 0 };
	const childId = "dst-child";
	let state: H1StateName = "spawned";
	let delivered = false;
	let clock = 0;
	let interruptRequested = false;
	const pending = [...actions];
	let previousActionId = -1;

	append(trace, childId, sequence, "admitted", clock);
	append(trace, childId, sequence, "started", clock);
	state = "running";

	for (let index = 0; pending.length > 0; index += 1) {
		const selectedIndex = Math.floor(random() * pending.length);
		const action = pending.splice(selectedIndex, 1)[0]!;
		clock = Math.max(clock, action.at);
		if (shouldDelay(options.profile, random)) {
			clock += 1;
			stats.messageDelays += 1;
		}
		if (options.profile !== "clean" && previousActionId >= 0 && action.id < previousActionId) stats.messageReorders += 1;
		previousActionId = action.id;

		switch (action.kind) {
			case "childProgress":
				if (state === "running") {
					if (shouldDropProgress(options.profile, random)) {
						stats.messageDrops += 1;
						append(trace, childId, sequence, "pipeDrop", clock, "progress");
					} else {
						append(trace, childId, sequence, "progress", clock);
					}
				}
				break;

			case "childYield":
				if (state === "running") {
					if (shouldKillBoundary(options.profile, random) && random() < 0.2) {
						stats.killBoundaries += 1;
						append(trace, childId, sequence, "killBoundary", clock, "before-yield");
						append(trace, childId, sequence, "crashed", clock, "killed-before-yield");
						state = "crashed";
					} else {
						append(trace, childId, sequence, "yieldWritten", clock);
						state = "yielded";
						delivered = emitDelivery(trace, childId, sequence, clock, state);
						if (shouldKillBoundary(options.profile, random)) {
							stats.killBoundaries += 1;
							append(trace, childId, sequence, "killBoundary", clock, "after-yield");
						}
					}
				}
				break;

			case "childCrash":
				if (state === "running") {
					if (shouldKillBoundary(options.profile, random)) {
						stats.killBoundaries += 1;
						append(trace, childId, sequence, "killBoundary", clock, "crash-boundary");
					}
					append(trace, childId, sequence, "crashed", clock, "child-crash");
					state = "crashed";
					delivered = emitDelivery(trace, childId, sequence, clock, state);
				} else if (state === "yielded" || state === "parked") {
					stats.killBoundaries += 1;
					append(trace, childId, sequence, "killBoundary", clock, "post-yield-kill-ignored");
				}
				break;

			case "interruptRequest":
				if (state === "running") {
					if (options.profile === "race-heavy") stats.interruptYieldRaces += 1;
					append(trace, childId, sequence, "interruptRequested", clock, "parent-interrupt");
					interruptRequested = true;
					if (random() < 0.65) {
						append(trace, childId, sequence, "interruptDone", clock, "cleanup-once");
						state = "interrupted";
						delivered = emitDelivery(trace, childId, sequence, clock, state);
					}
				} else if (state === "yielded" || state === "parked") {
					stats.interruptYieldRaces += 1;
					append(trace, childId, sequence, "interruptRequested", clock, "yield-priority");
				}
				break;

			case "wallClockTick":
				append(trace, childId, sequence, "wallClockTick", clock);
				if (state === "running" && options.profile === "race-heavy" && random() < 0.2) {
					stats.timeoutYieldRaces += 1;
					append(trace, childId, sequence, "timeoutFired", clock, "deadline");
					state = "timedOut";
					delivered = emitDelivery(trace, childId, sequence, clock, state);
				}
				break;

			case "parkTtl":
				if (state === "yielded") {
					append(trace, childId, sequence, "parked", clock, "ttl");
					state = "parked";
				}
				break;

			case "revive":
				if (state === "parked" && !delivered) {
					stats.reviveReapRaces += 1;
					if (random() < 0.5) {
						append(trace, childId, sequence, "reviveRequested", clock, "race");
						if (!delivered) delivered = emitDelivery(trace, childId, sequence, clock, state);
						append(trace, childId, sequence, "reaped", clock, "reap-wins-race");
						state = "reaped";
					} else {
						append(trace, childId, sequence, "reviveRequested", clock, "race");
					}
				}
				break;

			case "parentPoll":
				if (options.profile === "lossy-pipe" && random() < 0.2) {
					stats.messageDrops += 1;
					append(trace, childId, sequence, "pipeDrop", clock, "poll");
				} else {
					append(trace, childId, sequence, "parentPoll", clock, `receipt=${receiptFor(state, delivered)}`);
					if (shouldDuplicatePoll(options.profile, random)) {
						stats.messageDuplicates += 1;
						append(trace, childId, sequence, "parentPoll", clock, `receipt=${receiptFor(state, delivered)}`);
					}
				}
				if (!delivered && terminalState(state)) {
					delivered = emitDelivery(trace, childId, sequence, clock, state);
				}
				break;

			case "parentRestart":
				stats.parentRestarts += 1;
				append(trace, childId, sequence, "parentRestart", clock, "journal-recovery");
				if (!delivered && terminalState(state)) {
					delivered = emitDelivery(trace, childId, sequence, clock, state);
				}
				break;

			case "reap":
				if (state === "yielded" || state === "parked" || state === "crashed" || state === "interrupted" || state === "timedOut") {
					if (state === "parked") stats.reviveReapRaces += 1;
					if (!delivered) delivered = emitDelivery(trace, childId, sequence, clock, state);
					append(trace, childId, sequence, "reaped", clock, "ttl");
					state = "reaped";
				}
				break;
		}

		if (state === "reaped") break;
		if (interruptRequested && state === "running" && random() < 0.25) {
			append(trace, childId, sequence, "interruptDone", clock, "cleanup-once");
			state = "interrupted";
			interruptRequested = false;
		}
	}

	if (state === "running") {
		if (interruptRequested) {
			append(trace, childId, sequence, "interruptDone", clock, "cleanup-once");
			state = "interrupted";
			delivered = emitDelivery(trace, childId, sequence, clock, state);
		} else {
			append(trace, childId, sequence, "yieldWritten", clock);
			state = "yielded";
		}
	}
	if (!delivered && terminalState(state)) {
		delivered = emitDelivery(trace, childId, sequence, clock, state);
	}
	if ((state === "yielded" || state === "parked" || state === "crashed" || state === "interrupted" || state === "timedOut") && delivered) {
		append(trace, childId, sequence, "reaped", clock, "terminal-teardown");
		state = "reaped";
	}
	const violations = h1CheckTrace(trace);
	const shrunkTrace = violations.length === 0 ? trace : shrinkH1Trace(trace);
	return {
		seed,
		profile: options.profile,
		actions,
		trace,
		violations,
		shrunkTrace,
		faultStats: cloneStats(stats),
	};
}

/** Drop-one-action shrinking for a reproducible violating trace. */
export function shrinkH1Trace(
	events: readonly H1Event[],
	predicate: (candidate: readonly H1Event[]) => boolean = candidate => h1CheckTrace(candidate).length > 0,
): readonly H1Event[] {
	let current = [...events];
	let changed = true;
	while (changed) {
		changed = false;
		for (let index = 0; index < current.length; index += 1) {
			const candidate = [...current.slice(0, index), ...current.slice(index + 1)];
			if (!predicate(candidate)) continue;
			current = candidate;
			changed = true;
			break;
		}
	}
	return current;
}
