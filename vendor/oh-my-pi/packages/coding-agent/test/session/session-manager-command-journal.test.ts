import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	CURRENT_SESSION_VERSION,
	type PlanWorkflowModeSnapshot,
	type PlanWorkflowRestoreState,
	type SessionHeader,
} from "@oh-my-pi/pi-coding-agent/session/session-entries";
import {
	IndexedSessionStorage,
	type SessionStorageBackend,
	type SessionStorageIndexEntry,
} from "@oh-my-pi/pi-coding-agent/session/indexed-session-storage";
import {
	SessionCommandConflictError,
	SessionManager,
	SessionStateCommandInFlightError,
	SessionRevisionConflictError,
} from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

const modelCommand = (commandId: string, expectedSessionRevision: number, model = "openai/gpt-5") => ({
	schemaVersion: 1 as const,
	commandId,
	correlationId: `correlation-${commandId}`,
	expectedSessionRevision,
	kind: "setModel" as const,
	model,
	role: "default",
});

const workflowCommand = (
	commandId: string,
	expectedSessionRevision: number,
	transition:
		| { kind: "enter"; planFilePath: string; workflow: "parallel" | "iterative" }
		| { kind: "exit"; disposition: "paused" | "disabled" },
) => ({
	schemaVersion: 1 as const,
	commandId,
	correlationId: `correlation-${commandId}`,
	expectedSessionRevision,
	kind: "transitionPlanMode" as const,
	transition,
});

const restoreState: PlanWorkflowRestoreState = {
	mode: { kind: "none" },
	activeToolNames: ["read", "edit"],
	model: "openai/gpt-5",
	thinkingLevel: "high",
};

const activePlan: PlanWorkflowModeSnapshot = {
	kind: "plan",
	phase: "active",
	planFilePath: "local://journal-plan.md",
	workflow: "parallel",
	reentry: false,
};

class ControlledSessionBackend implements SessionStorageBackend {
	readonly files = new Map<string, { content: string; mtimeMs: number }>();
	appendStarted = false;
	failAppend = false;
	appendGate: Promise<void> = Promise.resolve();
	writeStarted = false;
	writeGate: Promise<void> = Promise.resolve();

	async init(): Promise<void> {}
	async loadIndex(): Promise<Iterable<SessionStorageIndexEntry>> {
		return [...this.files].map(([path, file]) => ({
			path,
			size: Buffer.byteLength(file.content),
			mtimeMs: file.mtimeMs,
		}));
	}
	async readFull(path: string): Promise<string | null> {
		return this.files.get(path)?.content ?? null;
	}
	async readSlices(path: string, prefixBytes: number, suffixBytes: number): Promise<[string, string]> {
		const content = this.files.get(path)?.content ?? "";
		return [content.slice(0, prefixBytes), content.slice(-suffixBytes)];
	}
	async writeFull(path: string, content: string, mtimeMs: number): Promise<void> {
		this.writeStarted = true;
		await this.writeGate;
		this.files.set(path, { content, mtimeMs });
	}
	async append(path: string, line: string, mtimeMs: number): Promise<void> {
		this.appendStarted = true;
		await this.appendGate;
		if (this.failAppend) throw new Error("controlled append failure");
		const current = this.files.get(path)?.content ?? "";
		this.files.set(path, { content: current + line, mtimeMs });
	}
	async truncate(path: string, mtimeMs: number): Promise<void> {
		this.files.set(path, { content: "", mtimeMs });
	}
	async remove(paths: string[]): Promise<void> {
		for (const path of paths) this.files.delete(path);
	}
	async move(src: string, dst: string, mtimeMs: number): Promise<void> {
		const current = this.files.get(src);
		if (!current) return;
		this.files.delete(src);
		this.files.set(dst, { content: current.content, mtimeMs });
	}
}

