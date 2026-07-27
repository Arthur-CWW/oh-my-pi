import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

type FastModeScope = "both" | "openai" | "claude";

describe("fast mode scope", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let session: AgentSession;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-fast-mode-scope-");
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
		}
		authStorage?.close();
		tempDir.removeSync();
	});

	async function createSession(fastModeScope?: FastModeScope): Promise<AgentSession> {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) {
			throw new Error("Expected bundled test model to exist");
		}

		const settings = fastModeScope === undefined ? Settings.isolated() : Settings.isolated({ fastModeScope });
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});

		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey(model.provider, "anthropic-token");
		modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));

		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		session.subscribe(() => {});
		return session;
	}

	it("scopes enabled fast mode to OpenAI when configured", async () => {
		const session = await createSession("openai");

		session.setFastMode(true);

		expect(session.serviceTier).toBe("openai-only");
	});

	it("scopes enabled fast mode to Claude when configured", async () => {
		const session = await createSession("claude");

		session.setFastMode(true);

		expect(session.serviceTier).toBe("claude-only");
	});

	it("defaults enabled fast mode to priority for both providers", async () => {
		const session = await createSession();

		session.setFastMode(true);

		expect(session.serviceTier).toBe("priority");
	});

	it("clears the service tier when disabled", async () => {
		const session = await createSession("openai");
		session.setFastMode(true);

		session.setFastMode(false);

		expect(session.serviceTier).toBeUndefined();
	});

	it("does not broaden an already enabled scoped tier", async () => {
		const session = await createSession("claude");
		session.setFastMode(true);
		expect(session.serviceTier).toBe("claude-only");
		session.settings.set("fastModeScope", "both");

		session.setFastMode(true);

		expect(session.serviceTier).toBe("claude-only");
	});

	it("enables fast mode for only OpenAI when scoped from off", async () => {
		const session = await createSession();

		session.setFastMode(true, "openai");

		expect(session.serviceTier).toBe("openai-only");
	});

	it("adds Claude to an OpenAI-only fast mode scope", async () => {
		const session = await createSession();
		session.setServiceTier("openai-only");

		session.setFastMode(true, "claude");

		expect(session.serviceTier).toBe("priority");
	});

	it("removes Claude from a both-provider fast mode scope", async () => {
		const session = await createSession();
		session.setServiceTier("priority");

		session.setFastMode(false, "claude");

		expect(session.serviceTier).toBe("openai-only");
	});

	it("turns fast mode off when removing the only Claude scope", async () => {
		const session = await createSession();
		session.setServiceTier("claude-only");

		session.setFastMode(false, "claude");

		expect(session.serviceTier).toBeUndefined();
	});

	it("enables fast mode for both providers when scoped to both from off", async () => {
		const session = await createSession();

		session.setFastMode(true, "both");

		expect(session.serviceTier).toBe("priority");
	});

	it("adds OpenAI while scoped fast mode is already enabled for Claude", async () => {
		const session = await createSession();
		session.setServiceTier("claude-only");

		session.setFastMode(true, "openai");

		expect(session.serviceTier).toBe("priority");
	});
});
