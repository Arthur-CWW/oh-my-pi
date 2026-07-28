import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { Schema } from "effect";
import type { SessionEntry, SessionMessageEntry } from "./session-entries";

export const CompactionTriggerSchema = Schema.Literals(["manual", "token_threshold", "auto"]);
export type CompactionTrigger = typeof CompactionTriggerSchema.Type;
export const AutoCompactionReasonSchema = Schema.Literals(["threshold", "overflow", "idle", "incomplete"]);
export type AutoCompactionReason = typeof AutoCompactionReasonSchema.Type;
export type CompactionMessageClass = string;

const NonNegativeIntSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));
export const CompactionMessageClassCountSchema = Schema.Struct({
	class: Schema.String,
	count: NonNegativeIntSchema,
});
export type CompactionMessageClassCount = typeof CompactionMessageClassCountSchema.Type;

export const CompactionDroppedRangeSchema = Schema.Struct({
	firstEntryId: Schema.String,
	lastEntryId: Schema.String,
	count: NonNegativeIntSchema,
	classes: Schema.Array(CompactionMessageClassCountSchema),
});
export type CompactionDroppedRange = typeof CompactionDroppedRangeSchema.Type;

/** Durable, content-free audit metadata for one completed compaction. */
export const CompactionReceiptSchema = Schema.Struct({
	trigger: CompactionTriggerSchema,
	/** The runtime reason is retained separately when trigger is automatic. */
	triggerReason: Schema.optional(AutoCompactionReasonSchema),
	tokensBeforeEstimate: NonNegativeIntSchema,
	tokensAfterEstimate: NonNegativeIntSchema,
	messageCountBefore: NonNegativeIntSchema,
	retained: Schema.Struct({
		count: NonNegativeIntSchema,
		classes: Schema.Array(CompactionMessageClassCountSchema),
	}),
	dropped: Schema.Struct({
		count: NonNegativeIntSchema,
		ranges: Schema.Array(CompactionDroppedRangeSchema),
	}),
	durationMs: NonNegativeIntSchema,
	/** provider/model, present only when an LLM generated the summary. */
	summaryModel: Schema.optional(Schema.String),
});
export type CompactionReceipt = typeof CompactionReceiptSchema.Type;

export function decodeCompactionReceipt(input: unknown): CompactionReceipt {
	return Schema.decodeUnknownSync(CompactionReceiptSchema)(input, { onExcessProperty: "error" });
}

export interface CreateCompactionReceiptOptions {
	trigger: CompactionTrigger;
	triggerReason?: AutoCompactionReason;
	pathEntries: readonly SessionEntry[];
	firstKeptEntryId: string;
	tokensBeforeEstimate: number;
	tokensAfterEstimate: number;
	durationMs: number;
	summaryModel?: string;
}

function countClasses(entries: readonly SessionMessageEntry[]): CompactionMessageClassCount[] {
	const counts = new Map<CompactionMessageClass, number>();
	for (const entry of entries) {
		const role = entry.message.role;
		counts.set(role, (counts.get(role) ?? 0) + 1);
	}
	return [...counts].map(([messageClass, count]) => ({ class: messageClass, count }));
}

