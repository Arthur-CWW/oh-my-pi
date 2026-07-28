import { rewriteEnvelopePeer, unpackEnvelope } from "../src/lib/link";

const ROOM_PATH_RE = /^\/r\/([A-Za-z0-9_-]{10,64})$/;

interface SocketData {
	roomId: string;
	role: "host" | "guest";
	peerId: number;
}

type RelaySocket = Bun.ServerWebSocket<SocketData>;
interface Room {
	host: RelaySocket;
	guests: Map<number, RelaySocket>;
	nextPeerId: number;
}

export interface RelayHandlers {
	fetch(request: Request, server: Bun.Server<SocketData>): Response | undefined;
	websocket: Bun.WebSocketHandler<SocketData>;
	close(): void;
}

/** Create the relay route and WebSocket handlers shared by the hub and standalone relay. */
export function createRelayHandlers(): RelayHandlers {
	const rooms = new Map<string, Room>();
	return {
		fetch(request, server) {
			const url = new URL(request.url);
			const match = ROOM_PATH_RE.exec(url.pathname);
			const role = url.searchParams.get("role");
			if (!match || (role !== "host" && role !== "guest")) return new Response("not found", { status: 404 });
			const data: SocketData = { roomId: match[1]!, role, peerId: 0 };
			if (server.upgrade(request, { data })) return undefined;
			return new Response("websocket upgrade required", { status: 426 });
		},
		websocket: {
			open(ws) {
				const { roomId, role } = ws.data;
				if (role === "host") {
					if (rooms.has(roomId)) return ws.close(4009, "a host is already connected for this room");
					rooms.set(roomId, { host: ws, guests: new Map(), nextPeerId: 1 });
					return;
				}
				const room = rooms.get(roomId);
				if (!room) return ws.close(4004, "no such room");
				const peerId = room.nextPeerId++;
				ws.data.peerId = peerId;
				room.guests.set(peerId, ws);
				room.host.send(JSON.stringify({ t: "peer-joined", peer: peerId }));
			},
			message(ws, message) {
				if (typeof message === "string") return;
				const room = rooms.get(ws.data.roomId);
				if (!room) return;
				if (ws.data.role === "host") {
					const envelope = unpackEnvelope(message);
					if (!envelope) return;
					if (envelope.peerId === 0) for (const guest of room.guests.values()) guest.send(message);
					else room.guests.get(envelope.peerId)?.send(message);
					return;
				}
				if (message.byteLength < 4) return;
				rewriteEnvelopePeer(message, ws.data.peerId);
				room.host.send(message);
			},
			close(ws) {
				const { roomId, role, peerId } = ws.data;
				const room = rooms.get(roomId);
				if (!room) return;
				if (role === "host") {
					if (room.host !== ws) return;
					rooms.delete(roomId);
					const closure = JSON.stringify({ t: "room-closed" });
					for (const guest of room.guests.values()) {
						guest.send(closure);
						guest.close(4001, "room closed");
					}
					room.guests.clear();
					return;
				}
				if (room.guests.delete(peerId)) room.host.send(JSON.stringify({ t: "peer-left", peer: peerId }));
			},
		},
		close() {
			for (const room of rooms.values()) {
				const closure = JSON.stringify({ t: "room-closed" });
				for (const guest of room.guests.values()) {
					guest.send(closure);
					guest.close(4001, "room closed");
				}
				room.host.close(1001, "relay shutting down");
			}
			rooms.clear();
		},
	};
}
