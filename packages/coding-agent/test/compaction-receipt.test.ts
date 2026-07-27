import { describe, expect, it } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	createCompactionSummaryMessage,
	DEFAULT_COMPACTION_SETTINGS,
	estimateTokens,
	prepareCompaction,
} from "@oh-my-pi/pi-agent-core/compaction";
import { projectJournalEntries } from "@oh-my-pi/pi-coding-agent/journal/projection";
import {
	createCompactionReceipt,
	estimateCompactedContextTokens,
	formatCompactionReceipt,
	getLatestCompactionReceipt,
} from "@oh-my-pi/pi-coding-agent/session/compaction-receipt";
import type {
	CompactionEntry,
	SessionEntry,
	SessionHeader,
	SessionMessageEntry,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import * as snapcompact from "@oh-my-pi/snapcompact";

const timestamp = "2026-07-15T00:00:00.000Z";

function usage(input: number) {
	return {
		input,
		output: 10,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: input + 10,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function syntheticBranch(): SessionEntry[] {
	const entries: SessionMessageEntry[] = [];
	const add = (message: AgentMessage) => {
		const id = `message-${entries.length + 1}`;
		entries.push({
			type: "message",
			id,
			parentId: entries.at(-1)?.id ?? null,
			timestamp,
			message,
		});
	};
	for (let turn = 0; turn < 4; turn++) {
		add({ role: "user", content: `private-user-${turn} ${"context ".repeat(900)}`, timestamp: turn * 2 });
		add({
			role: "assistant",
			content: [{ type: "text", text: `private-assistant-${turn} ${"answer ".repeat(900)}` }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: usage(60_000),
			stopReason: "stop",
			timestamp: turn * 2 + 1,
		});
	}
	return entries;
}

describe("compaction visibility receipt", () => {
	it("records a real local compaction without persisting dropped content", async () => {
		const branch = syntheticBranch();
		const preparation = prepareCompaction(branch, {
			...DEFAULT_COMPACTION_SETTINGS,
			keepRecentTokens: 1_000,
		});
		expect(preparation).toBeDefined();
		if (!preparation) throw new Error("synthetic session did not reach a compaction cut point");

		const result = await snapcompact.compact(preparation, { maxFrames: 1 });
		const summaryMessage = createCompactionSummaryMessage(
			result.summary,
			result.tokensBefore,
			timestamp,
			result.shortSummary,
		);
		const tokensAfterEstimate = estimateCompactedContextTokens(
			100,
			summaryMessage,
			preparation.recentMessages,
			estimateTokens,
		);
		const receipt = createCompactionReceipt({
			trigger: "manual",
			pathEntries: branch,
			firstKeptEntryId: result.firstKeptEntryId,
			tokensBeforeEstimate: result.tokensBefore,
			tokensAfterEstimate,
			durationMs: 17.4,
		});

		expect(receipt.messageCountBefore).toBe(branch.length);
		expect(receipt.retained.count + receipt.dropped.count).toBe(receipt.messageCountBefore);
		expect(receipt.retained.count).toBeGreaterThan(0);
		expect(receipt.dropped.count).toBeGreaterThan(0);
		expect(receipt.dropped.ranges).toEqual([
			expect.objectContaining({
				firstEntryId: "message-1",
				count: receipt.dropped.count,
			}),
		]);
		expect(receipt.summaryModel).toBeUndefined();
		expect(JSON.stringify(receipt)).not.toContain("private-user");
		expect(JSON.stringify(receipt)).not.toContain("private-assistant");

		const compactionEntry: CompactionEntry = {
			type: "compaction",
			id: "compaction-1",
			parentId: branch.at(-1)?.id ?? null,
			timestamp,
			summary: result.summary,
			shortSummary: result.shortSummary,
			firstKeptEntryId: result.firstKeptEntryId,
			tokensBefore: result.tokensBefore,
			receipt,
		};
		const header: SessionHeader = {
			type: "session",
			version: 4,
			id: "synthetic-session",
			timestamp,
			cwd: "/tmp/synthetic",
		};
		const projection = projectJournalEntries([header, ...branch, compactionEntry]);
		expect(projection).not.toBeNull();
		expect(getLatestCompactionReceipt(projection?.entries ?? [])).toEqual(receipt);
	});

	it("renders a bounded manual or automatic notice with summary model provenance", () => {
		const branch = syntheticBranch();
		const receipt = createCompactionReceipt({
			trigger: "token_threshold",
			triggerReason: "threshold",
			pathEntries: branch,
			firstKeptEntryId: "message-7",
			tokensBeforeEstimate: 120_500,
			tokensAfterEstimate: 24_250,
			durationMs: 812.8,
			summaryModel: "anthropic/claude-sonnet-4-5",
		});
		const notice = formatCompactionReceipt(receipt);

		expect(notice.length).toBeLessThanOrEqual(360);
		expect(notice).toContain("Compacted 121k → 24k tokens");
		expect(notice).toContain("token_threshold/threshold");
		expect(notice).toContain("kept 2");
		expect(notice).toContain("dropped 6");
		expect(notice).toContain("model anthropic/claude-sonnet-4-5");
	});
});
