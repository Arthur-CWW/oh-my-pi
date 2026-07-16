import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { IrcExternalBus } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

const MODEL_PATH = path.join(import.meta.dir, "model", "h1-model.ts");
const MODEL_AVAILABLE = await Bun.file(MODEL_PATH).exists();
const SKIP_REASON = "H1 model module is not present; coordinator will run the union with the model worker.";

let tmpRoot = "";
let previousHome: string | undefined;
let previousControlDb: string | undefined;

async function writeChildJournal(): Promise<void> {
	const root = process.env.H1_TRACE_ROOT;
	if (!root) return;
	const bus = new IrcExternalBus(path.join(root, "irc.sqlite"));
	bus.close();
	const session = SessionManager.create(root, path.join(root, "sessions"));
	session.appendCustomEntry("child_lifecycle", {
		version: 1,
		agentId: "child-1",
		childSessionFile: "child.jsonl",
		parentSessionFile: "parent.jsonl",
		state: "running",
		updatedAt: "2026-01-01T00:00:00.000Z",
	});
	await session.ensureOnDisk();
	session.appendMessage({
		role: "toolResult",
		toolCallId: "yield-call",
		toolName: "yield",
		content: [{ type: "text", text: "Result submitted." }],
		isError: false,
		timestamp: 0,
		details: { status: "success", data: { ok: true } },
	});
	session.appendCustomEntry("h1:delivered", { state: "delivered" });
	session.appendCustomEntry("future_record", { state: "future" });
	await session.close();
	const sessionFile = session.getSessionFile();
	if (!sessionFile) throw new Error("real child did not create a session journal");
	await Bun.write(path.join(root, "journal-path.txt"), sessionFile);
}

if (process.env.H1_TRACE_CHILD === "1") {
	await writeChildJournal();
	process.exit(0);
}

beforeEach(async () => {
	tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "omp-h1-trace-"));
	previousHome = process.env.HOME;
	previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.HOME = tmpRoot;
	process.env.OMP_SESSION_CONTROL_DB = path.join(tmpRoot, "session-control.sqlite");
	const bus = new IrcExternalBus(path.join(tmpRoot, "irc.sqlite"));
	bus.close();
});

afterEach(async () => {
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	await fs.rm(tmpRoot, { recursive: true, force: true });
});

function modelTest(name: string, test: () => Promise<void>): void {
	if (!MODEL_AVAILABLE) {
		it.skip(`${name} [skip: ${SKIP_REASON}]`, () => {});
		return;
	}
	it(name, test);
}

function event(kind: string, seq: number, cause?: string): { readonly kind: string; readonly childId: string; readonly seq: number; readonly at: number; readonly cause?: string } {
	return { kind, childId: "child-1", seq, at: seq, ...(cause === undefined ? {} : { cause }) };
}

describe("H1 trace conformance", () => {
	modelTest("maps a real child journal with no violations", async () => {
		const child = Bun.spawn([process.execPath, "test", import.meta.path], {
			cwd: path.resolve(import.meta.dir, "../.."),
			env: {
				...process.env,
				HOME: tmpRoot,
				OMP_SESSION_CONTROL_DB: path.join(tmpRoot, "session-control.sqlite"),
				H1_TRACE_CHILD: "1",
				H1_TRACE_ROOT: tmpRoot,
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(exitCode, `${stderr}\n${stdout}`).toBe(0);
		const journalPath = (await Bun.file(path.join(tmpRoot, "journal-path.txt")).text()).trim();
		expect(await Bun.file(journalPath).exists(), `journal path ${journalPath}`).toBe(true);
		// Dynamic import is intentional: standalone suites skip while the frozen model is absent.
		const { checkH1Journal, journalToH1Events } = await import("./h1-trace-conformance");
		const journal = await Bun.file(journalPath).text();
		const report = checkH1Journal(journal);
		expect(report.violations).toHaveLength(0);
		expect(report.skippedRecords).toBe(1);
		expect(report.eventCounts).toMatchObject({ admitted: 1, started: 1, yieldWritten: 1, delivered: 1 });
		expect(journalToH1Events(journal)).toHaveLength(4);
	});

	modelTest("detects yield followed by timeout teardown as I2", async () => {
		// Dynamic import is intentional: standalone suites skip while the frozen model is absent.
		const { h1CheckTrace } = await import("./model/h1-model");
		const violations = h1CheckTrace([
			event("admitted", 1),
			event("started", 2),
			event("yieldWritten", 3),
			event("timeoutFired", 4, "wall-clock timeout"),
			event("crashed", 5, "timeout teardown"),
		]);
		expect(violations.some((violation: { readonly invariant: string }) => violation.invariant === "I2")).toBe(true);
	});

	modelTest("detects duplicate terminal delivery as I1", async () => {
		// Dynamic import is intentional: standalone suites skip while the frozen model is absent.
		const { h1CheckTrace } = await import("./model/h1-model");
		const violations = h1CheckTrace([
			event("admitted", 1),
			event("started", 2),
			event("yieldWritten", 3),
			event("delivered", 4),
			event("delivered", 5),
		]);
		expect(violations.some((violation: { readonly invariant: string }) => violation.invariant === "I1")).toBe(true);
	});

	if (!MODEL_AVAILABLE) {
		it.skip(`replays OMP_CONFORMANCE_JOURNAL [skip: ${SKIP_REASON}]`, () => {});
	} else if (process.env.OMP_CONFORMANCE_JOURNAL === undefined) {
		it.skip("replays OMP_CONFORMANCE_JOURNAL [skip: environment variable is unset]", () => {});
	} else {
		it("replays OMP_CONFORMANCE_JOURNAL", async () => {
			// Dynamic import is intentional: standalone suites skip while the frozen model is absent.
			const { checkH1Journal, formatH1ConformanceReport } = await import("./h1-trace-conformance");
			const journalPath = process.env.OMP_CONFORMANCE_JOURNAL;
			expect(journalPath).toBeDefined();
			const report = checkH1Journal(await Bun.file(journalPath!).text());
			process.stdout.write(`[h1-conformance] ${formatH1ConformanceReport(report)}\n`);
		});
	}
});
