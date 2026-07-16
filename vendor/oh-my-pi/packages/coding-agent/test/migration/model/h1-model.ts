export type H1StateName =
	| "spawned"
	| "running"
	| "yielded"
	| "crashed"
	| "interrupted"
	| "timedOut"
	| "parked"
	| "reaped";

export interface H1Event {
	readonly kind: string;
	readonly childId: string;
	readonly seq: number;
	readonly at: number;
	readonly cause?: string;
}

export interface H1Snapshot {
	readonly state: H1StateName;
	readonly seq: number;
	readonly journal: readonly H1Event[];
	readonly deliveredOutcome?: "result" | "typedError" | "cancelled";
}

export type H1StepResult =
	| { readonly ok: true; readonly next: H1Snapshot }
	| { readonly ok: false; readonly violation: H1Violation };

export interface H1Violation {
	readonly invariant: "I1" | "I2" | "I3" | "I4" | "I5" | "I6" | "I7" | "I8" | "I9";
	readonly detail: string;
	readonly event: H1Event;
}

/** The virtual-time liveness budget used when a trace has no poll cadence. */
export const H1_DELIVERY_BOUND = 8;

const LIFECYCLE_KINDS: Record<string, true> = {
	admitted: true,
	started: true,
	progress: true,
	yieldWritten: true,
	delivered: true,
	crashed: true,
	interruptRequested: true,
	interruptDone: true,
	timeoutFired: true,
	parked: true,
	reviveRequested: true,
	revived: true,
	reaped: true,
};

const OBSERVER_KINDS: Record<string, true> = {
	poll: true,
	parentPoll: true,
	monitorPoll: true,
	wallClockTick: true,
	tick: true,
	parentRestart: true,
	restart: true,
	killBoundary: true,
	pipeDrop: true,
	pipeDuplicate: true,
	pipeReorder: true,
	pipeDelay: true,
};

type DecodedEvent = {
	readonly kind: string;
	readonly observation: boolean;
};

function decodeKind(kind: string): DecodedEvent {
	if (kind.startsWith("message:")) {
		return { kind: kind.slice("message:".length), observation: true };
	}
	if (kind.startsWith("journal:")) {
		return { kind: kind.slice("journal:".length), observation: false };
	}
	return { kind, observation: false };
}

function isLifecycleKind(kind: string): boolean {
	return LIFECYCLE_KINDS[decodeKind(kind).kind] === true;
}

function isObserverKind(kind: string): boolean {
	return OBSERVER_KINDS[decodeKind(kind).kind] === true;
}

function violation(invariant: H1Violation["invariant"], detail: string, event: H1Event): H1StepResult {
	return { ok: false, violation: { invariant, detail, event } };
}

function countKind(journal: readonly H1Event[], wanted: string): number {
	let count = 0;
	for (const event of journal) {
		if (decodeKind(event.kind).kind === wanted) count += 1;
	}
	return count;
}

function hasUnmatched(journal: readonly H1Event[], requested: string, completed: string): boolean {
	return countKind(journal, requested) > countKind(journal, completed);
}

function hasYield(journal: readonly H1Event[]): boolean {
	return countKind(journal, "yieldWritten") > 0;
}

function isOutcomeState(state: H1StateName): boolean {
	return state === "yielded" || state === "crashed" || state === "interrupted" || state === "timedOut";
}

function isTerminalState(state: H1StateName): boolean {
	return isOutcomeState(state) || state === "reaped";
}

function outcomeForState(state: H1StateName): H1Snapshot["deliveredOutcome"] {
	if (state === "yielded" || state === "parked") return "result";
	if (state === "crashed" || state === "timedOut") return "typedError";
	if (state === "interrupted") return "cancelled";
	return undefined;
}

function durableOutcome(journal: readonly H1Event[]): H1Snapshot["deliveredOutcome"] {
	for (let index = journal.length - 1; index >= 0; index -= 1) {
		const kind = decodeKind(journal[index]!.kind).kind;
		if (kind === "yieldWritten") return "result";
		if (kind === "interruptDone") return "cancelled";
		if (kind === "crashed" || kind === "timeoutFired") return "typedError";
	}
	return undefined;
}

function requestedOutcome(cause: string | undefined): H1Snapshot["deliveredOutcome"] {
	if (cause === undefined) return undefined;
	if (cause === "result" || cause === "typedError" || cause === "cancelled") return cause;
	if (cause.startsWith("outcome=")) {
		const value = cause.slice("outcome=".length);
		if (value === "result" || value === "typedError" || value === "cancelled") return value;
	}
	return undefined;
}

