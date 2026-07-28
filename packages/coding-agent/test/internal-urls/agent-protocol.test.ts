import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { InternalUrlRouter } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { CURRENT_SESSION_VERSION } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { CHILD_LIFECYCLE_CUSTOM_TYPE } from "@oh-my-pi/pi-coding-agent/task/child-lifecycle";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-protocol-"));
	try {
		return await fn(dir);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

function fakeLiveSession(artifactsDir: string, messages: AgentSession["messages"]): AgentSession {
	const session: Pick<AgentSession, "messages" | "sessionManager"> = {
		messages,
		sessionManager: { getArtifactsDir: () => artifactsDir } as AgentSession["sessionManager"],
	};
	return session as AgentSession;
}

function sessionFixtureJsonl(): string {
	const timestamp = new Date().toISOString();
	const header = {
		type: "session",
		version: CURRENT_SESSION_VERSION,
		id: "fixture-session",
		timestamp,
		cwd: "/tmp",
	};
	const userEntry = {
		type: "message",
		id: "m1",
		parentId: null,
		timestamp,
		message: { role: "user", content: "archived transcript remains readable", timestamp: 1 },
	};
	const assistantEntry = {
		type: "message",
		id: "m2",
		parentId: "m1",
		timestamp,
		message: {
			role: "assistant",
			content: [{ type: "text", text: "archived child reply" }],
			api: "anthropic-messages",
			provider: "anthropic",
			model: "test-model",
			usage: {},
			stopReason: "stop",
			timestamp: 2,
		},
	};
	return `${JSON.stringify(header)}\n${JSON.stringify(userEntry)}\n${JSON.stringify(assistantEntry)}\n`;
}

async function rejectionOf<T>(promise: Promise<T>): Promise<Error | null> {
	return promise.then(
		() => null,
		err => err as Error,
	);
}

describe("agent:// protocol diagnostics", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		InternalUrlRouter.resetForTests();
	});

	afterEach(() => {
		InternalUrlRouter.resetForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("explains that a registered running agent has not finalized its output while preserving live history", async () => {
		await withTempDir(async artifactsDir => {
			AgentRegistry.global().register({
				id: "Runner",
				displayName: "task",
				kind: "sub",
				session: fakeLiveSession(artifactsDir, [
					{ role: "user", content: "running transcript remains readable", timestamp: 1 },
				]),
				status: "running",
			});

			const error = await rejectionOf(InternalUrlRouter.instance().resolve("agent://Runner"));

			expect(error).toBeInstanceOf(Error);
			const diagnostic = error?.message.toLowerCase() ?? "";
			expect(error?.message).toContain("Runner");
			expect(diagnostic).toMatch(/status[^\r\n]*running/);
			expect(diagnostic).toContain("not finalized");
			expect(error?.message).toContain("history://Runner");

			const history = await InternalUrlRouter.instance().resolve("history://Runner");
			expect(history.content).toContain("# Runner (running)");
			expect(history.content).toContain("running transcript remains readable");
			expect(history.notes).toContain("Source: live session");
		});
	});

	it("explains that an archived terminal child has no final output while preserving its journal history", async () => {
		await withTempDir(async dir => {
			const parentFile = path.join(dir, "parent.jsonl");
			const artifactsDir = parentFile.slice(0, -".jsonl".length);
			await fs.mkdir(artifactsDir);
			await Bun.write(parentFile, sessionFixtureJsonl());
			const childFile = path.join(artifactsDir, "ArchivedChild.jsonl");
			const timestamp = new Date().toISOString();
			const lifecycle = {
				type: "custom",
				id: "lifecycle",
				parentId: null,
				timestamp,
				customType: CHILD_LIFECYCLE_CUSTOM_TYPE,
				data: {
					version: 1,
					agentId: "ArchivedChild",
					childSessionFile: childFile,
					parentSessionFile: parentFile,
					state: "completed",
					updatedAt: timestamp,
				},
			};
			await Bun.write(childFile, `${sessionFixtureJsonl()}${JSON.stringify(lifecycle)}\n`);
			AgentRegistry.global().register({
				id: "Main",
				displayName: "main",
				kind: "main",
				session: null,
				sessionFile: parentFile,
				status: "parked",
			});

			const error = await rejectionOf(InternalUrlRouter.instance().resolve("agent://ArchivedChild"));

			expect(error).toBeInstanceOf(Error);
			const diagnostic = error?.message.toLowerCase() ?? "";
			expect(error?.message).toContain("ArchivedChild");
			expect(diagnostic).toContain("archived");
			expect(diagnostic).toMatch(/no final output|final output[^\r\n]*(?:not|unavailable|missing)/);
			expect(error?.message).toContain("history://ArchivedChild");

			const history = await InternalUrlRouter.instance().resolve("history://ArchivedChild");
			expect(history.content).toContain("# ArchivedChild (archived)");
			expect(history.content).toContain("archived transcript remains readable");
			expect(history.content).toContain("archived child reply");
			expect(history.sourcePath).toBe(childFile);
		});
	});

	it("lists finalized outputs and known agents for an unknown id", async () => {
		await withTempDir(async artifactsDir => {
			await Bun.write(path.join(artifactsDir, "Finished.md"), "done");
			AgentRegistry.global().register({
				id: "KnownWorker",
				displayName: "task",
				kind: "sub",
				session: fakeLiveSession(artifactsDir, []),
				status: "idle",
			});

			const error = await rejectionOf(InternalUrlRouter.instance().resolve("agent://MissingWorker"));

			expect(error?.message).toContain("Available finalized outputs: Finished");
			expect(error?.message).toContain("Known agents: KnownWorker");
		});
	});

	it("keeps the exact plural agents:// typo unknown and suggests agent://", async () => {
		const error = await rejectionOf(InternalUrlRouter.instance().resolve("agents://Runner"));

		expect(error).toBeInstanceOf(Error);
		expect(error?.message).toContain("Unknown protocol: agents://");
		expect(error?.message).toContain("Did you mean agent://?");

		const otherError = await rejectionOf(InternalUrlRouter.instance().resolve("agentz://Runner"));
		expect(otherError?.message).not.toContain("Did you mean agent://?");
	});
});
