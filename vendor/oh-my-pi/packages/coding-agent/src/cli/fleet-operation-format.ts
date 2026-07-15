import type { SessionControlReceipt } from "../session/session-control";
import type { FleetRolloutFailureReceipt } from "../session/fleet-rollout-plan";

import type { FleetRolloutOperationResult } from "./fleet-operations";

export function formatFleetReceipt(receipt: SessionControlReceipt): string {
	return (
		[
			"RECEIPT",
			`commandId=${receipt.commandId}`,
			`sessionId=${receipt.sessionId}`,
			`targetOwnerEpoch=${receipt.targetOwnerEpoch}`,
			`state=${receipt.state}`,
			`requestedAt=${receipt.requestedAt}`,
			`acknowledgedAt=${receipt.acknowledgedAt ?? "-"}`,
			`completedAt=${receipt.completedAt ?? "-"}`,
			`result=${receipt.result === undefined ? "-" : JSON.stringify(receipt.result)}`,
			`error=${receipt.error ?? "-"}`,
		].join("\t") + "\n"
	);
}

function inline(value: string): string {
	return value.replaceAll(/\s+/g, " ").trim();
}

function formatFleetRolloutFailure(failure: FleetRolloutFailureReceipt): string {
	return [
		"TARGET_ERROR",
		`targetId=${failure.targetId}`,
		`sessionId=${failure.sessionId}`,
		`phase=${failure.phaseReached}`,
		`awaited=${failure.awaitedCondition}`,
		`commandId=${failure.commandId ?? "-"}`,
		`timedOut=${failure.timedOut}`,
		`buildVersion=${failure.buildVersion ?? "unknown/legacy"}`,
		`buildDigest=${failure.buildDigest ?? "unknown/legacy"}`,
		`cause=${inline(failure.cause)}`,
	].join("\t");
}

export function formatFleetRolloutPlan(result: FleetRolloutOperationResult): string {
	const lines = [
		`ROLLOUT_ID\t${result.plan.fleetRolloutId}`,
		`MODE\t${result.mode}`,
		`TARGET\t${result.plan.target.source.kind}\t${result.plan.target.digest}`,
		`PREVIOUS\t${result.plan.previousDigest}`,
		"WAVES",
	];
	for (const wave of result.plan.waves)
		lines.push(
			`WAVE\t${wave.waveId}\t${wave.kind}\t${wave.targets.map(target => `${target.sessionId}:${target.expectedOwnerEpoch}`).join(",")}`,
		);
	lines.push("EXCLUDED");
	for (const target of result.plan.excluded)
		lines.push(`EXCLUDED\t${target.sessionId}\t${target.state}\t${target.reason ?? "-"}`);
	if (result.reason) lines.push(`REASON\t${result.reason}`);
	if (result.execution) {
		lines.push(`EXECUTION\t${result.execution.state}\t${result.execution.completed.join(",") || "-"}`);
		if (result.execution.state === "Frozen") {
			for (const failure of result.execution.failures) lines.push(formatFleetRolloutFailure(failure));
		}
	}
	return `${lines.join("\n")}\n`;
}

export function formatFleetActionReceipts(receipts: readonly SessionControlReceipt[]): string {
	return receipts.map(formatFleetReceipt).join("");
}
