import { describe, expect, mock, test } from "bun:test";
import {
	captureSessionStateCommandUnhandledRejection,
	diagnosticInputFromError,
	ErrorInbox,
	type DiagnosticEventInput,
} from "../../../src/modes/utils/error-inbox";
import type { SessionEntry } from "../../../src/session/session-entries";
import type { ErrorInboxWriter } from "../../../src/session/error-inbox-ledger";
import { SessionOwnershipLostError } from "../../../src/session/durable-input-queue";
import { SessionStateCommandInFlightError } from "../../../src/session/session-manager";

describe("ErrorInbox", () => {
	test("recordError appends payload with default unread/resolved state", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError("test error 1", "test-source", { nowMs: 1000, id: "test-id" });

		expect(appendCustomEntry).toHaveBeenCalledTimes(1);
		expect(appendCustomEntry.mock.calls[0][0]).toBe("ui_error");
		expect(appendCustomEntry.mock.calls[0][1]).toMatchObject({
			version: 2,
			id: "test-id",
			message: "test error 1",
			firstTimestamp: 1000,
			lastTimestamp: 1000,
			count: 1,
			source: "test-source",
			unread: true,
			resolved: false,
		});

		expect(inbox.getErrors().length).toBe(1);
		expect(inbox.getErrors()[0].id).toBe("test-id");
	});

	test("recordError stamps the owning binary version and digest at emission", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const writer = {
			appendCustomEntry,
			getSessionOwnership: () => ({ buildRevision: { version: "16.0.1", digest: "build-a" } }),
		} as unknown as ErrorInboxWriter;
		const inbox = new ErrorInbox(writer);

		inbox.recordError("versioned failure", "test-source", { nowMs: 1000, id: "versioned" });

		expect(appendCustomEntry.mock.calls[0][1]).toMatchObject({
			buildVersion: "16.0.1",
			buildDigest: "build-a",
		});
		expect(inbox.getErrors()[0]).toMatchObject({ buildVersion: "16.0.1", buildDigest: "build-a" });
	});

	test("dedupes identical errors inside window", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError("msg", "src", { nowMs: 1000, id: "id1" });
		inbox.recordError("msg", "src", { nowMs: 2000 }); // inside 60s

		expect(inbox.getErrors().length).toBe(1);
		const err = inbox.getErrors()[0];
		expect(err.id).toBe("id1"); // keeps first id
		expect(err.count).toBe(2);
		expect(err.firstTimestamp).toBe(1000);
		expect(err.lastTimestamp).toBe(2000);

		expect(appendCustomEntry).toHaveBeenCalledTimes(2);
		expect(appendCustomEntry.mock.calls[1][1]).toMatchObject({
			id: "id1",
			count: 2,
			lastTimestamp: 2000,
			unread: true,
		});
	});

	test("dedupes newest matching event, not just the top item", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError("A", "src", { nowMs: 1000, id: "a" });
		inbox.recordError("B", "src", { nowMs: 2000, id: "b" });
		inbox.recordError("A", "src", { nowMs: 3000, id: "a2" });

		expect(inbox.getErrors().length).toBe(2);
		const a = inbox.getErrors().find(e => e.message === "A");
		expect(a).toBeDefined();
		expect(a!.count).toBe(2);
		expect(a!.lastTimestamp).toBe(3000);
		expect(a!.id).toBe("a");
	});

	test("does not dedupe if identity fields differ", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError({ message: "msg", provider: "a" }, "src", { nowMs: 1000 });
		inbox.recordError({ message: "msg", provider: "b" }, "src", { nowMs: 2000 });

		expect(inbox.getErrors().length).toBe(2);
	});


	test("captures the rejection belt as one session-control error per command", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		expect(
			captureSessionStateCommandUnhandledRejection(
				inbox,
				"session-a",
				new SessionStateCommandInFlightError("command-a"),
			),
		).toBe(true);
		expect(
			captureSessionStateCommandUnhandledRejection(
				inbox,
				"session-a",
				new SessionStateCommandInFlightError("command-a"),
			),
		).toBe(true);
		expect(
			captureSessionStateCommandUnhandledRejection(
				inbox,
				"session-a",
				new SessionStateCommandInFlightError("command-b"),
			),
		).toBe(true);
		expect(captureSessionStateCommandUnhandledRejection(inbox, "session-a", new Error("fatal"))).toBe(false);

		expect(inbox.getErrors()).toHaveLength(2);
		expect(inbox.getErrors().find(error => error.id === "session-control:command-a")).toMatchObject({
			message:
				"SessionStateCommandInFlightError: A session state command is awaiting durable persistence",
			count: 2,
			category: "session-control",
			source: "process-unhandled-rejection",
			errorClass: "SessionStateCommandInFlightError",
			session: "session-a",
			operation: "unhandledRejection:command-a",
			code: "session_state_command_in_flight",
		});
		expect(inbox.getErrors().find(error => error.id === "session-control:command-b")?.count).toBe(1);
	});

	test("does not dedupe outside window", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError("msg", "src", { nowMs: 1000 });
		inbox.recordError("msg", "src", { nowMs: 62000 }); // > 60s

		expect(inbox.getErrors().length).toBe(2);
	});

	test("bounds at 100 errors", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		for (let i = 0; i < 110; i++) {
			inbox.recordError(`err ${i}`, undefined, { nowMs: i * 100 });
		}

		expect(inbox.getErrors().length).toBe(100);
		expect(inbox.getErrors()[0].message).toBe("err 109");
	});

	test("reconcile recovers state, skips malformed and unknown versions", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		const entries = [
			{
				type: "custom",
				customType: "ui_error",
				data: { version: 1, id: "legacy1", timestamp: 1000, message: "v1", count: 1 },
			},
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "v2",
					firstTimestamp: 2000,
					lastTimestamp: 2000,
					message: "v2",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 3,
					id: "v3",
					firstTimestamp: 3000,
					lastTimestamp: 3000,
					message: "v3",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "bad",
					firstTimestamp: 4000,
					message: "missing lastTimestamp",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "bad2",
					firstTimestamp: 5000,
					lastTimestamp: 5000,
					message: "bad count",
					count: 0,
					unread: true,
					resolved: false,
				},
			},
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "bad3",
					firstTimestamp: 6000,
					lastTimestamp: 6000,
					message: "bad status",
					count: 1,
					status: {},
					unread: true,
					resolved: false,
				},
			},
		] as unknown as SessionEntry[];

		inbox.reconcile(entries);

		const ids = inbox.getErrors().map(e => e.id);
		expect(ids).toContain("legacy1");
		expect(ids).toContain("v2");
		expect(ids).not.toContain("v3");
		expect(ids).not.toContain("bad");
		expect(ids).not.toContain("bad2");
		expect(ids).not.toContain("bad3");
	});

	test("reconcile keeps latest update for same id", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		const entries = [
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "same",
					firstTimestamp: 1000,
					lastTimestamp: 1000,
					message: "upd1",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "same",
					firstTimestamp: 1000,
					lastTimestamp: 2000,
					message: "upd2",
					count: 2,
					unread: false,
					resolved: true,
				},
			},
		] as unknown as SessionEntry[];

		inbox.reconcile(entries);

		expect(inbox.getErrors().length).toBe(1);
		const err = inbox.getErrors()[0];
		expect(err.message).toBe("upd2");
		expect(err.count).toBe(2);
		expect(err.resolved).toBe(true);
	});

	test("reconcile clears all records before a clear marker and keeps records after it", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		const entries = [
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "before",
					firstTimestamp: 1000,
					lastTimestamp: 1000,
					message: "before",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
			{ type: "custom", customType: "ui_error_clear", data: { version: 1, clearedAt: 1500 } },
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "after",
					firstTimestamp: 2000,
					lastTimestamp: 2000,
					message: "after",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
		] as unknown as SessionEntry[];

		inbox.reconcile(entries);

		expect(inbox.getErrors().length).toBe(1);
		expect(inbox.getErrors()[0].id).toBe("after");
	});

	test("reconcile ignores malformed clear markers", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		const entries = [
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "keep",
					firstTimestamp: 1000,
					lastTimestamp: 1000,
					message: "keep",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
			{ type: "custom", customType: "ui_error_clear", data: { clearedAt: 1500 } }, // missing version
			{ type: "custom", customType: "ui_error_clear", data: { version: 2, clearedAt: 1500 } }, // unsupported version
		] as unknown as SessionEntry[];

		inbox.reconcile(entries);

		expect(inbox.getErrors().length).toBe(1);
		expect(inbox.getErrors()[0].id).toBe("keep");
	});

	test("clear appends a marker and empties the ledger", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError("msg", "src", { nowMs: 1000 });
		inbox.clear(1500);

		expect(inbox.getErrors().length).toBe(0);
		expect(appendCustomEntry).toHaveBeenCalledTimes(2);
		expect(appendCustomEntry.mock.calls[1][0]).toBe("ui_error_clear");
		expect(appendCustomEntry.mock.calls[1][1]).toMatchObject({ version: 1, clearedAt: 1500 });
	});

	test("resolve marks a single error resolved and preserves the occurrence timestamp", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError("msg", "src", { nowMs: 1000, id: "x" });
		const ok = inbox.resolve("x");

		expect(ok).toBe(true);
		expect(inbox.getErrors()[0].resolved).toBe(true);
		expect(inbox.getErrors()[0].unread).toBe(false);
		expect(inbox.getErrors()[0].lastTimestamp).toBe(1000);
		expect(appendCustomEntry).toHaveBeenCalledTimes(2);
		expect(appendCustomEntry.mock.calls[1][1]).toMatchObject({
			id: "x",
			resolved: true,
			unread: false,
			lastTimestamp: 1000,
			version: 2,
		});
	});

	test("resolve returns false for unknown id", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		expect(inbox.resolve("missing")).toBe(false);
		expect(appendCustomEntry).toHaveBeenCalledTimes(0);
	});

	test("delivers record notifications asynchronously", async () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });
		const subscriber = mock(() => {});
		inbox.subscribe(subscriber);

		inbox.recordError("msg", "src", { nowMs: 1000, id: "x" });

		expect(subscriber).toHaveBeenCalledTimes(0);
		await Promise.resolve();
		expect(subscriber).toHaveBeenCalledTimes(1);
	});

	test("coalesces mutation bursts into one notification", async () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });
		const subscriber = mock(() => {});
		inbox.subscribe(subscriber);

		inbox.recordError("one", undefined, { nowMs: 1000 });
		inbox.recordError("two", undefined, { nowMs: 2000 });
		inbox.recordError("three", undefined, { nowMs: 3000 });

		expect(subscriber).toHaveBeenCalledTimes(0);
		await Promise.resolve();
		expect(subscriber).toHaveBeenCalledTimes(1);
	});

	test("does not notify an unsubscribed subscriber", async () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });
		const subscriber = mock(() => {});
		const unsubscribe = inbox.subscribe(subscriber);

		inbox.recordError("queued", undefined, { nowMs: 1000 });
		unsubscribe();
		await Promise.resolve();
		inbox.recordError("later", undefined, { nowMs: 2000 });
		await Promise.resolve();

		expect(subscriber).toHaveBeenCalledTimes(0);
	});

	test("notifies after clear, reconcile, and successful resolve", async () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });
		const subscriber = mock(() => {});
		inbox.subscribe(subscriber);

		inbox.clear(500);
		await Promise.resolve();
		expect(subscriber).toHaveBeenCalledTimes(1);
		expect(appendCustomEntry).toHaveBeenCalledTimes(1);

		inbox.reconcile([
			{
				type: "custom",
				customType: "ui_error",
				data: {
					version: 2,
					id: "recovered",
					firstTimestamp: 1000,
					lastTimestamp: 1000,
					message: "recovered",
					count: 1,
					unread: true,
					resolved: false,
				},
			},
		] as unknown as SessionEntry[]);
		await Promise.resolve();
		expect(subscriber).toHaveBeenCalledTimes(2);
		expect(appendCustomEntry).toHaveBeenCalledTimes(1);

		expect(inbox.resolve("recovered")).toBe(true);
		await Promise.resolve();
		expect(subscriber).toHaveBeenCalledTimes(3);
		expect(appendCustomEntry).toHaveBeenCalledTimes(2);

		expect(inbox.resolve("missing")).toBe(false);
		await Promise.resolve();
		expect(subscriber).toHaveBeenCalledTimes(3);
	});

	test("silent persistence failure on record", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => {
			throw new Error("Disk full");
		});
		const inbox = new ErrorInbox({ appendCustomEntry });

		// Should not throw
		inbox.recordError("msg", "src");
		expect(inbox.getErrors().length).toBe(1);
	});

	test("silent persistence failure on clear", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => {
			throw new Error("Disk full");
		});
		const inbox = new ErrorInbox({ appendCustomEntry });

		inbox.recordError("msg", "src");
		inbox.clear();
		expect(inbox.getErrors().length).toBe(0);
	});

	test("structured input persists all diagnostic context fields", () => {
		const appendCustomEntry = mock<(type: string, data?: unknown) => string>(() => "");
		const inbox = new ErrorInbox({ appendCustomEntry });

		const input: DiagnosticEventInput = {
			message: "boom",
			source: "provider",
			category: "quota",
			cause: "rate-limit",
			disposition: "retrying 1/2 in 8s",
			detail: "429 Request was aborted",
			provider: "anthropic",
			model: "claude-3-5-sonnet",
			session: "sess-1",
			agent: "agent-1",
			tool: "tool-1",
			job: "job-1",
			operation: "chat",
			status: 429,
			code: "rate_limit",
			retry: true,
			reset: 1234567890000,
			requestFingerprint: "fp-1",
			logPointer: "log-1",
			causeChain: ["a", "b"],
		};
		inbox.recordError(input, "src", { nowMs: 1000, id: "full" });

		expect(appendCustomEntry.mock.calls[0][1]).toMatchObject({
			message: "boom",
			source: "provider",
			category: "quota",
			cause: "rate-limit",
			disposition: "retrying 1/2 in 8s",
			detail: "429 Request was aborted",
			provider: "anthropic",
			model: "claude-3-5-sonnet",
			session: "sess-1",
			agent: "agent-1",
			tool: "tool-1",
			job: "job-1",
			operation: "chat",
			status: 429,
			code: "rate_limit",
			retry: true,
			reset: 1234567890000,
			requestFingerprint: "fp-1",
			logPointer: "log-1",
			causeChain: ["a", "b"],
		});
	});
	test("ownership action round-trips, participates in dedupe, and malformed actions fall back safely", () => {
		const entries: SessionEntry[] = [];
		const inbox = new ErrorInbox({
			appendCustomEntry(type, data) {
				entries.push({
					type: "custom",
					id: `entry-${entries.length}`,
					parentId: null,
					timestamp: new Date().toISOString(),
					customType: type,
					data,
				});
				return "";
			},
		});
		const action = {
			kind: "focus_cmux_owner" as const,
			sessionFile: "/tmp/session.jsonl",
			sessionId: "session-1",
			lostOwnerEpoch: "epoch-old",
		};

		inbox.recordError({ message: "ownership lost", action }, undefined, { nowMs: 1000, id: "ownership" });
		inbox.recordError({ message: "ownership lost", action: { ...action } }, undefined, { nowMs: 2000 });
		expect(inbox.getErrors()).toHaveLength(1);
		expect(inbox.getErrors()[0].count).toBe(2);

		const recovered = new ErrorInbox({ appendCustomEntry: () => "" });
		recovered.reconcile(entries);
		expect(recovered.getErrors()[0].action).toEqual(action);

		const persisted = entries.at(-1);
		expect(persisted?.type).toBe("custom");
		const malformed = {
			...(persisted as Extract<SessionEntry, { type: "custom" }>),
			id: "malformed-entry",
			data: {
				...((persisted as Extract<SessionEntry, { type: "custom" }>).data as Record<string, unknown>),
				id: "malformed",
				action: { ...action, unexpected: true },
			},
		} as SessionEntry;
		recovered.reconcile([malformed]);
		expect(recovered.getErrors()).toHaveLength(1);
		expect(recovered.getErrors()[0].id).toBe("malformed");
		expect(recovered.getErrors()[0].action).toBeUndefined();
	});

	test("converts only ownership loss errors into focus actions", () => {
		const converted = diagnosticInputFromError(
			new SessionOwnershipLostError("session-1", "epoch-old"),
			"/tmp/session.jsonl",
		);
		expect(converted).toMatchObject({
			action: {
				kind: "focus_cmux_owner",
				sessionFile: "/tmp/session.jsonl",
				sessionId: "session-1",
				lostOwnerEpoch: "epoch-old",
			},
		});
		expect(diagnosticInputFromError(new Error("ordinary"), "/tmp/session.jsonl")).toBe("ordinary");
	});
});
