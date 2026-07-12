import { describe, expect, it } from "bun:test";
import type { CollabRunnerSnapshot, HostFrame } from "@oh-my-pi/pi-wire";
import { GuestClient, reduceRunnerDelta } from "../src/lib/client";
import { encodeBase64Url } from "../src/lib/link";

const LINK = `roomroomroom1234#${encodeBase64Url(new Uint8Array(32))}`;
const snapshot = (
	runnerSequence = 4,
	revision = 7,
	transcript: CollabRunnerSnapshot["transcript"] = [],
): CollabRunnerSnapshot => ({
	revision, runnerSequence, sessionRevision: 3, transcript, durableInputs: [], activeOperations: [],
	workflow: {}, tools: {}, todos: {}, model: {}, session: {},
});
const welcome = (capability: "observer" | "controller" = "observer"): Extract<HostFrame, { t: "welcome" }> => ({
	t: "welcome", connectionId: "connection", viewId: "view", capability,
	controllerEpoch: capability === "controller" ? 8 : undefined, snapshot: snapshot(), sequence: 1,
});

describe("protocol v2 runner projection", () => {
	it("atomically replaces state on welcome and resync", () => {
		const client = new GuestClient(LINK, "guest");
		client.applyFrameForTest(welcome("controller"));
		expect(client.getSnapshot().phase).toBe("live");
		expect(client.getSnapshot().runner?.revision).toBe(7);
		expect(client.getSnapshot().capability).toBe("controller");
		expect(client.getSnapshot().controllerEpoch).toBe(8);
		client.applyFrameForTest({ t: "resync", snapshot: snapshot(20, 21), expectedSequence: 5, observedSequence: 20 });
		expect(client.getSnapshot().runner?.runnerSequence).toBe(20);
		expect(client.getSnapshot().runner?.revision).toBe(21);
	});

	it("retains full transcript history across welcome, resync, and the next delta", () => {
		const first = { type: "message", id: "m1", parentId: null, timestamp: "first", message: { role: "user", content: "first", timestamp: 1 } } as const;
		const second = { type: "message", id: "m2", parentId: "m1", timestamp: "second", message: { role: "assistant", content: "second", timestamp: 2 } } as const;
		const third = { type: "message", id: "m3", parentId: "m2", timestamp: "third", message: { role: "user", content: "third", timestamp: 3 } } as const;
		const client = new GuestClient(LINK, "guest");
		client.applyFrameForTest({ ...welcome(), snapshot: snapshot(4, 7, [first]) });
		expect(client.getSnapshot().runner?.transcript).toEqual([first]);
		client.applyFrameForTest({
			t: "resync",
			snapshot: snapshot(20, 21, [first, second]),
			expectedSequence: 5,
			observedSequence: 20,
		});
		client.applyFrameForTest({
			t: "delta",
			delivery: {
				kind: "event",
				event: {
					kind: "transcriptEntryAppended",
					sequence: 21,
					revision: 22,
					sessionRevision: 4,
					transcriptEntry: third,
				},
			},
		});
		expect(client.getSnapshot().runner?.transcript).toEqual([first, second, third]);
	});

	it("applies only contiguous deltas and appends immutable transcript entries", () => {
		const base = snapshot();
		const event = { kind: "transcriptEntryAppended", sequence: 5, revision: 8, sessionRevision: 4,
			transcriptEntry: { type: "message", id: "m1", parentId: null, timestamp: "now", message: { role: "user", content: "hello", timestamp: 1 } } };
		const result = reduceRunnerDelta(base, { kind: "event", event });
		expect(result.kind).toBe("applied");
		if (result.kind === "applied") {
			expect(result.snapshot.runnerSequence).toBe(5);
			expect(result.snapshot.revision).toBe(8);
			expect(result.snapshot.transcript).toHaveLength(1);
		}
	});

	it("ignores duplicates and reports future gaps without partial mutation", () => {
		const base = snapshot();
		const duplicate = reduceRunnerDelta(base, { kind: "event", event: { sequence: 4, revision: 99 } });
		expect(duplicate).toEqual({ kind: "duplicate", snapshot: base });
		const gap = reduceRunnerDelta(base, { kind: "event", event: { sequence: 7, revision: 99 } });
		expect(gap).toEqual({ kind: "gap", expectedSequence: 5, observedSequence: 7 });
		expect(base.revision).toBe(7);
	});

	it("drops controller state immediately when the host changes capability", () => {
		const client = new GuestClient(LINK, "guest");
		client.applyFrameForTest(welcome("controller"));
		client.applyFrameForTest({ t: "controllerChanged", capability: "observer" });
		expect(client.getSnapshot().capability).toBe("observer");
		expect(client.getSnapshot().controllerEpoch).toBeNull();
		expect(client.getSnapshot().readOnly).toBe(true);
	});

	it("ends on bye", () => {
		const client = new GuestClient(LINK, "guest");
		client.applyFrameForTest(welcome());
		client.applyFrameForTest({ t: "bye", reason: "host stopped" });
		expect(client.getSnapshot().phase).toBe("ended");
		expect(client.getSnapshot().endedReason).toBe("host stopped");
	});
});
