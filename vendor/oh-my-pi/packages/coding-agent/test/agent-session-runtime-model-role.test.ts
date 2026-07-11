import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { Effort } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("AgentSession explicit runtime model roles", () => {
	it("rolls back runtime and persisted roles when model synchronization fails", async () => {
		const tempDir = TempDir.createSync("@pi-runtime-model-role-");
		const agentDir = path.join(tempDir.path(), "agent");
		const initialModel = getBundledModel("anthropic", "claude-sonnet-4-5");
		const nextModel = getBundledModel("anthropic", "claude-sonnet-4-6");
		if (!initialModel || !nextModel) throw new Error("Expected bundled Anthropic models");
		const initialSelector = `${initialModel.provider}/${initialModel.id}`;
		const nextSelector = `${nextModel.provider}/${nextModel.id}`;

		fs.mkdirSync(agentDir, { recursive: true });
		await Bun.write(
			path.join(agentDir, "config.yml"),
			`includeModelInPrompt: true\nmodelRoles:\n  default: ${initialSelector}\n`,
		);
		resetSettingsForTest();
		let session: AgentSession | undefined;
		let authStorage: AuthStorage | undefined;
		try {
			const settings = await Settings.init({ cwd: tempDir.path(), agentDir });
			settings.setRuntimeModelRole("default", initialSelector);
			authStorage = await AuthStorage.create(path.join(agentDir, "auth.db"));
			authStorage.setRuntimeApiKey("anthropic", "test-key");
			const modelRegistry = new ModelRegistry(authStorage, path.join(agentDir, "models.yml"));
			const agent = new Agent({
				initialState: {
					model: initialModel,
					systemPrompt: ["Test"],
					tools: [],
					messages: [],
					thinkingLevel: Effort.Medium,
				},
			});
			session = new AgentSession({
				agent,
				sessionManager: SessionManager.inMemory(),
				settings,
				modelRegistry,
				rebuildSystemPrompt: async () => {
					throw new Error("prompt rebuild failed");
				},
			});

			const initialThinkingLevel = session.thinkingLevel;
			await expect(session.setModelExplicitRuntime(nextModel)).rejects.toThrow("prompt rebuild failed");
			expect(session.model?.id).toBe(initialModel.id);
			expect(session.thinkingLevel).toBe(initialThinkingLevel);
			expect(settings.resolveModelRole("default")).toMatchObject({
				effectiveSelector: initialSelector,
				winningLayer: "runtime_override",
				shadowedCandidates: [{ layer: "global", selector: initialSelector }],
			});

			await settings.reloadFromDisk();
			expect(settings.resolveModelRole("default").effectiveSelector).toBe(initialSelector);
			expect(settings.resolveModelRole("default").effectiveSelector).not.toBe(nextSelector);
		} finally {
			await session?.dispose();
			authStorage?.close();
			resetSettingsForTest();
			tempDir.removeSync();
		}
	});
});
