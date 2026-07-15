import { Effect } from "effect";
import type { PolicyHead } from "./policy-journal";
import {
	decodePolicyTransactionV1,
	type PolicyApplyClass,
	type PolicyApplyCommandV1,
	PolicyApplyCommandV1Schema,
	type PolicyApplyRecordV1,
	PolicyApplyRecordV1Schema,
	type PolicyApplyResult,
	type PolicyTransactionV1,
	TimestampSchema,
} from "./policy-records";
import type { PolicyService, PolicySetInput, PolicySetResult } from "./policy-service";

export interface PolicyApplyTargetState {
	readonly sessionId: string;
	readonly ownerEpoch: string;
	readonly head: PolicyHead;
	readonly appliedSequence: number;
}

/** A target adapter has no stop/kill operation: next-operation can never interrupt admitted work. */
export interface PolicyApplyTarget {
	readonly readState: () => PolicyApplyTargetState | Promise<PolicyApplyTargetState>;
	readonly apply: (
		classification: PolicyApplyClass,
		command: PolicyApplyCommandV1,
		transaction: PolicyTransactionV1,
	) => void | Promise<void>;
	readonly appendRecord?: (record: PolicyApplyRecordV1) => void | Promise<void>;
}

export class PolicyApplyTargetVerificationError extends Error {
	readonly code = "policy-apply-target-verification-failed" as const;

	constructor(reason: string) {
		super(reason);
		this.name = "PolicyApplyTargetVerificationError";
	}
}

export interface PolicyApplyOutcome {
	readonly command: PolicyApplyCommandV1;
	readonly records: readonly PolicyApplyRecordV1[];
	readonly result: PolicyApplyResult;
	readonly appliedSequence: number;
}

export interface PolicyCommitPreview {
	readonly preview: PolicySetResult;
	readonly committed: PolicySetResult;
}

export interface PolicyCommitPreviewInput {
	readonly service: PolicyService;
	readonly set: PolicySetInput;
}

