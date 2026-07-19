import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	AGENT_DASHBOARD_ROUTE,
	AgentDashboard,
	reduceAgentDashboard,
	type AgentDashboardModel,
} from "@oh-my-pi/pi-coding-agent/modes/components/agent-dashboard";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { type Component, setKeybindings } from "@oh-my-pi/pi-tui";

const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const tempDirs: string[] = [];

async function makeTempSettings(cwd: string): Promise<Settings> {
	const agentDir = path.join(cwd, ".omp-agent");
	await fs.mkdir(agentDir, { recursive: true });
	resetSettingsForTest();
	return Settings.init({ cwd, agentDir });
}

async function makeTempCwd(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-dashboard-"));
	tempDirs.push(dir);
	return dir;
}
async function createDashboard(terminalHeight: number): Promise<AgentDashboard> {
	const cwd = await makeTempCwd();
	const settings = await makeTempSettings(cwd);
	return AgentDashboard.create(cwd, settings, terminalHeight, {});
}

function applyMessage(
	dashboard: AgentDashboard,
	model: AgentDashboardModel,
	message: Parameters<typeof reduceAgentDashboard>[1],
): AgentDashboardModel {
	const next = reduceAgentDashboard(model, message).model;
	dashboard.apply(next);
	return next;
}

/**
 * Pin the terminal geometry the dashboard reads via `process.stdout.rows/columns`
 * so the height-fit assertions don't depend on whether the suite runs under a TTY.
 */
function stubStdoutGeometry(cols: number): { setRows(n: number): void; restore(): void } {
	const rowsDesc = Object.getOwnPropertyDescriptor(process.stdout, "rows");
	const colsDesc = Object.getOwnPropertyDescriptor(process.stdout, "columns");
	let rows = 24;
	Object.defineProperty(process.stdout, "rows", { configurable: true, get: () => rows });
	Object.defineProperty(process.stdout, "columns", { configurable: true, get: () => cols });
	const restoreOne = (key: "rows" | "columns", desc: PropertyDescriptor | undefined) => {
		if (desc) Object.defineProperty(process.stdout, key, desc);
		else Object.defineProperty(process.stdout, key, { configurable: true, value: undefined, writable: true });
	};
	return {
		setRows(n: number) {
			rows = n;
		},
		restore() {
			restoreOne("rows", rowsDesc);
			restoreOne("columns", colsDesc);
		},
	};
}

beforeEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
});

