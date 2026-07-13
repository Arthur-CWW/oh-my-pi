import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager } from "../src/session/session-manager";
import {
	type AutomationEntry,
	type AutomationRunResult,
	appendAutomationLedger,
	decodeAutomationRegistry,
	getAutomationSessionFile,
	isAutomationDue,
	loadAutomationRegistry,
	parseAutomationSchedule,
	readAutomationLedger,
	runAutomationDaemon,
	runAutomationOnce,
} from "../src/task/automations";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-automations-"));
	tempDirs.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

const ENTRY: AutomationEntry = {
	name: "local-check",
	schedule: "30m",
	lane: "smol",
	prompt: "Reply with OK.",
	cwd: process.cwd(),
	enabled: true,
};

describe("automation schedules", () => {
	it("computes interval due times and resists backward clock skew", () => {
		expect(parseAutomationSchedule("30m")).toEqual({ kind: "interval", intervalMs: 1_800_000 });
		expect(parseAutomationSchedule("6h")).toEqual({ kind: "interval", intervalMs: 21_600_000 });
		expect(isAutomationDue("30m", 1_800_000)).toBe(true);
		expect(isAutomationDue("30m", 2_799_999, 1_000_000)).toBe(false);
		expect(isAutomationDue("30m", 2_800_000, 1_000_000)).toBe(true);
		expect(isAutomationDue("30m", 900_000, 1_000_000)).toBe(false);
	});

	it("fires daily once after the local wall-clock boundary", () => {
		const before = new Date(2026, 6, 13, 8, 59, 59).getTime();
		const boundary = new Date(2026, 6, 13, 9, 0, 0).getTime();
		const after = new Date(2026, 6, 13, 12, 0, 0).getTime();
		expect(isAutomationDue("daily@09:00", before)).toBe(false);
		expect(isAutomationDue("daily@09:00", boundary)).toBe(true);
		expect(isAutomationDue("daily@09:00", after, boundary)).toBe(false);
		expect(isAutomationDue("daily@09:00", after, boundary - 1)).toBe(true);
		expect(isAutomationDue("daily@09:00", before, after)).toBe(false);
	});
});

describe("automation registry", () => {
	it("strictly decodes YAML-shaped entries", () => {
		const [entry] = decodeAutomationRegistry({
			automations: [{ name: "triage", schedule: "6h", prompt: "Triage inbox", cwd: "." }],
		});
		expect(entry.name).toBe("triage");
		expect(entry.cwd).toBe(process.cwd());
	});

	it("rejects invalid schedules, duplicate names, prompt ambiguity, and excess fields", () => {
		expect(() => decodeAutomationRegistry([{ name: "bad", schedule: "* * * * *", prompt: "x", cwd: "." }])).toThrow(
			"Invalid automation schedule",
		);
		expect(() =>
			decodeAutomationRegistry([
				{ name: "same", schedule: "1h", prompt: "x", cwd: "." },
				{ name: "same", schedule: "1h", packet: "packet.txt", cwd: "." },
			]),
		).toThrow("Duplicate automation name");
		expect(() =>
			decodeAutomationRegistry([{ name: "both", schedule: "1h", prompt: "x", packet: "x.txt", cwd: "." }]),
		).toThrow("exactly one of prompt or packet");
		expect(() =>
			decodeAutomationRegistry([{ name: "extra", schedule: "1h", prompt: "x", cwd: ".", cron: "no" }]),
		).toThrow();
	});

	it("loads a registry from the profile agent directory", async () => {
		const agentDir = await makeTempDir();
		await Bun.write(
			path.join(agentDir, "automations.yml"),
			"automations:\n  - name: packet-job\n    schedule: daily@09:30\n    packet: packets/job.md\n    cwd: .\n    enabled: false\n",
		);
		const [entry] = await loadAutomationRegistry(agentDir);
		expect(entry).toMatchObject({ name: "packet-job", schedule: "daily@09:30", enabled: false });
	});
});

