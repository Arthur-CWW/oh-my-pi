import { pressHub } from "./helpers/agent-hub-input";
import { beforeAll, describe, expect, it } from "bun:test";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { AgentHubOverlayComponent } from "@oh-my-pi/pi-coding-agent/modes/components/agent-hub";
import { SessionObserverRegistry } from "@oh-my-pi/pi-coding-agent/modes/session-observer-registry";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { AgentRegistry, MAIN_AGENT_ID } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { setKeybindings } from "@oh-my-pi/pi-tui";
import { TempDir } from "@oh-my-pi/pi-utils";

const AGENT_ID = "ExitWorker";
const ESCAPE = "\x1b";
const CTRL_C = "\x03";
const CTRL_Q = "\x11";
const CTRL_W = "\x17";
const HUB_HEIGHT = 40;
const TABLE_WIDTH = 120;
const DUAL_LANE_WIDTH = 160;

interface ExitFixture {
	hub: AgentHubOverlayComponent;
	doneCalls(): number;
	unfocusCalls(): number;
	cleanup(): void;
}

interface EscapeStep {
	width?: number;
	includes?: readonly string[];
	excludes?: readonly string[];
}

interface ExitState {
	name: string;
	arrange(fixture: ExitFixture): void;
	escapeSteps: readonly EscapeStep[];
}

interface ExitKey {
	name: string;
	data: string;
	unfocuses: boolean;
}

type ExitMatrixCase = readonly [label: string, state: ExitState, key: ExitKey];

function liveSession(): AgentSession {
	const session: Pick<AgentSession, "subscribe"> = { subscribe: () => () => {} };
	return session as AgentSession;
}

function renderedText(hub: AgentHubOverlayComponent, width = TABLE_WIDTH): string {
	return hub
		.render(width)
		.map(line => Bun.stripANSI(line))
		.join("\n");
}

function typeText(hub: AgentHubOverlayComponent, value: string): void {
	for (const character of value) pressHub(hub, character);
}

function createFixture(): ExitFixture {
	const tempDir = TempDir.createSync("@omp-agent-hub-exit-matrix-");
	const externalIrc = new IrcExternalBus(`${tempDir.path()}/irc-bus.sqlite`);
	const registry = new AgentRegistry();
	const observers = new SessionObserverRegistry();
	const irc = new IrcBus(registry);
	let done = 0;
	let unfocused = 0;
	let hub: AgentHubOverlayComponent | undefined;
	try {
		registry.register({
			id: AGENT_ID,
			displayName: AGENT_ID,
			kind: "sub",
			parentId: MAIN_AGENT_ID,
			session: liveSession(),
			sessionFile: null,
			status: "running",
		});
		hub = new AgentHubOverlayComponent({
			observers,
			hubKeys: [],
			interruptKeys: ["ctrl+q"],
			onDone: () => {
				done++;
			},
			unfocusSession: async () => {
				unfocused++;
			},
			requestRender: () => {},
			height: () => HUB_HEIGHT,
			registry,
			irc,
			externalIrc,
			externalSessionId: "exit-matrix-current-session",
		});
		const fixtureHub = hub;
		return {
			hub: fixtureHub,
			doneCalls: () => done,
			unfocusCalls: () => unfocused,
			cleanup: () => {
				fixtureHub.dispose();
				observers.dispose();
				registry.unregister(AGENT_ID);
				externalIrc.close();
				tempDir.removeSync();
			},
		};
	} catch (error) {
		hub?.dispose();
		observers.dispose();
		externalIrc.close();
		tempDir.removeSync();
		throw error;
	}
}

function assertEscapeStep(fixture: ExitFixture, step: EscapeStep): void {
	if (!step.includes && !step.excludes) return;
	const output = renderedText(fixture.hub, step.width);
	for (const marker of step.includes ?? []) expect(output).toContain(marker);
	for (const marker of step.excludes ?? []) expect(output).not.toContain(marker);
}

const EXIT_KEYS: readonly ExitKey[] = [
	{ name: "Escape", data: ESCAPE, unfocuses: false },
	{ name: "Ctrl-C", data: CTRL_C, unfocuses: false },
	{ name: "Ctrl-Q", data: CTRL_Q, unfocuses: true },
	{ name: "q", data: "q", unfocuses: false },
];

