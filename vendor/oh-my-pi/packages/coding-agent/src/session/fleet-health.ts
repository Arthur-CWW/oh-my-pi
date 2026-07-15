import type { IrcExternalPeer } from "../irc/bus-external";
import type { FleetIncident } from "../task/fleet-incident";
import type { DiagnosticEvent } from "./error-inbox-ledger";
import { classifyFleetCompatibility, type FleetCompatibilityProfile } from "./fleet-capability";
import type { SessionControlReceipt } from "./session-control";

export interface FleetErrorBaseline {
	readonly capturedAt: number;
	readonly countsById: ReadonlyMap<string, number>;
}

export interface FleetErrorPolicy {
	/** First attributable event count that fails the target gate. Must be positive. */
	readonly correlatedEventThreshold: number;
}

export interface FleetHealthObservation {
	readonly sessionId: string;
	readonly previousOwnerEpoch: string;
	readonly targetDigest: string;
	readonly targetVersion: string;
	readonly fleetRolloutId: string;
	readonly observedAt: number;
	readonly heartbeatFreshAfter: number;
	readonly statusRequestedAt: number;
	readonly replacementHeartbeats: readonly IrcExternalPeer[];
	readonly statusReceipt?: SessionControlReceipt;
	readonly checkpointFailure?: string;
	readonly reAdoptionFailure?: string;
	readonly errors: readonly DiagnosticEvent[];
	readonly errorBaseline: FleetErrorBaseline;
	readonly errorPolicy: FleetErrorPolicy;
	readonly incidents: readonly FleetIncident[];
	readonly compatibility: FleetCompatibilityProfile;
}

export type FleetHealthFailureCode =
	| "HeartbeatTimeout"
	| "DualOwner"
	| "OwnerEpochNotAdvanced"
	| "HeartbeatMismatch"
	| "CompatibilityMismatch"
	| "StatusReceiptMissing"
	| "StatusReceiptFailed"
	| "StatusReceiptStale"
	| "CheckpointFailed"
	| "ReAdoptionFailed"
	| "CorrelatedErrorThreshold"
	| "FleetIncident";

export interface FleetHealthFailure {
	readonly code: FleetHealthFailureCode;
	readonly reason: string;
	/** False for an underlying fleet outage: freeze, but do not blame or automatically roll back the build. */
	readonly attributedToBuild: boolean;
}

export type FleetHealthResult =
	| {
			readonly state: "Healthy";
			readonly replacement: IrcExternalPeer;
			readonly correlatedErrorCount: number;
	  }
	| {
			readonly state: "HealthFailed";
			readonly failures: readonly FleetHealthFailure[];
			readonly correlatedErrorCount: number;
	  };

function failure(code: FleetHealthFailureCode, reason: string, attributedToBuild = true): FleetHealthFailure {
	return { code, reason, attributedToBuild };
}

function incidentOverlaps(incident: FleetIncident, start: number, end: number): boolean {
	return incident.openedAt <= end && (incident.closedAt === undefined || incident.closedAt >= start);
}

function isUserCancelled(event: DiagnosticEvent): boolean {
	return (
		event.cause === "parent-cancel" ||
		event.cause === "user-interrupt" ||
		event.disposition === "user-cancelled" ||
		event.category === "user-cancelled"
	);
}

function isOutageEvent(event: DiagnosticEvent, hasOverlappingIncident: boolean): boolean {
	if (event.source === "fleet" && event.category === "fleet-incident") return true;
	return hasOverlappingIncident && event.cause === "network";
}

export function countBuildCorrelatedErrors(
	observation: Pick<
		FleetHealthObservation,
		"sessionId" | "targetDigest" | "fleetRolloutId" | "observedAt" | "errors" | "errorBaseline" | "incidents"
	>,
): number {
	const { errorBaseline } = observation;
	const hasOverlappingIncident = observation.incidents.some(incident =>
		incidentOverlaps(incident, errorBaseline.capturedAt, observation.observedAt),
	);
	let total = 0;
	for (const event of observation.errors) {
		if (
			event.lastTimestamp <= errorBaseline.capturedAt ||
			event.firstTimestamp > observation.observedAt ||
			event.buildDigest !== observation.targetDigest ||
			event.fleetRolloutId !== observation.fleetRolloutId ||
			(event.session !== undefined && event.session !== observation.sessionId) ||
			isUserCancelled(event) ||
			isOutageEvent(event, hasOverlappingIncident)
		)
			continue;
		const baselineCount = errorBaseline.countsById.get(event.id) ?? 0;
		total += Math.max(0, event.count - baselineCount);
	}
	return total;
}

function statusResultMatches(receipt: SessionControlReceipt, sessionId: string, ownerEpoch: string): boolean {
	if (receipt.sessionId !== sessionId || receipt.targetOwnerEpoch !== ownerEpoch) return false;
	if (receipt.state !== "applied" || receipt.completedAt === undefined) return false;
	const result = receipt.result;
	return (
		typeof result === "object" &&
		result !== null &&
		"kind" in result &&
		result.kind === "status" &&
		"sessionId" in result &&
		result.sessionId === sessionId &&
		"ownerEpoch" in result &&
		result.ownerEpoch === ownerEpoch
	);
}

