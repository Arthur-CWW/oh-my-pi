import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
	DurableInputQueue,
	SessionOwnershipLostError,
} from "@oh-my-pi/pi-coding-agent/session/durable-input-queue";
import type { SessionOwnershipHandle } from "@oh-my-pi/pi-coding-agent/session/session-ownership";

const roots: string[] = [];

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
			isCurrent: async () => owner.current,
			release: async () => {
				owner.current = false;
			},
		},
	};
	return owner;
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

	it("adopts queued editor input after restart with stable IDs and order", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const firstQueue = await DurableInputQueue.open(owner.handle, root);
		await firstQueue.adopt();
		const first = await firstQueue.enqueue("first");
		const second = await firstQueue.enqueue("second");
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const replacementQueue = await DurableInputQueue.open(nextOwner.handle, root);
		const adopted = await replacementQueue.adopt();
		expect(adopted.map(item => ({ id: item.id, text: item.text, state: item.state }))).toEqual([
			{ id: first.id, text: "first", state: "queued" },
			{ id: second.id, text: "second", state: "queued" },
		]);
		expect(await replacementQueue.adopt()).toEqual([]);
	});

	it("refuses stale writers after a replacement takes the lease", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const staleQueue = await DurableInputQueue.open(owner.handle, root);
		await staleQueue.adopt();
		const item = await staleQueue.enqueue("keep this");
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const currentQueue = await DurableInputQueue.open(nextOwner.handle, root);
		await currentQueue.adopt();
		await expect(staleQueue.complete(item.id)).rejects.toBeInstanceOf(SessionOwnershipLostError);
		expect((await currentQueue.replayQueued()).map(entry => entry.id)).toEqual([item.id]);
	});

	it("serializes a stale append against replacement adoption", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const staleQueue = await DurableInputQueue.open(owner.handle, root);
		await staleQueue.adopt();
		const queuePath = await queueRoot(root);
		const writerLock = path.join(queuePath, "writer.lock");
		await fs.mkdir(writerLock);
		await fs.writeFile(path.join(writerLock, "owner.json"), "{}");

		const staleAppend = staleQueue.enqueue("must not disappear").then(
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
		const admitted = await queue.enqueue("active");
		const queued = await queue.enqueue("later");
		expect((await queue.admitNext())?.id).toBe(admitted.id);
		const activeAttempt = await queue.markRunning(admitted.id);
		expect(await queue.admitNext()).toBeUndefined();
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const replacementQueue = await DurableInputQueue.open(nextOwner.handle, root);
		expect((await replacementQueue.adopt()).map(item => item.id)).toEqual([queued.id]);
		expect((await replacementQueue.replayQueued()).map(item => item.id)).toEqual([queued.id]);
		expect(await replacementQueue.admitNext()).toBeUndefined();
		await replacementQueue.reconcile(activeAttempt.id, "not-executed");
		const replayedActive = await replacementQueue.admitNext();
		expect(replayedActive?.id).toBe(admitted.id);
		await replacementQueue.markRunning(admitted.id);
		await replacementQueue.complete(admitted.id);
		const replayed = await replacementQueue.admitNext();
		expect(replayed?.id).toBe(queued.id);
		await replacementQueue.markRunning(queued.id);
		await replacementQueue.complete(queued.id);
		expect(await replacementQueue.admitNext()).toBeUndefined();
		expect(await replacementQueue.replayQueued()).toEqual([]);
	});
	it("holds rate-limited input until its retry time after owner replacement", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const item = await queue.enqueue("retry after reset");
		await queue.admitNext();
		const attempt = await queue.markRunning(item.id);
		const retryAt = Date.now() + 1000;
		await queue.failRateLimit(item.id, attempt.id, retryAt);
		owner.current = false;

		const nextOwner = replacement(session, "epoch-b");
		const replacementQueue = await DurableInputQueue.open(nextOwner.handle, root);
		expect(await replacementQueue.adopt()).toEqual([]);
		expect(await replacementQueue.replayQueued()).toEqual([]);
		expect(await replacementQueue.retryDue(retryAt - 1)).toEqual([]);
		expect((await replacementQueue.retryDue(retryAt)).map(entry => entry.id)).toEqual([item.id]);
		expect((await replacementQueue.replayQueued()).map(entry => entry.id)).toEqual([item.id]);
	});

	it("reads correct segment sizes across multiple generations", async () => {
		const { root, session, owner: ownerA } = await fixture("epoch-a");
		const queueA = await DurableInputQueue.open(ownerA.handle, root);
		await queueA.adopt();
		const first = await queueA.enqueue("first");
		ownerA.current = false;

		const ownerB = replacement(session, "epoch-b");
		const queueB = await DurableInputQueue.open(ownerB.handle, root);
		await queueB.adopt();
		const second = await queueB.enqueue("second");
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
		expect(adoptedC.map(item => ({ id: item.id, text: item.text }))).toEqual([
			{ id: first.id, text: "first" },
			{ id: second.id, text: "second" },
		]);
	});

	it("transitions running items to uncertain on adoption, and allows reconciliation", async () => {
		const { root, session, owner: ownerA } = await fixture("epoch-a");
		const queueA = await DurableInputQueue.open(ownerA.handle, root);
		await queueA.adopt();

		const item1 = await queueA.enqueue("one");
		const admitted = await queueA.admitNext();
		expect(admitted?.id).toBe(item1.id);

		const attemptId = admitted!.attempts[admitted!.attempts.length - 1].id;
		await queueA.markRequestStarted(item1.id, attemptId);
		const item2 = await queueA.enqueue("two");

		ownerA.current = false;
		const ownerB = replacement(session, "epoch-b");
		const queueB = await DurableInputQueue.open(ownerB.handle, root);

		expect((await queueB.adopt()).map(item => item.id)).toEqual([item2.id]);
		expect(await queueB.admitNext()).toBeUndefined();

		await queueB.reconcile(attemptId, "not-executed");

		const queued = await queueB.replayQueued();
		expect(queued.map(item => item.id)).toEqual([item1.id, item2.id]);
	});

	it("requeues admitted items with no durable request-start record on adoption", async () => {
		const { root, session, owner: ownerA } = await fixture("epoch-a");
		const queueA = await DurableInputQueue.open(ownerA.handle, root);
		await queueA.adopt();

		const item = await queueA.enqueue("admitted-item");
		const admitted = await queueA.admitNext();
		expect(admitted?.id).toBe(item.id);

		ownerA.current = false;
		const ownerB = replacement(session, "epoch-b");
		const queueB = await DurableInputQueue.open(ownerB.handle, root);

		expect((await queueB.adopt()).map(entry => entry.id)).toEqual([item.id]);
		expect((await queueB.replayQueued()).map(entry => entry.id)).toEqual([item.id]);
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
		await queue.enqueue("first");
		await queue.enqueue("second");
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
		const currentQueue = await DurableInputQueue.open(nextOwner.handle, root);
		await expect(currentQueue.adopt()).rejects.toThrow("Corrupt durable input queue segment");
	});

	it("tolerates partial final-line records from crashes", async () => {
		const { root, session, owner } = await fixture("epoch-a");
		const queue = await DurableInputQueue.open(owner.handle, root);
		await queue.adopt();
		const first = await queue.enqueue("first");
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

		expect(adopted.map(item => ({ id: item.id, text: item.text }))).toEqual([{ id: first.id, text: "first" }]);
	});
	it("shares a same-owner head across queue instances without self-fencing", async () => {
		const { root, owner } = await fixture("epoch-a");
		const first = await DurableInputQueue.open(owner.handle, root);
		const second = await DurableInputQueue.open(owner.handle, root);
		await Promise.all([first.adopt(), second.adopt()]);

		const firstInput = await first.enqueue("first");
		const secondInput = await second.enqueue("second");
		expect((await first.replayQueued()).map(item => item.id)).toEqual([firstInput.id, secondInput.id]);
		expect((await second.replayQueued()).map(item => item.id)).toEqual([firstInput.id, secondInput.id]);
	});

	it("publishes one successor when concurrent same-owner adopters migrate a legacy head", async () => {
		const { root, owner } = await fixture("epoch-a");
		const initial = await DurableInputQueue.open(owner.handle, root);
		await initial.enqueue("legacy");
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
		expect(new Set([...firstAdopted, ...secondAdopted].map(item => item.id)).size).toBe(1);
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

		const pending = queue.enqueue("wait for live fallback lock");
		await Bun.sleep(50);
		expect((await fs.readdir(rootPath)).some(entry => entry.startsWith("writer.lock.reclaim-"))).toBe(false);
		await fs.rm(writerLock, { recursive: true });
		await expect(pending).resolves.toMatchObject({ text: "wait for live fallback lock" });
	});
});
