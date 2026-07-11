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
	"async function complete(item) {",
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
	"  const later = await queue.enqueue({ text: \"wait behind reset retry\", deliveryClass: \"followUp\" });",
	"  console.log(JSON.stringify({ inputId: item.inputId, laterInputId: later.inputId, attemptId: attempt.id, retryAt }));",
	'} else if (action === "resume-rate-limit") {',
	"  const retryAt = Number(process.env.RETRY_AT);",
	"  const before = await queue.replayQueued();",
	"  const early = await queue.retryDue(retryAt - 1);",
	'  const blocked = await queue.admitNext("terminal", retryAt - 1);',
	"  const due = await queue.retryDue(retryAt);",
	"  const admitted = await queue.admitNext();",
	'  if (!admitted) throw new Error("due input was not admitted");',
	"  const attempt = admitted.attempts.at(-1);",
	'  if (!attempt) throw new Error("attempt missing");',
	"  await queue.markRequestStarted(admitted.inputId, attempt.id);",
	"  const admittedWhileRunning = await queue.admitNext();",
	"  await queue.completeAttempt(admitted.inputId, attempt.id);",
	"  const next = await queue.admitNext();",
	'  if (!next) throw new Error("later input was not admitted");',
	"  await complete(next);",
	"  console.log(JSON.stringify({ adopted: adopted.length, before: before.length, early: early.length, blocked: blocked !== undefined, due: due.length, inputId: admitted.inputId, admittedWhileRunning: admittedWhileRunning !== undefined, nextInputId: next.inputId, admittedAgain: (await queue.admitNext()) !== undefined, replay: (await queue.replayQueued()).length }));",
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
	"  const terminal = [];",
	"  for (;;) {",
	'    const item = await queue.admitNext("terminal");',
	"    if (!item) break;",
	"    terminal.push({ inputId: item.inputId, sequence: item.sequence, attemptId: await complete(item) });",
	"  }",
	"  const items = await queue.list();",
	"  console.log(JSON.stringify({ adopted: adopted.map(item => ({ inputId: item.inputId, sequence: item.sequence, revision: item.revision })), captured: { inputId: captured.inputId, sequence: captured.sequence }, tool: tool ? { inputId: tool.inputId, sequence: tool.sequence } : null, terminal, items: items.map(item => ({ inputId: item.inputId, sequence: item.sequence, revision: item.revision, state: item.state, attempts: item.attempts.map(attempt => attempt.id) })) }));",
	'} else if (action === "enqueue-once") {',
	'  const item = await queue.enqueue({ text: process.env.TEXT ?? "concurrent", deliveryClass: "followUp" });',
	"  console.log(JSON.stringify({ inputId: item.inputId, sequence: item.sequence }));",
'} else if (action === "seed-mutation-target") {',
'  const item = await queue.enqueue({ text: process.env.TEXT ?? "target", deliveryClass: "followUp" });',
'  console.log(JSON.stringify({ inputId: item.inputId, itemRevision: item.revision }));',
	'} else if (action === "admit-command") {',
	"  const commandId = process.env.COMMAND_ID;",
	"  const expectedRevision = Number(process.env.EXPECTED_REVISION);",
	'  if (!commandId || !Number.isSafeInteger(expectedRevision)) throw new Error("command environment missing");',
	"  try {",
	'    const receipt = await queue.enqueueCommand({ text: process.env.TEXT ?? "command", deliveryClass: "followUp" }, { schemaVersion: 1, commandId, correlationId: "correlation-" + commandId, viewId: "view-a", controllerEpoch: 1, expectedRevision });',
	'    console.log(JSON.stringify({ status: "accepted", inputId: receipt.item.inputId, sequence: receipt.item.sequence, runnerRevision: receipt.runnerRevision, replayed: receipt.replayed }));',
	"  } catch (error) {",
	'    console.log(JSON.stringify({ status: "rejected", name: error?.name, expectedRevision: error?.expectedRevision, actualRevision: error?.actualRevision }));',
	"  }",
