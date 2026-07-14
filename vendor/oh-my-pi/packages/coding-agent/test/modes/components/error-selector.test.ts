import { beforeAll, describe, expect, mock, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import {
	ErrorSelectorComponent,
	formatDiagnosticDetail,
	formatDiagnosticLabel,
} from "../../../src/modes/components/error-selector";
import { initTheme } from "../../../src/modes/theme/theme";
import type { DiagnosticEvent } from "../../../src/modes/utils/error-inbox";
import type { FocusCmuxOwnerResult } from "../../../src/modes/utils/cmux-owner-navigation";

function renderText(component: { render(width: number): readonly string[] }, width = 80): string {
	return stripVTControlCharacters(component.render(width).join("\n"));
}

describe("ErrorSelectorComponent", () => {
	const dummyEvent: DiagnosticEvent = {
		id: "err-1",
		firstTimestamp: 1000,
		lastTimestamp: 2000,
		message: "Some error msg",
		count: 2,
		provider: "openai",
		model: "gpt-4",
		status: 400,
		code: "insufficient_quota",
		requestFingerprint: "fingerprint-123",
		causeChain: ["Cause 1", "Cause 2"],
		unread: true,
		resolved: false,
	};

	beforeAll(() => {
		initTheme(false);
	});

	test("formatDiagnosticDetail includes all structured fields", () => {
		const content = formatDiagnosticDetail(dummyEvent);
		expect(content).toContain("Occurrences: ");
		expect(content).toContain("2");
		expect(content).toContain("err-1");
		expect(content).toContain("openai");
		expect(content).toContain("gpt-4");
		expect(content).toContain("400");
		expect(content).toContain("insufficient_quota");
		expect(content).toContain("fingerprint-123");
		expect(content).toContain("Some error msg");
		expect(content).toContain("1. Cause 1");
		expect(content).toContain("2. Cause 2");
		expect(content).toContain("Unread: true");
		expect(content).toContain("Resolved: false");
		expect(content).toContain("Resolve: :errors resolve err-1");
	});

	test("formatDiagnosticDetail handles missing fields gracefully", () => {
		const minimal: DiagnosticEvent = {
			id: "min",
			firstTimestamp: 1000,
			lastTimestamp: 1000,
			message: "minimal msg",
			count: 1,
			unread: true,
			resolved: false,
		};
		const content = formatDiagnosticDetail(minimal);
		expect(content).toContain("Timestamp: ");
		expect(content).toContain("minimal msg");
		expect(content).not.toContain("Provider:");
		expect(content).not.toContain("Cause chain:");
	});

	test("resolved and unread rows are labeled in the list", () => {
		const resolved: DiagnosticEvent = { ...dummyEvent, id: "resolved-1", unread: false, resolved: true };
		const read: DiagnosticEvent = { ...dummyEvent, id: "read-1", unread: false, resolved: false };
		const selector = new ErrorSelectorComponent([dummyEvent, resolved, read], mock());
		const text = renderText(selector);
		expect(text).toContain("[unread]");
		expect(text).toContain("[resolved]");
	});

	test("open fleet incidents are distinct without overriding unread or resolved state", () => {
		const openIncident: DiagnosticEvent = {
			...dummyEvent,
			id: "incident-open",
			source: "fleet",
			category: "fleet-incident",
			status: "open",
		};
		const closedIncident: DiagnosticEvent = {
			...openIncident,
			id: "incident-closed",
			status: "closed",
			resolved: true,
		};

		expect(formatDiagnosticLabel(openIncident)).toStartWith("[unread] [incident open] ");
		expect(formatDiagnosticDetail(openIncident)).toContain("[incident open]");
		expect(formatDiagnosticLabel(closedIncident)).toStartWith("[resolved] ");
		expect(formatDiagnosticLabel(closedIncident)).not.toContain("[incident open]");
		expect(formatDiagnosticLabel(dummyEvent)).toStartWith("[unread] ");

		const text = renderText(new ErrorSelectorComponent([openIncident, closedIncident], mock()));
		expect(text).toContain("[unread] [incident open]");
		expect(text).toContain("[resolved]");
	});

	test("empty state displays 'No recent errors' in list", () => {
		const selector = new ErrorSelectorComponent([], mock());
		const text = renderText(selector);
		expect(text).toContain("No recent errors");
	});

	test("selection change updates the detail pane", () => {
		const second: DiagnosticEvent = {
			id: "err-2",
			firstTimestamp: 3000,
			lastTimestamp: 4000,
			message: "Second error detail",
			count: 1,
			provider: "anthropic",
			unread: true,
			resolved: false,
		};
		const onDismiss = mock();
		const selector = new ErrorSelectorComponent([dummyEvent, second], onDismiss);
		const selectList = selector.getSelectList();

		selectList.clickItem(1);

		expect(onDismiss).toHaveBeenCalledTimes(1);
		const text = renderText(selector);
		expect(text).toContain("Second error detail");
		expect(text).toContain("anthropic");
	});
	test("ownership action invokes once and keeps the selector open on failure", async () => {
		const actionEvent: DiagnosticEvent = {
			...dummyEvent,
			action: {
				kind: "focus_cmux_owner",
				sessionFile: "/tmp/session.jsonl",
				sessionId: "session-1",
				lostOwnerEpoch: "epoch-old",
			},
		};
		const result = Promise.withResolvers<{ kind: "unavailable" }>();
		let invocations = 0;
		let dismissals = 0;
		const selector = new ErrorSelectorComponent(
			[actionEvent],
			() => {
				dismissals++;
			},
			{
				onAction: async () => {
					invocations++;
					return await result.promise;
				},
			},
		);

		expect(renderText(selector)).toContain("Focus active cmux session: Enter");
		selector.getSelectList().clickItem(0);
		selector.getSelectList().clickItem(0);
		expect(invocations).toBe(1);
		result.resolve({ kind: "unavailable" });
		await result.promise;
		await Bun.sleep(0);

		expect(dismissals).toBe(0);
		expect(renderText(selector)).toContain(
			"The active cmux session is no longer available. This view remains read-only.",
		);
	});
	test("ownership actions remain isolated when selection changes while requests are pending", async () => {
		const first: DiagnosticEvent = {
			...dummyEvent,
			message: "First ownership error",
			action: {
				kind: "focus_cmux_owner",
				sessionFile: "/tmp/first.jsonl",
				sessionId: "session-1",
				lostOwnerEpoch: "epoch-1",
			},
		};
		const second: DiagnosticEvent = {
			...dummyEvent,
			id: "err-2",
			message: "Second ownership error",
			action: {
				kind: "focus_cmux_owner",
				sessionFile: "/tmp/second.jsonl",
				sessionId: "session-2",
				lostOwnerEpoch: "epoch-2",
			},
		};
		const firstResult = Promise.withResolvers<FocusCmuxOwnerResult>();
		const secondResult = Promise.withResolvers<FocusCmuxOwnerResult>();
		const invocations: string[] = [];
		const selector = new ErrorSelectorComponent([first, second], mock(), {
			onAction: async action => {
				invocations.push(action.sessionId);
				return await (action.sessionId === "session-1" ? firstResult.promise : secondResult.promise);
			},
		});
		const selectList = selector.getSelectList();

		selectList.clickItem(0);
		selectList.clickItem(0);
		selectList.clickItem(1);
		expect(invocations).toEqual(["session-1", "session-2"]);
		expect(renderText(selector)).toContain("Second ownership error");

		firstResult.resolve({ kind: "unavailable" });
		await firstResult.promise;
		await Bun.sleep(0);
		expect(renderText(selector)).toContain("Second ownership error");
		expect(renderText(selector)).not.toContain("The active cmux session is no longer available");

		secondResult.resolve({ kind: "failed", reason: "second focus failed" });
		await secondResult.promise;
		await Bun.sleep(0);
		expect(renderText(selector)).toContain("Second ownership error");
		expect(renderText(selector)).toContain("second focus failed");
		expect(renderText(selector)).not.toContain("The active cmux session is no longer available");

		selectList.handleWheel(-1);
		expect(renderText(selector)).toContain("First ownership error");
		expect(renderText(selector)).toContain("The active cmux session is no longer available");
		expect(renderText(selector)).not.toContain("second focus failed");
	});


});
