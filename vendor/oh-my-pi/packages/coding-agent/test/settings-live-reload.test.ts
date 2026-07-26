import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings, type SettingsChangeNotice } from "@oh-my-pi/pi-coding-agent/config/settings";
import { YAML } from "bun";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

function nextNotice(
	settings: Settings,
	predicate: (notice: SettingsChangeNotice) => boolean,
): Promise<SettingsChangeNotice> {
	return new Promise(resolve => {
		const unsubscribe = settings.onChange(notice => {
			if (!predicate(notice)) return;
			unsubscribe();
			resolve(notice);
		});
	});
}

describe("Settings live config reload", () => {
	let settingsState: SettingsTestState | undefined;
	let root = "";
	let agentDir = "";
	let projectDir = "";
	let configPath = "";

	beforeEach(async () => {
		settingsState = beginSettingsTest();
		root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-settings-live-reload-"));
		agentDir = path.join(root, "home", ".omp", "agent");
		projectDir = path.join(root, "project");
		configPath = path.join(agentDir, "config.yml");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(projectDir, { recursive: true });
		process.env.HOME = path.join(root, "home");
		process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
		process.env.OMP_FLEET_REGISTER = "0";
		await Bun.write(configPath, YAML.stringify({ display: { tabWidth: 2, showTokenUsage: false } }, null, 2));
	});

	afterEach(() => {
		restoreSettingsTestState(settingsState);
		settingsState = undefined;
		if (root) fs.rmSync(root, { recursive: true, force: true });
		root = "";
	});

	it("isolates an explicit agent directory from an existing global instance", async () => {
		const foreignAgentDir = path.join(root, "foreign-agent");
		const foreignConfigPath = path.join(foreignAgentDir, "config.yml");
		fs.mkdirSync(foreignAgentDir, { recursive: true });
		await Bun.write(foreignConfigPath, YAML.stringify({ modelRoles: { slow: "foreign/slow" } }, null, 2));
		await Bun.write(configPath, YAML.stringify({ modelRoles: { smol: "fixture/smol" } }, null, 2));

		const foreign = await Settings.init({ cwd: projectDir, agentDir: foreignAgentDir });
		expect(foreign.get("modelRoles")).toEqual({ slow: "foreign/slow" });

		const explicit = await Settings.init({ cwd: projectDir, agentDir });
		expect(explicit).not.toBe(foreign);
		expect(explicit.getAgentDir()).toBe(path.normalize(agentDir));
		expect(explicit.get("modelRoles")).toEqual({ smol: "fixture/smol" });
	});

	it("applies disk defaults, preserves runtime overrides, and rejects malformed YAML", async () => {
		const settings = await Settings.init({ cwd: projectDir, agentDir });
		const notices: SettingsChangeNotice[] = [];
		const unsubscribe = settings.onChange(notice => notices.push(notice));

		try {
			expect(settings.get("display.tabWidth")).toBe(2);
			const defaultChanged = nextNotice(
				settings,
				notice => notice.kind === "changed" && notice.changedPaths.includes("display.tabWidth"),
			);
			await Bun.write(configPath, YAML.stringify({ display: { tabWidth: 3, showTokenUsage: false } }, null, 2));
			await defaultChanged;
			expect(settings.get("display.tabWidth")).toBe(3);

			settings.override("display.tabWidth", 9);
			const unshadowedDefaultChanged = nextNotice(
				settings,
				notice => notice.kind === "changed" && notice.changedPaths.includes("display.showTokenUsage"),
			);
			await Bun.write(configPath, YAML.stringify({ display: { tabWidth: 4, showTokenUsage: true } }, null, 2));
			await unshadowedDefaultChanged;
			expect(settings.get("display.showTokenUsage")).toBe(true);
			expect(settings.get("display.tabWidth")).toBe(9);

			const warning = nextNotice(settings, notice => notice.kind === "warning");
			await Bun.write(configPath, "display:\n  tabWidth: [\n");
			await warning;
			expect(settings.get("display.tabWidth")).toBe(9);
			expect(settings.get("display.showTokenUsage")).toBe(true);
			expect(notices.filter(notice => notice.kind === "warning")).toHaveLength(1);
		} finally {
			unsubscribe();
		}
	});

	it("ignores temp files and retains the last good config across invalid replacements", async () => {
		const settings = await Settings.init({ cwd: projectDir, agentDir });
		const notices: SettingsChangeNotice[] = [];
		const unsubscribe = settings.onChange(notice => notices.push(notice));

		try {
			await Bun.write(path.join(agentDir, ".config.yml.tmp-injected"), "display:\n  tabWidth: [\n");
			await Bun.sleep(250);
			expect(notices).toEqual([]);
			expect(settings.get("display.tabWidth")).toBe(2);

			for (const invalid of ["", "display:\n  tabWidth: [\n", "display:\n  tabWidth: nope\n"]) {
				const warning = nextNotice(settings, notice => notice.kind === "warning");
				await Bun.write(configPath, invalid);
				await warning;
				expect(settings.get("display.tabWidth")).toBe(2);
			}

			const changed = nextNotice(
				settings,
				notice => notice.kind === "changed" && notice.changedPaths.includes("display.tabWidth"),
			);
			await Bun.write(configPath, YAML.stringify({ display: { tabWidth: 6 } }, null, 2));
			await changed;
			expect(settings.get("display.tabWidth")).toBe(6);
		} finally {
			unsubscribe();
		}
	});
});
