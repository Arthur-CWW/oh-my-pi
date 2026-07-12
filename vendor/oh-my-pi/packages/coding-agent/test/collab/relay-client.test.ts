import { afterEach, describe, expect, test } from "bun:test";
import { generateRoomKey, importRoomKey, open } from "../../src/collab/crypto";
import { unpackEnvelope } from "../../src/collab/protocol";
import { CollabSocket } from "../../src/collab/relay-client";

class TestWebSocket {
	static readonly OPEN = 1;
	static instances: TestWebSocket[] = [];
	readonly sent: ArrayBuffer[] = [];
	readonly nextSend = Promise.withResolvers<void>();
	readyState = 0;
	binaryType = "";
	onopen: (() => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((event: CloseEvent) => void) | null = null;
	constructor(readonly url: string) { TestWebSocket.instances.push(this); }
	send(data: ArrayBuffer): void { this.sent.push(data); this.nextSend.resolve(); }
	close(): void { this.readyState = 3; }
	open(): void { this.readyState = TestWebSocket.OPEN; this.onopen?.(); }
}

const RealWebSocket = globalThis.WebSocket;
afterEach(() => {
	globalThis.WebSocket = RealWebSocket;
	TestWebSocket.instances.length = 0;
});

describe("CollabSocket v2 epochs", () => {
	test("sends nothing before a connection epoch and never buffers it", async () => {
		globalThis.WebSocket = TestWebSocket as unknown as typeof WebSocket;
		const key = await importRoomKey(generateRoomKey());
		const socket = new CollabSocket({ wsUrl: "ws://relay/r/room", role: "guest", key });
		socket.connect();
		const ws = TestWebSocket.instances[0]!;
		expect(socket.send({ t: "detach" })).toBe(false);
		ws.open();
		expect(ws.sent).toHaveLength(0);
		expect(socket.send({ t: "detach" })).toBe(false);
	});

	test("seals frames with fresh connection identity and monotonic sequence", async () => {
		globalThis.WebSocket = TestWebSocket as unknown as typeof WebSocket;
		const key = await importRoomKey(generateRoomKey());
		const socket = new CollabSocket({ wsUrl: "ws://relay/r/room", role: "guest", key });
		socket.connect();
		const ws = TestWebSocket.instances[0]!;
		ws.open();
		socket.beginConnection("challenge-connection");
		expect(socket.send({ t: "detach" })).toBe(true);
		await ws.nextSend.promise;
		const relay = unpackEnvelope(new Uint8Array(ws.sent[0]!));
		expect(relay).not.toBeNull();
		const secure = await open(key, relay!.payload, {
			connectionId: "challenge-connection",
			direction: "guestToHost",
			sequence: 1,
		});
		expect(secure.frame).toEqual({ t: "detach" });
		socket.forgetPeer();
		expect(socket.send({ t: "detach" })).toBe(false);
		expect(ws.sent).toHaveLength(1);
	});
});
