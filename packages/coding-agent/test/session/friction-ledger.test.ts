import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type SettingPath, Settings } from "../../src/config/settings";
import {
	appendFriction,
	createReportFrictionTool,
	decodeFrictionRow,
	readFrictions,
	type FrictionRow,
} from "../../src/session/friction-ledger";
import { createTools, type ToolSession } from "../../src/tools";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function row(overrides: Partial<FrictionRow> = {}): FrictionRow {
	return {
		ts: "2026-01-01T00:00:00.000Z",
		sessionId: "session-a",
		agentId: "agent-a",
		model: "model-a",
		class: "tool-defect",
		note: "tool failed",
		binaryVersion: "1.2.3",
		binaryDigest: "digest-a",
		...overrides,
	};
}

async function tempLedger(): Promise<{ readonly root: string; readonly dbPath: string }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-friction-"));
	roots.push(root);
	return { root, dbPath: path.join(root, "agent", "friction.jsonl") };
}

function textContent(result: { readonly content: readonly { readonly type: string; readonly text?: string }[] }): string {
	const content = result.content[0];
	if (!content || content.type !== "text" || content.text === undefined) throw new Error("Expected text tool output");
	return content.text;
}

function createSession(overrides: Partial<ToolSession> = {}): ToolSession {
	const settings = Settings.isolated({ "lsp.formatOnWrite": true } as Partial<Record<SettingPath, unknown>>);
	return {
		cwd: "/tmp/omp-friction-test",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings,
		...overrides,
	};
}

describe("friction ledger", () => {
	it("round-trips rows and filters by class, model, and since", async () => {
		const { dbPath } = await tempLedger();
		const first = row();
		const second = row({
			ts: "2026-01-02T00:00:00.000Z",
			model: "model-b",
			class: "capability-gap",
			note: "capability missing",
		});
		await appendFriction(first, dbPath);
		await appendFriction(second, dbPath);

		expect(await readFrictions(undefined, dbPath)).toEqual([first, second]);
		expect(await readFrictions({ class: "capability-gap" }, dbPath)).toEqual([second]);
		expect(await readFrictions({ model: "model-b" }, dbPath)).toEqual([second]);
		expect(await readFrictions({ since: "2026-01-02T00:00:00.000Z" }, dbPath)).toEqual([second]);
	});

	it("tolerates an incomplete trailing line", async () => {
		const { dbPath } = await tempLedger();
		const saved = row();
		await appendFriction(saved, dbPath);
		await fs.appendFile(dbPath, '{"ts":"2026-01-03T00:00:00.000Z"');

		expect(await readFrictions(undefined, dbPath)).toEqual([saved]);
	});

	it("rejects rows with a class outside the closed enum", () => {
		expect(() => decodeFrictionRow(row({ class: "not-a-class" as FrictionRow["class"] }))).toThrow();
	});
});

describe("report_friction tool", () => {
	it("is registered and reports a stamped row", async () => {
		const { dbPath } = await tempLedger();
		const session = createSession({
			getSessionId: () => "session-stamped",
			getAgentId: () => "agent-stamped",
			getActiveModelString: () => "model-stamped",
			buildVersion: "version-stamped",
			buildDigest: "digest-stamped",
		});
		const tool = createReportFrictionTool(session, dbPath);
		const result = await tool.execute("call-1", { class: "tool-defect", note: "tool X failed" });

		expect(textContent(result)).toBe("Friction noted.");
		const rows = await readFrictions(undefined, dbPath);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			sessionId: "session-stamped",
			agentId: "agent-stamped",
			model: "model-stamped",
			class: "tool-defect",
			note: "tool X failed",
			binaryVersion: "version-stamped",
			binaryDigest: "digest-stamped",
		});
		expect(rows[0]?.ts).toMatch(/^202\d-/);

		const surfaced = await createTools(createSession(), ["read"]);
		expect(surfaced.map(entry => entry.name)).toContain("report_friction");
	});

	it("rejects invalid classes and notes over 500 characters clearly", async () => {
		const { dbPath } = await tempLedger();
		const tool = createReportFrictionTool(createSession(), dbPath);

		const invalidClass = await tool.execute("call-invalid-class", {
			class: "invalid" as never,
			note: "symptom",
		});
		expect(textContent(invalidClass)).toContain("class must be one of");
		expect(invalidClass.isError).toBe(true);

		const oversized = await tool.execute("call-oversized", { class: "environment", note: "x".repeat(501) });
		expect(textContent(oversized)).toContain("500 characters");
		expect(oversized.isError).toBe(true);
		expect(await readFrictions(undefined, dbPath)).toEqual([]);
	});
});