afterEach(async () => {
	resetSettingsForTest();
	setKeybindings(KeybindingsManager.inMemory());
	await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("AgentDashboard create editor", () => {
	test("keeps carriage return as multiline editor text", async () => {
		await initTheme(false);
		const dashboard = await createDashboard(24);
		let model = dashboard.initialModel;

		model = applyMessage(dashboard, model, { _tag: "BeginCreate" });
		model = applyMessage(dashboard, model, { _tag: "CreateAppend", text: "first line" });
		model = applyMessage(dashboard, model, { _tag: "CreateAppend", text: "\r" });
		applyMessage(dashboard, model, { _tag: "CreateAppend", text: "second line" });
		const rendered = dashboard.render(80).join("\n").replace(ANSI_PATTERN, "");

		expect(rendered).toContain("> first line");
		expect(rendered).toContain("  second line");
		expect(rendered).toContain("Ctrl+Enter: generate");
		expect(rendered).toContain("Enter: newline");
		expect(rendered).not.toContain("Description is required.");
	});

	test("submits multiline new-agent descriptions on CSI-u Ctrl+Enter", async () => {
		await initTheme(false);
		const dashboard = await createDashboard(24);
		let model = dashboard.initialModel;

		model = applyMessage(dashboard, model, { _tag: "BeginCreate" });
		model = applyMessage(dashboard, model, { _tag: "CreateAppend", text: "first line" });
		model = applyMessage(dashboard, model, { _tag: "CreateAppend", text: "\r" });
		const pending = reduceAgentDashboard(model, { _tag: "CreateSubmit" });
		const command = pending.commands.find(item => item._tag === "Generate");
		if (command === undefined || command._tag !== "Generate") throw new Error("missing generate command");
		dashboard.apply(pending.model);
		const failed = await dashboard.execute(command);
		dashboard.apply(reduceAgentDashboard(pending.model, failed).model);
		const rendered = dashboard.render(80).join("\n").replace(ANSI_PATTERN, "");

		expect(rendered).toContain("Model registry unavailable in current session.");
		expect(rendered).not.toContain("Description is required.");
	});

	test("keeps bare LF as multiline editor text on non-Windows terminals", async () => {
		if (process.platform === "win32") return;
		await initTheme(false);
		const dashboard = await createDashboard(24);
		let model = dashboard.initialModel;

		model = applyMessage(dashboard, model, { _tag: "BeginCreate" });
		model = applyMessage(dashboard, model, { _tag: "CreateAppend", text: "first line" });
		model = applyMessage(dashboard, model, { _tag: "CreateAppend", text: "\n" });
		applyMessage(dashboard, model, { _tag: "CreateAppend", text: "second line" });
		const rendered = dashboard.render(80).join("\n").replace(ANSI_PATTERN, "");

		expect(rendered).toContain("> first line");
		expect(rendered).toContain("  second line");
		expect(rendered).toContain("Ctrl+Enter: generate");
		expect(rendered).toContain("Enter: newline");
		expect(rendered).not.toContain("Model registry unavailable in current session.");
		expect(rendered).not.toContain("Description is required.");
	});
});

	test("exports route grammar and preserves create cancellation through the domain interpreter", async () => {
		await initTheme(false);
		expect(String(AGENT_DASHBOARD_ROUTE.componentId)).toBe("agent-dashboard");
		expect(AGENT_DASHBOARD_ROUTE.context).toBe("selector.global");
		const dashboard = await createDashboard(24);
		let model = dashboard.initialModel;
		model = applyMessage(dashboard, model, { _tag: "BeginCreate" });
		model = applyMessage(dashboard, model, { _tag: "CreateAppend", text: "draft agent" });
		expect(dashboard.render(80).join("\n").replace(ANSI_PATTERN, "")).toContain("draft agent");
		applyMessage(dashboard, model, { _tag: "CreateCancel" });
		expect(dashboard.render(80).join("\n").replace(ANSI_PATTERN, "")).not.toContain("draft agent");
		await dashboard.dispose();
	});

	test("disposal fences selector and create messages", async () => {
		await initTheme(false);
		const dashboard = await createDashboard(24);
		let requestedRoot: Component | undefined;
		dashboard.onRequestComponentRender = component => {
			requestedRoot = component;
		};
		let model = dashboard.initialModel;
		model = applyMessage(dashboard, model, { _tag: "Move", delta: 1 });
		expect(requestedRoot).toBe(dashboard);
		const committed = dashboard.render(80);
		await dashboard.dispose();
		const next = reduceAgentDashboard(model, { _tag: "BeginCreate" }).model;
		dashboard.apply(next);
		expect(dashboard.render(80)).toEqual(committed);
		expect(dashboard.render(80).join("\n").replace(ANSI_PATTERN, "")).not.toContain("Create New Agent");
	});

	test("stale creation results no-op after cancellation", async () => {
		await initTheme(false);
		const dashboard = await createDashboard(24);
		let model = reduceAgentDashboard(dashboard.initialModel, { _tag: "BeginCreate" }).model;
		model = reduceAgentDashboard(model, { _tag: "CreateAppend", text: "draft agent" }).model;
		const pending = reduceAgentDashboard(model, { _tag: "CreateSubmit" }).model;
		const cancelled = reduceAgentDashboard(pending, { _tag: "CreateCancel" }).model;
		const stale = reduceAgentDashboard(cancelled, {
			_tag: "CreateGenerated",
			requestGeneration: pending.requestGeneration,
			sourceRevision: pending.sourceRevision,
			spec: { identifier: "stale-agent", whenToUse: "never", systemPrompt: "stale" },
		});
		expect(stale.model).toBe(cancelled);
		await dashboard.dispose();
	});

describe("AgentDashboard layout", () => {
	test("fills the terminal height exactly and keeps the footer visible", async () => {
		await initTheme(false);
		const geo = stubStdoutGeometry(100);
		try {
			geo.setRows(30);
			const dashboard = await createDashboard(30);
			const lines = dashboard.render(100);
			const plain = lines.map(line => line.replace(ANSI_PATTERN, "")).join("\n");

			// Full-screen overlay must occupy exactly the viewport — never overflow
			// past it (which is what pushed the controls into scrollback).
			expect(lines.length).toBe(30);
			expect(plain).toContain("Agent Control Center");
			expect(plain).toContain("escape close");
		} finally {
			geo.restore();
		}
	});

	test("re-fits the body when the terminal height shrinks", async () => {
		await initTheme(false);
		const geo = stubStdoutGeometry(100);
		try {
			geo.setRows(30);
			const dashboard = await createDashboard(30);
			expect(dashboard.render(100).length).toBe(30);

			geo.setRows(18);
			const shrunk = dashboard.render(100);
			expect(shrunk.length).toBe(18);
			// Footer survives the shrink instead of being clipped off the bottom.
			expect(shrunk.map(line => line.replace(ANSI_PATTERN, "")).join("\n")).toContain("escape close");
		} finally {
			geo.restore();
		}
	});
});

describe("AgentDashboard tab navigation", () => {
	test("left/right arrows switch source tabs", async () => {
		await initTheme(false);
		const geo = stubStdoutGeometry(120);
		try {
			geo.setRows(30);
			const dashboard = await createDashboard(30);
			let model = reduceAgentDashboard(dashboard.initialModel, {
				_tag: "DiscoveryLoaded",
				requestGeneration: dashboard.initialModel.requestGeneration,
				agents: [
					{ name: "proj-agent", description: "p", systemPrompt: "", source: "project", disabled: false },
					{ name: "bundled-agent", description: "b", systemPrompt: "", source: "bundled", disabled: false },
				],
			}).model;
			dashboard.apply(model);
			const strip = () => dashboard.render(120).join("\n").replace(ANSI_PATTERN, "");

			const all = strip();
			expect(all).toContain("proj-agent");
			expect(all).toContain("bundled-agent");

			model = applyMessage(dashboard, model, { _tag: "SwitchSource", delta: 1 });
			const project = strip();
			expect(project).toContain("proj-agent");
			expect(project).not.toContain("bundled-agent");

			model = applyMessage(dashboard, model, { _tag: "SwitchSource", delta: 1 });
			const bundled = strip();
			expect(bundled).toContain("bundled-agent");
			expect(bundled).not.toContain("proj-agent");

			applyMessage(dashboard, model, { _tag: "SwitchSource", delta: -1 });
			const back = strip();
			expect(back).toContain("proj-agent");
			expect(back).not.toContain("bundled-agent");
		} finally {
			geo.restore();
		}
	});
});