describe("SessionManager state command journal", () => {
	it("appends one entry, notifies after commit, and replays without appending", async () => {
		const manager = SessionManager.inMemory("/command-journal");
		const observedReceipts: string[] = [];
		manager.subscribeEntries(entry => {
			if (entry.type === "model_change") {
				const receipt = manager.getSessionCommandReceipt("model-1");
				if (receipt) observedReceipts.push(receipt.entry.id);
			}
		});

		const command = modelCommand("model-1", 0);
		const committed = await manager.commitStateCommand(command);
		expect(committed.replayed).toBe(false);
		expect(committed.sessionRevision).toBe(1);
		expect(manager.getEntries()).toHaveLength(1);
		expect(observedReceipts).toEqual([committed.entry.id]);

		const replayed = await manager.commitStateCommand(command);
		expect(replayed.replayed).toBe(true);
		expect(replayed.entry.id).toBe(committed.entry.id);
		expect(manager.getEntries()).toHaveLength(1);
	});

	it("acknowledges indexed commands only after the backend append succeeds", async () => {
		const backend = new ControlledSessionBackend();
		const storage = new IndexedSessionStorage(backend);
		await storage.initialize();
		const manager = SessionManager.create("/indexed-project", "/indexed-sessions", storage);
		await manager.ensureOnDisk();
		let releaseAppend: (() => void) | undefined;
		backend.appendGate = new Promise<void>(resolve => {
			releaseAppend = resolve;
		});
		let notifications = 0;
		manager.subscribeEntries(entry => {
			if (entry.type === "model_change") notifications++;
		});

		const pending = manager.commitStateCommand(modelCommand("delayed", 0));
		while (!backend.appendStarted) await Bun.sleep(0);
		expect(() => manager.appendServiceTierChange(null)).toThrow(SessionStateCommandInFlightError);
		expect(manager.getSessionRevision()).toBe(1);
		expect(manager.getEntries().map(entry => entry.type)).toEqual(["model_change"]);
		expect(manager.getSessionCommandReceipt("delayed")).toBeUndefined();
		expect(notifications).toBe(0);
		releaseAppend?.();
		const receipt = await pending;
		expect(receipt.sessionRevision).toBe(1);
		expect(manager.getSessionCommandReceipt("delayed")?.entry.id).toBe(receipt.entry.id);
		expect(notifications).toBe(1);
		manager.appendServiceTierChange(null);
		await manager.flush();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected indexed session file");
		const persistedTypes = (backend.files.get(sessionFile)?.content ?? "")
			.trim()
			.split("\n")
			.map(line => (JSON.parse(line) as { type: string }).type);
		expect(persistedTypes).toEqual(["session", "model_change", "service_tier_change"]);
		await manager.close();
	});


	it("reserves a cold command before a concurrent ordinary append", async () => {
		const backend = new ControlledSessionBackend();
		const storage = new IndexedSessionStorage(backend);
		await storage.initialize();
		const manager = SessionManager.create("/cold-indexed-project", "/cold-indexed-sessions", storage);
		let releaseWrite: (() => void) | undefined;
		backend.writeGate = new Promise<void>(resolve => {
			releaseWrite = resolve;
		});

		const pending = manager.commitStateCommand(modelCommand("cold", 0));
		while (!backend.writeStarted) await Bun.sleep(0);
		expect(() => manager.appendServiceTierChange(null)).toThrow(SessionStateCommandInFlightError);
		expect(manager.getEntries().map(entry => entry.type)).toEqual(["model_change"]);
		releaseWrite?.();
		const receipt = await pending;
		expect(receipt.sessionRevision).toBe(1);
		manager.appendServiceTierChange(null);
		await manager.flush();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected cold indexed session file");
		const persistedTypes = (backend.files.get(sessionFile)?.content ?? "")
			.trim()
			.split("\n")
			.map(line => (JSON.parse(line) as { type: string }).type);
		expect(persistedTypes).toEqual(["session", "model_change", "service_tier_change"]);
		await manager.close();
	});
	it("fences ordinary appends and rolls back a failed indexed command", async () => {
		const backend = new ControlledSessionBackend();
		const storage = new IndexedSessionStorage(backend);
		await storage.initialize();
		const manager = SessionManager.create("/indexed-project", "/indexed-sessions", storage);
		await manager.ensureOnDisk();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected failed indexed session file");
		let releaseAppend: (() => void) | undefined;
		backend.appendGate = new Promise<void>(resolve => {
			releaseAppend = resolve;
		});
		backend.failAppend = true;
		let notifications = 0;
		manager.subscribeEntries(() => {
			notifications++;
		});

		const pending = manager.commitStateCommand(modelCommand("failed", 0));
		while (!backend.appendStarted) await Bun.sleep(0);
		expect(() => manager.appendServiceTierChange(null)).toThrow(SessionStateCommandInFlightError);
		expect(manager.getSessionRevision()).toBe(1);
		releaseAppend?.();
		await expect(pending).rejects.toThrow("controlled append failure");
		expect(manager.getSessionRevision()).toBe(0);
		expect(manager.getEntries()).toEqual([]);
		expect(manager.getSessionCommandReceipt("failed")).toBeUndefined();
		expect(notifications).toBe(0);

		const reopenedStorage = new IndexedSessionStorage(backend);
		await reopenedStorage.initialize();
		const reopened = await SessionManager.open(sessionFile, "/indexed-sessions", reopenedStorage);
		expect(reopened.getSessionRevision()).toBe(0);
		expect(reopened.getEntries()).toEqual([]);
		expect(() => manager.appendServiceTierChange(null)).toThrow("controlled append failure");
		await reopened.close();
	});

	it("rejects changed command reuse and serializes concurrent CAS contenders", async () => {
		const manager = SessionManager.inMemory("/command-journal");
		await manager.commitStateCommand(modelCommand("original", 0));
		await expect(manager.commitStateCommand(modelCommand("original", 0, "anthropic/claude"))).rejects.toBeInstanceOf(
			SessionCommandConflictError,
		);

		const contenders = await Promise.allSettled([
			manager.commitStateCommand({
				schemaVersion: 1,
				commandId: "thinking-a",
				correlationId: "correlation-thinking-a",
				expectedSessionRevision: 1,
				kind: "setThinkingLevel",
				thinkingLevel: undefined as never,
			}),
			manager.commitStateCommand(modelCommand("model-b", 1)),
		]);
		expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const rejection = contenders.find(result => result.status === "rejected");
		expect(rejection?.status === "rejected" && rejection.reason).toBeInstanceOf(SessionRevisionConflictError);
		expect(manager.getSessionRevision()).toBe(2);
		const thinking = manager.getEntries().find(entry => entry.type === "thinking_level_change");
		if (thinking) expect(thinking.thinkingLevel).toBeNull();
	});

	it("persists one line and rebuilds receipts and CAS state on reopen", async () => {
		using tempDir = TempDir.createSync("@omp-session-command-");
		const sessionDir = path.join(tempDir.path(), "sessions");
		await fs.mkdir(sessionDir, { recursive: true });
		const manager = SessionManager.create(tempDir.path(), sessionDir);
		await manager.ensureOnDisk();
		const command = modelCommand("persisted", 0);
		await manager.commitStateCommand(command);
		await manager.flush();
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected session file");
		const lines = (await Bun.file(sessionFile).text()).trim().split("\n");
		expect(lines).toHaveLength(2);
		await manager.close();

		const reopened = await SessionManager.open(sessionFile, sessionDir);
		expect(reopened.getSessionRevision()).toBe(1);
		expect(reopened.getSessionCommandReceipt("persisted")?.entry.id).toBe(
			manager.getSessionCommandReceipt("persisted")?.entry.id,
		);
		expect((await reopened.commitStateCommand(command)).replayed).toBe(true);
		reopened.appendServiceTierChange(null);
		expect(reopened.getSessionRevision()).toBe(2);
		await expect(reopened.commitStateCommand(modelCommand("stale", 1))).rejects.toBeInstanceOf(
			SessionRevisionConflictError,
		);
		await reopened.commitStateCommand(modelCommand("next", 2));
		expect(reopened.getSessionRevision()).toBe(3);
		await reopened.close();
	});

	it("commits one workflow line and replays before CAS without recomputing restore state", async () => {
		const manager = SessionManager.inMemory("/workflow-command-journal");
		manager.appendModeChange("plan", { planFilePath: "local://legacy.md" });
		const command = workflowCommand("workflow-enter", 1, {
			kind: "enter",
			planFilePath: activePlan.kind === "plan" ? activePlan.planFilePath : "",
			workflow: "parallel",
		});
		const committed = await manager.commitWorkflowCommand(command, restoreState, activePlan);
		expect(committed.sessionRevision).toBe(2);
		expect(manager.getEntries().map(entry => entry.type)).toEqual(["mode_change", "workflow_change"]);
		expect(committed.entry).toMatchObject({
			type: "workflow_change",
			previous: restoreState,
			next: activePlan,
			command: {
				commandId: "workflow-enter",
				correlationId: "correlation-workflow-enter",
				expectedSessionRevision: 1,
				committedSessionRevision: 2,
				request: { kind: command.kind, transition: command.transition },
			},
		});
		expect(manager.buildSessionContext()).toMatchObject({
			mode: "plan",
			modeData: {
				planFilePath: "local://journal-plan.md",
				workflow: "parallel",
				reentry: false,
			},
			workflow: activePlan,
		});

		const replayed = await manager.commitWorkflowCommand(
			command,
			{ mode: activePlan, activeToolNames: ["different"] },
			{ kind: "none" },
		);
		expect(replayed.replayed).toBe(true);
		expect(replayed.entry.id).toBe(committed.entry.id);
		expect(manager.getSessionRevision()).toBe(2);
		await expect(
			manager.commitWorkflowCommand(
				workflowCommand("workflow-enter", 1, {
					kind: "enter",
					planFilePath: "local://other.md",
					workflow: "parallel",
				}),
				restoreState,
				activePlan,
			),
		).rejects.toBeInstanceOf(SessionCommandConflictError);
	});

	it("serializes concurrent workflow CAS contenders through the shared command fence", async () => {
		const manager = SessionManager.inMemory("/workflow-command-cas");
		const contenders = await Promise.allSettled([
			manager.commitWorkflowCommand(
				workflowCommand("workflow-a", 0, {
					kind: "enter",
					planFilePath: "local://a.md",
					workflow: "parallel",
				}),
				restoreState,
				{ ...activePlan, planFilePath: "local://a.md" },
			),
			manager.commitWorkflowCommand(
				workflowCommand("workflow-b", 0, {
					kind: "enter",
					planFilePath: "local://b.md",
					workflow: "iterative",
				}),
				restoreState,
				{ ...activePlan, planFilePath: "local://b.md", workflow: "iterative" },
			),
		]);
		expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1);
		const rejection = contenders.find(result => result.status === "rejected");
		expect(rejection?.status === "rejected" && rejection.reason).toBeInstanceOf(SessionRevisionConflictError);
		expect(manager.getSessionRevision()).toBe(1);
		expect(manager.getEntries()).toHaveLength(1);
		expect(manager.getEntries()[0]?.type).toBe("workflow_change");
	});

	it("reopens workflow receipts and typed mode projection with legacy mode parity", async () => {
		using tempDir = TempDir.createSync("@omp-session-workflow-command-");
		const sessionDir = path.join(tempDir.path(), "sessions");
		await fs.mkdir(sessionDir, { recursive: true });
		const manager = SessionManager.create(tempDir.path(), sessionDir);
		await manager.ensureOnDisk();
		const command = workflowCommand("workflow-pause", 0, {
			kind: "exit",
			disposition: "paused",
		});
		const pausedPlan: PlanWorkflowModeSnapshot = {
			...activePlan,
			phase: "paused",
			reentry: true,
		};
		await manager.commitWorkflowCommand(command, { ...restoreState, mode: activePlan }, pausedPlan);
		const sessionFile = manager.getSessionFile();
		if (!sessionFile) throw new Error("expected workflow session file");
		const lines = (await Bun.file(sessionFile).text()).trim().split("\n");
		expect(lines).toHaveLength(2);
		expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({ type: "workflow_change" });
		await manager.close();

		const reopened = await SessionManager.open(sessionFile, sessionDir);
		expect(reopened.getSessionCommandReceipt("workflow-pause")?.entry.type).toBe("workflow_change");
		expect(reopened.buildSessionContext()).toMatchObject({
			mode: "plan_paused",
			workflow: pausedPlan,
		});
		expect((await reopened.commitWorkflowCommand(command, restoreState, { kind: "none" })).replayed).toBe(true);
		await reopened.close();

		const legacy = SessionManager.inMemory("/legacy-workflow-context");
		legacy.appendModeChange("plan", { planFilePath: "local://legacy.md" });
		expect(legacy.buildSessionContext()).toMatchObject({
			mode: "plan",
			modeData: { planFilePath: "local://legacy.md" },
			workflow: {
				kind: "plan",
				phase: "active",
				planFilePath: "local://legacy.md",
				workflow: "parallel",
				reentry: false,
			},
		});
	});

	it("keeps legacy model and thinking entries readable without receipts", async () => {
		using tempDir = TempDir.createSync("@omp-session-command-legacy-");
		const sessionFile = path.join(tempDir.path(), "legacy.jsonl");
		const timestamp = new Date().toISOString();
		const header: SessionHeader = {
			type: "session",
			version: CURRENT_SESSION_VERSION,
			id: "legacy-session",
			timestamp,
			cwd: tempDir.path(),
		};
		const entries = [
			{ type: "model_change", id: "legacy-model", parentId: null, timestamp, model: "openai/legacy" },
			{
				type: "thinking_level_change",
				id: "legacy-thinking",
				parentId: "legacy-model",
				timestamp,
				thinkingLevel: "high",
			},
		];
		await Bun.write(sessionFile, `${[header, ...entries].map(entry => JSON.stringify(entry)).join("\n")}\n`);

		const manager = await SessionManager.open(sessionFile, tempDir.path());
		expect(manager.getSessionRevision()).toBe(2);
		expect(manager.getSessionCommandReceipt("legacy-model")).toBeUndefined();
		expect(manager.getEntries().map(entry => entry.type)).toEqual(["model_change", "thinking_level_change"]);
		await manager.close();
	});
});
