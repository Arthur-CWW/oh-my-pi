import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

const roots: string[] = [];

const CHILD_SOURCE = [
	'import { DurableInputQueue } from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";',
	"const root = process.env.ROOT;",
	"const sessionFile = process.env.SESSION_FILE;",
	"const epoch = process.env.EPOCH;",
	"const action = process.env.ACTION;",
	'if (!root || !sessionFile || !epoch || !action) throw new Error("missing child environment");',
	'const owner = { sessionFile, sessionId: "parent", ownerEpoch: epoch, ownerKind: "omp", isCurrent: async () => true, release: async () => {} };',
	"const queue = await DurableInputQueue.open(owner, root);",
	"const adopted = await queue.adopt();",
	'if (action === "rate-limit") {',
	"  const retryAt = Number(process.env.RETRY_AT);",
	'  const item = await queue.enqueue("resume after reset");',
	"  const admitted = await queue.admitNext();",
	'  if (!admitted) throw new Error("input was not admitted");',
	"  const attempt = admitted.attempts.at(-1);",
	'  if (!attempt) throw new Error("attempt missing");',
	"  await queue.markRequestStarted(item.id, attempt.id);",
	"  await queue.failRateLimit(item.id, attempt.id, retryAt);",
	"  console.log(JSON.stringify({ inputId: item.id, attemptId: attempt.id, retryAt }));",
	'} else if (action === "resume-rate-limit") {',
	"  const retryAt = Number(process.env.RETRY_AT);",
	"  const before = await queue.replayQueued();",
	"  const early = await queue.retryDue(retryAt - 1);",
	"  const due = await queue.retryDue(retryAt);",
	"  const admitted = await queue.admitNext();",
	'  if (!admitted) throw new Error("due input was not admitted");',
	"  const attempt = admitted.attempts.at(-1);",
	'  if (!attempt) throw new Error("attempt missing");',
	"  await queue.markRequestStarted(admitted.id, attempt.id);",
	"  await queue.completeAttempt(admitted.id, attempt.id);",
	"  console.log(JSON.stringify({ adopted: adopted.length, before: before.length, early: early.length, due: due.length, inputId: admitted.id, admittedAgain: (await queue.admitNext()) !== undefined, replay: (await queue.replayQueued()).length }));",
	'} else if (action === "running") {',
	'  const item = await queue.enqueue("uncertain after crash");',
	"  const admitted = await queue.admitNext();",
	'  if (!admitted) throw new Error("input was not admitted");',
	"  const attempt = admitted.attempts.at(-1);",
	'  if (!attempt) throw new Error("attempt missing");',
	"  await queue.markRequestStarted(item.id, attempt.id);",
	"  console.log(JSON.stringify({ inputId: item.id, attemptId: attempt.id }));",
	'} else if (action === "reconcile-running") {',
	"  const attemptId = process.env.ATTEMPT_ID;",
	'  if (!attemptId) throw new Error("attempt id missing");',
	"  const before = await queue.replayQueued();",
	'  await queue.reconcile(attemptId, "not-executed");',
	"  const replay = await queue.replayQueued();",
	"  const admitted = await queue.admitNext();",
	"  console.log(JSON.stringify({ adopted: adopted.length, before: before.length, replay: replay.length, inputId: admitted?.id }));",
	"} else {",
	'  throw new Error("unknown action: " + action);',
	"}",
].join("\n");

async function runChild(environment: Record<string, string>): Promise<Record<string, unknown>> {
	const processHandle = Bun.spawn({
		cmd: [process.execPath, "-e", CHILD_SOURCE],
		cwd: path.resolve(import.meta.dir, "../.."),
		env: { ...process.env, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		processHandle.exited,
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
	]);
	if (exitCode !== 0) throw new Error(`queue child failed (${exitCode}): ${stderr}`);
	const line = stdout.trim().split("\n").at(-1);
	if (!line) throw new Error("queue child emitted no result");
	const parsed: unknown = JSON.parse(line);
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
		throw new Error("queue child emitted invalid result");
	return parsed as Record<string, unknown>;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("durable input queue process replacement", () => {
	it("resumes one rate-limited input exactly once after its reset", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-queue-process-"));
		roots.push(root);
		const sessionFile = path.join(root, "parent.jsonl");
		await fs.writeFile(sessionFile, "");
		const retryAt = Date.now() + 250;
		const first = await runChild({
			ROOT: root,
			SESSION_FILE: sessionFile,
			EPOCH: "epoch-a",
			ACTION: "rate-limit",
			RETRY_AT: String(retryAt),
		});
		const [queueKey] = await fs.readdir(path.join(root, "owners-v1"));
		if (!queueKey) throw new Error("queue root missing");
		const queueRoot = path.join(root, "owners-v1", queueKey, "queue-v2");
		const firstHead = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as { epoch: string };
		const firstSegment = path.join(queueRoot, "segments", `${firstHead.epoch}.jsonl`);
		const firstSegmentBytes = (await fs.stat(firstSegment)).size;
		const resumed = await runChild({
			ROOT: root,
			SESSION_FILE: sessionFile,
			EPOCH: "epoch-b",
			ACTION: "resume-rate-limit",
			RETRY_AT: String(retryAt),
		});
		const replacementHead = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as {
			ownershipEpoch?: string;
		};
		expect(replacementHead.ownershipEpoch).toBe("epoch-b");
		expect((await fs.stat(firstSegment)).size).toBe(firstSegmentBytes);
		expect(resumed).toMatchObject({
			adopted: 0,
			before: 0,
			early: 0,
			due: 1,
			inputId: first.inputId,
			admittedAgain: false,
			replay: 0,
		});
	});

	it("withholds a crashed running attempt until durable reconciliation proves non-execution", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-queue-process-"));
		roots.push(root);
		const sessionFile = path.join(root, "parent.jsonl");
		await fs.writeFile(sessionFile, "");
		const first = await runChild({ ROOT: root, SESSION_FILE: sessionFile, EPOCH: "epoch-a", ACTION: "running" });
		const resumed = await runChild({
			ROOT: root,
			SESSION_FILE: sessionFile,
			EPOCH: "epoch-b",
			ACTION: "reconcile-running",
			ATTEMPT_ID: String(first.attemptId),
		});
		expect(resumed).toMatchObject({ adopted: 0, before: 0, replay: 1, inputId: first.inputId });
	});
});
