import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import {
	HookInputComponent,
	makeHookInputModel,
	type HookInputModel,
	type HookInputMsg,
	updateHookInput,
} from "@oh-my-pi/pi-coding-agent/modes/components/hook-input";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

beforeAll(async () => {
	const loadedTheme = await getThemeByName("dark");
	if (!loadedTheme) throw new Error("Failed to load dark theme for tests");
	setThemeInstance(loadedTheme);
});

afterEach(() => {
	vi.useRealTimers();
});

interface InputTimeoutRoute {
	model: HookInputModel;
	readonly component: HookInputComponent;
	readonly submitted: string[];
	cancelled: number;
	readonly timedOut: number;
	dispatch(message: HookInputMsg): void;
	append(value: string): void;
	submit(): void;
}

function createInputTimeoutRoute(timeout: number): InputTimeoutRoute {
	let model = makeHookInputModel("Prompt");
	const component = new HookInputComponent(model);
	const submitted: string[] = [];
	let cancelled = 0;
	let timedOut = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const armTimeout = (): void => {
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			timedOut++;
			const transition = updateHookInput(model, { _tag: "Back" });
			model = transition.model;
			component.apply(model);
			for (const command of transition.commands) {
				if (command._tag === "Cancel") cancelled++;
			}
		}, timeout);
	};
	const dispatch = (message: HookInputMsg): void => {
		const transition = updateHookInput(model, message);
		model = transition.model;
		component.apply(model);
		if (message._tag === "ValueChanged") armTimeout();
		for (const command of transition.commands) {
			switch (command._tag) {
				case "Resolve":
					submitted.push(command.value);
					if (timer !== undefined) clearTimeout(timer);
					timer = undefined;
					break;
				case "Cancel":
					cancelled++;
					if (timer !== undefined) clearTimeout(timer);
					timer = undefined;
					break;
			}
		}
	};
	armTimeout();
	return {
		get model() {
			return model;
		},
		component,
		submitted,
		get cancelled() {
			return cancelled;
		},
		get timedOut() {
			return timedOut;
		},
		dispatch,
		append: value => dispatch({ _tag: "ValueChanged", value: model.value + value }),
		submit: () => dispatch({ _tag: "Submit" }),
	};
}

describe("Hook input route timeout", () => {
	it("resets timeout on user activity and still expires when idle", () => {
		vi.useFakeTimers();
		const route = createInputTimeoutRoute(1_000);

		vi.advanceTimersByTime(900);
		route.append("a");

		vi.advanceTimersByTime(900);
		route.append("");

		vi.advanceTimersByTime(900);
		expect(route.timedOut).toBe(0);
		expect(route.cancelled).toBe(0);

		vi.advanceTimersByTime(200);
		expect(route.timedOut).toBe(1);
		expect(route.cancelled).toBe(1);
	});

	it("preserves submit behavior", () => {
		vi.useFakeTimers();
		const route = createInputTimeoutRoute(1_000);

		route.append("h");
		route.append("i");
		route.submit();

		expect(route.submitted).toEqual(["hi"]);
		expect(route.cancelled).toBe(0);
		expect(route.timedOut).toBe(0);
	});

	it("absorbs enhanced-paste payloads through the hook paste route and resets the timeout", () => {
		vi.useFakeTimers();
		const route = createInputTimeoutRoute(1_000);

		vi.advanceTimersByTime(900);
		route.append("sk-line1sk-line2");

		vi.advanceTimersByTime(900);
		expect(route.timedOut).toBe(0);
		expect(route.cancelled).toBe(0);

		route.submit();

		expect(route.submitted).toEqual(["sk-line1sk-line2"]);
		expect(route.cancelled).toBe(0);
	});
});