function withState(snapshot: H1Snapshot, state: H1StateName, event: H1Event, outcome?: H1Snapshot["deliveredOutcome"]): H1Snapshot {
	const nextOutcome = outcome ?? snapshot.deliveredOutcome;
	if (nextOutcome === undefined) {
		return { state, seq: event.seq, journal: [...snapshot.journal, event] };
	}
	return { state, seq: event.seq, journal: [...snapshot.journal, event], deliveredOutcome: nextOutcome };
}

function initialEvent(events: readonly H1Event[], childId: string): H1Event {
	const last = events[events.length - 1];
	if (last !== undefined) return last;
	return { kind: "traceEnd", childId, seq: 0, at: 0 };
}

/** Advance one pure virtual lifecycle event. */
export function h1Step(snapshot: H1Snapshot, event: H1Event): H1StepResult {
	const decoded = decodeKind(event.kind);
	if (snapshot.journal.length > 0 && snapshot.journal[0]?.childId !== event.childId) {
		return violation("I6", "event belongs to a different child", event);
	}
	if (!Number.isInteger(event.seq) || event.seq <= snapshot.seq) {
		return violation("I6", `sequence ${event.seq} is not greater than ${snapshot.seq}`, event);
	}
	if (!Number.isFinite(event.at) || event.at < 0) {
		return violation("I6", "event virtual time must be finite and non-negative", event);
	}
	if (LIFECYCLE_KINDS[decoded.kind] !== true && !isObserverKind(decoded.kind)) {
		return violation("I6", `unknown lifecycle event ${event.kind}`, event);
	}
	if (decoded.observation) {
		return { ok: true, next: withState(snapshot, snapshot.state, event) };
	}
	if (isObserverKind(decoded.kind)) {
		return { ok: true, next: withState(snapshot, snapshot.state, event) };
	}
	if (snapshot.state === "reaped") {
		if (decoded.kind === "delivered" && snapshot.deliveredOutcome === undefined) {
			const expected = durableOutcome(snapshot.journal);
			const supplied = requestedOutcome(event.cause);
			if (supplied !== undefined && supplied !== expected) {
				return violation("I1", `delivery outcome ${supplied} disagrees with durable outcome ${expected}`, event);
			}
			return {
				ok: true,
				next: withState(snapshot, snapshot.state, event, expected),
			};
		}
		return violation("I6", "a reaped child emits no further lifecycle events", event);
	}

	switch (decoded.kind) {
		case "admitted":
			if (snapshot.state !== "spawned") {
				return violation("I6", `admitted is only valid from spawned, not ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "spawned", event) };

		case "started":
			if (snapshot.state !== "spawned") {
				return violation("I6", `started is only valid from spawned, not ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "running", event) };

		case "progress":
			if (snapshot.state !== "running") {
				return violation("I6", `progress is only valid from running, not ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "running", event) };

		case "yieldWritten":
			if (snapshot.state !== "running") {
				if (hasYield(snapshot.journal)) {
					return violation("I1", "a child wrote more than one yield record", event);
				}
				return violation("I6", `yieldWritten is only valid from running, not ${snapshot.state}`, event);
			}
			if (hasYield(snapshot.journal)) {
				return violation("I1", "a child wrote more than one yield record", event);
			}
			return { ok: true, next: withState(snapshot, "yielded", event) };

		case "delivered": {
			if (!isTerminalState(snapshot.state)) {
				return violation("I1", `delivered is not valid from ${snapshot.state}`, event);
			}
			if (snapshot.deliveredOutcome !== undefined) {
				return violation("I1", "parent received a second terminal outcome", event);
			}
			const expected = outcomeForState(snapshot.state);
			if (expected === undefined) {
				return violation("I1", "delivery has no terminal journal outcome", event);
			}
			const supplied = requestedOutcome(event.cause);
			if (supplied !== undefined && supplied !== expected) {
				return violation("I1", `delivery outcome ${supplied} disagrees with ${expected}`, event);
			}
			return { ok: true, next: withState(snapshot, snapshot.state, event, expected) };
		}

		case "crashed":
			if (hasYield(snapshot.journal) || snapshot.state === "yielded" || snapshot.state === "parked") {
				return violation("I2", "teardown after yield cannot convert the outcome to an error", event);
			}
			if (snapshot.state !== "spawned" && snapshot.state !== "running") {
				return violation("I6", `crashed is not valid from ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "crashed", event) };

		case "interruptRequested":
			if (snapshot.state === "interrupted") {
				return { ok: true, next: withState(snapshot, snapshot.state, event) };
			}
			if (snapshot.state === "crashed" || snapshot.state === "timedOut") {
				return violation("I7", `interruptRequested is too late from ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, snapshot.state, event) };

		case "interruptDone":
			if (snapshot.state === "yielded" || snapshot.state === "parked") {
				return { ok: true, next: withState(snapshot, snapshot.state, event) };
			}
			if (snapshot.state !== "spawned" && snapshot.state !== "running") {
				return violation("I7", `interruptDone is not valid from ${snapshot.state}`, event);
			}
			if (!hasUnmatched(snapshot.journal, "interruptRequested", "interruptDone")) {
				return violation("I7", "interruptDone has no unmatched interrupt request", event);
			}
			return { ok: true, next: withState(snapshot, "interrupted", event) };

		case "timeoutFired":
			if (snapshot.state !== "running") {
				return violation("I3", `timeoutFired is only reachable from running, not ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "timedOut", event) };

		case "parked":
			if (snapshot.state !== "yielded") {
				return violation("I6", `parked is only valid from yielded, not ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "parked", event) };

		case "reviveRequested":
			if (snapshot.state !== "parked") {
				return violation("I6", `reviveRequested is only valid from parked, not ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "parked", event) };

		case "revived":
			if (snapshot.state !== "parked") {
				return violation("I6", `revived is only valid from parked, not ${snapshot.state}`, event);
			}
			if (!hasUnmatched(snapshot.journal, "reviveRequested", "revived")) {
				return violation("I6", "revived has no unmatched revive request", event);
			}
			if (snapshot.deliveredOutcome !== undefined) {
				return violation("I1", "a child cannot revive after its terminal outcome was delivered", event);
			}
			return { ok: true, next: withState(snapshot, "running", event) };

		case "reaped":
			if (!isOutcomeState(snapshot.state) && snapshot.state !== "parked") {
				return violation("I8", `reaped requires a terminal child state, not ${snapshot.state}`, event);
			}
			return { ok: true, next: withState(snapshot, "reaped", event) };

		default:
			return violation("I6", `unknown lifecycle event ${event.kind}`, event);
	}
}