describe("automation ledger and daemon", () => {
	it("appends valid JSONL records without losing prior runs", async () => {
		const agentDir = await makeTempDir();
		await appendAutomationLedger(
			ENTRY,
			{ runAt: 100, durationMs: 25, status: "succeeded", sessionFile: "/tmp/session.jsonl", outputSummary: "ok" },
			agentDir,
		);
		await appendAutomationLedger(
			ENTRY,
			{ runAt: 200, durationMs: 10, status: "failed", sessionFile: "/tmp/session.jsonl", outputSummary: "no" },
			agentDir,
		);
		expect(await readAutomationLedger(ENTRY, agentDir)).toEqual([
			{ runAt: 100, durationMs: 25, status: "succeeded", sessionFile: "/tmp/session.jsonl", outputSummary: "ok" },
			{ runAt: 200, durationMs: 10, status: "failed", sessionFile: "/tmp/session.jsonl", outputSummary: "no" },
		]);
	});

	it("runs a due job once in a compressed scheduler cycle", async () => {
		const agentDir = await makeTempDir();
		await Bun.write(
			path.join(agentDir, "automations.yml"),
			"automations:\n  - name: local-check\n    schedule: 30m\n    prompt: Reply with OK.\n    cwd: .\n",
		);
		const fired: string[] = [];
		const run = async (entry: AutomationEntry): Promise<AutomationRunResult> => {
			fired.push(entry.name);
			return {
				name: entry.name,
				runAt: 1_000,
				durationMs: 1,
				status: "succeeded",
				sessionFile: "/tmp/session.jsonl",
				outputSummary: "OK",
			};
		};
		await runAutomationDaemon({
			agentDir,
			nowMs: () => 1_000,
			random: () => 0,
			maxCycles: 1,
			checkIntervalMs: 1,
			maxJitterMs: 0,
			run,
		});
		expect(fired).toEqual(["local-check"]);
	});

	it("runs a real headless local-provider prompt and resumes its stable journal", async () => {
		const root = await makeTempDir();
		let promptObserved = false;
		const server = Bun.serve({
			port: 0,
			fetch: async request => {
				const body: unknown = await request.json();
				promptObserved ||= JSON.stringify(body).includes("LOCAL_AUTOMATION_PROMPT");
				const chunks = [
					{
						id: "local-proof",
						object: "chat.completion.chunk",
						created: 1,
						model: "local-model",
						choices: [{ index: 0, delta: { role: "assistant", content: "AUTOMATION_OK" }, finish_reason: null }],
					},
					{
						id: "local-proof",
						object: "chat.completion.chunk",
						created: 1,
						model: "local-model",
						choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
					},
				];
				return new Response(
					`${chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
					{
						headers: { "content-type": "text/event-stream" },
					},
				);
			},
		});
		try {
			await Bun.write(
				path.join(root, "models.yml"),
				[
					"providers:",
					"  local-proof:",
					`    baseUrl: http://127.0.0.1:${server.port}/v1`,
					"    api: openai-completions",
					"    auth: none",
					"    models:",
					"      - id: local-model",
					"        name: Local proof model",
					"        contextWindow: 8192",
					"        maxTokens: 1024",
				].join("\n"),
			);
			const entry: AutomationEntry = {
				...ENTRY,
				name: "local-provider-proof",
				model: "local-proof/local-model",
				prompt: "LOCAL_AUTOMATION_PROMPT",
			};
			const sessionsDir = path.join(root, "sessions");
			const first = await runAutomationOnce(entry, { agentDir: root, sessionsDir });
			const second = await runAutomationOnce(entry, { agentDir: root, sessionsDir });
			expect(first.status).toBe("succeeded");
			expect(first.outputSummary).toBe("AUTOMATION_OK");
			expect(second.sessionFile).toBe(first.sessionFile);
			expect(promptObserved).toBe(true);
			const reopened = await SessionManager.open(first.sessionFile);
			expect(reopened.getEntries().filter(item => item.type === "message").length).toBe(4);
			expect(await readAutomationLedger(entry, root)).toHaveLength(2);
		} finally {
			server.stop(true);
		}
	});

	it("places stable journals where the root session scan can discover them", async () => {
		const sessionsDir = await makeTempDir();
		expect(getAutomationSessionFile(ENTRY, sessionsDir)).toBe(
			path.join(sessionsDir, "automation-local-check", "local-check.jsonl"),
		);
	});
});
