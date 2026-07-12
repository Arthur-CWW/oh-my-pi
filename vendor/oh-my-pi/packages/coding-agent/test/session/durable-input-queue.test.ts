import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
	cloneJsonValue,
	decodeDurableCustomPayload,
	decodeJsonValue,
	DurableInputCommandConflictError,
	DurableInputItemRevisionConflictError,
	DurableInputQueue,
	DurableInputRunnerRevisionConflictError,
	type DurableCustomPayload,
	type DurableInputCommandMetadata,
	jsonValuesEqual,
	SessionOwnershipLostError,
} from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import { acquireSessionOwnership, type SessionOwnershipHandle } from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const roots: string[] = [];
const TEST_BUILD_REVISION = { digest: "0".repeat(64), version: "durable-input-queue-test" };
const TEST_RUNNER_INSTANCE_IDENTITY = {
	runnerInstanceId: "00000000-0000-4000-8000-000000000006",
	startedAt: "2026-01-01T00:00:00.000Z",
};

it("includes owner identity fields in the read-only takeover banner", () => {
	const error = new SessionOwnershipLostError("session-1", "old-epoch", {
		ownerEpoch: "new-epoch",
		pid: 4242,
		cwd: "/work/active",
		startedAt: "2026-07-12T13:40:00.000Z",
		muxHint: "cmux-surface-7",
	});
	expect(error.message).toContain("pid 4242");
	expect(error.message).toContain("cwd /work/active");
	expect(error.message).toContain("started 2026-07-12T13:40:00.000Z");
	expect(error.message).toContain("mux cmux-surface-7");
});

interface Owner {
	readonly handle: SessionOwnershipHandle;
	current: boolean;
}

async function fixture(epoch: string): Promise<{ root: string; session: string; owner: Owner }> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-durable-input-"));
	roots.push(root);
	const session = path.join(root, "parent.jsonl");
	await fs.writeFile(session, "");
	const owner: Owner = {
		current: true,
		handle: {
			sessionFile: session,
			sessionId: "parent",
			ownerEpoch: epoch,
			ownerKind: "omp",
			buildRevision: TEST_BUILD_REVISION,
			runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
			isCurrent: async () => owner.current,
			release: async () => {
				owner.current = false;
			},
		},
	};
	return { root, session, owner };
}

function replacement(session: string, epoch: string): Owner {
	const owner: Owner = {
		current: true,
		handle: {
			sessionFile: session,
			sessionId: "parent",
			ownerEpoch: epoch,
			ownerKind: "omp",
			buildRevision: TEST_BUILD_REVISION,
			runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
			isCurrent: async () => owner.current,
			release: async () => {
				owner.current = false;
			},
		},
	};
	return owner;
}

function command(
	commandId: string,
	expectedRevision: number,
	overrides: Partial<DurableInputCommandMetadata> = {},
): DurableInputCommandMetadata {
	return {
		schemaVersion: 1,
		commandId,
		correlationId: `correlation-${commandId}`,
		viewId: "view-a",
		controllerEpoch: 1,
		expectedRevision,
		...overrides,
	};
}

