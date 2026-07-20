import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { type Api, Effort, type Model } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resolveAgentModelPatterns } from "@oh-my-pi/pi-coding-agent/config/role-resolution";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { type CreateAgentSessionResult, createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { getRestorableSessionModels } from "@oh-my-pi/pi-coding-agent/session/session-context";
import {
	EPHEMERAL_MODEL_CHANGE_ROLE,
	type TransitionGoalModeSessionCommand,
	type TransitionPlanModeSessionCommand,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { AUTO_THINKING } from "@oh-my-pi/pi-coding-agent/thinking";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("AgentSession model persistence", () => {
	let tempDir: TempDir;
	let session: AgentSession | undefined;
	let sessionSettings: Settings;
	// Auth storage (SQLite DB) and the model registry are immutable across these tests:
	// every test sets the same anthropic runtime key and only ever reads the bundled model
	// list. Building them once avoids ~12 SQLite opens + registry constructions.
	let sharedDir: TempDir;
	let sharedAuthStorage: AuthStorage;
	let sharedModelRegistry: ModelRegistry;

	beforeAll(async () => {
		sharedDir = TempDir.createSync("@pi-model-persistence-shared-");
		sharedAuthStorage = await AuthStorage.create(path.join(sharedDir.path(), "auth.db"));
		sharedAuthStorage.setRuntimeApiKey("anthropic", "test-key");
		sharedModelRegistry = new ModelRegistry(sharedAuthStorage, path.join(sharedDir.path(), "models.yml"));
	});

	afterAll(() => {
		sharedAuthStorage.close();
		sharedDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-model-persistence-");
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
			session = undefined;
		}
		tempDir.removeSync();
	});

	function getAnthropicModelOrThrow(id: string): Model<Api> {
		const model = getBundledModel("anthropic", id);
		if (!model) throw new Error(`Expected anthropic model ${id} to exist`);
		return model;
	}

	function modelValue(model: Model<Api>): string {
		return `${model.provider}/${model.id}`;
	}

	async function writeRoleModelSession(
		defaultRoleValue: string,
		smolRoleValue: string,
		lastRole = "smol",
	): Promise<string> {
		const targetSessionFile = path.join(tempDir.path(), `target-${Bun.nanoseconds()}.jsonl`);
		const timestamp = "2026-06-01T00:00:00.000Z";
		await Bun.write(
			targetSessionFile,
			`${[
				{ type: "session", version: 3, id: "target-session", timestamp, cwd: tempDir.path() },
				{
					type: "model_change",
					id: "default-model",
					parentId: null,
					timestamp,
					model: defaultRoleValue,
					role: "default",
				},
				{
					type: "model_change",
					id: "smol-model",
					parentId: "default-model",
					timestamp,
					model: smolRoleValue,
					role: lastRole,
				},
			]
				.map(entry => JSON.stringify(entry))
				.join("\n")}\n`,
		);
		return targetSessionFile;
	}
	async function createSession(options?: {
		initialModel?: Model<Api>;
		selectInitialModel?: (availableModels: Model<Api>[]) => Model<Api>;
		modelRoles?: Record<string, string>;
		persist?: boolean;
		settings?: Settings;
	}): Promise<{ modelRegistry: ModelRegistry; settings: Settings; session: AgentSession; sessionManager: SessionManager }> {
		const modelRegistry = sharedModelRegistry;
		const model =
			options?.initialModel ??
			options?.selectInitialModel?.(modelRegistry.getAvailable()) ??
			getAnthropicModelOrThrow("claude-sonnet-4-5");
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
				thinkingLevel: Effort.Medium,
			},
		});

		sessionSettings = options?.settings ?? Settings.isolated();
		const modelRoles = options?.modelRoles;
		if (modelRoles) {
			for (const role in modelRoles) {
				const modelRoleValue = modelRoles[role];
				if (modelRoleValue !== undefined) {
					sessionSettings.setModelRole(role, modelRoleValue);
				}
			}
		}
		const sessionManager = options?.persist
			? SessionManager.create(tempDir.path(), path.join(tempDir.path(), "active"))
			: SessionManager.inMemory();
		session = new AgentSession({
			agent,
			sessionManager,
			settings: sessionSettings,
			modelRegistry,
		});

		return { modelRegistry, settings: sessionSettings, session, sessionManager };
	}

	async function createStartupResumeSession(
		targetSessionFile: string,
		settings: Settings = Settings.isolated(),
	): Promise<CreateAgentSessionResult> {
		const sessionManager = await SessionManager.open(targetSessionFile, path.join(tempDir.path(), "startup"));
		const result = await createAgentSession({
			cwd: tempDir.path(),
			agentDir: tempDir.path(),
			authStorage: sharedAuthStorage,
			modelRegistry: sharedModelRegistry,
			sessionManager,
			settings,
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		session = result.session;
		return result;
	}
	it("switches the active model without persisting by default", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);

		const created = await createSession({
			initialModel: defaultModel,
			modelRoles: { default: defaultRoleValue },
		});

		await created.session.setModel(nextModel);

		expect(created.session.model?.id).toBe(nextModel.id);
		expect(created.settings.getModelRole("default")).toBe(defaultRoleValue);
	});

	it("persists the default role when explicitly requested", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");

		const created = await createSession({
			initialModel: defaultModel,
			modelRoles: { default: modelValue(defaultModel) },
		});

		await created.session.setModel(nextModel, "default", { persist: true });

		expect(created.session.model?.id).toBe(nextModel.id);
		expect(created.settings.getModelRole("default")).toBe(modelValue(nextModel));
	});

	it("refuses persisted role changes before changing the live session model", async () => {
		const initialModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const projectSettingsPath = path.join(tempDir.path(), ".claude", "settings.json");
		const agentDir = path.join(tempDir.path(), "agent");
		fs.mkdirSync(path.dirname(projectSettingsPath), { recursive: true });
		fs.mkdirSync(agentDir, { recursive: true });
		fs.writeFileSync(
			projectSettingsPath,
			JSON.stringify({ modelRoles: { default: modelValue(initialModel) } }),
		);

		resetSettingsForTest();
		try {
			const settings = await Settings.init({ cwd: tempDir.path(), agentDir });
			const created = await createSession({ initialModel, settings });
			const entryCount = created.sessionManager.getEntries().length;

			await expect(created.session.setModel(nextModel, "default", { persist: true })).rejects.toThrow(
				"modelRoles.default is overridden by project settings",
			);
			expect(created.session.model?.id).toBe(initialModel.id);
			expect(created.sessionManager.getEntries()).toHaveLength(entryCount);
			expect(created.settings.getModelRole("default")).toBe(modelValue(initialModel));
		} finally {
			resetSettingsForTest();
		}
	});

	it("cycles role models without rewriting configured roles", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const slowModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const slowRoleValue = `${modelValue(slowModel)}:high`;

		const created = await createSession({
			initialModel: defaultModel,
			modelRoles: {
				default: defaultRoleValue,
				slow: slowRoleValue,
			},
		});

		const result = await created.session.cycleRoleModels(["default", "slow"]);

		expect(result?.role).toBe("slow");
		expect(result?.model.id).toBe(slowModel.id);
		expect(created.session.model?.id).toBe(slowModel.id);
		expect(created.settings.getModelRole("default")).toBe(defaultRoleValue);
		expect(created.settings.getModelRole("slow")).toBe(slowRoleValue);
	});

	it("cycles role models backward from the current role", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const slowModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const slowRoleValue = modelValue(slowModel);

		const created = await createSession({
			initialModel: defaultModel,
			modelRoles: {
				default: defaultRoleValue,
				slow: slowRoleValue,
			},
		});

		const forward = await created.session.cycleRoleModels(["default", "slow"], "forward");
		const backward = await created.session.cycleRoleModels(["default", "slow"], "backward");

		expect(forward?.role).toBe("slow");
		expect(backward?.role).toBe("default");
		expect(created.session.model?.id).toBe(defaultModel.id);
		expect(created.settings.getModelRole("default")).toBe(defaultRoleValue);
		expect(created.settings.getModelRole("slow")).toBe(slowRoleValue);
	});

	it("cycles available models without persisting the default role", async () => {
		const created = await createSession({
			selectInitialModel: availableModels => {
				if (availableModels.length <= 1 || !availableModels[0]) {
					throw new Error("Expected at least two available models");
				}
				return availableModels[0];
			},
		});
		const initialModel = created.session.model;
		if (!initialModel) throw new Error("Expected initial model to be set");
		const defaultRoleValue = modelValue(initialModel);
		created.settings.setModelRole("default", defaultRoleValue);

		const result = await created.session.cycleModel();

		if (!result) throw new Error("Expected cycleModel to return a new model");
		expect(modelValue(result.model)).not.toBe(defaultRoleValue);
		const activeModel = created.session.model;
		if (!activeModel) throw new Error("Expected active model after cycleModel");
		expect(modelValue(activeModel)).toBe(modelValue(result.model));
		expect(created.settings.getModelRole("default")).toBe(defaultRoleValue);
	});

	it("restores the last active role model when switching sessions", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const smolModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const smolRoleValue = modelValue(smolModel);

		const targetSessionFile = await writeRoleModelSession(defaultRoleValue, smolRoleValue);

		const created = await createSession({
			initialModel: defaultModel,
			modelRoles: { default: defaultRoleValue, smol: smolRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(smolModel.id);
	});

	it("restores the last active role model during startup resume", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const smolModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const smolRoleValue = modelValue(smolModel);
		const targetSessionFile = await writeRoleModelSession(defaultRoleValue, smolRoleValue);

		const result = await createStartupResumeSession(targetSessionFile);

		expect(result.session.model?.id).toBe(smolModel.id);
	});

	it("falls back to the saved default model when switch-session role restore is unavailable", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const previousModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const targetSessionFile = await writeRoleModelSession(defaultRoleValue, "anthropic/not-loaded-anymore");

		const created = await createSession({
			initialModel: previousModel,
			modelRoles: { default: defaultRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(defaultModel.id);
	});

	it("restores the saved default model when switch-session last role is fallback", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const fallbackModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const targetSessionFile = await writeRoleModelSession(
			defaultRoleValue,
			modelValue(fallbackModel),
			EPHEMERAL_MODEL_CHANGE_ROLE,
		);

		const created = await createSession({
			initialModel: fallbackModel,
			modelRoles: { default: defaultRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(defaultModel.id);
	});

	it("falls back to the saved default model when startup role restore is unavailable", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const settingsFallbackModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const targetSessionFile = await writeRoleModelSession(defaultRoleValue, "anthropic/not-loaded-anymore");
		const settings = Settings.isolated();
		settings.setModelRole("default", modelValue(settingsFallbackModel));

		const result = await createStartupResumeSession(targetSessionFile, settings);

		expect(result.session.model?.id).toBe(defaultModel.id);
	});

	it("restores the saved default model when startup last role is fallback", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const fallbackModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const targetSessionFile = await writeRoleModelSession(
			defaultRoleValue,
			modelValue(fallbackModel),
			EPHEMERAL_MODEL_CHANGE_ROLE,
		);
		const settings = Settings.isolated();
		settings.setModelRole("default", modelValue(fallbackModel));

		const result = await createStartupResumeSession(targetSessionFile, settings);

		expect(result.session.model?.id).toBe(defaultModel.id);
	});

	it("restores a temporary model when switching sessions", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const temporaryModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const targetSessionFile = await writeRoleModelSession(defaultRoleValue, modelValue(temporaryModel), "temporary");

		const created = await createSession({
			initialModel: defaultModel,
			modelRoles: { default: defaultRoleValue },
			persist: true,
		});

		await expect(created.session.switchSession(targetSessionFile)).resolves.toBe(true);
		expect(created.session.model?.id).toBe(temporaryModel.id);
	});

	it("restores a temporary model during startup resume", async () => {
		const defaultModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const temporaryModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const defaultRoleValue = modelValue(defaultModel);
		const targetSessionFile = await writeRoleModelSession(defaultRoleValue, modelValue(temporaryModel), "temporary");
		const settings = Settings.isolated();
		settings.setModelRole("default", defaultRoleValue);

		const result = await createStartupResumeSession(targetSessionFile, settings);

		expect(result.session.model?.id).toBe(temporaryModel.id);
	});

	it("lists restorable temporary model before the default fallback", () => {
		expect(
			getRestorableSessionModels(
				{
					default: "anthropic/claude-sonnet-4-5",
					temporary: "anthropic/claude-sonnet-4-6",
				},
				"temporary",
			),
		).toEqual(["anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-4-5"]);
	});

	it("lists only the default model for ephemeral fallback restores", () => {
		expect(
			getRestorableSessionModels(
				{
					default: "anthropic/claude-sonnet-4-5",
					[EPHEMERAL_MODEL_CHANGE_ROLE]: "anthropic/claude-sonnet-4-6",
				},
				EPHEMERAL_MODEL_CHANGE_ROLE,
			),
		).toEqual(["anthropic/claude-sonnet-4-5"]);
	});

	it("lists a named role model before the default fallback", () => {
		expect(
			getRestorableSessionModels(
				{
					default: "anthropic/claude-sonnet-4-5",
					smol: "anthropic/claude-sonnet-4-6",
				},
				"smol",
			),
		).toEqual(["anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-4-5"]);
	});

	it("makes an explicit config-shadowed default runtime-authoritative across reload", async () => {
		const initialModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const agentDir = path.join(tempDir.path(), "agent");
		const configOverlay = path.join(tempDir.path(), "overlay.yml");
		fs.mkdirSync(agentDir, { recursive: true });
		await Bun.write(configOverlay, `modelRoles:\n  default: ${modelValue(initialModel)}\n`);

		resetSettingsForTest();
		try {
			const settings = await Settings.init({
				cwd: tempDir.path(),
				agentDir,
				configFiles: [configOverlay],
			});
			const created = await createSession({ initialModel, settings });

			await created.session.setModelExplicitRuntime(nextModel, "default", {
				thinkingLevel: Effort.High,
			});

			expect(created.session.model?.id).toBe(nextModel.id);
			const modelChange = created.sessionManager.getEntries().findLast(entry => entry.type === "model_change");
			if (modelChange?.type !== "model_change") throw new Error("Expected a model change entry");
			expect(modelChange.role).toBe("default");
			expect(created.settings.resolveModelRole("default")).toMatchObject({
				effectiveSelector: `${modelValue(nextModel)}:high`,
				winningLayer: "runtime_override",
				shadowedCandidates: [{ layer: "config_overlay", selector: modelValue(initialModel) }],
			});

			await created.settings.reloadFromDisk();
			expect(created.settings.resolveModelRole("default").effectiveSelector).toBe(`${modelValue(nextModel)}:high`);
		} finally {
			resetSettingsForTest();
		}
	});

	it("persists writable explicit defaults while retaining the runtime override", async () => {
		const initialModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const agentDir = path.join(tempDir.path(), "agent");
		fs.mkdirSync(agentDir, { recursive: true });

		resetSettingsForTest();
		try {
			const settings = await Settings.init({ cwd: tempDir.path(), agentDir });
			const created = await createSession({ initialModel, settings });

			await created.session.setModelExplicitRuntime(nextModel);

			const resolution = created.settings.resolveModelRole("default");
			expect(resolution).toMatchObject({
				effectiveSelector: modelValue(nextModel),
				winningLayer: "runtime_override",
				shadowedCandidates: [{ layer: "global", selector: modelValue(nextModel) }],
			});
		} finally {
			resetSettingsForTest();
		}
	});

	it("uses explicit non-default runtime roles for subsequent child resolution", async () => {
		const initialModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const nextModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const created = await createSession({ initialModel });

		await created.session.setModelExplicitRuntime(nextModel, "smol", { thinkingLevel: Effort.High });

		expect(
			resolveAgentModelPatterns({
				taskOrRoleModel: "pi/smol",
				settings: created.settings,
			}),
		).toEqual([`${modelValue(nextModel)}:high`]);
		expect(created.settings.resolveModelRole("smol").winningLayer).toBe("runtime_override");
	});

	it("keeps temporary model selection out of runtime roles", async () => {
		const initialModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const temporaryModel = getAnthropicModelOrThrow("claude-sonnet-4-6");
		const created = await createSession({
			initialModel,
			modelRoles: { default: modelValue(initialModel) },
		});
		const before = created.settings.resolveModelRole("default");

		await created.session.setModelTemporary(temporaryModel, Effort.High);

		expect(created.session.model?.id).toBe(temporaryModel.id);
		expect(created.settings.resolveModelRole("default")).toEqual(before);
	});

	it("rejects unauthenticated explicit assignments without mutating runtime or session state", async () => {
		const initialModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const unauthenticatedModel = getBundledModel("openai", "gpt-4o-mini");
		if (!unauthenticatedModel) throw new Error("Expected bundled unauthenticated OpenAI model");
		const created = await createSession({
			initialModel,
			modelRoles: { default: modelValue(initialModel) },
		});
		const entryCount = created.sessionManager.getEntries().length;
		const before = created.settings.resolveModelRole("default");

		await expect(created.session.setModelExplicitRuntime(unauthenticatedModel)).rejects.toThrow("No API key");

		expect(created.session.model?.id).toBe(initialModel.id);
		expect(created.sessionManager.getEntries()).toHaveLength(entryCount);
		expect(created.settings.resolveModelRole("default")).toEqual(before);
	});
	it("restores journaled auto thinking during fresh SDK startup", async () => {
		const persisted = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "persisted-auto"));
		await persisted.commitStateCommand({
			schemaVersion: 1,
			kind: "setThinkingLevel",
			commandId: "startup-auto",
			correlationId: "startup-auto-correlation",
			expectedSessionRevision: persisted.getSessionRevision(),
			thinkingLevel: AUTO_THINKING,
		});
		await persisted.flush();
		const sessionFile = persisted.getSessionFile();
		expect(sessionFile).toBeDefined();
		await persisted.close();

		const resumed = await createStartupResumeSession(sessionFile!);
		expect(resumed.session.configuredThinkingLevel()).toBe(AUTO_THINKING);
		expect(resumed.session.isAutoThinking).toBe(true);
	});

	it("persists and restores plan workflow transitions across SDK reopen", async () => {
		const initialModel = getAnthropicModelOrThrow("claude-sonnet-4-5");
		const planModel = getAnthropicModelOrThrow("claude-opus-4-5");
		const settings = Settings.isolated({
			modelRoles: {
				default: `${initialModel.provider}/${initialModel.id}:high`,
				plan: `${planModel.provider}/${planModel.id}:off`,
			},
		});
		const manager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "sessions"));
		const created = await createAgentSession({
			cwd: tempDir.path(),
			agentDir: tempDir.path(),
			authStorage: sharedAuthStorage,
			modelRegistry: sharedModelRegistry,
			sessionManager: manager,
			model: initialModel,
			thinkingLevel: Effort.High,
			settings,
			toolNames: ["read", "edit", "bash"],
			disableExtensionDiscovery: true,
			skills: [],
			contextFiles: [],
			promptTemplates: [],
			slashCommands: [],
			enableMCP: false,
			enableLsp: false,
			skipPythonPreflight: true,
		});
		session = created.session;
		const originalTools = [...session.getActiveToolNames()];
		const baselineSideEntryTypes = session.sessionManager
			.getEntries()
			.filter(entry => entry.type !== "workflow_change")
			.map(entry => entry.type);
		const sessionFile = session.sessionFile;
		if (!sessionFile) throw new Error("Expected persisted session file");
		const enter: TransitionPlanModeSessionCommand = {
			schemaVersion: 1,
			kind: "transitionPlanMode",
			commandId: "sdk-plan-enter",
			correlationId: "sdk-plan-enter-correlation",
			expectedSessionRevision: session.sessionManager.getSessionRevision(),
			transition: {
				kind: "enter",
				planFilePath: "local://PLAN.md",
				workflow: "parallel",
			},
		};
		await session.commitPlanWorkflowTransition(enter);
		expect(session.getPlanModeState()).toMatchObject({
			enabled: true,
			planFilePath: "local://PLAN.md",
			workflow: "parallel",
		});
		expect(session.getActiveToolNames()).not.toContain("resolve");
		expect(session.model?.id).toBe(planModel.id);
		expect(session.configuredThinkingLevel()).toBe("off");
		expect(session.sessionManager.getEntries().filter(entry => entry.type === "workflow_change")).toHaveLength(1);
		expect(
			session.sessionManager
				.getEntries()
				.filter(entry => entry.type !== "workflow_change")
				.map(entry => entry.type),
		).toEqual(baselineSideEntryTypes);

		await session.dispose();
		session = undefined;
		const reopened = await createStartupResumeSession(sessionFile, settings);
		expect(reopened.session.getPlanModeState()).toMatchObject({
			enabled: true,
			planFilePath: "local://PLAN.md",
			workflow: "parallel",
		});
		expect(reopened.session.getActiveToolNames()).not.toContain("resolve");
		expect(reopened.session.model?.id).toBe(planModel.id);
		expect(reopened.session.configuredThinkingLevel()).toBe("off");

		const pause: TransitionPlanModeSessionCommand = {
			schemaVersion: 1,
			kind: "transitionPlanMode",
			commandId: "sdk-plan-pause",
			correlationId: "sdk-plan-pause-correlation",
			expectedSessionRevision: reopened.session.sessionManager.getSessionRevision(),
			transition: { kind: "exit", disposition: "paused" },
		};
		await reopened.session.commitPlanWorkflowTransition(pause);
		expect(reopened.session.getPlanModeState()).toBeUndefined();
		expect(reopened.session.getActiveToolNames()).toEqual(originalTools);
		expect(reopened.session.model?.id).toBe(initialModel.id);
		expect(reopened.session.configuredThinkingLevel()).toBe(Effort.High);
		expect(reopened.session.sessionManager.getEntries().filter(entry => entry.type === "workflow_change")).toHaveLength(2);
		expect(
			reopened.session.sessionManager
				.getEntries()
				.filter(entry => entry.type !== "workflow_change")
				.map(entry => entry.type),
		).toEqual(baselineSideEntryTypes);

		await reopened.session.dispose();
		session = undefined;
		const resumed = await createStartupResumeSession(sessionFile, settings);
		expect(resumed.session.getPlanModeState()).toBeUndefined();
		expect(resumed.session.getActiveToolNames()).toEqual(originalTools);
		expect(resumed.session.model?.id).toBe(initialModel.id);
		expect(resumed.session.configuredThinkingLevel()).toBe(Effort.High);
		expect(resumed.session.sessionManager.getEntries().filter(entry => entry.type === "workflow_change")).toHaveLength(2);
		expect(
			resumed.session.sessionManager
				.getEntries()
				.filter(entry => entry.type !== "workflow_change")
				.map(entry => entry.type),
		).toEqual(baselineSideEntryTypes);
	});

	it("rolls back goal state and accounting when switch target goal reconciliation fails", async () => {
		const created = await createSession({ persist: true });
		const previousManager = created.session.sessionManager;
		const previousSessionFile = previousManager.getSessionFile();
		const previousSessionId = created.session.sessionId;
		const previousGoalState = {
			enabled: true,
			mode: "active" as const,
			goal: {
				id: "goal-before-failed-switch",
				objective: "Keep the original accounting state",
				status: "active" as const,
				tokensUsed: 37,
				timeUsedSeconds: 11,
				createdAt: 100,
				updatedAt: 200,
			},
		};
		created.session.goalRuntime.hydratePersistedState(previousGoalState);
		created.session.goalRuntime.onTurnStart("turn-before-failed-switch", {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		});

		const targetManager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "invalid-goal-target"));
		const targetSessionFile = targetManager.getSessionFile();
		if (!targetSessionFile) throw new Error("Expected persisted target session file");
		const targetGoalState = {
			enabled: true,
			mode: "active" as const,
			goal: {
				id: "goal-present-only-in-target",
				objective: "Must disappear when reconciliation fails",
				status: "active" as const,
				tokensUsed: 91,
				timeUsedSeconds: 23,
				createdAt: 300,
				updatedAt: 400,
			},
		};
		targetManager.appendModeChange("goal", { goal: targetGoalState });
		const conflictingEnter: TransitionGoalModeSessionCommand = {
			schemaVersion: 1,
			kind: "transitionGoalMode",
			commandId: "conflicting-target-goal-enter",
			correlationId: "conflicting-target-goal-enter-correlation",
			expectedSessionRevision: targetManager.getSessionRevision(),
			transition: {
				kind: "enter",
				action: "create",
				objective: "Conflicting committed target goal",
			},
		};
		await targetManager.commitWorkflowCommand(
			conflictingEnter,
			{ kind: "goal", phase: "active", goalId: targetGoalState.goal.id },
			{ mode: { kind: "none" }, activeToolNames: ["read"] },
			{ kind: "goal", phase: "active", goalId: "conflicting-target-goal" },
		);
		await targetManager.close();

		await expect(created.session.switchSession(targetSessionFile)).rejects.toThrow(
			"cannot create goal because existing goal is active",
		);
		expect(created.session.sessionManager).toBe(previousManager);
		expect(created.session.sessionFile).toBe(previousSessionFile);
		expect(created.session.sessionId).toBe(previousSessionId);
		expect(created.session.getGoalModeState()).toEqual(previousGoalState);
		expect(created.session.goalRuntime.snapshot.turnSnapshot?.activeGoalId).toBe(previousGoalState.goal.id);
		expect(JSON.stringify(created.session.getGoalModeState())).not.toContain(targetGoalState.goal.id);

		await created.session.goalRuntime.flushUsage({
			input: 9,
			output: 8,
			cacheRead: 0,
			cacheWrite: 0,
		});
		expect(created.session.getGoalModeState()?.goal.tokensUsed).toBe(54);
	});

	it("reconciles a committed goal workflow without a runtime entry across active and paused reopens", async () => {
		const manager = SessionManager.create(tempDir.path(), path.join(tempDir.path(), "goal-sessions"));
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("Expected persisted goal session file");
		const enter: TransitionGoalModeSessionCommand = {
			schemaVersion: 1,
			kind: "transitionGoalMode",
			commandId: "sdk-goal-enter",
			correlationId: "sdk-goal-enter-correlation",
			expectedSessionRevision: manager.getSessionRevision(),
			transition: {
				kind: "enter",
				action: "create",
				objective: "Recover a committed goal",
			},
		};
		await manager.commitWorkflowCommand(
			enter,
			{ kind: "none" },
			{ mode: { kind: "none" }, activeToolNames: ["read", "edit", "bash"] },
			{ kind: "goal", phase: "active", goalId: "goal-recovery-proof" },
		);
		expect(manager.getEntries().filter(entry => entry.type === "mode_change")).toHaveLength(0);
		await manager.close();

		const active = await createStartupResumeSession(sessionFile);
		expect(active.session.getGoalModeState()).toMatchObject({
			enabled: true,
			goal: {
				id: "goal-recovery-proof",
				objective: "Recover a committed goal",
				status: "active",
			},
		});
		expect(active.session.getActiveToolNames()).toContain("goal");
		const pause: TransitionGoalModeSessionCommand = {
			schemaVersion: 1,
			kind: "transitionGoalMode",
			commandId: "sdk-goal-pause",
			correlationId: "sdk-goal-pause-correlation",
			expectedSessionRevision: active.session.sessionManager.getSessionRevision(),
			transition: {
				kind: "exit",
				goalId: "goal-recovery-proof",
				disposition: "paused",
			},
		};
		await active.session.commitGoalWorkflowTransition(pause);
		await active.session.dispose();
		session = undefined;

		const paused = await createStartupResumeSession(sessionFile);
		expect(paused.session.getGoalModeState()).toMatchObject({
			enabled: false,
			goal: {
				id: "goal-recovery-proof",
				objective: "Recover a committed goal",
				status: "paused",
			},
		});
		expect(paused.session.getActiveToolNames()).not.toContain("goal");
		expect(paused.session.sessionManager.getEntries().filter(entry => entry.type === "workflow_change")).toHaveLength(2);
		const differentManager = SessionManager.create(
			tempDir.path(),
			path.join(tempDir.path(), "different-goal-sessions"),
		);
		const differentSessionFile = differentManager.getSessionFile();
		if (!differentSessionFile) throw new Error("Expected different persisted goal session file");
		const differentEnter: TransitionGoalModeSessionCommand = {
			...enter,
			commandId: "sdk-different-goal-enter",
			correlationId: "sdk-different-goal-enter-correlation",
			expectedSessionRevision: differentManager.getSessionRevision(),
			transition: {
				kind: "enter",
				action: "create",
				objective: "Replace stale hydrated state",
			},
		};
		await differentManager.commitWorkflowCommand(
			differentEnter,
			{ kind: "none" },
			{ mode: { kind: "none" }, activeToolNames: ["read"] },
			{ kind: "goal", phase: "active", goalId: "goal-after-switch" },
		);
		await differentManager.close();

		await expect(paused.session.switchSession(differentSessionFile)).resolves.toBe(true);
		expect(paused.session.getGoalModeState()).toMatchObject({
			enabled: true,
			goal: {
				id: "goal-after-switch",
				objective: "Replace stale hydrated state",
				status: "active",
			},
		});
		expect(paused.session.getActiveToolNames()).toContain("goal");
	});

});
