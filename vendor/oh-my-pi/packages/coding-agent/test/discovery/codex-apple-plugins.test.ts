import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadCodexSkills } from "@oh-my-pi/pi-coding-agent/discovery/codex";
import { buildSkillPromptMessage } from "@oh-my-pi/pi-coding-agent/extensibility/skills";

const IOS_SKILLS = [
	"ios-app-intents",
	"ios-debugger-agent",
	"ios-ettrace-performance",
	"ios-memgraph-leaks",
	"ios-simulator-browser",
	"swiftui-liquid-glass",
	"swiftui-performance-audit",
	"swiftui-ui-patterns",
	"swiftui-view-refactor",
];
const MACOS_SKILLS = [
	"appkit-interop",
	"build-run-debug",
	"liquid-glass",
	"packaging-notarization",
	"signing-entitlements",
	"swiftpm-macos",
	"swiftui-patterns",
	"telemetry",
	"test-triage",
	"view-refactor",
	"window-management",
];
const EXPECTED_SKILLS = [...IOS_SKILLS, ...MACOS_SKILLS].sort();
const BODY_MARKER = "CODEX_PLUGIN_BODY_MUST_BE_LAZY";

async function writePlugin(
	home: string,
	pluginName: "build-ios-apps" | "build-macos-apps",
	versionDir: string,
	skills: readonly string[],
): Promise<void> {
	const root = path.join(home, ".codex", "plugins", "cache", "openai-curated", pluginName, versionDir);
	await fs.mkdir(path.join(root, ".codex-plugin"), { recursive: true });
	await fs.writeFile(
		path.join(root, ".codex-plugin", "plugin.json"),
		JSON.stringify({ name: pluginName, version: "0.1.0", skills: "./skills/" }),
	);
	for (const name of skills) {
		const skillDir = path.join(root, "skills", name);
		await fs.mkdir(skillDir, { recursive: true });
		await fs.writeFile(
			path.join(skillDir, "SKILL.md"),
			`---\nname: ${name}\ndescription: ${name} metadata\n---\n\n# ${name}\n\n${BODY_MARKER}\n`,
		);
	}
}

describe("Codex cached Apple plugin discovery", () => {
	let root: string;
	let home: string;
	let swiftWorkspace: string;
	let nonSwiftWorkspace: string;
	const sourceContext = (cwd: string) => ({ cwd, home, repoRoot: null });

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-codex-apple-plugins-"));
		home = path.join(root, "home");
		swiftWorkspace = path.join(root, "swift-workspace");
		nonSwiftWorkspace = path.join(root, "web-workspace");
		await fs.mkdir(swiftWorkspace, { recursive: true });
		await fs.mkdir(nonSwiftWorkspace, { recursive: true });
		await fs.writeFile(path.join(swiftWorkspace, "Package.swift"), "// swift-tools-version: 6.0\n");
		await writePlugin(home, "build-ios-apps", "3fdeeb49", IOS_SKILLS);
		await writePlugin(home, "build-macos-apps", "3fdeeb49", MACOS_SKILLS);
	});

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});

	test("discovers exactly the 20 curated skills in a Swift workspace and loads a selected body", async () => {
		const result = await loadCodexSkills(sourceContext(swiftWorkspace));
		const pluginSkills = result.items;

		expect(pluginSkills.map(skill => skill.name).sort()).toEqual(EXPECTED_SKILLS);
		expect(pluginSkills.every(skill => skill._source.level === "user")).toBe(true);

		const selected = pluginSkills.find(skill => skill.name === "ios-app-intents");
		expect(selected).toBeDefined();
		const loaded = await buildSkillPromptMessage({ name: selected!.name, filePath: selected!.path }, "use it");
		expect(loaded.message).toContain(BODY_MARKER);
	});

	test("excludes cached Apple plugin skills outside Swift and Apple workspaces", async () => {
		const result = await loadCodexSkills(sourceContext(nonSwiftWorkspace));
		expect(result.items).toEqual([]);
	});

	test("selects the lexicographically greatest valid cache version deterministically", async () => {
		await writePlugin(home, "build-ios-apps", "00000000", ["old-version-only"]);
		await writePlugin(home, "build-ios-apps", "ffffffff", ["selected-version-only"]);
		const result = await loadCodexSkills(sourceContext(swiftWorkspace));
		const selected = result.items.find(skill => skill.name === "selected-version-only");

		expect(selected?.path).toContain(`${path.sep}ffffffff${path.sep}`);
		expect(result.items.some(skill => skill.name === "old-version-only")).toBe(false);
		expect(result.items.some(skill => skill.name === "ios-app-intents")).toBe(false);
	});
});