/** Evaluate the complete post-recovery gate. Any failure is a wave freeze condition. */
export function evaluateFleetTargetHealth(observation: FleetHealthObservation): FleetHealthResult {
	if (
		!Number.isSafeInteger(observation.errorPolicy.correlatedEventThreshold) ||
		observation.errorPolicy.correlatedEventThreshold <= 0
	)
		throw new RangeError("Fleet correlated error threshold must be a positive integer");
	const failures: FleetHealthFailure[] = [];
	const replacements = observation.replacementHeartbeats.filter(peer => {
		const lastSeen = Date.parse(peer.lastSeen);
		return (
			peer.sessionId === observation.sessionId &&
			lastSeen >= observation.heartbeatFreshAfter &&
			lastSeen <= observation.observedAt
		);
	});
	const ownerEpochs = new Set(replacements.map(peer => peer.ownerEpoch).filter(epoch => epoch !== undefined));
	if (replacements.length === 0) {
		failures.push(failure("HeartbeatTimeout", "no fresh replacement heartbeat arrived"));
	} else if (ownerEpochs.size > 1) {
		failures.push(failure("DualOwner", "multiple fresh owner epochs reported for the session"));
	}
	const replacement = replacements.at(-1);
	if (replacement) {
		if (!replacement.ownerEpoch || replacement.ownerEpoch === observation.previousOwnerEpoch)
			failures.push(failure("OwnerEpochNotAdvanced", "replacement owner epoch did not advance"));
		if (replacement.buildDigest !== observation.targetDigest || replacement.version !== observation.targetVersion)
			failures.push(failure("HeartbeatMismatch", "replacement digest or version did not match the target"));
		const compatibility = classifyFleetCompatibility(replacement, observation.compatibility);
		if (compatibility.kind !== "compatible")
			failures.push(failure("CompatibilityMismatch", compatibility.reasons.join("; ")));
	}

	const receipt = observation.statusReceipt;
	if (!receipt) {
		failures.push(failure("StatusReceiptMissing", "fresh status receipt was not observed"));
	} else if (receipt.state === "failed") {
		failures.push(failure("StatusReceiptFailed", receipt.error ?? "status healthcheck failed"));
	} else if (
		!replacement?.ownerEpoch ||
		!statusResultMatches(receipt, observation.sessionId, replacement.ownerEpoch)
	) {
		failures.push(failure("StatusReceiptFailed", "status receipt did not prove the replacement owner"));
	} else if (Date.parse(receipt.completedAt ?? "") < observation.statusRequestedAt) {
		failures.push(failure("StatusReceiptStale", "status receipt predates the health request"));
	}
	if (observation.checkpointFailure) failures.push(failure("CheckpointFailed", observation.checkpointFailure));
	if (observation.reAdoptionFailure) failures.push(failure("ReAdoptionFailed", observation.reAdoptionFailure));

	const correlatedErrorCount = countBuildCorrelatedErrors(observation);
	if (correlatedErrorCount >= observation.errorPolicy.correlatedEventThreshold)
		failures.push(
			failure(
				"CorrelatedErrorThreshold",
				`${correlatedErrorCount} build-correlated errors reached policy threshold ${observation.errorPolicy.correlatedEventThreshold}`,
			),
		);
	const incident = observation.incidents.find(item =>
		incidentOverlaps(item, observation.errorBaseline.capturedAt, observation.observedAt),
	);
	if (incident) failures.push(failure("FleetIncident", `fleet incident ${incident.id} overlaps observation`, false));

	return failures.length === 0 && replacement
		? { state: "Healthy", replacement, correlatedErrorCount }
		: { state: "HealthFailed", failures, correlatedErrorCount };
}

export class FleetHealthGateError extends Error {
	readonly result: Extract<FleetHealthResult, { readonly state: "HealthFailed" }>;

	constructor(result: Extract<FleetHealthResult, { readonly state: "HealthFailed" }>) {
		super(result.failures.map(item => `${item.code}: ${item.reason}`).join("; "));
		this.name = "FleetHealthGateError";
		this.result = result;
	}
}

/**
 * Controller integration seam: use inside executeFleetRolloutPlan.executeTarget.
 * Throwing delegates the authoritative freeze of all later targets to the existing planner.
 */
export function requireHealthyFleetTarget(
	observation: FleetHealthObservation,
): Extract<FleetHealthResult, { readonly state: "Healthy" }> {
	const result = evaluateFleetTargetHealth(observation);
	if (result.state === "HealthFailed") throw new FleetHealthGateError(result);
	return result;
}

export interface FleetReplacementFailure {
	readonly sessionId: string;
	readonly targetDigest: string;
	readonly ownerEpoch: string;
	readonly occurredAt: number;
	readonly phase: "post-applied-loss" | "post-applied-failure";
}

/** Journal-derived crash-loop policy. At two consecutive failures, a third restart is forbidden. */
export function evaluateFleetCrashLoop(
	events: readonly FleetReplacementFailure[],
	input: {
		readonly sessionId: string;
		readonly targetDigest: string;
		readonly now: number;
		readonly windowMs: number;
	},
): { readonly stop: boolean; readonly consecutiveFailures: number } {
	const relevant = events
		.filter(
			event =>
				event.sessionId === input.sessionId &&
				event.targetDigest === input.targetDigest &&
				event.occurredAt >= input.now - input.windowMs &&
				event.occurredAt <= input.now,
		)
		.sort((left, right) => left.occurredAt - right.occurredAt);
	const distinctAttempts = new Set(relevant.map(event => event.ownerEpoch)).size;
	return { stop: distinctAttempts >= 2, consecutiveFailures: distinctAttempts };
}
