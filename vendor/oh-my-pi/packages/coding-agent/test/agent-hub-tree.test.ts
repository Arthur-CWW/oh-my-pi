import { pressHub } from "./helpers/agent-hub-input";
import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry, type AgentStatus, MAIN_AGENT_ID } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function add(registry: AgentRegistry, id: string, parentId = MAIN_AGENT_ID, status: AgentStatus = "running"): void {
	registry.register({ id, displayName: id, kind: "sub", parentId, session: liveSession(), status });
}

function makeHub(registry: AgentRegistry): AgentHubOverlayComponent {
	return new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry,
		irc: new IrcBus(registry),
		externalIrc: null,
	});
}

function text(hub: AgentHubOverlayComponent): string {
	return Bun.stripANSI(hub.render(120).join("\n"));
}

function selectedId(hub: AgentHubOverlayComponent): string | undefined {
	const line = hub
		.render(120)
		.map(Bun.stripANSI)
		.find(rendered => rendered.startsWith(" ❯ "));
	if (!line) return undefined;
	return line
		.slice(23)
		.trim()
		.replace(/^(?:(?:│ | {2})*(?:├|└) )/, "")
		.split(/\s+/)[0];
}

function rosterLines(hub: AgentHubOverlayComponent): string[] {
	return hub
		.render(120)
		.map(Bun.stripANSI)
		.filter(line => /^[ ](?:❯| )[ ]/.test(line) && /[●○■×◌·✓~]/.test(line.slice(17, 23)));
}

describe("Agent Hub nested roster tree", () => {
	let rowsDescriptor: PropertyDescriptor | undefined;
	let columnsDescriptor: PropertyDescriptor | undefined;

	beforeAll(async () => {
		await initTheme();
	});

	afterEach(() => {
		if (rowsDescriptor) Object.defineProperty(process.stdout, "rows", rowsDescriptor);
		else Reflect.deleteProperty(process.stdout, "rows");
		if (columnsDescriptor) Object.defineProperty(process.stdout, "columns", columnsDescriptor);
		else Reflect.deleteProperty(process.stdout, "columns");
		rowsDescriptor = undefined;
		columnsDescriptor = undefined;
	});

	function useGeometry(): void {
		rowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
		columnsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "columns");
		Object.defineProperty(process.stdout, "rows", { configurable: true, value: 40 });
		Object.defineProperty(process.stdout, "columns", { configurable: true, value: 120 });
	}

	it("renders roots and two nested levels in stable tree order", () => {
		useGeometry();
		const registry = new AgentRegistry();
		add(registry, "Alpha");
		add(registry, "Beta");
		add(registry, "Alpha.One", "Alpha");
		add(registry, "Alpha.Two", "Alpha");
		add(registry, "Alpha.One.Leaf", "Alpha.One");
		const hub = makeHub(registry);
		const rendered = text(hub);
		const indexes = ["Alpha Alpha", "├ Alpha.One", "│ └ Alpha.One.Leaf", "└ Alpha.Two", "Beta Beta"].map(value =>
			rendered.indexOf(value),
		);
		expect(indexes.every(index => index >= 0)).toBe(true);
		expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
		hub.dispose();
	});

	it("collapses with h and reports hidden and running descendants", () => {
		useGeometry();
		const registry = new AgentRegistry();
		add(registry, "Alpha");
		add(registry, "Alpha.One", "Alpha");
		add(registry, "Alpha.One.Leaf", "Alpha.One");
		const hub = makeHub(registry);
		pressHub(hub, "h");
		const rendered = text(hub);
		expect(rendered).toContain("(+2 · 2 run)");
		expect(rendered).not.toContain("Alpha.One Alpha.One");
		hub.dispose();
	});

	it("removes hidden historical children from collapsed parent rollups", () => {
		useGeometry();
		const registry = new AgentRegistry();
		add(registry, "Alpha");
		add(registry, "Alpha.Live", "Alpha");
		add(registry, "Alpha.Parked", "Alpha", "parked");
		const hub = makeHub(registry);

		pressHub(hub, "h");
		expect(text(hub)).toContain("(+2 · 1 run)");
		pressHub(hub, ".");
		const activeOnly = text(hub);
		expect(activeOnly).toContain("(+1 · 1 run)");
		expect(activeOnly).not.toContain("Alpha.Parked");
		hub.dispose();
	});

	it("shows search matches with ancestors and auto-expands the selected path when search clears", () => {
		useGeometry();
		const registry = new AgentRegistry();
		add(registry, "Alpha");
		add(registry, "Alpha.One", "Alpha");
		add(registry, "Alpha.One.Leaf", "Alpha.One");
		const hub = makeHub(registry);
		pressHub(hub, "h");
		pressHub(hub, "/");
		for (const character of "Leaf") pressHub(hub, character);
		pressHub(hub, "\r");
		expect(text(hub)).toContain("Alpha.One.Leaf");
		pressHub(hub, "n");
		pressHub(hub, "n");
		expect(selectedId(hub)).toBe("Alpha.One.Leaf");
		pressHub(hub, "\u001b");
		expect(text(hub)).toContain("Alpha.One.Leaf");
		expect(selectedId(hub)).toBe("Alpha.One.Leaf");
		hub.dispose();
	});

	it("cycles siblings with brackets and raw arrow sequences without entering descendants", () => {
		useGeometry();
		const registry = new AgentRegistry();
		add(registry, "Alpha");
		add(registry, "Beta");
		add(registry, "Alpha.One", "Alpha");
		add(registry, "Alpha.One.Leaf", "Alpha.One");
		add(registry, "Alpha.Two", "Alpha");
		const hub = makeHub(registry);
		pressHub(hub, "n");
		expect(selectedId(hub)).toBe("Alpha.One");
		pressHub(hub, "]");
		expect(selectedId(hub)).toBe("Alpha.Two");
		pressHub(hub, "[");
		expect(selectedId(hub)).toBe("Alpha.One");
		pressHub(hub, "\u001b[C");
		expect(selectedId(hub)).toBe("Alpha.Two");
		pressHub(hub, "\u001b[D");
		expect(selectedId(hub)).toBe("Alpha.One");
		hub.dispose();
	});

	it("adds no tree-guide bytes to a childless roster", () => {
		useGeometry();
		const registry = new AgentRegistry();
		add(registry, "Alpha");
		add(registry, "Beta");
		const hub = makeHub(registry);
		expect(rosterLines(hub).every(line => !/[├└│] •/.test(line))).toBe(true);
		hub.dispose();
	});
});
