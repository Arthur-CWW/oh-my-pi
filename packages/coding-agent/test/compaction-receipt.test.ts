import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
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
	createOpenAiRemoteCompactionAttemptStarted,
	decodeOpenAiRemoteCompactionAttemptRecord,
	estimateCompactedContextTokens,
	formatCompactionReceipt,
	getLatestCompactionReceipt,
	OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE,
} from "@oh-my-pi/pi-coding-agent/session/compaction-receipt";
import type {
	CompactionEntry,
	SessionEntry,
	SessionHeader,
	SessionMessageEntry,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";
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

	it("durably settles interrupted remote compaction attempts without changing retry source identity", async () => {
		using tempDir = TempDir.createSync("@omp-compaction-attempt-");
		const previousConfigRoot = process.env.OMP_CONFIG_ROOT;
		const previousSessionControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.OMP_CONFIG_ROOT = path.join(tempDir.path(), "config");
		process.env.OMP_SESSION_CONTROL_DB = path.join(tempDir.path(), "session-control.db");
		try {
			const sessionDir = path.join(tempDir.path(), "sessions");
			const manager = SessionManager.create(tempDir.path(), sessionDir);
			await manager.ensureOnDisk();
			const firstKeptEntryId = manager.appendMessage({
				role: "user",
				content: "source turn",
				timestamp: Date.now(),
			});
			const started = createOpenAiRemoteCompactionAttemptStarted({
				sessionId: manager.getSessionId(),
				pathEntries: manager.getBranch(),
				firstKeptEntryId,
				provider: "openai",
				model: "gpt-5.1",
			});
			manager.appendCustomEntry(OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE, started);
			await manager.flush();

			const sessionFile = manager.getSessionFile();
			if (!sessionFile) throw new Error("expected persisted session file");
			const persistedBeforeClose = fs
				.readFileSync(sessionFile, "utf8")
				.trimEnd()
				.split("\n")
				.map(line => JSON.parse(line) as Record<string, unknown>);
			expect(
				persistedBeforeClose.some(
					entry =>
						entry.type === "custom" &&
						entry.customType === OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE &&
						decodeOpenAiRemoteCompactionAttemptRecord(entry.data)?.status === "started",
				),
			).toBe(true);
			expect(
				persistedBeforeClose.some(
					entry =>
						entry.type === "custom" &&
						entry.customType === OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE &&
						decodeOpenAiRemoteCompactionAttemptRecord(entry.data)?.status === "interrupted",
				),
			).toBe(false);
			await manager.close();

			const reopened = await SessionManager.open(sessionFile, sessionDir);
			const attempts = reopened.getEntries().flatMap(entry => {
				if (entry.type !== "custom" || entry.customType !== OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE) {
					return [];
				}
				return [decodeOpenAiRemoteCompactionAttemptRecord(entry.data)];
			});
			expect(attempts).toEqual([
				expect.objectContaining({ attemptId: started.attemptId, status: "started" }),
				expect.objectContaining({ attemptId: started.attemptId, status: "interrupted" }),
			]);
			const persistedAfterOpen = fs
				.readFileSync(sessionFile, "utf8")
				.trimEnd()
				.split("\n")
				.map(line => JSON.parse(line) as Record<string, unknown>);
			expect(
				persistedAfterOpen.some(
					entry =>
						entry.type === "custom" &&
						entry.customType === OPENAI_REMOTE_COMPACTION_ATTEMPT_CUSTOM_TYPE &&
						decodeOpenAiRemoteCompactionAttemptRecord(entry.data)?.attemptId === started.attemptId &&
						decodeOpenAiRemoteCompactionAttemptRecord(entry.data)?.status === "interrupted",
				),
			).toBe(true);

			const retry = createOpenAiRemoteCompactionAttemptStarted({
				sessionId: reopened.getSessionId(),
				pathEntries: reopened.getBranch(),
				firstKeptEntryId,
				provider: "openai",
				model: "gpt-5.1",
			});
			expect(retry.source.digest).toBe(started.source.digest);
			expect(retry.source.sourceLeafId).toBe(started.source.sourceLeafId);
			expect(retry.source.sourceLeafId).toBe(firstKeptEntryId);
			await reopened.close();
		} finally {
			if (previousConfigRoot === undefined) delete process.env.OMP_CONFIG_ROOT;
			else process.env.OMP_CONFIG_ROOT = previousConfigRoot;
			if (previousSessionControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
			else process.env.OMP_SESSION_CONTROL_DB = previousSessionControlDb;
		}
	});
});
