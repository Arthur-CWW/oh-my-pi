import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { YAML } from "bun";
import { runPolicyCommand } from "../../src/cli/policy-cli";
import { assertPolicyApplyCapability, PolicyApplyCapabilityBlockError } from "../../src/policy/policy-apply";
import {
	ignoreImportedYamlForPolicyRuntime,
	importPolicyYaml,
	PolicyImportSecretRefusalError,
	PolicyImportValidationError,
	PolicyImportYamlError,
} from "../../src/policy/policy-yaml";
import { createFleetCapability, createFleetCompatibilityProfile } from "../../src/session/fleet-capability";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../../src/session/session-control";

const roots: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-policy-yaml-"));
	roots.push(root);
	return root;
}

async function writeFixture(root: string, name: string, content: string): Promise<string> {
	const filePath = path.join(root, name);
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(filePath, content);
	return filePath;
}

afterEach(async () => {
	for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("policy YAML migration and cutover", () => {
	it("reports global-plus-project scalar, array, and map conflicts while preserving replacement precedence", async () => {
		const root = await temporaryDirectory();
		const global = await writeFixture(
			root,
			"global.yml",
			[
				"modelRoles:",
				"  default: anthropic/claude-global",
				"disabledProviders: [anthropic, openai]",
				"retry:",
				"  proposableFallbackChains:",
				"    default: [anthropic/claude-fallback]",
			].join("\n"),
		);
		const project = await writeFixture(
			root,
			".omp/fable-config.yml",
			[
				"modelRoles:",
				"  default: openai/gpt-project",
				"disabledProviders: [google]",
				"retry:",
				"  proposableFallbackChains:",
				"    qa: [openai/gpt-qa]",
			].join("\n"),
		);
		const imported = await importPolicyYaml([
			{ sourcePath: global, layer: "global", scope: { kind: "global" } },
			{ sourcePath: project, layer: "project", scope: { kind: "workstream", workstream: "alpha" } },
		]);

		expect(imported.conflicts).toHaveLength(3);
		expect(imported.conflicts.find(conflict => conflict.key === "core.routing.default")).toMatchObject({
			mergeSemantics: "scalar-last-wins",
			legacyMergeSemantics: "deep-merge",
			chosen: { sourcePath: project, value: "openai/gpt-project" },
			requiredManualResolution: true,
		});
		expect(imported.conflicts.find(conflict => conflict.key === "core.providers.deny.providers")).toMatchObject({
			mergeSemantics: "array-replace",
			chosen: { value: { providerIds: ["google"] } },
			shadowed: [{ value: { providerIds: ["anthropic", "openai"] } }],
		});
		expect(imported.conflicts.find(conflict => conflict.key === "core.fallback.chains")).toMatchObject({
			mergeSemantics: "map-replace",
			chosen: { value: { chains: { qa: ["openai/gpt-qa"] } } },
		});
		expect(imported.mutations).toHaveLength(6);
		expect(imported.mutations.every(mutation => mutation.importProvenance !== undefined)).toBe(true);
	});

	it("rejects malformed YAML and unknown or malformed policy-owned keys with typed errors", async () => {
		const root = await temporaryDirectory();
		const malformedYaml = await writeFixture(root, "malformed.yml", "modelRoles: [unterminated");
		await expect(importPolicyYaml([{ sourcePath: malformedYaml, layer: "global" }])).rejects.toBeInstanceOf(
			PolicyImportYamlError,
		);

		const unknownRole = await writeFixture(root, "unknown.yml", "modelRoles:\n  futureRole: openai/gpt\n");
		try {
			await importPolicyYaml([{ sourcePath: unknownRole, layer: "global" }]);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(PolicyImportValidationError);
			expect((error as PolicyImportValidationError).issues).toEqual([
				expect.objectContaining({ keyPath: "modelRoles.futureRole", reason: "unknown policy model role" }),
			]);
		}

		const malformedOwned = await writeFixture(root, "wrong-shape.yml", "disabledProviders: anthropic\n");
		await expect(importPolicyYaml([{ sourcePath: malformedOwned, layer: "global" }])).rejects.toBeInstanceOf(
			PolicyImportValidationError,
		);
	});

	it("imports frontmatter routing with source and key-path provenance", async () => {
		const root = await temporaryDirectory();
		const agent = await writeFixture(
			root,
			"qa-agent.md",
			"---\nname: qa-agent\nmodelRole: qa\nmodel: openai/gpt-qa\n---\nAgent body\n",
		);
		const imported = await importPolicyYaml([
			{ sourcePath: agent, layer: "frontmatter", scope: { kind: "workstream", workstream: "alpha" } },
		]);
		expect(imported.mutations).toEqual([
			expect.objectContaining({
				key: "core.routing.qa",
				value: "openai/gpt-qa",
				scope: { kind: "workstream", workstream: "alpha" },
				importProvenance: { sourcePath: agent, keyPath: "model" },
			}),
		]);
	});

	it("refuses planted tokens and known credential key paths before journal mutation", async () => {
		const root = await temporaryDirectory();
		const config = await writeFixture(
			root,
			"config.yml",
			"modelRoles:\n  default: openai/gpt\nanthropicApiKey: sk-ant-this-is-a-planted-token-123456\n",
		);
		try {
			await importPolicyYaml([{ sourcePath: config, layer: "global" }]);
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(PolicyImportSecretRefusalError);
			expect((error as PolicyImportSecretRefusalError).offendingPaths).toEqual([
				expect.objectContaining({ sourcePath: config, keyPath: "anthropicApiKey", classification: "credential" }),
			]);
		}
	});

	it("exports a generated redacted YAML snapshot that parses and round-trips without journal metadata or secrets", async () => {
		const root = await temporaryDirectory();
		const config = await writeFixture(
			root,
			"config.yml",
			[
				"modelRoles:",
				"  default: openai/gpt-export",
				"disabledProviders: [anthropic]",
				"retry:",
				"  proposableFallbackChains:",
				"    default: [openai/gpt-fallback]",
				"task:",
				"  softRequestBudget: 40",
			].join("\n"),
		);
		await runPolicyCommand(
			{ action: "import", configPath: config, apply: true },
			{ directory: root, now: () => new Date("2026-01-01T00:00:00.000Z") },
		);
		const yaml = await runPolicyCommand(
			{ action: "export" },
			{ directory: root, now: () => new Date("2026-01-01T00:00:00.000Z") },
		);
		const parsed = YAML.parse(yaml) as Record<string, unknown>;
		expect(yaml).toContain("GENERATED BY omp policy export — DO NOT EDIT");
		expect(yaml).not.toMatch(/sk-ant|importDigest|transactionId|author:/);
		expect(parsed.generatedPolicySnapshot).toMatchObject({ generated: true, doNotEdit: true, redacted: true });
		const exportedPath = await writeFixture(root, "generated.yml", yaml);
		const roundTrip = await importPolicyYaml([{ sourcePath: exportedPath, layer: "global" }]);
		expect(roundTrip.mutations.map(mutation => mutation.key).sort()).toEqual([
			"core.budgets.task.softRequestBudget",
			"core.fallback.chains",
			"core.providers.deny.providers",
			"core.routing.default",
		]);
	});

	it("ignores only imported YAML keys for a policy-capable runtime and emits one visible notice", () => {
		const notices: string[] = [];
		const settings = {
			modelRoles: { default: "legacy/model" },
			disabledProviders: ["legacy"],
			retry: { proposableFallbackChains: { default: ["legacy/fallback"] }, maxRetries: 3 },
			task: { softRequestBudget: 10, enableLsp: true },
			ui: { theme: "dark" },
		};
		const first = ignoreImportedYamlForPolicyRuntime(settings, {
			policyCapable: true,
			sourcePath: "/generated.yml",
			runtimeId: "session-alpha",
			onNotice: notice => notices.push(notice),
		});
		const second = ignoreImportedYamlForPolicyRuntime(settings, {
			policyCapable: true,
			sourcePath: "/generated.yml",
			runtimeId: "session-alpha",
			onNotice: notice => notices.push(notice),
		});
		expect(first.settings).toEqual({
			retry: { maxRetries: 3 },
			task: { enableLsp: true },
			ui: { theme: "dark" },
		});
		expect(first.notice).toContain("Policy-capable runtime ignored journal-owned YAML keys");
		expect(second.notice).toBeUndefined();
		expect(notices).toHaveLength(1);
		expect(
			ignoreImportedYamlForPolicyRuntime(settings, { policyCapable: false, sourcePath: "/legacy.yml" }).settings,
		).toBe(settings);
	});

	it("blocks policy apply to an old peer without policy capability", () => {
		const local = createFleetCompatibilityProfile(CURRENT_SESSION_CONTROL_PROTOCOL);
		expect(() => assertPolicyApplyCapability({ sessionId: "old-peer" }, local)).toThrow(
			PolicyApplyCapabilityBlockError,
		);
		try {
			assertPolicyApplyCapability({ sessionId: "old-peer" }, local);
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({
				_tag: "PolicyApplyCapabilityBlockError",
				targetSessionId: "old-peer",
				classification: "LegacyIncompatible",
			});
		}
		const capability = createFleetCapability({
			buildDigest: "sha256:policy-capable",
			productVersion: "16.0.1",
			controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
		});
		expect(assertPolicyApplyCapability({ sessionId: "new-peer", fleetCapability: capability }, local)).toBe(
			"policy-apply-v1",
		);
	});

	it("keeps import dry-run by default and import --apply creates visible drift without changing an active session", async () => {
		const root = await temporaryDirectory();
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const options = {
			directory: root,
			now,
			liveSessions: () => [{ sessionId: "active-session", name: "Active", workstream: "alpha", appliedSequence: 1 }],
		};
		await runPolicyCommand({ action: "set", key: "core.routing.default", value: "anthropic/baseline" }, options);
		const config = await writeFixture(root, "config.yml", "modelRoles:\n  default: openai/imported\n");
		const preview = JSON.parse(await runPolicyCommand({ action: "import", configPath: config, json: true }, options));
		expect(preview.committed).toBe(false);
		expect(JSON.parse(await runPolicyCommand({ action: "history", json: true }, options))).toHaveLength(1);

		const applied = JSON.parse(
			await runPolicyCommand({ action: "import", configPath: config, apply: true, json: true }, options),
		);
		expect(applied.committed).toBe(true);
		const drift = JSON.parse(await runPolicyCommand({ action: "drift", json: true }, options));
		expect(drift).toEqual([
			expect.objectContaining({
				sessionId: "active-session",
				appliedSequence: 1,
				headSequence: 2,
				rows: [
					expect.objectContaining({
						key: "core.routing.default",
						applied: { value: "anthropic/baseline", sequence: 1 },
						head: { value: "openai/imported", sequence: 2 },
					}),
				],
			}),
		]);
	});
});
