#!/usr/bin/env bun
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = "/Users/arthur/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent";
const { AgentHubOverlayComponent } = await import(`${root}/src/modes/components/agent-hub.ts`);
const { AgentRegistry } = await import(`${root}/src/registry/agent-registry.ts`);
const { AgentLifecycleManager } = await import(`${root}/src/registry/agent-lifecycle.ts`);
const { IrcBus } = await import(`${root}/src/irc/bus.ts`);
const { SessionObserverRegistry } = await import(`${root}/src/modes/session-observer-registry.ts`);
const { initTheme } = await import(`${root}/src/modes/theme/theme.ts`);
const { Settings, resetSettingsForTest } = await import(`${root}/src/config/settings.ts`);

type TranscriptViewerLike = {
	render(width: number): readonly string[];
	handleInput(data: string): void;
};

function assert(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

async function waitFor(predicate: () => boolean, message: () => string): Promise<void> {
	const started = Date.now();
	while (!predicate()) {
		if (Date.now() - started > 1_000) throw new Error(message());
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

initTheme();
resetSettingsForTest();
await Settings.init({ inMemory: true });

const dir = await mkdtemp(join(tmpdir(), "omp-hub-parked-"));
try {
	const sessionFile = join(dir, "Worker.jsonl");
	await writeFile(sessionFile, "");
	const agents = new AgentRegistry();
	agents.register({
		id: "Worker",
		displayName: "Worker",
		kind: "sub",
		parentId: "Main",
		session: null,
		sessionFile,
		status: "parked",
	});

	let focusCalls = 0;
	let focusedComponent: TranscriptViewerLike | undefined;
	let overlayComponent: TranscriptViewerLike | undefined;
	const ui = {
		showOverlay(component: TranscriptViewerLike) {
			overlayComponent = component;
			return { hide() {} };
		},
		setFocus(component: TranscriptViewerLike) {
			focusedComponent = component;
		},
		requestRender() {},
		requestComponentRender() {},
	};
	const lifecycle = new AgentLifecycleManager(agents);
	const session = { subscribe: () => () => {} };
	lifecycle.adopt("Worker", { idleTtlMs: 0, revive: async () => session });
	const hub = new AgentHubOverlayComponent({
		observers: new SessionObserverRegistry(),
		hubKeys: [],
		onDone: () => {},
		requestRender: () => {},
		registry: agents,
		irc: new IrcBus(agents),
		lifecycle,
		ui,
		focusAgent: async () => {
			focusCalls++;
		},
	});

	hub.handleInput("\r");
	assert(focusCalls === 0, `expected no focus on parked Enter, got ${focusCalls}`);
	assert(agents.get("Worker")?.status === "parked", `expected parked after Enter, got ${agents.get("Worker")?.status}`);
	assert(Boolean(overlayComponent), "expected transcript overlay to open");
	assert(focusedComponent === overlayComponent, "expected transcript viewer to receive focus");
	assert(Bun.stripANSI(overlayComponent.render(120).join("\n")).includes("R:revive"), "expected R:revive footer");

	overlayComponent.handleInput("R");
	await waitFor(() => agents.get("Worker")?.status === "idle", () => `revive timed out at ${agents.get("Worker")?.status}`);
	assert(focusCalls === 0, `expected no focus on explicit R revive, got ${focusCalls}`);
	assert(agents.get("Worker")?.session === session, "expected revived session to attach");
	hub.dispose();
	await lifecycle.dispose();
	console.log("Agent Hub parked Enter stayed read-only; R revived without focus.");
} finally {
	resetSettingsForTest();
	await rm(dir, { recursive: true, force: true });
}
