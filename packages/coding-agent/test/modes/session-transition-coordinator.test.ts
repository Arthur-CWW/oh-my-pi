import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { type InteractiveHostIntent, transitionLineage } from "../../src/modes/interactive-host-intent";
import {
	type ActiveInteractiveHost,
	SessionTransitionCoordinator,
	type SessionTransitionDependencies,
} from "../../src/modes/session-transition-coordinator";
import { acquireSessionOwnership, ExternalSessionOwner } from "../../src/session/session-ownership";

interface FakeSession {
	id: string;
}
type FakeHost = ActiveInteractiveHost<string, FakeSession>;
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))));

function harness(options: { prepareError?: Error; stopError?: Error; createError?: Error } = {}) {
	const events: string[] = [];
	let stopped = false;
	let cleaned = false;
	let next = 1;
	const makeHost = (epoch: number, id: string): FakeHost => ({
		epoch,
		runner: `runner-${id}`,
		session: { id },
		buildIdentity: "build",
		stop: async () => {
			events.push(`stop:${id}`);
			if (options.stopError) throw options.stopError;
			stopped = true;
		},
	});
	const dependencies: SessionTransitionDependencies<string, FakeSession, string, string> = {
		prepare: async intent => {
			events.push(`prepare:${intent.kind}`);
			if (options.prepareError) throw options.prepareError;
			return intent.kind === "restartProcess" ? { handoff: "handoff" } : { target: `s${next++}` };
		},
		confirmReleased: async () => stopped,
		acquire: async (target, epoch) => {
			events.push(`acquire:${target}`);
			if (!stopped) throw new Error("overlap");
			stopped = false;
			return {
				createHost: async () => {
					if (options.createError) throw options.createError;
					return makeHost(epoch, target);
				},
				cleanup: async () => {
					cleaned = true;
					stopped = true;
				},
			};
		},
	};
	return {
		coordinator: new SessionTransitionCoordinator(makeHost(4, "old"), dependencies),
		events,
		cleaned: () => cleaned,
	};
}

const fresh: InteractiveHostIntent = { kind: "freshSession" };

describe("SessionTransitionCoordinator", () => {
	it("serializes concurrent transitions with monotonically increasing epochs", async () => {
		const test = harness();
		const [first, second] = await Promise.all([
			test.coordinator.transition(fresh),
			test.coordinator.transition(fresh),
		]);
		expect(first.status).toBe("started");
		expect(second.status).toBe("started");
		if (first.status === "started" && second.status === "started") {
			expect([first.host.epoch, second.host.epoch]).toEqual([5, 6]);
			expect(first.host.session.id).not.toBe(second.host.session.id);
		}
		expect(test.events).toEqual([
			"prepare:freshSession",
			"stop:old",
			"acquire:s1",
			"prepare:freshSession",
			"stop:s1",
			"acquire:s2",
		]);
	});

	it("classifies runtime branch as a new identity and navigation as the same lineage", () => {
		expect(transitionLineage({ kind: "branch", entryId: "entry" })).toBe("new");
		expect(transitionLineage({ kind: "fork", entryId: "entry" })).toBe("new");
		expect(transitionLineage({ kind: "navigate", targetId: "entry", summarize: false })).toBe("same");
		expect(transitionLineage({ kind: "resume", session: { kind: "id", id: "session" } })).toBe("same");
	});

	it("keeps the old host on prevalidation or stop failure", async () => {
		for (const options of [{ prepareError: new Error("invalid") }, { stopError: new Error("busy") }]) {
			const result = await harness(options).coordinator.transition(fresh);
			expect(result.status).toBe("failed");
			if (result.status === "failed") expect(result.current?.session.id).toBe("old");
		}
	});

	it("cleans acquired ownership when host construction fails", async () => {
		const test = harness({ createError: new Error("factory") });
		const result = await test.coordinator.transition(fresh);
		expect(result).toMatchObject({ status: "failed", phase: "start", recoveryIntent: fresh });
		expect(test.cleaned()).toBe(true);
	});

	it("emits restart handoff only after release", async () => {
		const test = harness();
		const result = await test.coordinator.transition({ kind: "restartProcess" });
		expect(result).toEqual({ status: "handoff", descriptor: "handoff" });
		expect(test.events).toEqual(["prepare:restartProcess", "stop:old"]);
	});

	it("proves stop-before-acquire against an isolated real ownership root", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-transition-"));
		roots.push(root);
		const file = path.join(root, "session.jsonl");
		await fs.writeFile(file, `${JSON.stringify({ type: "session", id: "same" })}\n`);
		const identity = (runnerInstanceId: string) => ({
			root,
			buildRevision: { digest: "a".repeat(64), version: "transition-test" },
			runnerInstanceIdentity: { runnerInstanceId, startedAt: "2026-07-12T00:00:00.000Z" },
		});
		let ownership = await acquireSessionOwnership(file, "same", identity("11111111-1111-4111-8111-111111111111"));
		const old: FakeHost = {
			epoch: 8,
			runner: "old",
			session: { id: "same" },
			buildIdentity: "build",
			stop: async () => ownership.release(),
		};
		const coordinator = new SessionTransitionCoordinator(old, {
			prepare: async () => ({ target: file }),
			confirmReleased: async () => {
				const probe = await acquireSessionOwnership(file, "same", identity("22222222-2222-4222-8222-222222222222"));
				await probe.release();
				return true;
			},
			acquire: async (_target, epoch) => {
				ownership = await acquireSessionOwnership(file, "same", identity("33333333-3333-4333-8333-333333333333"));
				return {
					createHost: async () => ({
						epoch,
						runner: "new",
						session: { id: "same" },
						buildIdentity: "build",
						stop: async () => ownership.release(),
					}),
					cleanup: async () => ownership.release(),
				};
			},
		});
		await expect(
			acquireSessionOwnership(file, "same", identity("44444444-4444-4444-8444-444444444444")),
		).rejects.toBeInstanceOf(ExternalSessionOwner);
		const result = await coordinator.transition({ kind: "resume", session: { kind: "path", path: file } });
		expect(result).toMatchObject({ status: "started", host: { epoch: 9, session: { id: "same" } } });
		await expect(
			acquireSessionOwnership(file, "same", identity("55555555-5555-4555-8555-555555555555")),
		).rejects.toBeInstanceOf(ExternalSessionOwner);
		if (result.status === "started") await result.host.stop();
	});
});
