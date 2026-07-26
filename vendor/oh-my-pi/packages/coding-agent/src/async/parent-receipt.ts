import type { AsyncJobCompletionReceipt } from "../session/session-entries";
import type { AsyncJobCompletionReceiptAdmission, SessionManager } from "../session/session-manager";
import type { YieldQueue } from "../session/yield-queue";

export const ASYNC_JOB_RESULT_YIELD_KIND = "async-result";

/** Commit the receipt before making it visible to the live parent queue. */
export async function admitParentCompletionReceipt(
	sessionManager: SessionManager,
	yieldQueue: YieldQueue | undefined,
	receipt: Omit<AsyncJobCompletionReceipt, "version">,
): Promise<AsyncJobCompletionReceiptAdmission> {
	const admission = await sessionManager.appendAsyncJobCompletionReceipt(receipt);
	if (!admission.replayed && !admission.acknowledged) {
		yieldQueue?.enqueue<AsyncJobCompletionReceipt>(ASYNC_JOB_RESULT_YIELD_KIND, admission.receipt);
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
