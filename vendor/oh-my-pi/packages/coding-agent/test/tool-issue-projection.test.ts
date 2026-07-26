import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import { TempDir } from "@oh-my-pi/pi-utils";
import {
	appendToolIssueDisposition,
	collectToolIssueProjection,
	projectToolIssues,
	readToolIssueDispositions,
	type ToolIssueOccurrence,
} from "../src/cli/tool-issue-projection";
import { appendFriction } from "../src/session/friction-ledger";

const NOW = Date.parse("2026-07-26T12:00:00.000Z");

function createAutoQaFixture(dbPath: string): void {
	const db = new Database(dbPath);
	try {
		db.run(`
			CREATE TABLE grievances (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				model TEXT NOT NULL,
				version TEXT NOT NULL,
				tool TEXT NOT NULL,
				report TEXT NOT NULL,
				pushed INTEGER NOT NULL DEFAULT 0,
				created_at TEXT,
				session_id TEXT,
				agent_id TEXT,
				tool_call_id TEXT,
				build_digest TEXT,
				platform TEXT,
				architecture TEXT
			)
		`);
		const insert = db.prepare(
			`INSERT INTO grievances (
				model, version, tool, report, created_at, session_id, agent_id,
				tool_call_id, build_digest, platform, architecture
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		for (const callId of ["call-1", "call-2"]) {
			insert.run(
				"openai/test-model",
				"16.0.1",
				"tool-defect",
				"Job failed token=local-secret 42 for https://example.test/run?auth=private",
				new Date(NOW).toISOString(),
				"session-a",
				"Main",
				callId,
				"digest-a",
				"darwin",
				"arm64",
			);
		}
	} finally {
		db.close();
	}
}

function errorEntry(id: string, timestamp: number, digest: string): string {
	return JSON.stringify({
		type: "custom",
		id,
		parentId: null,
		timestamp: new Date(timestamp).toISOString(),
		customType: "ui_error",
		data: {
			version: 2,
			id,
			firstTimestamp: timestamp,
			lastTimestamp: timestamp,
			message: "Job failed token=other-secret 42 for https://example.test/run?auth=different",
			cause: "tool-defect",
			tool: "tool-defect",
			count: id === "error-a" ? 3 : 1,
			unread: true,
			resolved: false,
			buildVersion: "16.0.1",
			buildDigest: digest,
		},
	});
}

async function createJournal(journalPath: string): Promise<void> {
	const header = JSON.stringify({
		type: "session",
		version: 4,
		id: "session-a",
		timestamp: new Date(NOW).toISOString(),
		cwd: "/fixture",
		workstream: { kind: "workstream", id: "harness" },
	});
	await fs.mkdir(journalPath.slice(0, journalPath.lastIndexOf("/")), { recursive: true });
	await fs.writeFile(journalPath, `${header}\n${errorEntry("error-a", NOW, "digest-a")}\n`, "utf8");
}

describe("tool issue closure projection", () => {
	it("idempotently folds AutoQA, friction, and ErrorInbox evidence with redacted provenance", async () => {
		using tempDir = TempDir.createSync("@omp-tool-issues-");
		const root = tempDir.path();
		const autoQaDbPath = `${root}/autoqa.db`;
		const frictionLedgerPath = `${root}/friction.jsonl`;
		const dispositionLedgerPath = `${root}/dispositions.jsonl`;
		const sessionsRoot = `${root}/sessions`;
		const journalPath = `${sessionsRoot}/session-a/session.jsonl`;
		createAutoQaFixture(autoQaDbPath);
		await appendFriction(
			{
				ts: new Date(NOW).toISOString(),
				sessionId: "session-a",
				agentId: "Main",
				model: "openai/test-model",
				class: "tool-defect",
				note: "Job failed token=friction-secret 42 for https://example.test/run?auth=friction",
				binaryVersion: "16.0.1",
				binaryDigest: "digest-a",
			},
			frictionLedgerPath,
		);
		await createJournal(journalPath);

		const options = {
			autoQaDbPath,
			frictionLedgerPath,
			dispositionLedgerPath,
			sessionsRoot,
			controlDbPath: `${root}/control.sqlite`,
			nowMs: NOW,
		};
		const first = await collectToolIssueProjection(options);
		const second = await collectToolIssueProjection(options);
		expect(second).toEqual(first);
		expect(first.total).toBe(1);
		const issue = first.issues[0];
		expect(issue?.count).toBe(6);
		expect(issue?.builds).toHaveLength(1);
		expect(issue?.sources).toEqual(["autoqa", "error-inbox", "friction"]);
		expect(issue?.provenance.map((item) => item.ref).sort()).toEqual([
			"autoqa:1",
			"autoqa:2",
			"error-inbox:session-a:error-a",
			"friction:1",
		]);
		const serialized = JSON.stringify(first);
		expect(serialized).not.toContain("local-secret");
		expect(serialized).not.toContain("other-secret");
		expect(serialized).not.toContain("friction-secret");
		expect(issue?.signature).toContain("token=[REDACTED]");
		expect(issue?.signature).toContain("?[REDACTED]");
	});

	it("preserves append-only dispositions and identifies a fixed issue recurring on a later build", async () => {
		using tempDir = TempDir.createSync("@omp-tool-issue-status-");
		const root = tempDir.path();
		const autoQaDbPath = `${root}/autoqa.db`;
		const frictionLedgerPath = `${root}/friction.jsonl`;
		const dispositionLedgerPath = `${root}/dispositions.jsonl`;
		const sessionsRoot = `${root}/sessions`;
		const journalPath = `${sessionsRoot}/session-a/session.jsonl`;
		createAutoQaFixture(autoQaDbPath);
		await fs.writeFile(frictionLedgerPath, "", "utf8");
		await createJournal(journalPath);
		const options = {
			autoQaDbPath,
			frictionLedgerPath,
			dispositionLedgerPath,
			sessionsRoot,
			controlDbPath: `${root}/control.sqlite`,
			nowMs: NOW + 5_000,
		};
		const issueKey = (await collectToolIssueProjection(options)).issues[0]?.issueKey;
		expect(issueKey).toBeDefined();
		if (!issueKey) throw new Error("fixture issue missing");
		const sourceBefore = await Promise.all([
			Bun.file(autoQaDbPath).bytes(),
			Bun.file(journalPath).bytes(),
		]);
		await appendToolIssueDisposition(
			{
				issueKey,
				disposition: "in-flight",
				owner: "HarnessOwner",
				change: "change-nzvvwyxw",
				ts: new Date(NOW + 500).toISOString(),
			},
			dispositionLedgerPath,
		);
		await appendToolIssueDisposition(
			{
				issueKey,
				disposition: "fixed",
				change: "change-nzvvwyxw",
				proof: "artifact://tool-issue-proof",
				build: "16.0.1@digest-a",
				ts: new Date(NOW + 1_000).toISOString(),
			},
			dispositionLedgerPath,
		);
		const fixed = (await collectToolIssueProjection(options)).issues[0];
		expect(fixed?.disposition).toBe("fixed");
		expect(fixed?.owner).toBe("HarnessOwner");
		expect(fixed?.proof).toBe("artifact://tool-issue-proof");
		expect(fixed?.recurrenceAfterDisposition).toBe(false);
		const sourceAfter = await Promise.all([
			Bun.file(autoQaDbPath).bytes(),
			Bun.file(journalPath).bytes(),
		]);
		expect(sourceAfter).toEqual(sourceBefore);
		expect(await readToolIssueDispositions(dispositionLedgerPath)).toHaveLength(2);

		await fs.appendFile(journalPath, `${errorEntry("error-b", NOW + 2_000, "digest-b")}\n`, "utf8");
		const recurring = (await collectToolIssueProjection(options)).issues[0];
		expect(recurring?.disposition).toBe("fixed");
		expect(recurring?.recurrenceAcrossBuilds).toBe(true);
		expect(recurring?.recurrenceAfterDisposition).toBe(true);
		expect(recurring?.builds.map((build) => build.build).sort()).toEqual([
			"16.0.1@digest-a",
			"16.0.1@digest-b",
		]);
	});

	it("folds repeated source refs and keeps the Top-10 recurrence ordering deterministic", () => {
		const expected = [
			"provider refusal",
			"oauth invalidated",
			"ownership lost",
			"disk enospc",
			"task capability",
			"history selector",
			"job list image",
			"browser stale tab",
			"remote trust",
			"hud overflow",
		];
		const occurrences: ToolIssueOccurrence[] = expected.flatMap((signature, index) => {
			const occurrence: ToolIssueOccurrence = {
				source: index % 2 === 0 ? "autoqa" : "error-inbox",
				sourceRef: `fixture:${index}`,
				timestamp: NOW - index,
				signature,
				tool: `tool-${index}`,
				buildVersion: "16.0.1",
				buildDigest: "fixture-build",
				count: expected.length - index,
			};
			return index === 0 ? [occurrence, occurrence] : [occurrence];
		});
		const projected = projectToolIssues(occurrences);
		expect(projected.slice(0, 10).map((issue) => issue.signature)).toEqual(expected);
		expect(projected[0]?.count).toBe(10);
	});
});
