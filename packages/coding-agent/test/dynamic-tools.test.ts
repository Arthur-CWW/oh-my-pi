import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage, validateToolArguments } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import {
	createAgentSession,
	type ExtensionFactory,
} from "@oh-my-pi/pi-coding-agent/sdk";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { z } from "zod/v4";
import { initializeExtensions } from "../src/modes/runtime-init";
import type { AgentSession } from "../src/session/agent-session";

describe("dynamic extension tools", () => {
	it("registers during session_start, validates and executes live, then removes the tool on shutdown", async () => {
		const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-dynamic-tools-"));
		const workspaceDir = path.join(tempDir, "workspace");
		fs.mkdirSync(workspaceDir, { recursive: true });
		const previousHome = process.env.HOME;
		const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
		process.env.HOME = tempDir;
		process.env.OMP_SESSION_CONTROL_DB = path.join(tempDir, "session-control.sqlite");
		const ircBus = new IrcExternalBus(path.join(tempDir, "irc-bus.sqlite"));

		let authStorage: AuthStorage | undefined;
		let session: AgentSession | undefined;
		let disposed = false;
		const reportedErrors: string[] = [];
		const sessionEvents: Array<{ reason: string; previousSessionFile: string | undefined }> = [];
		let executeCalls = 0;

		const extension: ExtensionFactory = pi => {
			pi.on("session_start", () => {
				pi.registerTool({
					name: "runtime_echo",
					label: "Runtime Echo",
					description: "Echo a message registered after the session starts.",
					parameters: z.object({ message: z.string().min(1) }),
					async execute(_toolCallId, params) {
						executeCalls += 1;
						return { content: [{ type: "text", text: `echo:${params.message}` }] };
					},
					onSession(event) {
						sessionEvents.push({ ...event });
					},
				});
			});
		};

		try {
			authStorage = await AuthStorage.create(path.join(tempDir, "auth.db"));
			const modelRegistry = new ModelRegistry(authStorage);
			({ session } = await createAgentSession({
				cwd: workspaceDir,
				agentDir: tempDir,
				modelRegistry,
				sessionManager: SessionManager.inMemory(),
				settings: Settings.isolated(),
				model: getBundledModel("openai", "gpt-4o-mini"),
				disableExtensionDiscovery: true,
				extensions: [extension],
				autoApprove: true,
				skills: [],
				contextFiles: [],
				promptTemplates: [],
				slashCommands: [],
				enableMCP: false,
				enableLsp: false,
				rules: [],
				workspaceTree: {
					rootPath: workspaceDir,
					rendered: "",
					truncated: false,
					totalLines: 0,
					agentsMdFiles: [],
				},
			}));

			await initializeExtensions(session, {
				reportSendError: (action, error) => {
					reportedErrors.push(`${action}: ${error.message}`);
				},
				reportRuntimeError: error => {
					reportedErrors.push(`${error.extensionPath}:${error.event}: ${error.error}`);
				},
			});

			const tool = session.getToolByName("runtime_echo");
			expect(tool).toBeDefined();
			expect((tool as { origin?: unknown }).origin).toEqual({ kind: "dynamic", source: "<inline-0>" });
			expect(reportedErrors).toEqual([]);

			expect(() =>
				validateToolArguments(tool!, {
					type: "toolCall",
					id: "invalid-runtime-echo",
					name: tool!.name,
					arguments: {},
				}),
			).toThrow();
			expect(executeCalls).toBe(0);

			const args = validateToolArguments(tool!, {
				type: "toolCall",
				id: "valid-runtime-echo",
				name: tool!.name,
				arguments: { message: "hello" },
			});
			const result = await tool!.execute("valid-runtime-echo", args);
			expect(result.content).toEqual([{ type: "text", text: "echo:hello" }]);
			expect(executeCalls).toBe(1);

			await session.dispose();
			disposed = true;
			expect(session.getToolByName("runtime_echo")).toBeUndefined();
			expect(sessionEvents).toContainEqual({ reason: "shutdown", previousSessionFile: undefined });
			expect(reportedErrors).toEqual([]);
		} finally {
			try {
				if (!disposed) await session?.dispose();
			} finally {
				authStorage?.close();
				ircBus.close();
				if (previousHome === undefined) delete process.env.HOME;
				else process.env.HOME = previousHome;
				if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
				else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		}
	});
});
