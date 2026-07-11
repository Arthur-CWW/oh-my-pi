import { beforeAll, describe, expect, mock, test } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import { ErrorSelectorComponent, formatDiagnosticDetail } from "../../../src/modes/components/error-selector";
import { initTheme } from "../../../src/modes/theme/theme";
import type { DiagnosticEvent } from "../../../src/modes/utils/error-inbox";

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
		expect(content).toContain("Resolve: /errors resolve err-1");
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
});
