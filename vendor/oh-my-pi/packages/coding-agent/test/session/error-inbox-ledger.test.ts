import { describe, expect, test } from "bun:test";
import { ErrorInbox } from "../../src/modes/utils/error-inbox";
import {
	appendErrorInboxEvent,
	type DiagnosticEvent,
	type ErrorInboxWriter,
} from "../../src/session/error-inbox-ledger";
import type { SessionEntry } from "../../src/session/session-entries";

function diagnosticEvent(overrides: Partial<DiagnosticEvent> = {}): DiagnosticEvent {
	return {
		id: "error-1",
		firstTimestamp: 1_000,
		lastTimestamp: 1_000,
		message: "boom",
		count: 1,
		unread: true,
		resolved: false,
		...overrides,
	};
}

function customEntry(customType: string, data: unknown, id: string): SessionEntry {
	return {
		type: "custom",
		id,
		parentId: null,
		timestamp: new Date(0).toISOString(),
		customType,
		data,
	};
}

function checkpoint(rolloutId: string): SessionEntry {
	return customEntry(
		"rollout-checkpoint",
		{
			type: "rollout-checkpoint",
			checkpointId: `checkpoint-${rolloutId}`,
			rolloutId,
			commandId: "00000000-0000-4000-8000-000000000001",
			ownerEpoch: "owner-1",
			expectedDigest: "build-owned",
			journalCheckpoint: {
				sessionId: "session-1",
				sessionFile: "/tmp/session.jsonl",
				checkpointId: `checkpoint-${rolloutId}`,
			},
			children: [],
			unresumableReasons: [],
			autoResumeAllowed: true,
			pauseProvenance: "rollout",
			outcome: "Checkpointed",
			createdAt: new Date(0).toISOString(),
		},
		`checkpoint-${rolloutId}`,
	);
}

function autoResume(rolloutId: string): SessionEntry {
	return customEntry(
		"rollout-auto-resume",
		{
			decisionId: `decision-${rolloutId}`,
			rolloutId,
			checkpointId: `checkpoint-${rolloutId}`,
			phase: "AutoResumed",
			resumedAgentIds: [],
			excludedAgentIds: [],
			pauseProvenance: "rollout",
			committedAt: new Date(0).toISOString(),
		},
		`resume-${rolloutId}`,
	);
}

describe("ErrorInbox rollout provenance", () => {
	test("infers the ownership digest and latest durable rollout evidence", () => {
		const entries = [checkpoint("rollout-checkpoint")];
		const writes: Array<{ type: string; data: unknown }> = [];
		const writer = {
			appendCustomEntry(type: string, data?: unknown) {
				writes.push({ type, data });
				return `entry-${writes.length}`;
			},
			getSessionOwnership() {
				return { buildRevision: { digest: "build-owned" } };
			},
			getEntries() {
				return entries;
			},
		} as unknown as ErrorInboxWriter;

		expect(appendErrorInboxEvent(writer, diagnosticEvent())).toBe(true);
		entries.push(autoResume("rollout-auto-resume"));
		expect(appendErrorInboxEvent(writer, diagnosticEvent({ id: "error-2" }))).toBe(true);

		expect(writes[0]).toMatchObject({
			type: "ui_error",
			data: { version: 2, buildDigest: "build-owned", fleetRolloutId: "rollout-checkpoint" },
		});
		expect(writes[1]).toMatchObject({
			type: "ui_error",
			data: { version: 2, buildDigest: "build-owned", fleetRolloutId: "rollout-auto-resume" },
		});
	});

	test("preserves explicitly supplied provenance facets", () => {
		const writes: unknown[] = [];
		const writer = {
			appendCustomEntry(_type: string, data?: unknown) {
				writes.push(data);
				return "entry-1";
			},
			getSessionOwnership() {
				return { buildRevision: { digest: "build-inferred" } };
			},
			getEntries() {
				return [autoResume("rollout-inferred")];
			},
		} as unknown as ErrorInboxWriter;

		appendErrorInboxEvent(
			writer,
			diagnosticEvent({ buildDigest: "build-explicit", fleetRolloutId: "rollout-explicit" }),
		);

		expect(writes[0]).toMatchObject({
			buildDigest: "build-explicit",
			fleetRolloutId: "rollout-explicit",
		});
	});

	test("keeps append-only writers and records without rollout evidence valid", () => {
		const writes: unknown[] = [];
		const writer: ErrorInboxWriter = {
			appendCustomEntry(_type: string, data?: unknown) {
				writes.push(data);
				return "entry-1";
			},
		};

		expect(appendErrorInboxEvent(writer, diagnosticEvent())).toBe(true);
		expect(writes[0]).toMatchObject({ version: 2, id: "error-1" });
		expect(writes[0]).toHaveProperty("buildDigest", undefined);
		expect(writes[0]).toHaveProperty("fleetRolloutId", undefined);
	});

	test("round-trips provenance facets and includes them in dedupe identity", () => {
		const writes: unknown[] = [];
		const inbox = new ErrorInbox({
			appendCustomEntry(_type: string, data?: unknown) {
				writes.push(data);
				return `entry-${writes.length}`;
			},
		});
		inbox.reconcile([
			customEntry(
				"ui_error",
				{ ...diagnosticEvent({ buildDigest: "build-a", fleetRolloutId: "rollout-a" }), version: 2 },
				"persisted-error",
			),
		]);

		inbox.recordError({ message: "boom", buildDigest: "build-a", fleetRolloutId: "rollout-a" }, undefined, {
			nowMs: 2_000,
		});
		expect(inbox.getErrors()).toHaveLength(1);
		expect(inbox.getErrors()[0]).toMatchObject({
			count: 2,
			buildDigest: "build-a",
			fleetRolloutId: "rollout-a",
		});

		inbox.recordError({ message: "boom", buildDigest: "build-b", fleetRolloutId: "rollout-a" }, undefined, {
			nowMs: 3_000,
		});
		expect(inbox.getErrors()).toHaveLength(2);
		expect(writes[0]).toMatchObject({ buildDigest: "build-a", fleetRolloutId: "rollout-a" });
	});
});