/** Build a receipt from the same branch and cut point used by compaction. */
export function createCompactionReceipt(options: CreateCompactionReceiptOptions): CompactionReceipt {
	const firstKeptIndex = options.pathEntries.findIndex(entry => entry.id === options.firstKeptEntryId);
	const cutIndex = firstKeptIndex >= 0 ? firstKeptIndex : options.pathEntries.length;
	const droppedEntries: SessionMessageEntry[] = [];
	const retainedEntries: SessionMessageEntry[] = [];

	for (let index = 0; index < options.pathEntries.length; index++) {
		const entry = options.pathEntries[index];
		if (entry.type !== "message") continue;
		(index < cutIndex ? droppedEntries : retainedEntries).push(entry);
	}

	const droppedRanges: CompactionDroppedRange[] = [];
	if (droppedEntries.length > 0) {
		droppedRanges.push({
			firstEntryId: droppedEntries[0].id,
			lastEntryId: droppedEntries[droppedEntries.length - 1].id,
			count: droppedEntries.length,
			classes: countClasses(droppedEntries),
		});
	}

	return {
		trigger: options.trigger,
		...(options.triggerReason ? { triggerReason: options.triggerReason } : {}),
		tokensBeforeEstimate: Math.max(0, Math.round(options.tokensBeforeEstimate)),
		tokensAfterEstimate: Math.max(0, Math.round(options.tokensAfterEstimate)),
		messageCountBefore: droppedEntries.length + retainedEntries.length,
		retained: { count: retainedEntries.length, classes: countClasses(retainedEntries) },
		dropped: { count: droppedEntries.length, ranges: droppedRanges },
		durationMs: Math.max(0, Math.round(options.durationMs)),
		...(options.summaryModel ? { summaryModel: options.summaryModel } : {}),
	};
}

const SUMMARY_LIMIT = 360;
const DISPLAY_CLASS_LIMIT = 4;
const DISPLAY_RANGE_LIMIT = 2;

function tokenCount(tokens: number): string {
	return tokens >= 1000 ? `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k` : String(tokens);
}

function classCounts(counts: readonly CompactionMessageClassCount[]): string {
	const displayed = counts.slice(0, DISPLAY_CLASS_LIMIT).map(item => `${item.class} ${item.count}`);
	if (counts.length > DISPLAY_CLASS_LIMIT) displayed.push(`+${counts.length - DISPLAY_CLASS_LIMIT} classes`);
	return displayed.join(", ") || "none";
}

/** One bounded, content-free line suitable for `/compact` and automatic notices. */
export function formatCompactionReceipt(receipt: CompactionReceipt): string {
	const trigger = receipt.triggerReason ? `${receipt.trigger}/${receipt.triggerReason}` : receipt.trigger;
	const ranges = receipt.dropped.ranges.slice(0, DISPLAY_RANGE_LIMIT).map(range => {
		const ids =
			range.firstEntryId === range.lastEntryId ? range.firstEntryId : `${range.firstEntryId}…${range.lastEntryId}`;
		return `${ids} (${range.count}: ${classCounts(range.classes)})`;
	});
	if (receipt.dropped.ranges.length > DISPLAY_RANGE_LIMIT) {
		ranges.push(`+${receipt.dropped.ranges.length - DISPLAY_RANGE_LIMIT} ranges`);
	}
	const model = receipt.summaryModel ? `; model ${receipt.summaryModel}` : "";
	const text =
		`Compacted ${tokenCount(receipt.tokensBeforeEstimate)} → ${tokenCount(receipt.tokensAfterEstimate)} tokens ` +
		`in ${receipt.durationMs}ms (${trigger}; kept ${receipt.retained.count}: ${classCounts(receipt.retained.classes)}; ` +
		`dropped ${receipt.dropped.count}${ranges.length > 0 ? `: ${ranges.join(", ")}` : ""}${model})`;
	return text.length <= SUMMARY_LIMIT ? text : `${text.slice(0, SUMMARY_LIMIT - 1)}…`;
}

/** Estimate the post-compaction context without changing the compaction cut point. */
export function estimateCompactedContextTokens(
	nonMessageTokens: number,
	summaryMessage: AgentMessage,
	retainedMessages: readonly AgentMessage[],
	estimate: (message: AgentMessage) => number,
): number {
	let tokens = nonMessageTokens + estimate(summaryMessage);
	for (const message of retainedMessages) tokens += estimate(message);
	return tokens;
}

export function getLatestCompactionReceipt(entries: readonly SessionEntry[]): CompactionReceipt | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "compaction" || !entry.receipt) continue;
		try {
			return decodeCompactionReceipt(entry.receipt);
		} catch {
			return undefined;
		}
	}
	return undefined;
}