async function queueRoot(root: string): Promise<string> {
	const [key] = await fs.readdir(path.join(root, "owners-v1"));
	if (!key) throw new Error("Durable input queue root missing");
	return path.join(root, "owners-v1", key, "queue-v2");
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("durable input queue", () => {
	it("serializes concurrent first-open initialization to one same-owner durable head", async () => {
		const { root, owner } = await fixture("epoch-a");
		const [first, second] = await Promise.all([
			DurableInputQueue.open(owner.handle, root),
			DurableInputQueue.open(owner.handle, root),
		]);
		expect((await first.getStatus()).activeEpoch).toBe((await second.getStatus()).activeEpoch);
	});

	it("shares AGENT_MUX_DIR with the default ownership lease root", async () => {
		const { root, session } = await fixture("fixture");
		const muxRoot = path.join(root, "custom-mux");
		const original = process.env.AGENT_MUX_DIR;
		try {
			process.env.AGENT_MUX_DIR = muxRoot;
			const ownership = await acquireSessionOwnership(session, "parent", {
				buildRevision: TEST_BUILD_REVISION,
				runnerInstanceIdentity: TEST_RUNNER_INSTANCE_IDENTITY,
			});
			try {
				await DurableInputQueue.open(ownership);
				expect(await ownership.isCurrent()).toBe(true);
				expect((await fs.stat(await queueRoot(muxRoot))).isDirectory()).toBe(true);
			} finally {
				await ownership.release();
			}
		} finally {
			if (original === undefined) delete process.env.AGENT_MUX_DIR;
			else process.env.AGENT_MUX_DIR = original;
		}
	});

	it("adopts queued editor input after restart with stable IDs and order", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const firstQueue = await DurableInputQueue.open(owner.handle, root);
		await firstQueue.adopt();
		const first = await firstQueue.enqueue({ text: "first", deliveryClass: "followUp" });
		const second = await firstQueue.enqueue({ text: "second", deliveryClass: "followUp" });
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const replacementQueue = await DurableInputQueue.open(nextOwner.handle, root);
		const adopted = await replacementQueue.adopt();
		expect(adopted.map(item => ({ id: item.inputId, text: "text" in item.payload ? item.payload.text : "", state: item.state }))).toEqual([
			{ id: first.inputId, text: "first", state: "queued" },
			{ id: second.inputId, text: "second", state: "queued" },
		]);
		expect(await replacementQueue.adopt()).toEqual([]);
	});

	it("refuses stale writers after a replacement takes the lease", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const staleQueue = await DurableInputQueue.open(owner.handle, root);
		await staleQueue.adopt();
		const item = await staleQueue.enqueue({ text: "keep this", deliveryClass: "followUp" });
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const currentQueue = await DurableInputQueue.open(nextOwner.handle, root);
		await currentQueue.adopt();
		await expect(staleQueue.complete(item.inputId)).rejects.toBeInstanceOf(SessionOwnershipLostError);
		expect((await currentQueue.replayQueued()).map(entry => entry.inputId)).toEqual([item.inputId]);
	});

	it("serializes a stale append against replacement adoption", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const staleQueue = await DurableInputQueue.open(owner.handle, root);
		await staleQueue.adopt();
		const queuePath = await queueRoot(root);
		const writerLock = path.join(queuePath, "writer.lock");
		await fs.mkdir(writerLock);
		await fs.writeFile(path.join(writerLock, "owner.json"), "{}");

		const staleAppend = staleQueue.enqueue({ text: "must not disappear", deliveryClass: "followUp" }).then(
			() => undefined,
			error => error as Error,
		);
		owner.current = false;
		const nextOwner = replacement(session, "epoch-b");
		await fs.rm(writerLock, { recursive: true });
		const [staleError, replacementQueue] = await Promise.all([
			staleAppend,
			DurableInputQueue.open(nextOwner.handle, root),
		]);
		if (!(staleError instanceof SessionOwnershipLostError)) {
			throw new Error("stale append did not report ownership loss");
		}
		expect(staleError.sessionId).toBe("parent");
		expect(staleError.ownerEpoch).toBe("epoch-a");
		expect(await replacementQueue.adopt()).toEqual([]);
		expect(await replacementQueue.replayQueued()).toEqual([]);
	});

	it("replays only queued input once and never interrupts admitted work", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const admitted = await queue.enqueue({ text: "active", deliveryClass: "followUp" });
		const queued = await queue.enqueue({ text: "later", deliveryClass: "followUp" });
		expect((await queue.admitNext())?.inputId).toBe(admitted.inputId);
		const activeAttempt = await queue.markRunning(admitted.inputId);
		expect(await queue.admitNext()).toBeUndefined();
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const replacementQueue = await DurableInputQueue.open(nextOwner.handle, root);
		expect((await replacementQueue.adopt()).map(item => item.inputId)).toEqual([queued.inputId]);
		expect((await replacementQueue.replayQueued()).map(item => item.inputId)).toEqual([queued.inputId]);
		expect(await replacementQueue.admitNext()).toBeUndefined();
		await replacementQueue.reconcile(activeAttempt.id, "not-executed");
		const replayedActive = await replacementQueue.admitNext();
		expect(replayedActive?.inputId).toBe(admitted.inputId);
		await replacementQueue.markRunning(admitted.inputId);
		await replacementQueue.complete(admitted.inputId);
		const replayed = await replacementQueue.admitNext();
		expect(replayed?.inputId).toBe(queued.inputId);
		await replacementQueue.markRunning(queued.inputId);
		await replacementQueue.complete(queued.inputId);
		expect(await replacementQueue.admitNext()).toBeUndefined();
		expect(await replacementQueue.replayQueued()).toEqual([]);
	});
	it("holds rate-limited input until its retry time after owner replacement", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const item = await queue.enqueue({ text: "retry after reset", deliveryClass: "followUp" });
		await queue.admitNext();
		const attempt = await queue.markRunning(item.inputId);
		const retryAt = Date.now() + 1000;
		await queue.failRateLimit(item.inputId, attempt.id, retryAt);
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const replacementQueue = await DurableInputQueue.open(nextOwner.handle, root);
		expect(await replacementQueue.adopt()).toEqual([]);
		expect(await replacementQueue.replayQueued()).toEqual([]);
		expect(await replacementQueue.retryDue(retryAt - 1)).toEqual([]);
		expect((await replacementQueue.retryDue(retryAt)).map(entry => entry.inputId)).toEqual([item.inputId]);
		expect((await replacementQueue.replayQueued()).map(entry => entry.inputId)).toEqual([item.inputId]);
	});

	it("blocks later input behind a rate-limited head until retryDue requeues it", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const head = await queue.enqueue({ text: "retry first", deliveryClass: "followUp" });
		const later = await queue.enqueue({ text: "wait behind retry", deliveryClass: "followUp" });
		const admitted = await queue.admitNext();
		const attempt = await queue.markRunning(head.inputId);
		const retryAt = Date.now() + 1000;
		await queue.failRateLimit(head.inputId, attempt.id, retryAt);

		expect(admitted?.inputId).toBe(head.inputId);
		expect(await queue.admitNext("terminal", retryAt - 1)).toBeUndefined();
		expect(await queue.retryDue(retryAt - 1)).toEqual([]);
		expect(await queue.admitNext("terminal", retryAt)).toBeUndefined();
		expect((await queue.retryDue(retryAt)).map(item => item.inputId)).toEqual([head.inputId]);

		const peer = await DurableInputQueue.open(owner.handle, root);
		await peer.adopt();
		const concurrentAdmissions = await Promise.all([queue.admitNext(), peer.admitNext()]);
		const [retried] = concurrentAdmissions.filter(item => item !== undefined);
		expect(concurrentAdmissions.filter(item => item !== undefined)).toHaveLength(1);
		expect(retried?.inputId).toBe(head.inputId);
		const retriedAttempt = await queue.markRunning(head.inputId);
		expect(await peer.admitNext()).toBeUndefined();
		await queue.completeAttempt(head.inputId, retriedAttempt.id);
		expect((await queue.admitNext())?.inputId).toBe(later.inputId);
	});

	it("exposes the next input when a rate-limited head is explicitly cancelled", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const head = await queue.enqueue({ text: "cancel retry", deliveryClass: "followUp" });
		const later = await queue.enqueue({ text: "run next", deliveryClass: "followUp" });
		await queue.admitNext();
		const attempt = await queue.markRunning(head.inputId);
		await queue.failRateLimit(head.inputId, attempt.id, Date.now() + 1000);

		expect(await queue.admitNext()).toBeUndefined();
		expect((await queue.cancel(head.inputId)).state).toBe("cancelled");
		expect((await queue.admitNext())?.inputId).toBe(later.inputId);
	});

	it("reads correct segment sizes across multiple generations", async () => {
		const { root, session, owner: ownerA } = await fixture("epoch-a");
		const queueA = await DurableInputQueue.open(ownerA.handle, root);
		await queueA.adopt();
		const first = await queueA.enqueue({ text: "first", deliveryClass: "followUp" });
		ownerA.current = false;

		const ownerB = replacement(session, "epoch-b");
		const queueB = await DurableInputQueue.open(ownerB.handle, root);
		await queueB.adopt();
		const second = await queueB.enqueue({ text: "second", deliveryClass: "followUp" });
		ownerB.current = false;

		// Simulate a stale write to A's segment after B adopted it
		const queuePath = await queueRoot(root);
		const headValue: unknown = JSON.parse(await fs.readFile(path.join(queuePath, "head.json"), "utf8"));
		if (
			typeof headValue !== "object" ||
			headValue === null ||
			!("predecessor" in headValue) ||
			typeof headValue.predecessor !== "string"
		) {
			throw new Error("Durable queue head predecessor missing");
		}
		const segmentA = path.join(queuePath, "segments", `${headValue.predecessor}.jsonl`);
		await fs.appendFile(
			segmentA,
			`${JSON.stringify({ version: 2, type: "enqueue", id: "stale-1", text: "stale", ownerEpoch: headValue.predecessor })}\n`,
		);

		const ownerC = replacement(session, "epoch-c");
		const queueC = await DurableInputQueue.open(ownerC.handle, root);
		const adoptedC = await queueC.adopt();
		expect(adoptedC.map(item => ({ id: item.inputId, text: "text" in item.payload ? item.payload.text : "" }))).toEqual([
			{ id: first.inputId, text: "first" },
			{ id: second.inputId, text: "second" },
		]);
	});

	it("transitions running items to uncertain on adoption, and allows reconciliation", async () => {
		const { root, session, owner: ownerA } = await fixture("epoch-a");
		const queueA = await DurableInputQueue.open(ownerA.handle, root);
		await queueA.adopt();

		const item1 = await queueA.enqueue({ text: "one", deliveryClass: "followUp" });
		const admitted = await queueA.admitNext();
		expect(admitted?.inputId).toBe(item1.inputId);

		const attemptId = admitted!.attempts[admitted!.attempts.length - 1].id;
		await queueA.markRequestStarted(item1.inputId, attemptId);
		const item2 = await queueA.enqueue({ text: "two", deliveryClass: "followUp" });

		ownerA.current = false;
		const ownerB = replacement(session, "epoch-b");
		const queueB = await DurableInputQueue.open(ownerB.handle, root);

		expect((await queueB.adopt()).map(item => item.inputId)).toEqual([item2.inputId]);
		expect(await queueB.admitNext()).toBeUndefined();

		await queueB.reconcile(attemptId, "not-executed");

		const queued = await queueB.replayQueued();
		expect(queued.map(item => item.inputId)).toEqual([item1.inputId, item2.inputId]);
	});

	it("requeues admitted items with no durable request-start record on adoption", async () => {
		const { root, session, owner: ownerA } = await fixture("epoch-a");
		const queueA = await DurableInputQueue.open(ownerA.handle, root);
		await queueA.adopt();

		const item = await queueA.enqueue({ text: "admitted-item", deliveryClass: "followUp" });
		const admitted = await queueA.admitNext();
		expect(admitted?.inputId).toBe(item.inputId);

		ownerA.current = false;
		const ownerB = replacement(session, "epoch-b");
		const queueB = await DurableInputQueue.open(ownerB.handle, root);

		expect((await queueB.adopt()).map(entry => entry.inputId)).toEqual([item.inputId]);
		expect((await queueB.replayQueued()).map(entry => entry.inputId)).toEqual([item.inputId]);
	});

	it("persists both the generation head and active head before adoption returns", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const queuePath = await queueRoot(root);
		const headText = await fs.readFile(path.join(queuePath, "head.json"), "utf8");
		const head = JSON.parse(headText) as { epoch: string };
		expect(await fs.readFile(path.join(queuePath, "heads", `${head.epoch}.json`), "utf8")).toBe(headText);
	});

	it("fails closed on middle-line corruption", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		await queue.enqueue({ text: "first", deliveryClass: "followUp" });
		await queue.enqueue({ text: "second", deliveryClass: "followUp" });
		owner.current = false;

		const queueRoot = path.join(
			root,
			"owners-v1",
			path.basename(await fs.readdir(path.join(root, "owners-v1")).then(dirs => dirs[0])),
			"queue-v2",
		);
		const headText = await fs.readFile(path.join(queueRoot, "head.json"), "utf8");
		const segmentPath = path.join(queueRoot, "segments", `${JSON.parse(headText).epoch}.jsonl`);

		// Corrupt the first enqueue record but keep the second intact
		const lines = (await fs.readFile(segmentPath, "utf8")).split("\n");
		lines[1] = '{ "version": 2, "type": "enqueue", "corrupt'; // line 0 is adopt, line 1 is first enqueue
		await fs.writeFile(segmentPath, lines.join("\n"));

		const nextOwner = replacement(session, "epoch-b");
		await expect(DurableInputQueue.open(nextOwner.handle, root)).rejects.toThrow(
			"Corrupt durable input queue segment",
		);
	});

	it("tolerates partial final-line records from crashes", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const first = await queue.enqueue({ text: "first", deliveryClass: "followUp" });
		owner.current = false;

		const queueRoot = path.join(
			root,
			"owners-v1",
			path.basename(await fs.readdir(path.join(root, "owners-v1")).then(dirs => dirs[0])),
			"queue-v2",
		);
		const headText = await fs.readFile(path.join(queueRoot, "head.json"), "utf8");
		const segmentPath = path.join(queueRoot, "segments", `${JSON.parse(headText).epoch}.jsonl`);

		// Append a partial tail
		await fs.appendFile(segmentPath, '{ "version": 2, "type": "enqueue", "id": "partial');

		const nextOwner = replacement(session, "epoch-b");
		const currentQueue = await DurableInputQueue.open(nextOwner.handle, root);
		const adopted = await currentQueue.adopt();

		expect(adopted.map(item => ({ id: item.inputId, text: "text" in item.payload ? item.payload.text : "" }))).toEqual([
			{ id: first.inputId, text: "first" },
		]);
	});
	it("synthesizes immutable defaults for legacy v2 enqueue records", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const { activeEpoch } = await queue.getStatus();
		const rootPath = await queueRoot(root);
		await fs.appendFile(
			path.join(rootPath, "segments", `${activeEpoch}.jsonl`),
			`${JSON.stringify({ version: 2, type: "enqueue", id: "legacy-a", text: "first", ownerEpoch: activeEpoch })}\n${JSON.stringify({ version: 2, type: "enqueue", id: "legacy-b", text: "second", ownerEpoch: activeEpoch })}\n`,
		);

		expect(await queue.replayQueued()).toMatchObject([
			{
				inputId: "legacy-a",
				sequence: 1,
				deliveryClass: "followUp",
				revision: 1,
				payload: { text: "first" },
			},
			{
				inputId: "legacy-b",
				sequence: 2,
				deliveryClass: "followUp",
				revision: 1,
				payload: { text: "second" },
			},
		]);
	});

	it("replays mixed legacy and revisioned records across predecessor segments in sequence order", async () => {
		const { root, session, owner: ownerA } = await fixture("epoch-a");
		const queueA = await DurableInputQueue.open(ownerA.handle, root);
		await queueA.adopt();
		const rootPath = await queueRoot(root);
		const { activeEpoch: epochA } = await queueA.getStatus();
		await fs.appendFile(
			path.join(rootPath, "segments", `${epochA}.jsonl`),
			`${JSON.stringify({ version: 2, type: "enqueue", id: "legacy-a", text: "legacy", ownerEpoch: epochA })}\n`,
		);
		ownerA.current = false;

		const ownerB = replacement(session, "epoch-b");
		const queueB = await DurableInputQueue.open(ownerB.handle, root);
		await queueB.adopt();
		const { activeEpoch: epochB } = await queueB.getStatus();
		await fs.appendFile(
			path.join(rootPath, "segments", `${epochB}.jsonl`),
			`${JSON.stringify({ version: 2, type: "enqueue", id: "modern-b", text: "modern", sequence: 2, deliveryClass: "steer", revision: 1, ownerEpoch: epochB })}\n`,
		);

		expect((await queueB.replayQueued()).map(item => [item.inputId, item.sequence, item.deliveryClass])).toEqual([
			["legacy-a", 1, "followUp"],
			["modern-b", 2, "steer"],
		]);
	});

	it("replays queued full-payload revisions without changing immutable delivery identity", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const item = await queue.enqueue({ text: "original", deliveryClass: "followUp" });
		const rootPath = await queueRoot(root);
		const { activeEpoch } = await queue.getStatus();
		await fs.appendFile(
			path.join(rootPath, "segments", `${activeEpoch}.jsonl`),
			`${JSON.stringify({
				version: 2,
				type: "revision",
				inputId: item.inputId,
				revision: 2,
				payload: { text: "revised" },
				ownerEpoch: activeEpoch,
			})}\n`,
		);

		expect(await queue.replayQueued()).toMatchObject([
			{
				inputId: item.inputId,
				sequence: item.sequence,
				deliveryClass: item.deliveryClass,
				revision: 2,
				payload: { text: "revised" },
			},
		]);
	});

	it("fails closed for malformed new sequences and revision gaps", async () => {
		const sequenceFixture = await fixture("epoch-a");
		const sequenceQueue = await DurableInputQueue.open(sequenceFixture.owner.handle, sequenceFixture.root);
		await sequenceQueue.adopt();
		const sequenceRoot = await queueRoot(sequenceFixture.root);
		const { activeEpoch: sequenceEpoch } = await sequenceQueue.getStatus();
		await fs.appendFile(
			path.join(sequenceRoot, "segments", `${sequenceEpoch}.jsonl`),
			`${JSON.stringify({ version: 2, type: "enqueue", id: "bad-sequence", text: "bad", sequence: 0, deliveryClass: "steer", revision: 1, ownerEpoch: sequenceEpoch })}\n`,
		);
		await expect(sequenceQueue.replayQueued()).rejects.toThrow("Corrupt durable input queue segment");

		const revisionFixture = await fixture("epoch-b");
		const revisionQueue = await DurableInputQueue.open(revisionFixture.owner.handle, revisionFixture.root);
		await revisionQueue.adopt();
		const item = await revisionQueue.enqueue({ text: "original", deliveryClass: "followUp" });
		const revisionRoot = await queueRoot(revisionFixture.root);
		const { activeEpoch: revisionEpoch } = await revisionQueue.getStatus();
		await fs.appendFile(
			path.join(revisionRoot, "segments", `${revisionEpoch}.jsonl`),
			`${JSON.stringify({
				version: 2,
				type: "revision",
				inputId: item.inputId,
				revision: 3,
				payload: { text: "skipped revision" },
				ownerEpoch: revisionEpoch,
			})}\n`,
		);
		await expect(revisionQueue.replayQueued()).rejects.toThrow("Invalid durable input queue revision");
	});
	it("shares a same-owner head across queue instances without self-fencing", async () => {
		const { root, owner } = await fixture("epoch-a");
		const first = await DurableInputQueue.open(owner.handle, root);
		const second = await DurableInputQueue.open(owner.handle, root);
		await Promise.all([first.adopt(), second.adopt()]);

		const firstInput = await first.enqueue({ text: "first", deliveryClass: "followUp" });
		const secondInput = await second.enqueue({ text: "second", deliveryClass: "followUp" });
		expect((await first.replayQueued()).map(item => item.inputId)).toEqual([firstInput.inputId, secondInput.inputId]);
		expect((await second.replayQueued()).map(item => item.inputId)).toEqual([
			firstInput.inputId,
			secondInput.inputId,
		]);
	});

	it("publishes one successor when concurrent same-owner adopters migrate a legacy head", async () => {
		const { root, owner } = await fixture("epoch-a");
		const initial = await DurableInputQueue.open(owner.handle, root);
		await initial.enqueue({ text: "legacy", deliveryClass: "followUp" });
		const rootPath = await queueRoot(root);
		const headPath = path.join(rootPath, "head.json");
		const legacyHead = JSON.parse(await fs.readFile(headPath, "utf8")) as Record<string, string | number>;
		const legacyEpoch = legacyHead.epoch;
		if (typeof legacyEpoch !== "string") throw new Error("Legacy queue head is missing its epoch");
		delete legacyHead.ownershipEpoch;
		await fs.writeFile(headPath, JSON.stringify(legacyHead));
		await fs.writeFile(path.join(rootPath, "heads", `${legacyEpoch}.json`), JSON.stringify(legacyHead));

		const first = await DurableInputQueue.open(owner.handle, root);
		const second = await DurableInputQueue.open(owner.handle, root);
		const [firstAdopted, secondAdopted] = await Promise.all([first.adopt(), second.adopt()]);
		const head = JSON.parse(await fs.readFile(headPath, "utf8")) as {
			epoch: string;
			ownershipEpoch?: string;
			predecessor?: string;
		};

		expect(head.ownershipEpoch).toBe(owner.handle.ownerEpoch);
		expect(head.predecessor).toBe(legacyEpoch);
		expect(new Set([...firstAdopted, ...secondAdopted].map(item => item.inputId)).size).toBe(1);
		expect((await fs.readdir(path.join(rootPath, "heads"))).length).toBe(2);
	});
	it("keeps a PID-fallback writer lock live when ps later has a fingerprint", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		const rootPath = await queueRoot(root);
		const writerLock = path.join(rootPath, "writer.lock");
		await fs.mkdir(writerLock);
		await fs.writeFile(
			path.join(writerLock, "owner.json"),
			JSON.stringify({
				version: 1,
				token: "pid-fallback-live",
				pid: process.pid,
				identity: { kind: "pid" },
				ownerEpoch: owner.handle.ownerEpoch,
				createdAt: 0,
			}),
		);
		const old = new Date(Date.now() - 31_000);
		await fs.utimes(writerLock, old, old);

		const pending = queue.enqueue({ text: "wait for live fallback lock", deliveryClass: "followUp" });
		await Bun.sleep(50);
		expect((await fs.readdir(rootPath)).some(entry => entry.startsWith("writer.lock.reclaim-"))).toBe(false);
		await fs.rm(writerLock, { recursive: true });
		await expect(pending).resolves.toMatchObject({ payload: { text: "wait for live fallback lock" } });
	});
	it("allocates unique contiguous sequences across concurrent same-owner queue instances", async () => {
		const { root, owner } = await fixture("epoch-a");
		const first = await DurableInputQueue.open(owner.handle, root);
		const second = await DurableInputQueue.open(owner.handle, root);
		await Promise.all([first.adopt(), second.adopt()]);

		const [one, two] = await Promise.all([
			first.enqueue({ text: "one", deliveryClass: "followUp" }),
			second.enqueue({ text: "two", deliveryClass: "steer" }),
		]);

		expect([one.sequence, two.sequence].sort((a, b) => a - b)).toEqual([1, 2]);
		expect(await first.sequenceBoundary()).toBe(2);
		expect((await second.list()).map(item => item.sequence)).toEqual([1, 2]);
	});

	it("admits a lone steer at the terminal boundary", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();

		const steer = await queue.enqueue({ text: "steer", deliveryClass: "steer" });
		expect((await queue.admitNext("terminal"))?.inputId).toBe(steer.inputId);
	});

	it("does not let a later steer overtake the queued follow-up at a tool boundary", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();

		const followUp = await queue.enqueue({ text: "follow-up", deliveryClass: "followUp" });
		const steer = await queue.enqueue({ text: "steer", deliveryClass: "steer" });
		expect(await queue.admitNext("tool")).toBeUndefined();

		const first = await queue.admitNext("terminal");
		expect(first?.inputId).toBe(followUp.inputId);
		const followUpAttempt = await queue.markRunning(followUp.inputId);
		await queue.completeAttempt(followUp.inputId, followUpAttempt.id);
		expect((await queue.admitNext("terminal"))?.inputId).toBe(steer.inputId);
	});

	it("allows a tool-boundary steer after the earlier queued input is cancelled", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();

		const followUp = await queue.enqueue({ text: "cancelled follow-up", deliveryClass: "followUp" });
		const steer = await queue.enqueue({ text: "steer", deliveryClass: "steer" });
		await queue.cancel(followUp.inputId);
		expect((await queue.admitNext("tool"))?.inputId).toBe(steer.inputId);
	});

	it("admits mixed input in global sequence order at the terminal boundary", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();

		const steer = await queue.enqueue({ text: "steer", deliveryClass: "steer" });
		const followUp = await queue.enqueue({ text: "follow-up", deliveryClass: "followUp" });
		const first = await queue.admitNext("terminal");
		expect(first?.inputId).toBe(steer.inputId);
		const attempt = await queue.markRunning(steer.inputId);
		await queue.completeAttempt(steer.inputId, attempt.id);
		expect((await queue.admitNext("terminal"))?.inputId).toBe(followUp.inputId);
	});

	it("edits queued input with compare-and-swap revisions only", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();

		const input = await queue.enqueue({ text: "original", deliveryClass: "followUp" });
		await queue.edit(input.inputId, 1, { text: "revised", images: undefined });
		await expect(queue.edit(input.inputId, 1, { text: "stale", images: undefined })).rejects.toThrow();
		expect(await queue.get(input.inputId)).toMatchObject({
			inputId: input.inputId,
			revision: 2,
			payload: { text: "revised" },
		});

		await queue.admitNext("terminal");
		await expect(queue.edit(input.inputId, 2, { text: "too late", images: undefined })).rejects.toThrow();
	});

	it("allows cancellation before request start but rejects it afterward", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();

		const admitted = await queue.enqueue({ text: "cancel before start", deliveryClass: "followUp" });
		await queue.admitNext("terminal");
		await expect(queue.cancel(admitted.inputId)).resolves.toMatchObject({
			inputId: admitted.inputId,
			state: "cancelled",
		});

		const running = await queue.enqueue({ text: "cannot cancel after start", deliveryClass: "followUp" });
		const attempt = await queue.admitNext("terminal");
		if (!attempt) throw new Error("Expected queued input to be admitted");
		await queue.markRequestStarted(running.inputId, attempt.attempts.at(-1)!.id);
		await expect(queue.cancel(running.inputId)).rejects.toThrow();
	});

	it("preserves the full queued input identity and latest payload across adoption", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const firstQueue = await DurableInputQueue.open(owner.handle, root);
		await firstQueue.adopt();
		const input = await firstQueue.enqueue({ text: "original", deliveryClass: "steer" });
		await firstQueue.edit(input.inputId, input.revision, { text: "revised", images: undefined });
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const replacementQueue = await DurableInputQueue.open(nextOwner.handle, root);
		expect(
			(await replacementQueue.adopt()).map(item => ({
				inputId: item.inputId,
				sequence: item.sequence,
				deliveryClass: item.deliveryClass,
				revision: item.revision,
				payload: item.payload,
			})),
		).toEqual([
			{
				inputId: input.inputId,
				sequence: input.sequence,
				deliveryClass: "steer",
				revision: 2,
				payload: { text: "revised", images: undefined },
			},
		]);
	});
	it("keeps ordinary enqueue outside the runner command ledger", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const item = await queue.enqueue({ text: "legacy path", deliveryClass: "followUp" });

		expect(await queue.getLatestRunnerRevision()).toBe(0);
		expect(await queue.getCommandReceipt(item.inputId)).toBeUndefined();
		const rootPath = await queueRoot(root);
		const { activeEpoch } = await queue.getStatus();
		const enqueueRecord = (await fs.readFile(path.join(rootPath, "segments", `${activeEpoch}.jsonl`), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as Record<string, unknown>)
			.find(record => record.type === "enqueue");
		expect(enqueueRecord).not.toHaveProperty("command");
		expect(enqueueRecord).not.toHaveProperty("runnerRevision");
	});

	it("atomically replays concurrent duplicate commands from one journal admission", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const metadata = command("duplicate", 0, { causationId: "cause-a" });
		const input = { text: "same", deliveryClass: "followUp" as const };

		const receipts = await Promise.all([queue.enqueueCommand(input, metadata), queue.enqueueCommand(input, metadata)]);

		expect(receipts.map(receipt => receipt.replayed).sort()).toEqual([false, true]);
		expect(receipts[0]?.item.inputId).toBe(receipts[1]?.item.inputId);
		expect(receipts[0]?.runnerRevision).toBe(1);
		expect(receipts[1]?.runnerRevision).toBe(1);
		expect(await queue.getLatestRunnerRevision()).toBe(1);
		const rootPath = await queueRoot(root);
		const { activeEpoch } = await queue.getStatus();
		const records = (await fs.readFile(path.join(rootPath, "segments", `${activeEpoch}.jsonl`), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as { type: string });
		expect(records.filter(record => record.type === "enqueue")).toHaveLength(1);
	});

	it("rejects changed command reuse and stale or concurrently lost runner revisions with typed errors", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		await queue.enqueueCommand({ text: "first", deliveryClass: "followUp" }, command("first", 0));

		const changedPayload = queue.enqueueCommand(
			{ text: "changed", deliveryClass: "followUp" },
			command("first", 0),
		);
		await expect(changedPayload).rejects.toBeInstanceOf(DurableInputCommandConflictError);
		const changedMetadata = queue.enqueueCommand(
			{ text: "first", deliveryClass: "followUp" },
			command("first", 0, { correlationId: "changed-correlation" }),
		);
		await expect(changedMetadata).rejects.toBeInstanceOf(DurableInputCommandConflictError);

		const stale = queue.enqueueCommand({ text: "stale", deliveryClass: "followUp" }, command("stale", 0));
		await expect(stale).rejects.toMatchObject({
			name: "DurableInputRunnerRevisionConflictError",
			expectedRevision: 0,
			actualRevision: 1,
		});

		const outcomes = await Promise.allSettled([
			queue.enqueueCommand({ text: "winner-a", deliveryClass: "steer" }, command("winner-a", 1)),
			queue.enqueueCommand({ text: "winner-b", deliveryClass: "steer" }, command("winner-b", 1)),
		]);
		expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
		const rejection = outcomes.find(outcome => outcome.status === "rejected") as PromiseRejectedResult;
		expect(rejection.reason).toBeInstanceOf(DurableInputRunnerRevisionConflictError);
		expect(rejection.reason).toMatchObject({ expectedRevision: 1, actualRevision: 2 });
		expect(await queue.getLatestRunnerRevision()).toBe(2);
	});

	it("rebuilds command receipts and latest runner revision after replacement adoption", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const original = await queue.enqueueCommand(
			{ text: "persisted", deliveryClass: "steer" },
			command("persisted", 0),
		);
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const reopened = await DurableInputQueue.open(nextOwner.handle, root);
		await reopened.adopt();
		expect(await reopened.getLatestRunnerRevision()).toBe(1);
		expect(await reopened.getCommandReceipt("persisted")).toEqual(original);
		const replay = await reopened.enqueueCommand(
			{ text: "persisted", deliveryClass: "steer" },
			command("persisted", 0),
		);
		expect(replay).toEqual({ ...original, replayed: true });
	});

	it("publishes post-commit events despite listener failure and permits listener reentrancy", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const seen: string[] = [];
		let reentrant: Promise<unknown> | undefined;
		queue.subscribe(event => {
			if (event.command.commandId === "outer") {
				reentrant = queue.enqueueCommand(
					{ text: "inner", deliveryClass: "followUp" },
					command("inner", 1),
				);
			}
			throw new Error("listener failure");
		});
		queue.subscribe(event => {
			seen.push(event.command.commandId);
		});

		const outer = await queue.enqueueCommand(
			{ text: "outer", deliveryClass: "followUp" },
			command("outer", 0),
		);
		expect(outer.replayed).toBe(false);
		await reentrant;
		expect(seen).toEqual(["outer", "inner"]);
		expect(await queue.getLatestRunnerRevision()).toBe(2);
		expect((await queue.list()).map(item => ("text" in item.payload ? item.payload.text : ""))).toEqual(["outer", "inner"]);
	});

	it("atomically edits and cancels through the command ledger with durable replay and CAS", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const first = await queue.enqueueCommand(
			{ text: "original", deliveryClass: "followUp" },
			command("enqueue-target", 0),
		);
		const editMetadata = command("edit-target", 1);
		const edited = await queue.editCommand(
			first.item.inputId,
			first.item.revision,
			{ text: "edited", images: undefined },
			editMetadata,
		);
		const replay = await queue.editCommand(
			first.item.inputId,
			first.item.revision,
			{ images: undefined, text: "edited" },
			editMetadata,
		);
		expect(replay).toEqual({ ...edited, replayed: true });
		await expect(
			queue.editCommand(
				first.item.inputId,
				first.item.revision,
				{ text: "changed", images: undefined },
				editMetadata,
			),
		).rejects.toBeInstanceOf(DurableInputCommandConflictError);
		await expect(
			queue.editCommand(
				first.item.inputId,
				edited.item.revision,
				{ text: "stale runner", images: undefined },
				command("stale-runner-edit", 1),
			),
		).rejects.toBeInstanceOf(DurableInputRunnerRevisionConflictError);
		await expect(
			queue.editCommand(
				first.item.inputId,
				first.item.revision,
				{ text: "stale item", images: undefined },
				command("stale-item-edit", 2),
			),
		).rejects.toBeInstanceOf(DurableInputItemRevisionConflictError);

		const cancelMetadata = command("cancel-target", 2);
		const cancelled = await queue.cancelCommand(first.item.inputId, edited.item.revision, cancelMetadata);
		expect(cancelled).toMatchObject({
			runnerRevision: 3,
			replayed: false,
			item: { revision: 2, state: "cancelled", payload: { text: "edited" } },
		});
		expect(await queue.cancelCommand(first.item.inputId, edited.item.revision, cancelMetadata)).toEqual({
			...cancelled,
			replayed: true,
		});

		const rootPath = await queueRoot(root);
		const { activeEpoch } = await queue.getStatus();
		const records = (await fs.readFile(path.join(rootPath, "segments", `${activeEpoch}.jsonl`), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as Record<string, unknown>);
		expect(records.filter(record => record.command && record.type === "revision")).toHaveLength(1);
		expect(records.filter(record => record.command && record.type === "state")).toHaveLength(1);

		owner.current = false;
		const nextOwner = replacement(session, "epoch-b");
		const reopened = await DurableInputQueue.open(nextOwner.handle, root);
		await reopened.adopt();
		expect(await reopened.getLatestRunnerRevision()).toBe(3);
		expect(await reopened.getCommandReceipt("edit-target")).toEqual(edited);
		expect(await reopened.getCommandReceipt("cancel-target")).toEqual(cancelled);
	});

	it("lets only one same-runner-revision mutation win and keeps legacy mutations outside the ledger", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const left = await queue.enqueue({ text: "left", deliveryClass: "followUp" });
		const right = await queue.enqueue({ text: "right", deliveryClass: "followUp" });
		const outcomes = await Promise.allSettled([
			queue.editCommand(left.inputId, left.revision, { text: "winner", images: undefined }, command("edit", 0)),
			queue.cancelCommand(right.inputId, right.revision, command("cancel", 0)),
		]);
		expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
		expect(outcomes.find(outcome => outcome.status === "rejected")).toMatchObject({
			reason: { name: "DurableInputRunnerRevisionConflictError", expectedRevision: 0, actualRevision: 1 },
		});

		const revisionBeforeLegacy = await queue.getLatestRunnerRevision();
		const legacy = await queue.enqueue({ text: "legacy", deliveryClass: "followUp" });
		const legacyEdited = await queue.edit(legacy.inputId, legacy.revision, { text: "legacy edit", images: undefined });
		await queue.cancel(legacyEdited.inputId);
		expect(await queue.getLatestRunnerRevision()).toBe(revisionBeforeLegacy);
	});

	it("publishes edit and cancel events only after durable commit and tolerates reentrant failing listeners", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const input = await queue.enqueue({ text: "original", deliveryClass: "followUp" });
		const seen: string[] = [];
		let reentrant: Promise<unknown> | undefined;
		queue.subscribe(event => {
			seen.push(event.kind);
			if (event.kind === "inputEdited") {
				reentrant = queue.cancelCommand(event.item.inputId, event.item.revision, command("cancel-event", 1));
			}
			throw new Error("listener failure");
		});
		await queue.editCommand(
			input.inputId,
			input.revision,
			{ text: "edited", images: undefined },
			command("edit-event", 0),
		);
		await reentrant;
		expect(seen).toEqual(["inputEdited", "inputCancelled"]);
		expect(await queue.getLatestRunnerRevision()).toBe(2);
	});

	it("round-trips custom payloads in global order across reopen while preserving legacy records", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const legacy = await queue.enqueue({ text: "legacy", deliveryClass: "followUp" });
		const custom: DurableCustomPayload = {
			kind: "custom",
			message: {
				customType: "notice",
				content: [
					{ type: "text", text: "hello" },
					{ type: "image", data: "base64", mimeType: "image/png" },
				],
				display: true,
				details: { z: [1, null, true], a: { nested: "value" } },
				attribution: "agent",
			},
			deliverAs: "nextTurn",
			triggerTurn: true,
			disposition: "provider",
		};
		const accepted = await queue.enqueue(custom);
		expect(accepted).toMatchObject({ sequence: legacy.sequence + 1, deliveryClass: "followUp", payload: custom });

		owner.current = false;
		const nextOwner = replacement(session, "epoch-b");
		const reopened = await DurableInputQueue.open(nextOwner.handle, root);
		await reopened.adopt();
		expect((await reopened.replayQueued()).map(item => item.payload)).toEqual([
			{ text: "legacy", images: undefined },
			custom,
		]);
	});

	it("strictly decodes and clones recursive JSON without key-order-sensitive equality", () => {
		const original = { b: [{ x: 1 }, null], a: "value" } as const;
		const clone = cloneJsonValue(original);
		expect(clone).toEqual(original);
		expect(clone).not.toBe(original);
		expect(jsonValuesEqual(original, { a: "value", b: [{ x: 1 }, null] })).toBe(true);
		expect(decodeJsonValue(Number.NaN)).toBeUndefined();
		expect(decodeJsonValue(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(decodeJsonValue({ missing: undefined })).toBeUndefined();
		expect(decodeJsonValue(new (class Value {
			value = 1;
		})())).toBeUndefined();
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(decodeJsonValue(cycle)).toBeUndefined();
		expect(
			decodeDurableCustomPayload({
				kind: "custom",
				message: {
					customType: "invalid",
					content: "x",
					display: false,
					attribution: "agent",
					details: cycle,
				},
				deliverAs: "steer",
				triggerTurn: false,
				disposition: "provider",
			}),
		).toBeUndefined();
	});

	it("rejects invalid JSON before enqueue and detects full custom command replay conflicts", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const payload: DurableCustomPayload = {
			kind: "custom",
			message: {
				customType: "notice",
				content: "hello",
				display: false,
				details: { count: 1 },
				attribution: "agent",
			},
			deliverAs: "steer",
			triggerTurn: false,
			disposition: "provider",
		};
		const metadata = command("custom", 0);
		const first = await queue.enqueueCommand(payload, metadata);
		expect(await queue.enqueueCommand(payload, metadata)).toEqual({ ...first, replayed: true });
		await expect(
			queue.enqueueCommand({ ...payload, triggerTurn: true }, metadata),
		).rejects.toBeInstanceOf(DurableInputCommandConflictError);
		expect(await queue.getLatestRunnerRevision()).toBe(1);
		await expect(
			queue.enqueue({
				...payload,
				message: { ...payload.message, details: { invalid: Number.NaN } },
			}),
		).rejects.toThrow("Invalid durable input queue enqueue payload");
		expect(await queue.getLatestRunnerRevision()).toBe(1);
	});

	it("completes append-only custom input idempotently without provider attempt records", async () => {
		const { root, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const appended = await queue.enqueue({
			kind: "custom",
			message: {
				customType: "idle",
				content: "persist only",
				display: true,
				attribution: "user",
			},
			deliverAs: "followUp",
			triggerTurn: false,
			disposition: "append",
		});
		const events: string[] = [];
		queue.subscribeTransitions(event => events.push(`${event.kind}:${event.item.state}`));
		expect(await queue.admitNext()).toBeUndefined();
		expect(await queue.completeAppendOnly(appended.inputId, appended.revision)).toMatchObject({
			state: "completed",
			attempts: [],
		});
		expect(await queue.completeAppendOnly(appended.inputId, appended.revision)).toMatchObject({
			state: "completed",
			attempts: [],
		});
		expect(events).toEqual(["inputCompleted:completed"]);
		const rootPath = await queueRoot(root);
		const { activeEpoch } = await queue.getStatus();
		const records = (await fs.readFile(path.join(rootPath, "segments", `${activeEpoch}.jsonl`), "utf8"))
			.trim()
			.split("\n")
			.map(line => JSON.parse(line) as { type: string });
		expect(records.map(record => record.type)).toEqual(["enqueue", "state"]);
		await expect(queue.edit(appended.inputId, appended.revision, { text: "no", images: undefined })).rejects.toThrow();
	});
	it("releases a deferred next-turn custom prefix only for a later provider-bound item", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		let queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const deferred = await queue.enqueue({
			kind: "custom",
			message: {
				customType: "context",
				content: "before user",
				display: false,
				attribution: "agent",
			},
			deliverAs: "nextTurn",
			triggerTurn: false,
			disposition: "provider",
		});
		expect(await queue.deferredCustomPrefix()).toBeUndefined();
		expect(await queue.admitNext()).toBeUndefined();
		const user = await queue.enqueue({ text: "continue", deliveryClass: "followUp" });
		owner.current = false;
		const nextOwner = replacement(session, "epoch-b");
		queue = await DurableInputQueue.open(nextOwner.handle, root);
		await queue.adopt();
		expect(await queue.deferredCustomPrefix()).toMatchObject({
			inputId: deferred.inputId,
			sequence: 1,
			attempts: [],
		});
		await queue.completeDeferredCustomPrefix(deferred.inputId, deferred.revision);
		const admitted = await queue.admitNext();
		expect(admitted).toMatchObject({ inputId: user.inputId, sequence: 2 });
		expect((await queue.list()).map(item => ({ sequence: item.sequence, state: item.state, attempts: item.attempts.length }))).toEqual([
			{ sequence: 1, state: "completed", attempts: 0 },
			{ sequence: 2, state: "admitted", attempts: 1 },
		]);
	});

});
