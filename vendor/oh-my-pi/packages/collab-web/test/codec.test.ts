import { describe, expect, it } from "bun:test";
import { COLLAB_PROTO, type SecureCollabFrame } from "@oh-my-pi/pi-wire";
import {
	ReceiveSequenceWindow,
	generateRoomKey,
	importRoomKey,
	open,
	seal,
} from "../src/lib/codec";

const context = { connectionId: "connection-vector", direction: "hostToGuest" as const, sequence: 1 };
const frame: SecureCollabFrame = {
	proto: COLLAB_PROTO,
	...context,
	frame: { t: "bye", reason: "vector" },
};

describe("collab codec v2", () => {
	it("round-trips an authenticated secure envelope", async () => {
		const key = await importRoomKey(generateRoomKey());
		expect(await open(key, await seal(key, frame), context)).toEqual(frame);
	});

	it("rejects wrong connection, direction, sequence, ciphertext, and v1", async () => {
		const key = await importRoomKey(generateRoomKey());
		const sealed = await seal(key, frame);
		await expect(open(key, sealed, { ...context, connectionId: "other" })).rejects.toThrow();
		await expect(open(key, sealed, { ...context, direction: "guestToHost" })).rejects.toThrow();
		await expect(open(key, sealed, { ...context, sequence: 2 })).rejects.toThrow();
		sealed[sealed.length - 1]! ^= 0xff;
		await expect(open(key, sealed, context)).rejects.toThrow();

		const v1 = { ...frame, proto: 1 } as unknown as SecureCollabFrame;
		await expect(open(key, await seal(key, v1), context)).rejects.toThrow("Invalid secure");
	});

	it("enforces exact order and resets only with a new window", () => {
		const window = new ReceiveSequenceWindow();
		expect(window.accept(1).kind).toBe("accepted");
		expect(window.accept(1).kind).toBe("dropped");
		expect(() => window.accept(0)).toThrow();
		expect(window.accept(3)).toEqual({ kind: "gap", expectedSequence: 2, observedSequence: 3 });
		expect(window.accept(2).kind).toBe("accepted");
		expect(new ReceiveSequenceWindow().accept(1).kind).toBe("accepted");
	});

	it("interoperates with the Node codec in both directions", async () => {
		const node = await import("@oh-my-pi/pi-coding-agent/collab/crypto");
		const raw = generateRoomKey();
		const browserKey = await importRoomKey(raw);
		const nodeKey = await node.importRoomKey(raw);
		expect(await node.open(nodeKey, await seal(browserKey, frame), context)).toEqual(frame);
		expect(await open(browserKey, await node.seal(nodeKey, frame), context)).toEqual(frame);
	});
});
