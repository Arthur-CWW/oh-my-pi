import { beforeAll, describe, expect, test } from "bun:test";
import { Effect, Exit, Scope } from "effect";
import { stripVTControlCharacters } from "node:util";
import {
	ErrorSelectorComponent,
	formatDiagnosticDetail,
	formatDiagnosticLabel,
} from "../../../src/modes/components/error-selector";
import { mountMvuRuntime } from "../../../src/modes/mvu/runtime";
import { initTheme } from "../../../src/modes/theme/theme";
import type { DiagnosticEvent } from "../../../src/modes/utils/error-inbox";
import type { FocusCmuxOwnerResult } from "../../../src/modes/utils/cmux-owner-navigation";

function renderText(component: { render(width: number): readonly string[] }, width = 80): string {
	return stripVTControlCharacters(component.render(width).join("\n"));
}
async function mountSelectorRuntime(selector: ErrorSelectorComponent): Promise<Scope.Scope> {
	const scope = Scope.makeUnsafe("sequential");
	const spec = selector.getRouteSpec();
	const runtime = await Effect.runPromise(Scope.provide(scope)(mountMvuRuntime({
		componentId: spec.componentId,
		initialModel: spec.initialModel,
		update: spec.update,
		interpret: spec.interpret,
		boundary: spec.boundary,
		inputCapacity: 32,
		messageCapacity: 64,
		commandCapacity: 32,
	})));
	selector.bindRuntime(message => {
		Effect.runFork(runtime.dispatch(message));
	});
	return scope;
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
		buildVersion: "16.0.1",
		buildDigest: "build-a",
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
		expect(content).toContain("Build: 16.0.1");
		expect(content).toContain("Build digest: build-a");
		expect(content).toContain("Some error msg");
		expect(content).toContain("1. Cause 1");
		expect(content).toContain("2. Cause 2");
		expect(content).toContain("Unread: true");
		expect(content).toContain("Resolved: false");
		expect(content).toContain("Resolve: :errors resolve err-1");
	});

	test("keeps a long build digest on one detail line at 140 columns", () => {
		const digest = `sha256:${"a".repeat(64)}`;
		const selector = new ErrorSelectorComponent([{ ...dummyEvent, buildDigest: digest }], () => {});

		expect(renderText(selector, 140)).toContain(`Build digest: ${digest}`);
	});

	test("keeps the selected detail visible within a half-height 30-row HUD", () => {
		const errors = Array.from({ length: 10 }, (_, index) => ({
			...dummyEvent,
			id: `err-${index}`,
		}));
		const selector = new ErrorSelectorComponent(errors, () => {});
		const lines = selector.render(140).map(line => stripVTControlCharacters(line));
		const detailStart = lines.findIndex(line => line.includes("Occurrences:"));

		expect(detailStart).toBeGreaterThanOrEqual(0);
		expect(detailStart).toBeLessThan(15);
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
		const selector = new ErrorSelectorComponent([dummyEvent, resolved, read], () => {});
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

		const text = renderText(new ErrorSelectorComponent([openIncident, closedIncident], () => {}));
		expect(text).toContain("[unread] [incident open]");
		expect(text).toContain("[resolved]");
	});

	test("empty state displays 'No recent errors' in list", () => {
		const selector = new ErrorSelectorComponent([], () => {});
		const text = renderText(selector);
		expect(text).toContain("No recent errors");
	});

	test("supports Vim navigation through the errors HUD", () => {
		const errors = Array.from({ length: 8 }, (_, index) => ({
			...dummyEvent,
			id: `err-${index}`,
			message: `Error ${index}`,
		}));
		const selector = new ErrorSelectorComponent(errors, () => {});
		const hints = renderText(selector);
		expect(hints).toContain("j down");
		expect(hints).toContain("shift+g last");
		expect(hints).toContain("ctrl+d half-page down");
		const selectList = selector.getSelectList();

		selector.handleInput("j");
		expect(selectList.getSelectedItem()?.value).toBe("err-1");
		selector.handleInput("k");
		expect(selectList.getSelectedItem()?.value).toBe("err-0");
		selector.handleInput("G");
		expect(selectList.getSelectedItem()?.value).toBe("err-7");
		selector.handleInput("g");
		expect(selectList.getSelectedItem()?.value).toBe("err-0");
		selector.handleInput("\x04");
		expect(selectList.getSelectedItem()?.value).toBe("err-2");
		selector.handleInput("\x15");
		expect(selectList.getSelectedItem()?.value).toBe("err-0");
	});

	test("selection change updates the detail pane", async () => {
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
		let dismissals = 0;
		const onDismiss = () => {
			dismissals++;
		};
		const selector = new ErrorSelectorComponent([dummyEvent, second], onDismiss);
		const scope = await mountSelectorRuntime(selector);
		const selectList = selector.getSelectList();

		selectList.clickItem(1);
		await Bun.sleep(20);

		expect(dismissals).toBe(1);
		const text = renderText(selector);
		expect(text).toContain("Second error detail");
		expect(text).toContain("anthropic");
		await Effect.runPromise(Scope.close(scope, Exit.void));
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
		const scope = await mountSelectorRuntime(selector);

		expect(renderText(selector)).toContain("Focus active cmux session: Enter");
		selector.getSelectList().clickItem(0);
		selector.getSelectList().clickItem(0);
		await Bun.sleep(20);
		expect(invocations).toBe(1);
		result.resolve({ kind: "unavailable" });
		await result.promise;
		await Bun.sleep(0);
		await Bun.sleep(20);

		expect(dismissals).toBe(0);
		expect(renderText(selector)).toContain(
			"The active cmux session is no longer available. This view remains read-only.",
		);
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});
	test("stale ownership completion is ignored after a newer receipt replaces it", async () => {
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
		const selector = new ErrorSelectorComponent([first, second], () => {}, {
			onAction: async action => {
				invocations.push(action.sessionId);
				return await (action.sessionId === "session-1" ? firstResult.promise : secondResult.promise);
			},
		});
		const scope = await mountSelectorRuntime(selector);
		const selectList = selector.getSelectList();

		selectList.clickItem(0);
		await Bun.sleep(20);
		expect(invocations).toEqual(["session-1"]);
		selectList.clickItem(1);
		await Bun.sleep(20);
		expect(invocations).toEqual(["session-1", "session-2"]);
		expect(renderText(selector)).toContain("Second ownership error");

		firstResult.resolve({ kind: "unavailable" });
		await firstResult.promise;
		await Bun.sleep(0);
		await Bun.sleep(20);
		expect(invocations).toEqual(["session-1", "session-2"]);
		expect(renderText(selector)).toContain("Second ownership error");
		expect(renderText(selector)).not.toContain("The active cmux session is no longer available");

		secondResult.resolve({ kind: "failed", reason: "second focus failed" });
		await secondResult.promise;
		await Bun.sleep(20);
		expect(renderText(selector)).toContain("Second ownership error");
		expect(renderText(selector)).toContain("second focus failed");
		expect(renderText(selector)).not.toContain("The active cmux session is no longer available");

		selector.getSelectList().handleWheel(-1);
		await Bun.sleep(20);
		expect(renderText(selector)).toContain("First ownership error");
		expect(renderText(selector)).not.toContain("The active cmux session is no longer available");
		expect(renderText(selector)).not.toContain("second focus failed");
		await Effect.runPromise(Scope.close(scope, Exit.void));
	});


});