const EXIT_STATES: readonly ExitState[] = [
	{
		name: "base table",
		arrange: ({ hub }) => {
			expect(renderedText(hub)).toContain("Agent Hub · tree");
		},
		escapeSteps: [{}],
	},
	{
		name: "base filtered table",
		arrange: ({ hub }) => {
			pressHub(hub, "/");
			typeText(hub, AGENT_ID);
			pressHub(hub, "\r");
			const output = renderedText(hub);
			expect(output).toContain(`/${AGENT_ID} (1/1)`);
			expect(output).not.toContain(`/${AGENT_ID}▏`);
		},
		escapeSteps: [{ excludes: [`/${AGENT_ID}`] }, {}],
	},
	{
		name: "preview-focused table",
		arrange: ({ hub, doneCalls }) => {
			expect(renderedText(hub)).toContain("Preview transcript");
			pressHub(hub, CTRL_W);
			expect(doneCalls()).toBe(0);
		},
		escapeSteps: [{ includes: ["Preview transcript"] }, {}],
	},
	{
		name: "filter-editing table",
		arrange: ({ hub }) => {
			pressHub(hub, "/");
			typeText(hub, "Exit");
			expect(renderedText(hub)).toContain("/Exit▏");
		},
		escapeSteps: [{ excludes: ["/Exit", "/Exit▏"] }, {}],
	},
	{
		name: "dual-lane inspector-focused table",
		arrange: ({ hub }) => {
			renderedText(hub, DUAL_LANE_WIDTH);
			pressHub(hub, "h");
			expect(renderedText(hub, DUAL_LANE_WIDTH)).toContain("●Prompt [ / ] section");
		},
		escapeSteps: [
			{
				width: DUAL_LANE_WIDTH,
				includes: ["●Preview transcript"],
				excludes: ["●Prompt [ / ] section"],
			},
			{},
		],
	},
	{
		name: "cycled inspector-focused table",
		arrange: ({ hub }) => {
			renderedText(hub, DUAL_LANE_WIDTH);
			pressHub(hub, "]");
			pressHub(hub, "h");
			expect(renderedText(hub, DUAL_LANE_WIDTH)).toContain("●Route [ / ] section");
		},
		escapeSteps: [
			{
				width: DUAL_LANE_WIDTH,
				includes: ["Route [ / ] section", "●Preview transcript"],
				excludes: ["●Route [ / ] section"],
			},
			{},
		],
	},
	{
		name: "pending g chord",
		arrange: ({ hub }) => {
			pressHub(hub, "g");
			expect(renderedText(hub)).toContain("g: gg gj gk gx gm gr gs gb ga");
		},
		escapeSteps: [{ excludes: ["g: gg gj gk gx gm gr gs gb ga"] }, {}],
	},
	{
		name: "rendered split cockpit table preview",
		arrange: ({ hub }) => {
			const output = renderedText(hub);
			expect(output).toContain("Prompt [ / ] section");
			expect(output).toContain("Preview transcript");
		},
		escapeSteps: [{}],
	},
	{
		name: "large chat preview",
		arrange: ({ hub }) => {
			hub.openChat(AGENT_ID);
			expect(renderedText(hub)).toContain(`Agent Hub > ${AGENT_ID}`);
		},
		escapeSteps: [
			{ includes: ["Agent Hub · tree"], excludes: [`Agent Hub > ${AGENT_ID}`] },
			{},
		],
	},
	{
		name: "large chat search-editing",
		arrange: ({ hub }) => {
			hub.openChat(AGENT_ID);
			pressHub(hub, "/");
			typeText(hub, "needle");
			const output = renderedText(hub);
			expect(output).toContain(`Agent Hub > ${AGENT_ID}`);
			expect(output).toContain("/needle [0]");
		},
		escapeSteps: [
			{ includes: [`Agent Hub > ${AGENT_ID}`], excludes: ["/needle"] },
			{ includes: ["Agent Hub · tree"], excludes: [`Agent Hub > ${AGENT_ID}`] },
			{},
		],
	},
];

const EXIT_MATRIX_CASES: readonly ExitMatrixCase[] = EXIT_STATES.flatMap(state =>
	EXIT_KEYS.map(key => [`${state.name} × ${key.name}`, state, key] as const),
);

beforeAll(async () => {
	setKeybindings(KeybindingsManager.inMemory());
	await initTheme();
});

describe("Agent Hub exit-key state matrix", () => {
	it.each(EXIT_MATRIX_CASES)("%s", (_label, state, key) => {
		const fixture = createFixture();
		try {
			state.arrange(fixture);
			expect(fixture.doneCalls()).toBe(0);
			expect(fixture.unfocusCalls()).toBe(0);
			pressHub(fixture.hub, key.data);

			if (key.data !== ESCAPE) {
				expect(fixture.doneCalls()).toBe(1);
				expect(fixture.unfocusCalls()).toBe(key.unfocuses ? 1 : 0);
				return;
			}

			expect(fixture.unfocusCalls()).toBe(0);
			for (let stepIndex = 0; stepIndex < state.escapeSteps.length; stepIndex++) {
				const finalStep = stepIndex === state.escapeSteps.length - 1;
				expect(fixture.doneCalls()).toBe(finalStep ? 1 : 0);
				assertEscapeStep(fixture, state.escapeSteps[stepIndex]);
				if (!finalStep) pressHub(fixture.hub, ESCAPE);
			}
		} finally {
			fixture.cleanup();
		}
	});

	it("keeps raw CSI arrows distinct from bare Escape while preview-focused", () => {
		const fixture = createFixture();
		try {
			expect(renderedText(fixture.hub)).toContain("Preview transcript");
			pressHub(fixture.hub, "\x17");
			for (const arrow of ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"]) {
				pressHub(fixture.hub, arrow);
				expect(fixture.doneCalls()).toBe(0);
				expect(fixture.unfocusCalls()).toBe(0);
				expect(renderedText(fixture.hub)).toContain("Preview transcript");
			}

			pressHub(fixture.hub, ESCAPE);
			expect(fixture.doneCalls()).toBe(0);
			expect(fixture.unfocusCalls()).toBe(0);
			pressHub(fixture.hub, ESCAPE);
			expect(fixture.doneCalls()).toBe(1);
			expect(fixture.unfocusCalls()).toBe(0);
		} finally {
			fixture.cleanup();
		}
	});
});
