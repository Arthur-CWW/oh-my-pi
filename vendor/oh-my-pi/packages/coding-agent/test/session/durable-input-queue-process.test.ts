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
	'async function complete(item) {',
	"  const attempt = item.attempts.at(-1);",
	'  if (!attempt) throw new Error("attempt missing");',
	"  await queue.markRequestStarted(item.inputId, attempt.id);",
	"  await queue.completeAttempt(item.inputId, attempt.id);",
	"  return attempt.id;",
	"}",
	'if (action === "rate-limit") {',
	"  const retryAt = Number(process.env.RETRY_AT);",
	'  const item = await queue.enqueue({ text: "resume after reset", deliveryClass: "followUp" });',
	"  const admitted = await queue.admitNext();",
	'  if (!admitted) throw new Error("input was not admitted");',
	"  const attempt = admitted.attempts.at(-1);",
	'  if (!attempt) throw new Error("attempt missing");',
	"  await queue.markRequestStarted(item.inputId, attempt.id);",
	"  await queue.failRateLimit(item.inputId, attempt.id, retryAt);",
	"  console.log(JSON.stringify({ inputId: item.inputId, attemptId: attempt.id, retryAt }));",
	'} else if (action === "resume-rate-limit") {',
	"  const retryAt = Number(process.env.RETRY_AT);",
	"  const before = await queue.replayQueued();",
	"  const early = await queue.retryDue(retryAt - 1);",
	"  const due = await queue.retryDue(retryAt);",
	"  const admitted = await queue.admitNext();",
	'  if (!admitted) throw new Error("due input was not admitted");',
	"  await complete(admitted);",
	"  console.log(JSON.stringify({ adopted: adopted.length, before: before.length, early: early.length, due: due.length, inputId: admitted.inputId, admittedAgain: (await queue.admitNext()) !== undefined, replay: (await queue.replayQueued()).length }));",
	'} else if (action === "running") {',
	'  const item = await queue.enqueue({ text: "uncertain after crash", deliveryClass: "followUp" });',
	"  const admitted = await queue.admitNext();",
	'  if (!admitted) throw new Error("input was not admitted");',
	"  const attempt = admitted.attempts.at(-1);",
	'  if (!attempt) throw new Error("attempt missing");',
	"  await queue.markRequestStarted(item.inputId, attempt.id);",
	"  console.log(JSON.stringify({ inputId: item.inputId, attemptId: attempt.id }));",
	'} else if (action === "reconcile-running") {',
	"  const attemptId = process.env.ATTEMPT_ID;",
	'  if (!attemptId) throw new Error("attempt id missing");',
	"  const before = await queue.replayQueued();",
	'  await queue.reconcile(attemptId, "not-executed");',
	"  const replay = await queue.replayQueued();",
	"  const admitted = await queue.admitNext();",
	"  console.log(JSON.stringify({ adopted: adopted.length, before: before.length, replay: replay.length, inputId: admitted?.inputId }));",
	'} else if (action === "seed-ordered-backlog") {',
	'  const followUp = await queue.enqueue({ text: "follow up", deliveryClass: "followUp" });',
	'  const steer = await queue.enqueue({ text: "steer now", deliveryClass: "steer" });',
	'  const neighbour = await queue.enqueue({ text: "cancel me", deliveryClass: "followUp" });',
	'  const revised = await queue.edit(followUp.inputId, followUp.revision, { text: "follow up revised", images: undefined });',
	"  const cancelled = await queue.cancel(neighbour.inputId);",
	"  console.log(JSON.stringify({ followUp: { inputId: revised.inputId, sequence: revised.sequence, revision: revised.revision }, steer: { inputId: steer.inputId, sequence: steer.sequence, revision: steer.revision }, cancelled: { inputId: cancelled.inputId, sequence: cancelled.sequence, state: cancelled.state } }));",
	'} else if (action === "adopt-order-and-deliver") {',
	'  const captured = await queue.enqueue({ text: "captured after adoption", deliveryClass: "followUp" });',
	'  const tool = await queue.admitNext("tool");',
	'  if (!tool) throw new Error("tool boundary admitted nothing");',
	"  const toolAttemptId = await complete(tool);",
	"  const terminal = [];",
	"  for (;;) {",
	'    const item = await queue.admitNext("terminal");',
	"    if (!item) break;",
	"    terminal.push({ inputId: item.inputId, sequence: item.sequence, attemptId: await complete(item) });",
	"  }",
	"  const items = await queue.list();",
	"  console.log(JSON.stringify({ adopted: adopted.map(item => ({ inputId: item.inputId, sequence: item.sequence, revision: item.revision })), captured: { inputId: captured.inputId, sequence: captured.sequence }, tool: { inputId: tool.inputId, sequence: tool.sequence, attemptId: toolAttemptId }, terminal, items: items.map(item => ({ inputId: item.inputId, sequence: item.sequence, revision: item.revision, state: item.state, attempts: item.attempts.map(attempt => attempt.id) })) }));",
	'} else if (action === "enqueue-once") {',
	'  const item = await queue.enqueue({ text: process.env.TEXT ?? "concurrent", deliveryClass: "followUp" });',
	"  console.log(JSON.stringify({ inputId: item.inputId, sequence: item.sequence }));",
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

	it("preserves edited identities through replacement and admits frozen backlog in boundary order", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-queue-process-"));
		roots.push(root);
		const sessionFile = path.join(root, "parent.jsonl");
		await fs.writeFile(sessionFile, "");
		const seeded = (await runChild({
			ROOT: root,
			SESSION_FILE: sessionFile,
			EPOCH: "epoch-a",
			ACTION: "seed-ordered-backlog",
		})) as {
			followUp: { inputId: string; sequence: number; revision: number };
			steer: { inputId: string; sequence: number; revision: number };
			cancelled: { inputId: string; sequence: number; state: string };
		};
		expect([seeded.followUp.sequence, seeded.steer.sequence, seeded.cancelled.sequence]).toEqual([1, 2, 3]);
		expect(seeded.followUp.revision).toBe(2);
		const [queueKey] = await fs.readdir(path.join(root, "owners-v1"));
		if (!queueKey) throw new Error("queue root missing");
		const queueRoot = path.join(root, "owners-v1", queueKey, "queue-v2");
		const firstHead = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as { epoch: string };
		const frozenSegment = path.join(queueRoot, "segments", `${firstHead.epoch}.jsonl`);
		const frozenBytes = (await fs.stat(frozenSegment)).size;
		const frozenRecords = (await fs.readFile(frozenSegment, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as Record<string, unknown>);
		expect(frozenRecords).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "enqueue", id: seeded.followUp.inputId, sequence: 1, deliveryClass: "followUp", revision: 1 }),
				expect.objectContaining({ type: "revision", inputId: seeded.followUp.inputId, revision: 2 }),
				expect.objectContaining({ type: "enqueue", id: seeded.steer.inputId, sequence: 2, deliveryClass: "steer", revision: 1 }),
				expect.objectContaining({ type: "state", id: seeded.cancelled.inputId, state: "cancelled" }),
			]),
		);
		const delivered = (await runChild({
			ROOT: root,
			SESSION_FILE: sessionFile,
			EPOCH: "epoch-b",
			ACTION: "adopt-order-and-deliver",
		})) as {
			adopted: { inputId: string; sequence: number; revision: number }[];
			captured: { inputId: string; sequence: number };
			tool: { inputId: string; sequence: number; attemptId: string };
			terminal: { inputId: string; sequence: number; attemptId: string }[];
			items: { inputId: string; sequence: number; revision: number; state: string; attempts: string[] }[];
		};
		const replacementHead = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as {
			epoch: string;
			ownershipEpoch: string;
			predecessor: string;
			predecessorBytes: number;
		};
		expect(replacementHead).toMatchObject({
			ownershipEpoch: "epoch-b",
			predecessor: firstHead.epoch,
			predecessorBytes: frozenBytes,
		});
		expect((await fs.stat(frozenSegment)).size).toBe(frozenBytes);
		expect(delivered.adopted).toEqual([
			{ inputId: seeded.followUp.inputId, sequence: 1, revision: 2 },
			{ inputId: seeded.steer.inputId, sequence: 2, revision: 1 },
		]);
		expect(delivered.tool).toMatchObject({ inputId: seeded.steer.inputId, sequence: 2 });
		expect(delivered.terminal.map(item => [item.inputId, item.sequence])).toEqual([
			[seeded.followUp.inputId, 1],
			[delivered.captured.inputId, 4],
		]);
		expect(delivered.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ inputId: seeded.followUp.inputId, sequence: 1, revision: 2, state: "completed" }),
				expect.objectContaining({ inputId: seeded.steer.inputId, sequence: 2, revision: 1, state: "completed" }),
				expect.objectContaining({ inputId: seeded.cancelled.inputId, sequence: 3, state: "cancelled", attempts: [] }),
				expect.objectContaining({ inputId: delivered.captured.inputId, sequence: 4, revision: 1, state: "completed" }),
			]),
		);
		const admittedIds = [delivered.tool.inputId, ...delivered.terminal.map(item => item.inputId)];
		const attemptIds = [delivered.tool.attemptId, ...delivered.terminal.map(item => item.attemptId)];
		expect(new Set(admittedIds).size).toBe(admittedIds.length);
		expect(new Set(attemptIds).size).toBe(attemptIds.length);
		expect(admittedIds).not.toContain(seeded.cancelled.inputId);
		const replacementSegment = path.join(queueRoot, "segments", `${replacementHead.epoch}.jsonl`);
		const replacementRecords = (await fs.readFile(replacementSegment, "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as Record<string, unknown>);
		expect(replacementRecords).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "adopt", previousEpoch: firstHead.epoch }),
				expect.objectContaining({ type: "enqueue", id: delivered.captured.inputId, sequence: 4, deliveryClass: "followUp" }),
				expect.objectContaining({ type: "attempt", id: delivered.tool.attemptId, inputId: seeded.steer.inputId, revision: 1 }),
				expect.objectContaining({ type: "terminal", inputId: seeded.steer.inputId, attemptId: delivered.tool.attemptId, state: "completed" }),
				expect.objectContaining({ type: "terminal", inputId: seeded.followUp.inputId, attemptId: delivered.terminal[0]?.attemptId, state: "completed" }),
				expect.objectContaining({ type: "terminal", inputId: delivered.captured.inputId, attemptId: delivered.terminal[1]?.attemptId, state: "completed" }),
			]),
		);
	});

	it("serializes concurrent same-owner process enqueues into contiguous sequences", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-queue-process-"));
		roots.push(root);
		const sessionFile = path.join(root, "parent.jsonl");
		await fs.writeFile(sessionFile, "");
		const [left, right] = (await Promise.all([
			runChild({ ROOT: root, SESSION_FILE: sessionFile, EPOCH: "epoch-a", ACTION: "enqueue-once", TEXT: "left" }),
			runChild({ ROOT: root, SESSION_FILE: sessionFile, EPOCH: "epoch-a", ACTION: "enqueue-once", TEXT: "right" }),
		])) as [{ inputId: string; sequence: number }, { inputId: string; sequence: number }];
		expect(new Set([left.inputId, right.inputId]).size).toBe(2);
		expect([left.sequence, right.sequence].sort((a, b) => a - b)).toEqual([1, 2]);
		const [queueKey] = await fs.readdir(path.join(root, "owners-v1"));
		if (!queueKey) throw new Error("queue root missing");
		const queueRoot = path.join(root, "owners-v1", queueKey, "queue-v2");
		const head = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as { epoch: string; ownershipEpoch: string };
		const records = (await fs.readFile(path.join(queueRoot, "segments", `${head.epoch}.jsonl`), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as Record<string, unknown>)
			.filter(record => record.type === "enqueue");
		expect(head.ownershipEpoch).toBe("epoch-a");
		expect(records).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: left.inputId, sequence: left.sequence }),
				expect.objectContaining({ id: right.inputId, sequence: right.sequence }),
			]),
		);
		expect(records.map(record => record.sequence).sort((a, b) => Number(a) - Number(b))).toEqual([1, 2]);
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