function pollEvents(events: readonly H1Event[]): readonly H1Event[] {
	return events.filter(event => {
		const kind = decodeKind(event.kind).kind;
		return kind === "poll" || kind === "parentPoll" || kind === "monitorPoll";
	});
}

function deliveryBound(events: readonly H1Event[]): number {
	const polls = pollEvents(events);
	if (polls.length < 2) return H1_DELIVERY_BOUND;
	let largestGap = 0;
	for (let index = 1; index < polls.length; index += 1) {
		const gap = polls[index]!.at - polls[index - 1]!.at;
		if (gap > largestGap) largestGap = gap;
	}
	return Math.max(H1_DELIVERY_BOUND, largestGap);
}

function receipt(cause: string | undefined): string | undefined {
	if (cause === undefined) return undefined;
	if (cause.startsWith("receipt=")) return cause.slice("receipt=".length);
	if (cause.startsWith("state=")) return cause.slice("state=".length);
	if (
		cause === "spawned" ||
		cause === "running" ||
		cause === "yielded" ||
		cause === "parked" ||
		cause === "crashed" ||
		cause === "interrupted" ||
		cause === "timedOut" ||
		cause === "reaped" ||
		cause === "result" ||
		cause === "typedError" ||
		cause === "cancelled"
	) {
		return cause;
	}
	return undefined;
}

function receiptMatches(snapshot: H1Snapshot, value: string): boolean {
	if (value === snapshot.state) return true;
	if (snapshot.deliveredOutcome !== undefined && value === snapshot.deliveredOutcome) return true;
	if (snapshot.state === "parked" && value === "yielded") return true;
	return false;
}

function run(events: readonly H1Event[]): {
	readonly snapshot: H1Snapshot;
	readonly violations: readonly H1Violation[];
} {
	let snapshot: H1Snapshot = { state: "spawned", seq: 0, journal: [] };
	const violations: H1Violation[] = [];
	for (const event of events) {
		const result = h1Step(snapshot, event);
		if (result.ok) snapshot = result.next;
		else violations.push(result.violation);
	}
	return { snapshot, violations };
}

