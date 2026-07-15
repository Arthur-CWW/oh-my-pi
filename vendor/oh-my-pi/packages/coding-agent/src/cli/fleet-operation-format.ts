import type { SessionControlReceipt } from "../session/session-control";
import type { FleetRolloutOperationResult } from "./fleet-operations";

export function formatFleetReceipt(receipt: SessionControlReceipt): string {
	return [
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
	].join("\t") + "\n";
}

export function formatFleetRolloutPlan(result: FleetRolloutOperationResult): string {
	const lines = [
		`ROLLOUT_ID\t${result.plan.fleetRolloutId}`,
		`MODE\t${result.mode}`,
		`TARGET\t${result.plan.target.source.kind}\t${result.plan.target.digest}`,
		`PREVIOUS\t${result.plan.previousDigest}`,
		"WAVES",
	];
	for (const wave of result.plan.waves) lines.push(`WAVE\t${wave.waveId}\t${wave.kind}\t${wave.targets.map(target => `${target.sessionId}:${target.expectedOwnerEpoch}`).join(",")}`);
	lines.push("EXCLUDED");
	for (const target of result.plan.excluded) lines.push(`EXCLUDED\t${target.sessionId}\t${target.state}\t${target.reason ?? "-"}`);
	if (result.reason) lines.push(`REASON\t${result.reason}`);
	if (result.execution) lines.push(`EXECUTION\t${result.execution.state}\t${result.execution.completed.join(",") || "-"}`);
	return `${lines.join("\n")}\n`;
}

export function formatFleetActionReceipts(receipts: readonly SessionControlReceipt[]): string {
	return receipts.map(formatFleetReceipt).join("");
}
