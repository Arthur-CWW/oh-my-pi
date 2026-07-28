import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager } from "../src/session/session-manager";
import { createAgentSession, discoverAuthStorage } from "../src/sdk";
import {
	AUTOMATION_COMMAND_OUTPUT_MAX_BYTES,
	AutomationRunError,
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

async function writeLocalModelFixture(root: string, port: number): Promise<void> {
	await Bun.write(
		path.join(root, "models.yml"),
		[
			"providers:",
			"  local-proof:",
			`    baseUrl: http://127.0.0.1:${port}/v1`,
			"    api: openai-completions",
			"    auth: none",
			"    models:",
			"      - id: local-model",
			"        name: Local proof model",
			"        contextWindow: 8192",
			"        maxTokens: 1024",
		].join("\n"),
	);
	await Bun.write(path.join(root, "settings.json"), JSON.stringify({ modelRoles: { smol: "local-proof/local-model" } }));
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

function commandEntry(name: string, command: readonly string[], cwd: string): AutomationEntry {
	return { name, schedule: "1h", cwd, enabled: true, command };
}

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

	it("decodes command argv literally and enforces command exclusivity", () => {
		const command = [process.execPath, "-e", "process.stdout.write('ok')", "argument with spaces"];
		const [entry] = decodeAutomationRegistry([{ name: "argv", schedule: "1h", command, cwd: "." }]);
		expect(entry).toEqual({ name: "argv", schedule: "1h", cwd: process.cwd(), enabled: true, command });
		expect(() => decodeAutomationRegistry([{ name: "empty", schedule: "1h", command: [], cwd: "." }])).toThrow(
			"command must not be empty",
		);
		expect(() =>
			decodeAutomationRegistry([{ name: "blank", schedule: "1h", command: ["echo", "  "], cwd: "." }]),
		).toThrow("command[1] must not be empty");
		expect(() =>
			decodeAutomationRegistry([{ name: "prompt", schedule: "1h", command, prompt: "also run", cwd: "." }]),
		).toThrow("exactly one of prompt or packet or command");
		expect(() =>
			decodeAutomationRegistry([{ name: "packet", schedule: "1h", command, packet: "job.md", cwd: "." }]),
		).toThrow("exactly one of prompt or packet or command");
		expect(() =>
			decodeAutomationRegistry([{ name: "lane", schedule: "1h", command, lane: "smol", cwd: "." }]),
		).toThrow("lane and model are only valid for prompt or packet automations");
		expect(() =>
			decodeAutomationRegistry([{ name: "model", schedule: "1h", command, model: "local/model", cwd: "." }]),
		).toThrow("lane and model are only valid for prompt or packet automations");
		expect(() =>
			decodeAutomationRegistry([{ name: "string", schedule: "1h", command: "echo hi", cwd: "." }]),
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

	it("runs a real command without model setup and records exit 0 success", async () => {
		const root = await makeTempDir();
		const sessionsDir = path.join(root, "sessions");
		const entry = commandEntry("command-success", [process.execPath, "-e", "process.stdout.write('COMMAND_OK')"], root);
		const result = await runAutomationOnce(entry, {
			agentDir: root,
			sessionsDir,
			nowMs: () => 1_000,
			discoverAuth: async () => {
				throw new Error("command automation must not discover auth");
			},
			createSession: async () => {
				throw new Error("command automation must not create an agent session");
			},
		});
		expect(result).toMatchObject({
			name: entry.name,
			status: "succeeded",
			command: entry.command,
			exitCode: 0,
			stdout: "COMMAND_OK",
			stderr: "",
			stdoutTruncated: false,
			stderrTruncated: false,
		});
		expect(await readAutomationLedger(entry, root)).toEqual([expect.objectContaining({ status: "succeeded", exitCode: 0 })]);
	});

	it("reports nonzero command exits as typed failures with the CLI status code", async () => {
		const root = await makeTempDir();
		const entry = commandEntry(
			"command-failure",
			[process.execPath, "-e", "process.stdout.write('OUT');process.stderr.write('ERR');process.exit(7)"],
			root,
		);
		let thrown: unknown;
		try {
			await runAutomationOnce(entry, { agentDir: root, sessionsDir: path.join(root, "sessions"), nowMs: () => 1_000 });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(AutomationRunError);
		if (!(thrown instanceof AutomationRunError)) throw new Error("expected AutomationRunError");
		expect(thrown.result).toMatchObject({
			name: entry.name,
			status: "failed",
			command: entry.command,
			exitCode: 7,
			stdout: "OUT",
			stderr: "ERR",
			stdoutTruncated: false,
			stderrTruncated: false,
		});
		expect(thrown.message).toContain("exit code 7");
		expect(await readAutomationLedger(entry, root)).toEqual([expect.objectContaining({ status: "failed", exitCode: 7 })]);
	});

	it("bounds both command output streams and marks truncation", async () => {
		const root = await makeTempDir();
		const entry = commandEntry(
			"command-output-cap",
			[
				process.execPath,
				"-e",
				"const output='x'.repeat(60000);process.stdout.write(output);process.stderr.write(output)",
			],
			root,
		);
		const result = await runAutomationOnce(entry, { agentDir: root, sessionsDir: path.join(root, "sessions"), nowMs: () => 1_000 });
		expect(result.status).toBe("succeeded");
		if (result.command === undefined) throw new Error("Expected command automation result");
		expect(Buffer.byteLength(result.stdout, "utf8")).toBeLessThanOrEqual(AUTOMATION_COMMAND_OUTPUT_MAX_BYTES);
		expect(Buffer.byteLength(result.stderr, "utf8")).toBeLessThanOrEqual(AUTOMATION_COMMAND_OUTPUT_MAX_BYTES);
		expect(result.stdoutTruncated).toBe(true);
		expect(result.stderrTruncated).toBe(true);
	});

	it("continues supervising a healthy command after a failed command", async () => {
		const root = await makeTempDir();
		const bad = commandEntry("command-bad", [process.execPath, "-e", "process.exit(9)"], root);
		const healthy = commandEntry("command-healthy", [process.execPath, "-e", "process.stdout.write('HEALTHY')"], root);
		await Bun.write(path.join(root, "automations.yml"), `automations: ${JSON.stringify([bad, healthy])}\n`);
		const runs: string[] = [];
		const errors: string[] = [];
		await runAutomationDaemon({
			agentDir: root,
			sessionsDir: path.join(root, "sessions"),
			nowMs: () => 1_000,
			maxCycles: 1,
			checkIntervalMs: 0,
			maxJitterMs: 0,
			onRun: entry => {
				runs.push(entry.name);
			},
			onError: (entry, error) => {
				errors.push(`${entry.name}:${error instanceof AutomationRunError ? error.result.exitCode : "unknown"}`);
			},
		});
		expect(runs).toEqual(["command-bad", "command-healthy"]);
		expect(errors).toEqual(["command-bad:9"]);
		expect(await readAutomationLedger(bad, root)).toEqual([expect.objectContaining({ status: "failed", exitCode: 9 })]);
		expect(await readAutomationLedger(healthy, root)).toEqual([
			expect.objectContaining({ status: "succeeded", exitCode: 0, stdout: "HEALTHY" }),
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
			if (server.port === undefined) throw new Error("Local automation test server has no port");
			await writeLocalModelFixture(root, server.port);
			const entry: AutomationEntry = {
				...ENTRY,
				name: "local-provider-proof",
				prompt: "LOCAL_AUTOMATION_PROMPT",
			};
			let authCloseCalls = 0;
			let sessionDisposeCalls = 0;
			const discoverAuth: typeof discoverAuthStorage = async agentDir => {
				const storage = await discoverAuthStorage(agentDir);
				const close = storage.close.bind(storage);
				storage.close = () => {
					authCloseCalls += 1;
					close();
				};
				return storage;
			};
			const createSession: typeof createAgentSession = async options => {
				const created = await createAgentSession(options);
				const dispose = created.session.dispose.bind(created.session);
				created.session.dispose = async disposeOptions => {
					sessionDisposeCalls += 1;
					await dispose(disposeOptions);
				};
				return created;
			};
			const sessionsDir = path.join(root, "sessions");
			const runOptions = { agentDir: root, sessionsDir, discoverAuth, createSession };
			const first = await runAutomationOnce(entry, runOptions);
			const second = await runAutomationOnce(entry, runOptions);
			expect(first.status).toBe("succeeded");
			expect(first.outputSummary).toBe("AUTOMATION_OK");
			expect(second.sessionFile).toBe(first.sessionFile);
			expect(promptObserved).toBe(true);
			expect(authCloseCalls).toBe(2);
			expect(sessionDisposeCalls).toBe(2);
			const reopened = await SessionManager.open(first.sessionFile);
			expect(reopened.getEntries().filter(item => item.type === "message").length).toBe(4);
			await reopened.close();
			expect(await readAutomationLedger(entry, root)).toHaveLength(2);
		} finally {
			server.stop(true);
		}
	});

	it("lists resolvable role candidates when a lane cannot resolve", async () => {
		const root = await makeTempDir();
		await writeLocalModelFixture(root, 1);
		const entry = { ...ENTRY, lane: "missing-lane" };
		await expect(runAutomationOnce(entry, { agentDir: root, sessionsDir: path.join(root, "sessions") })).rejects.toThrow(
			/No available model for automation lane "missing-lane"\. Available roles: .*smol/,
		);
	});

	it("recycles at a cycle boundary when RSS crosses the bound, after finishing due runs", async () => {
		const agentDir = await makeTempDir();
		await Bun.write(
			path.join(agentDir, "automations.yml"),
			"automations:\n  - name: local-check\n    schedule: 30m\n    prompt: Reply with OK.\n    cwd: .\n",
		);
		const fired: string[] = [];
		const recycles: string[] = [];
		await runAutomationDaemon({
			agentDir,
			nowMs: () => 1_000,
			random: () => 0,
			checkIntervalMs: 1,
			maxJitterMs: 0,
			rss: () => 4 * 1024 * 1024 * 1024,
			onRecycle: reason => {
				recycles.push(reason);
			},
			run: async entry => {
				fired.push(entry.name);
				return {
					name: entry.name,
					runAt: 1_000,
					durationMs: 1,
					status: "succeeded",
					sessionFile: "/tmp/session.jsonl",
					outputSummary: "OK",
				};
			},
		});
		expect(fired).toEqual(["local-check"]);
		expect(recycles).toEqual(["rss"]);
	});

	it("recycles on uptime and never interrupts a cycle mid-run", async () => {
		const agentDir = await makeTempDir();
		await Bun.write(
			path.join(agentDir, "automations.yml"),
			"automations:\n  - name: local-check\n    schedule: 30m\n    prompt: Reply with OK.\n    cwd: .\n",
		);
		let clock = 1_000;
		const recycles: string[] = [];
		const fired: string[] = [];
		await runAutomationDaemon({
			agentDir,
			nowMs: () => clock,
			random: () => 0,
			checkIntervalMs: 1,
			maxJitterMs: 0,
			maxUptimeMs: 5,
			onRecycle: reason => {
				recycles.push(reason);
			},
			run: async entry => {
				fired.push(entry.name);
				clock += 10;
				return {
					name: entry.name,
					runAt: clock,
					durationMs: 1,
					status: "succeeded",
					sessionFile: "/tmp/session.jsonl",
					outputSummary: "OK",
				};
			},
		});
		expect(fired).toEqual(["local-check"]);
		expect(recycles).toEqual(["uptime"]);
	});


	it("places stable journals where the root session scan can discover them", async () => {
		const sessionsDir = await makeTempDir();
		expect(getAutomationSessionFile(ENTRY, sessionsDir)).toBe(
			path.join(sessionsDir, "automation-local-check", "local-check.jsonl"),
		);
	});
});
