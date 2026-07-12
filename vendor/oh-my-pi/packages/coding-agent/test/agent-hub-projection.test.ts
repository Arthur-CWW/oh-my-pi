import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";

function hubFor(registry: AgentRegistry, requestRender = () => {}): AgentHubOverlayComponent {
	return new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender,
		registry,
		irc: new IrcBus(registry),
		externalIrc: null,
	});
}

function text(hub: AgentHubOverlayComponent): string {
	return Bun.stripANSI(hub.render(120).join("\n"));
}

function registryWithParked(count: number): AgentRegistry {
	const registry = new AgentRegistry();
	registry.register({ id: "live", displayName: "live", kind: "sub", session: null, status: "running" });
	for (let index = 1; index < count; index++) {
		registry.register({ id: `parked-${index}`, displayName: `parked-${index}`, kind: "sub", session: null, status: "parked" });
	}
	return registry;
}

beforeAll(async () => initTheme());
afterEach(() => {
	vi.useRealTimers();
	AgentRegistry.resetGlobalForTests();
});

describe("Agent Hub sectioned projection", () => {
	it("orders live sections and expands parked identities only through search", () => {
		const registry = new AgentRegistry();
		registry.register({ id: "idle", displayName: "idle", kind: "sub", session: null, status: "idle" });
		registry.register({ id: "completed", displayName: "completed", kind: "sub", session: null, status: "idle" });
		registry.register({ id: "parked", displayName: "parked", kind: "sub", session: null, status: "parked" });
		registry.register({ id: "running", displayName: "running", kind: "sub", session: null, status: "running" });
		const hub = new AgentHubOverlayComponent({
			observers: new SessionObserverRegistry(),
			hubKeys: [],
			onDone: () => {},
			requestRender: () => {},
			registry,
			irc: new IrcBus(registry),
			externalIrc: null,
			turnStatus: id => id === "completed" ? { inputId: "done", state: "completed", canCancel: false } : undefined,
		});

		const initial = text(hub);
		expect(initial.indexOf("Running (1)")).toBeLessThan(initial.indexOf("Idle / needs attention (1)"));
		expect(initial.indexOf("Idle / needs attention (1)")).toBeLessThan(initial.indexOf("Recent completed (1)"));
		expect(initial).toContain("Parked (1) collapsed · / to search and expand");
		expect(initial).not.toContain("■ PARK parked");

		hub.handleInput("/");
		for (const character of "parked") hub.handleInput(character);
		expect(text(hub)).toContain("Parked matches (1)");
		expect(text(hub)).toContain("■ PARK parked");

		hub.handleInput("\r");
		hub.handleInput("\x1b");
		hub.handleInput(".");
		expect(text(hub)).toContain("Running (1)");
		expect(text(hub)).not.toContain("Parked matches");
		hub.dispose();
	});

	it("batches a transition burst into one render request", () => {
		vi.useFakeTimers();
		const registry = registryWithParked(50);
		let renders = 0;
		const hub = hubFor(registry, () => renders++);
		for (let index = 1; index <= 20; index++) registry.setStatus(`parked-${index}`, "idle");
		vi.advanceTimersByTime(0);
		expect(renders).toBe(1);
		expect(text(hub)).toContain("Idle / needs attention (20)");
		hub.dispose();
	});

	it("keeps event-to-projection time independent of parked population at N=50/338/1000", () => {
		const measurements: Array<{ n: number; microseconds: number }> = [];
		for (const n of [50, 338, 1000]) {
			const registry = registryWithParked(n);
			const hub = hubFor(registry);
			hub.render(120);
			const samples: number[] = [];
			for (let iteration = 0; iteration < 100; iteration++) {
				const next = iteration % 2 === 0 ? "idle" : "running";
				const start = Bun.nanoseconds();
				registry.setStatus("live", next);
				hub.render(120);
				samples.push((Bun.nanoseconds() - start) / 1_000);
			}
			samples.sort((a, b) => a - b);
			measurements.push({ n, microseconds: samples[94]! });
			hub.dispose();
		}
		console.info("agent-hub event→projection p95 µs", measurements);
		const values = measurements.map(row => row.microseconds);
		expect(Math.max(...values)).toBeLessThan(2_000);
		expect(Math.max(...values) / Math.max(1, Math.min(...values))).toBeLessThan(5);
	});
});
