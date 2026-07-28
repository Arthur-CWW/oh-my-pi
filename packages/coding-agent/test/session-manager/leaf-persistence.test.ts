import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { loadSessionMessagesReadOnly } from "@oh-my-pi/pi-coding-agent/session/session-loader";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getConfigRootDir, setAgentDir } from "@oh-my-pi/pi-utils";
import { assistantMsg, userMsg } from "../utilities";

describe("SessionManager leaf_change persistence", () => {
	let testAgentDir: string;
	let cwd: string;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

	beforeEach(() => {
		testAgentDir = path.join(import.meta.dir, `.tmp-leaf-${Date.now()}-${Math.random().toString(16).slice(2)}`);
		setAgentDir(testAgentDir);
		cwd = path.join(testAgentDir, "project");
		fs.mkdirSync(cwd, { recursive: true });
	});

	afterEach(async () => {
		if (originalAgentDir) {
			setAgentDir(originalAgentDir);
		} else {
			setAgentDir(fallbackAgentDir);
			delete process.env.PI_CODING_AGENT_DIR;
		}
		if (testAgentDir) await fsp.rm(testAgentDir, { recursive: true, force: true });
	});

	async function createBranchedFile(): Promise<{ file: string; mainLeaf: string; branchLeaf: string; rootId: string }> {
		const session = SessionManager.create(cwd);
		const rootId = session.appendMessage(userMsg("root"));
		const mainLeaf = session.appendMessage(assistantMsg("main"));
		session.branch(rootId);
		const branchLeaf = session.appendMessage(assistantMsg("branch"));
		await session.flush();
		const file = session.getSessionFile();
		if (!file) throw new Error("Expected persisted session file");
		await session.close();
		return { file, mainLeaf, branchLeaf, rootId };
	}

	it("reopens at a navigated older branch and excludes leaf_change from getBranch", async () => {
		const { file, mainLeaf } = await createBranchedFile();
		const session = await SessionManager.open(file);
		session.branch(mainLeaf);
		await session.flush();
		await session.close();

		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getLeafId()).toBe(mainLeaf);
			const branch = reopened.getBranch();
			expect(branch.map(entry => entry.id)).toContain(mainLeaf);
			expect(branch.some(entry => entry.type === "leaf_change")).toBe(false);
		} finally {
			await reopened.close();
		}
	});

	it("old-format file without leaf_change loads with last-entry leaf", async () => {
		const session = SessionManager.create(cwd);
		session.appendMessage(userMsg("old root"));
		const lastEntryId = session.appendMessage(assistantMsg("old leaf"));
		await session.flush();
		const file = session.getSessionFile();
		if (!file) throw new Error("Expected persisted session file");
		await session.close();

		const before = fs.readFileSync(file, "utf8");

		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getEntries().some(entry => entry.type === "leaf_change")).toBe(false);
			expect(reopened.getLeafId()).toBe(lastEntryId);
			expect(reopened.getBranch().at(-1)?.id).toBe(lastEntryId);
		} finally {
			await reopened.close();
		}

		const after = fs.readFileSync(file, "utf8");
		expect(after).toBe(before);
	});

	it("ignores a dangling leaf_change target and keeps last-entry fallback", async () => {
		const { file, branchLeaf } = await createBranchedFile();
		fs.appendFileSync(
			file,
			`${JSON.stringify({ type: "leaf_change", id: "dangling", parentId: branchLeaf, timestamp: new Date().toISOString(), target: "missing" })}\n`,
		);

		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getLeafId()).toBe(branchLeaf);
			expect(reopened.getBranch().some(entry => entry.id === "dangling")).toBe(false);
		} finally {
			await reopened.close();
		}
	});

	it("persists root navigation with null target", async () => {
		const { file } = await createBranchedFile();
		const session = await SessionManager.open(file);
		session.resetLeaf();
		await session.flush();
		await session.close();

		const reopened = await SessionManager.open(file);
		try {
			expect(reopened.getLeafId()).toBeNull();
			expect(reopened.getBranch()).toEqual([]);
		} finally {
			await reopened.close();
		}
	});

	it("read-only history load replays leaf_change to an older branch", async () => {
		const { file, mainLeaf } = await createBranchedFile();
		const session = await SessionManager.open(file);
		session.branch(mainLeaf);
		await session.flush();
		await session.close();

		const messages = await loadSessionMessagesReadOnly(file);
		expect(messages.map(message => message.role)).toEqual(["user", "assistant"]);
		const rendered = JSON.stringify(messages);
		expect(rendered).toContain("main");
		expect(rendered).not.toContain("branch");
	});

	it("read-only history load replays null leaf_change as root", async () => {
		const { file } = await createBranchedFile();
		const session = await SessionManager.open(file);
		session.resetLeaf();
		await session.flush();
		await session.close();

		expect(await loadSessionMessagesReadOnly(file)).toEqual([]);
	});

	it("dedupes consecutive leaf_change entries to the same target", async () => {
		const { file, mainLeaf } = await createBranchedFile();
		const session = await SessionManager.open(file);
		session.branch(mainLeaf);
		session.branch(mainLeaf);
		await session.flush();
		await session.close();

		const lines = fs.readFileSync(file, "utf8").trim().split("\n");
		const leafChanges = lines.map(line => JSON.parse(line) as { type?: string; target?: string }).filter(entry => entry.type === "leaf_change");
		expect(leafChanges.filter(entry => entry.target === mainLeaf)).toHaveLength(1);
	});
});
