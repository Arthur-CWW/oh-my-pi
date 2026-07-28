import { afterEach, describe, expect, it } from "bun:test";
import { COLLAB_PROTO, type SecureCollabFrame } from "@oh-my-pi/pi-wire";
import { importRoomKey, seal } from "../src/lib/codec";
import { packEnvelope } from "../src/lib/link";
import { CollabSocket } from "../src/lib/socket";

const OriginalWebSocket = globalThis.WebSocket;

class FakeWebSocket extends EventTarget {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSING = 2;
	static readonly CLOSED = 3;
	static latest: FakeWebSocket;

	readyState = FakeWebSocket.CONNECTING;
	binaryType = "";

	constructor(_url: string) {
		super();
		FakeWebSocket.latest = this;
	}

	open(): void {
		this.readyState = FakeWebSocket.OPEN;
		this.dispatchEvent(new Event("open"));
	}

	receive(payload: Uint8Array): void {
		const event = new Event("message") as Event & { data: ArrayBuffer };
		Object.defineProperty(event, "data", { value: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) });
		this.dispatchEvent(event);
	}

	send(_data: unknown): void {}
	close(): void { this.readyState = FakeWebSocket.CLOSED; }
}

afterEach(() => {
	globalThis.WebSocket = OriginalWebSocket;
});

describe("CollabSocket encrypted receive sequencing", () => {
	it("serializes sequence expectation across a burst of encrypted frames", async () => {
		globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
		const key = await importRoomKey(new Uint8Array(32));
		const socket = new CollabSocket({ wsUrl: "ws://relay.test", role: "guest", key });
		const received: string[] = [];
		const burstComplete = Promise.withResolvers<void>();
		socket.onFrame = frame => {
			received.push(frame.t);
			if (received.length === 3) burstComplete.resolve();
		};
		socket.onClose = reason => burstComplete.reject(new Error(reason));
		socket.connect();
		FakeWebSocket.latest.open();
		socket.activateConnection("burst-connection");

		const encrypted = await Promise.all([1, 2, 3].map(async sequence => {
			const envelope: SecureCollabFrame = {
				proto: COLLAB_PROTO,
				connectionId: "burst-connection",
				direction: "hostToGuest",
				sequence,
				frame: { t: "bye", reason: `frame-${sequence}` },
			};
			return packEnvelope(7, await seal(key, envelope));
		}));
		for (const frame of encrypted) FakeWebSocket.latest.receive(frame);

		await burstComplete.promise;
		expect(received).toEqual(["bye", "bye", "bye"]);
		socket.close();
	});
});
