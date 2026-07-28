import { SessionOwnershipLostError } from "../session/durable-input-queue";
import type { AsyncJobCompletionReceipt } from "../session/session-entries";
import type { AsyncJobCompletionReceiptAdmission, SessionManager } from "../session/session-manager";
import type { YieldQueue } from "../session/yield-queue";

export const ASYNC_JOB_RESULT_YIELD_KIND = "async-result";

export interface ParentCompletionReceiptTarget {
	readonly sessionManager: SessionManager;
	readonly yieldQueue?: YieldQueue;
}

/**
 * Commit the receipt before making it visible to the live parent queue.
 *
 * A completion callback may outlive the AgentSession that created it. Once
 * that manager is fenced, resolve the current owner and admit there instead;
 * never retry a write against the stale journal.
 */
export async function admitParentCompletionReceipt(
	sessionManager: SessionManager,
	yieldQueue: YieldQueue | undefined,
	receipt: Omit<AsyncJobCompletionReceipt, "version">,
	resolveCurrentTarget?: () => ParentCompletionReceiptTarget | undefined,
): Promise<AsyncJobCompletionReceiptAdmission> {
	let target: ParentCompletionReceiptTarget = { sessionManager, yieldQueue };
	if (sessionManager.getSessionOwnershipLostError()) {
		target = resolveCurrentTarget?.() ?? target;
	}
	let admission: AsyncJobCompletionReceiptAdmission;
	try {
		admission = await target.sessionManager.appendAsyncJobCompletionReceipt(receipt);
	} catch (error) {
		if (!(error instanceof SessionOwnershipLostError)) throw error;
		const current = resolveCurrentTarget?.();
		if (!current || current.sessionManager === target.sessionManager) throw error;
		target = current;
		admission = await target.sessionManager.appendAsyncJobCompletionReceipt(receipt);
	}
	if (!admission.replayed && !admission.acknowledged) {
		target.yieldQueue?.enqueue<AsyncJobCompletionReceipt>(ASYNC_JOB_RESULT_YIELD_KIND, admission.receipt);
	}
	return admission;
}

/** Enqueue each durable, unacknowledged receipt once during session construction. */
export function replayParentCompletionReceipts(sessionManager: SessionManager, yieldQueue: YieldQueue): number {
	const receipts = sessionManager.getUnacknowledgedAsyncJobCompletionReceipts();
	for (const receipt of receipts) {
		yieldQueue.enqueue<AsyncJobCompletionReceipt>(ASYNC_JOB_RESULT_YIELD_KIND, receipt);
	}
	return receipts.length;
}