function journalSubset(events: readonly H1Event[]): readonly H1Event[] {
	return events.filter(event => {
		const decoded = decodeKind(event.kind);
		return !decoded.observation && isLifecycleKind(decoded.kind);
	});
}

function globalViolations(events: readonly H1Event[], primary: {
	readonly snapshot: H1Snapshot;
	readonly violations: readonly H1Violation[];
}): readonly H1Violation[] {
	if (events.length === 0) return [];
	const violations: H1Violation[] = [...primary.violations];
	const bound = deliveryBound(events);
	const yields = events.filter(event => decodeKind(event.kind).kind === "yieldWritten");
	const deliveries = events.filter(event => decodeKind(event.kind).kind === "delivered");
	for (const yielded of yields) {
		const delivery = deliveries.find(event => event.seq > yielded.seq && event.at >= yielded.at);
		if (delivery === undefined) {
			const last = events[events.length - 1]!;
			if (last.at - yielded.at > bound) {
				violations.push({
					invariant: "I5",
					detail: `yieldWritten at ${yielded.at} was not delivered within ${bound} virtual time units`,
					event: last,
				});
			}
		} else if (delivery.at - yielded.at > bound) {
			violations.push({
				invariant: "I5",
				 detail: `delivery delayed ${delivery.at - yielded.at} virtual time units; bound is ${bound}`,
				event: delivery,
			});
		}
	}

	let snapshot: H1Snapshot = { state: "spawned", seq: 0, journal: [] };
	for (const event of events) {
		const kind = decodeKind(event.kind).kind;
		const result = h1Step(snapshot, event);
		if (result.ok) snapshot = result.next;
		if (kind !== "poll" && kind !== "parentPoll" && kind !== "monitorPoll") continue;
		const value = receipt(event.cause);
		if (value === undefined) continue;
		if (!receiptMatches(snapshot, value)) {
			violations.push({
				invariant: "I9",
				detail: `receipt ${value} disagrees with journal state ${snapshot.state}`,
				event,
			});
			continue;
		}
		if (value === "running") {
			const yielded = [...events]
				.reverse()
				.find(candidate => candidate.seq < event.seq && decodeKind(candidate.kind).kind === "yieldWritten");
			if (yielded !== undefined && event.at - yielded.at > bound) {
				violations.push({
					invariant: "I9",
					detail: `running receipt is stale ${event.at - yielded.at} virtual time units after yield`,
					event,
				});
			}
		}
	}

	const replayed = run(journalSubset(events));
	const primaryOutcome = primary.snapshot.deliveredOutcome;
	const replayOutcome = replayed.snapshot.deliveredOutcome;
	if (primaryOutcome !== replayOutcome || replayed.violations.length > 0) {
		const event = replayed.violations[0]?.event ?? initialEvent(events, events[0]!.childId);
		violations.push({
			invariant: "I4",
			detail: `journal replay outcome ${replayOutcome ?? "none"} differs from parent outcome ${primaryOutcome ?? "none"}`,
			event,
		});
	}

	let terminalCount = 0;
	for (const event of events) {
		const kind = decodeKind(event.kind).kind;
		if (kind === "yieldWritten" || kind === "crashed" || kind === "timeoutFired") {
			terminalCount += 1;
		} else if (kind === "interruptDone" && terminalCount === 0) {
			terminalCount += 1;
		}
	}
	const deliveredCount = deliveries.length;
	const end = events[events.length - 1]!;
	if (terminalCount !== 1 || deliveredCount !== 1 || primary.snapshot.deliveredOutcome === undefined) {
		violations.push({
			invariant: "I1",
			detail: `expected one terminal transition and one delivery, saw ${terminalCount} and ${deliveredCount}`,
			event: end,
		});
	}
	return violations;
}

/** Check one complete observed event trace, including trace-global invariants. */
export function h1CheckTrace(events: readonly H1Event[]): readonly H1Violation[] {
	if (events.length === 0) return [];
	const childIds = [...new Set(events.map(event => event.childId))];
	const violations: H1Violation[] = [];
	for (const childId of childIds) {
		const childEvents = events.filter(event => event.childId === childId);
		const primary = run(childEvents);
		violations.push(...globalViolations(childEvents, primary));
	}
	return violations;
}