'} else if (action === "mutate-command") {',
'  const commandId = process.env.COMMAND_ID;',
'  const inputId = process.env.INPUT_ID;',
'  const operation = process.env.OPERATION;',
'  const expectedRevision = Number(process.env.EXPECTED_REVISION);',
'  const expectedItemRevision = Number(process.env.EXPECTED_ITEM_REVISION);',
'  if (!commandId || !inputId || !operation) throw new Error("mutation command environment missing");',
'  const metadata = { schemaVersion: 1, commandId, correlationId: "correlation-" + commandId, viewId: "view-a", controllerEpoch: 1, expectedRevision };',
'  try {',
'    const receipt = operation === "edit"',
'      ? await queue.editCommand(inputId, expectedItemRevision, { text: process.env.TEXT ?? "edited", images: undefined }, metadata)',
'      : await queue.cancelCommand(inputId, expectedItemRevision, metadata);',
'    console.log(JSON.stringify({ status: "accepted", inputId: receipt.item.inputId, itemRevision: receipt.item.revision, state: receipt.item.state, text: receipt.item.payload.text, runnerRevision: receipt.runnerRevision, replayed: receipt.replayed, latestRunnerRevision: await queue.getLatestRunnerRevision() }));',
'  } catch (error) {',
'    console.log(JSON.stringify({ status: "rejected", name: error?.name, expectedRevision: error?.expectedRevision, actualRevision: error?.actualRevision }));',
'  }',
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
	it("keeps a later input behind a rate-limited head across process replacement", async () => {
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
			adopted: 1,
			before: 1,
			early: 0,
			blocked: false,
			due: 1,
			inputId: first.inputId,
			admittedWhileRunning: false,
			nextInputId: first.laterInputId,
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
				expect.objectContaining({
					type: "enqueue",
					id: seeded.followUp.inputId,
					sequence: 1,
					deliveryClass: "followUp",
					revision: 1,
				}),
				expect.objectContaining({ type: "revision", inputId: seeded.followUp.inputId, revision: 2 }),
				expect.objectContaining({
					type: "enqueue",
					id: seeded.steer.inputId,
					sequence: 2,
					deliveryClass: "steer",
					revision: 1,
				}),
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
			tool: { inputId: string; sequence: number } | null;
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
		expect(delivered.tool).toBeNull();
		expect(delivered.terminal.map(item => [item.inputId, item.sequence])).toEqual([
			[seeded.followUp.inputId, 1],
			[seeded.steer.inputId, 2],
			[delivered.captured.inputId, 4],
		]);
		expect(delivered.items).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ inputId: seeded.followUp.inputId, sequence: 1, revision: 2, state: "completed" }),
				expect.objectContaining({ inputId: seeded.steer.inputId, sequence: 2, revision: 1, state: "completed" }),
				expect.objectContaining({
					inputId: seeded.cancelled.inputId,
					sequence: 3,
					state: "cancelled",
					attempts: [],
				}),
				expect.objectContaining({
					inputId: delivered.captured.inputId,
					sequence: 4,
					revision: 1,
					state: "completed",
				}),
			]),
		);
		const admittedIds = delivered.terminal.map(item => item.inputId);
		const attemptIds = delivered.terminal.map(item => item.attemptId);
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
				expect.objectContaining({
					type: "enqueue",
					id: delivered.captured.inputId,
					sequence: 4,
					deliveryClass: "followUp",
				}),
				expect.objectContaining({
					type: "terminal",
					inputId: seeded.followUp.inputId,
					attemptId: delivered.terminal[0]?.attemptId,
					state: "completed",
				}),
				expect.objectContaining({
					type: "terminal",
					inputId: seeded.steer.inputId,
					attemptId: delivered.terminal[1]?.attemptId,
					state: "completed",
				}),
				expect.objectContaining({
					type: "terminal",
					inputId: delivered.captured.inputId,
					attemptId: delivered.terminal[2]?.attemptId,
					state: "completed",
				}),
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
		const head = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as {
			epoch: string;
			ownershipEpoch: string;
		};
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

	it("serializes command idempotency and revision CAS across processes", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-queue-command-process-"));
		roots.push(root);
		const sessionFile = path.join(root, "parent.jsonl");
		await fs.writeFile(sessionFile, "");
		const common = {
			ROOT: root,
			SESSION_FILE: sessionFile,
			EPOCH: "epoch-a",
			ACTION: "admit-command",
			COMMAND_ID: "duplicate",
			EXPECTED_REVISION: "0",
			TEXT: "identical",
		};
		const duplicates = (await Promise.all([runChild(common), runChild(common)])) as Array<{
			status: string;
			inputId: string;
			runnerRevision: number;
			replayed: boolean;
		}>;
		expect(duplicates.map(result => result.status)).toEqual(["accepted", "accepted"]);
		expect(new Set(duplicates.map(result => result.inputId)).size).toBe(1);
		expect(duplicates.map(result => result.runnerRevision)).toEqual([1, 1]);
		expect(duplicates.map(result => result.replayed).sort()).toEqual([false, true]);

		const contenders = await Promise.all([
			runChild({
				...common,
				COMMAND_ID: "contender-a",
				EXPECTED_REVISION: "1",
				TEXT: "a",
			}),
			runChild({
				...common,
				COMMAND_ID: "contender-b",
				EXPECTED_REVISION: "1",
				TEXT: "b",
			}),
		]);
		expect(contenders.filter(result => result.status === "accepted")).toHaveLength(1);
		expect(contenders.filter(result => result.status === "rejected")).toEqual([
			expect.objectContaining({
				name: "DurableInputRunnerRevisionConflictError",
				expectedRevision: 1,
				actualRevision: 2,
			}),
		]);

		const [queueKey] = await fs.readdir(path.join(root, "owners-v1"));
		if (!queueKey) throw new Error("queue root missing");
		const queueRoot = path.join(root, "owners-v1", queueKey, "queue-v2");
		const head = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as { epoch: string };
		const records = (await fs.readFile(path.join(queueRoot, "segments", `${head.epoch}.jsonl`), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as Record<string, unknown>)
			.filter(record => record.type === "enqueue");
		expect(records).toHaveLength(2);
		expect(records.map(record => record.runnerRevision).sort()).toEqual([1, 2]);
	});


	it("serializes edit and cancel command CAS across processes and reopens mutation receipts", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-queue-mutation-process-"));
		roots.push(root);
		const sessionFile = path.join(root, "parent.jsonl");
		await fs.writeFile(sessionFile, "");
		const base = { ROOT: root, SESSION_FILE: sessionFile, EPOCH: "epoch-a" };
		const [left, right] = await Promise.all([
			runChild({ ...base, ACTION: "seed-mutation-target", TEXT: "left" }),
			runChild({ ...base, ACTION: "seed-mutation-target", TEXT: "right" }),
		]);
		const editEnvironment = {
			...base,
			ACTION: "mutate-command",
			OPERATION: "edit",
			COMMAND_ID: "edit-left",
			INPUT_ID: String(left.inputId),
			EXPECTED_REVISION: "0",
			EXPECTED_ITEM_REVISION: "1",
			TEXT: "left edited",
		};
		const cancelEnvironment = {
			...base,
			ACTION: "mutate-command",
			OPERATION: "cancel",
			COMMAND_ID: "cancel-right",
			INPUT_ID: String(right.inputId),
			EXPECTED_REVISION: "0",
			EXPECTED_ITEM_REVISION: "1",
		};
		const contenders = await Promise.all([runChild(editEnvironment), runChild(cancelEnvironment)]);
		expect(contenders.filter(result => result.status === "accepted")).toHaveLength(1);
		expect(contenders.filter(result => result.status === "rejected")).toEqual([
			expect.objectContaining({
				name: "DurableInputRunnerRevisionConflictError",
				expectedRevision: 0,
				actualRevision: 1,
			}),
		]);
		const winningEnvironment = contenders[0]?.status === "accepted" ? editEnvironment : cancelEnvironment;
		const replay = await runChild({ ...winningEnvironment, EPOCH: "epoch-a" });
		expect(replay).toMatchObject({
			status: "accepted",
			runnerRevision: 1,
			replayed: true,
			latestRunnerRevision: 1,
		});

		const [queueKey] = await fs.readdir(path.join(root, "owners-v1"));
		if (!queueKey) throw new Error("queue root missing");
		const queueRoot = path.join(root, "owners-v1", queueKey, "queue-v2");
		const head = JSON.parse(await fs.readFile(path.join(queueRoot, "head.json"), "utf8")) as { epoch: string };
		const records = (await fs.readFile(path.join(queueRoot, "segments", `${head.epoch}.jsonl`), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as Record<string, unknown>)
			.filter(record => record.command);
		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ runnerRevision: 1 });
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