function errorReason(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function assertApplyCommand(command: PolicyApplyCommandV1): PolicyApplyCommandV1 {
	return PolicyApplyCommandV1Schema.make(command);
}

function assertApplyRecord(record: PolicyApplyRecordV1): PolicyApplyRecordV1 {
	return PolicyApplyRecordV1Schema.make(record);
}

export function verifyPolicyApplyTarget(command: PolicyApplyCommandV1, state: PolicyApplyTargetState): void {
	if (state.sessionId !== command.targetSessionId) {
		throw new PolicyApplyTargetVerificationError(
			`Policy target session mismatch: expected ${command.targetSessionId}, found ${state.sessionId}`,
		);
	}
	if (state.ownerEpoch !== command.targetOwnerEpoch) {
		throw new PolicyApplyTargetVerificationError(
			`Policy target owner epoch mismatch: expected ${command.targetOwnerEpoch}, found ${state.ownerEpoch}`,
		);
	}
	if (state.head.sequence !== command.policySequence || state.head.hash !== command.policyHeadHash) {
		throw new PolicyApplyTargetVerificationError(
			`Policy target head is stale: expected ${command.policySequence}/${command.policyHeadHash}, found ${state.head.sequence}/${state.head.hash}`,
		);
	}
	if (state.appliedSequence !== command.expectedAppliedSequence) {
		throw new PolicyApplyTargetVerificationError(
			`Policy target applied sequence is stale: expected ${command.expectedAppliedSequence}, found ${state.appliedSequence}`,
		);
	}
}

function boundaryFor(classification: PolicyApplyClass): string {
	switch (classification) {
		case "hot":
			return "immediate";
		case "next-operation":
			return "next-operation-admission";
		case "next-turn":
			return "next-turn-admission";
		case "restart-required":
			return "verified-restart-or-reacquisition";
	}
}

/** Apply one committed transaction after re-reading the target's authoritative head and applied sequence. */
export async function applyPolicyCommand(input: {
	readonly command: PolicyApplyCommandV1;
	readonly transaction: PolicyTransactionV1;
	readonly target: PolicyApplyTarget;
	readonly now?: () => Date;
}): Promise<PolicyApplyOutcome> {
	const command = assertApplyCommand(input.command);
	const transaction = decodePolicyTransactionV1(input.transaction);
	if (transaction.transactionId !== command.policyTransactionId) {
		throw new PolicyApplyTargetVerificationError(
			`Policy transaction mismatch: expected ${command.policyTransactionId}, found ${transaction.transactionId}`,
		);
	}
	if (transaction.sequence !== command.policySequence || transaction.recordHash !== command.policyHeadHash) {
		throw new PolicyApplyTargetVerificationError("Policy transaction does not match the command head");
	}

	const state = await input.target.readState();
	verifyPolicyApplyTarget(command, state);
	const now = input.now ?? (() => new Date());
	const records: PolicyApplyRecordV1[] = [];
	let applied = false;
	let deferred = false;
	let failed = false;
	for (const classification of command.impactedPolicyClasses) {
		const effectiveAt = now().toISOString();
		let result: PolicyApplyResult = "applied";
		let reason = `${classification} policy applied`;
		try {
			if (classification === "restart-required") {
				result = "deferred";
				deferred = true;
				reason = "restart-required policy staged until verified restart or reacquisition";
			} else {
				await input.target.apply(classification, command, transaction);
				applied = true;
			}
		} catch (error) {
			result = "failed";
			failed = true;
			reason = errorReason(error);
		}
		const record = assertApplyRecord({
			recordType: "policy-apply",
			schemaVersion: 1,
			policyTransactionId: transaction.transactionId,
			policySequence: transaction.sequence,
			policyHeadHash: transaction.recordHash,
			previousAppliedSequence: command.expectedAppliedSequence,
			sessionId: command.targetSessionId,
			ownerEpoch: command.targetOwnerEpoch,
			commandId: command.commandId,
			classification,
			result,
			boundary: boundaryFor(classification),
			effectiveAt,
			reason,
		});
		records.push(record);
		if (input.target.appendRecord) await input.target.appendRecord(record);
	}
	const stateAfter = await input.target.readState();
	if (stateAfter.sessionId !== command.targetSessionId || stateAfter.ownerEpoch !== command.targetOwnerEpoch) {
		throw new PolicyApplyTargetVerificationError("Policy target ownership changed during apply");
	}
	return {
		command,
		records,
		result: failed ? "failed" : deferred ? "deferred" : "applied",
		appliedSequence: applied && !deferred ? transaction.sequence : command.expectedAppliedSequence,
	};
}

/** Validate and preview first, then commit with the preview head fence before dispatching apply. */
export async function commitPolicyWithPreview(input: PolicyCommitPreviewInput): Promise<PolicyCommitPreview> {
	const preview = await Effect.runPromise(input.service.set({ ...input.set, dryRun: true }));
	const expectedHead = input.set.expectedHead ?? {
		sequence: preview.transaction.sequence - 1,
		hash: preview.transaction.previousHash,
	};
	const committed = await Effect.runPromise(
		input.service.set({
			...input.set,
			dryRun: false,
			expectedHead,
		}),
	);
	return { preview, committed };
}

export function policyApplyCommandFromTransaction(input: {
	readonly commandId: string;
	readonly targetSessionId: string;
	readonly targetOwnerEpoch: string;
	readonly transaction: PolicyTransactionV1;
	readonly expectedAppliedSequence: number;
	readonly impactedPolicyClasses: readonly PolicyApplyClass[];
}): PolicyApplyCommandV1 {
	return assertApplyCommand({
		recordType: "policy-apply-command",
		schemaVersion: 1,
		commandId: input.commandId,
		targetSessionId: input.targetSessionId,
		targetOwnerEpoch: input.targetOwnerEpoch,
		policyTransactionId: input.transaction.transactionId,
		policySequence: input.transaction.sequence,
		policyHeadHash: input.transaction.recordHash,
		expectedAppliedSequence: input.expectedAppliedSequence,
		impactedPolicyClasses: [...input.impactedPolicyClasses],
	});
}

export function validatePolicyApplyRecord(record: PolicyApplyRecordV1): PolicyApplyRecordV1 {
	return assertApplyRecord({ ...record, effectiveAt: TimestampSchema.make(record.effectiveAt) });
}
