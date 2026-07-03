import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { runIrcCommand, type IrcCliIo } from "@oh-my-pi/pi-coding-agent/cli/irc-cli";
import { isSubcommand, resolveCliArgv } from "@oh-my-pi/pi-coding-agent/cli-commands";
import { IrcExternalBus, resolveIrcExternalPeerName } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import { IrcTool } from "@oh-my-pi/pi-coding-agent/tools/irc";

const cleanupRoots: string[] = [];
let tempCounter = 0;

async function tempDbPath(): Promise<string> {
	try {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-irc-external-"));
		cleanupRoots.push(root);
		return path.join(root, "irc-bus.sqlite");
	} catch (error) {
		if (!(error instanceof Error) || !("code" in error) || error.code !== "EPERM") throw error;
		tempCounter++;
		return `file:irc-external-${Date.now()}-${tempCounter}?mode=memory&cache=shared`;
	}
}

interface CapturedIrcIo {
	io: IrcCliIo;
	stdout: string;
	stderr: string;
}

function createCapturedIrcIo(): CapturedIrcIo {
	const chunks = { stdout: "", stderr: "" };
	return {
		io: {
			stdout: {
				write(chunk: string | Uint8Array): boolean {
					chunks.stdout += String(chunk);
					return true;
				},
			} as unknown as Pick<typeof process.stdout, "write">,
			stderr: {
				write(chunk: string | Uint8Array): boolean {
					chunks.stderr += String(chunk);
					return true;
				},
			} as unknown as Pick<typeof process.stderr, "write">,
		},
		get stdout(): string {
			return chunks.stdout;
		},
		get stderr(): string {
			return chunks.stderr;
		},
	};
}

afterEach(async () => {
	for (const root of cleanupRoots.splice(0)) {
		await fs.rm(root, { recursive: true, force: true });
	}
});

describe("IrcExternalBus", () => {
	it("imports the IRC tool module with the external bus", () => {
		expect(typeof IrcTool.createIf).toBe("function");
	});

	it("registers irc as a top-level subcommand", () => {
		expect(isSubcommand("irc")).toBe(true);
		expect(resolveCliArgv(["irc", "send", "peer-b", "hello"])).toEqual({
			argv: ["irc", "send", "peer-b", "hello"],
		});
	});

	it("registers peers and delivers a message exactly once", async () => {
		const dbPath = await tempDbPath();
		const sessionA = "session-a";
		const sessionB = "session-b";
		const peerA = resolveIrcExternalPeerName({ configuredName: "", cwd: "/tmp/project-a", sessionId: sessionA });
		const peerB = resolveIrcExternalPeerName({ configuredName: "custom-b", cwd: "/tmp/project-b", sessionId: sessionB });
		const busA = new IrcExternalBus(dbPath);
		const busB = new IrcExternalBus(dbPath);
		try {
			busA.registerPeer({ sessionId: sessionA, name: peerA, cwd: "/tmp/project-a", pid: 111 });
			busB.registerPeer({ sessionId: sessionB, name: peerB, cwd: "/tmp/project-b", pid: 222 });

			expect(busA.listPeers({ excludeSessionId: sessionA }).map(peer => peer.name)).toEqual([peerB]);
			const messageId = busA.sendMessage({ fromPeer: peerA, toPeer: peerB, body: "hello from A" });
			expect(messageId).toBeGreaterThan(0);
			expect(busB.unreadCount(peerB)).toBe(1);

			const messages = busB.pollMessages(peerB);
			expect(messages).toMatchObject([{ id: messageId, fromPeer: peerA, toPeer: peerB, body: "hello from A" }]);
			busB.markDelivered(messageId);
			expect(busB.pollMessages(peerB)).toEqual([]);
			expect(busB.unreadCount(peerB)).toBe(0);
		} finally {
			busA.close();
			busB.close();
		}
	});

	it("drains messages without consuming peeks", async () => {
		const dbPath = await tempDbPath();
		const busA = new IrcExternalBus(dbPath);
		const busB = new IrcExternalBus(dbPath);
		try {
			busA.registerPeer({ sessionId: "session-a", name: "peer-a", cwd: "/tmp/project-a", pid: 111 });
			busB.registerPeer({ sessionId: "session-b", name: "peer-b", cwd: "/tmp/project-b", pid: 222 });

			const firstId = busA.sendMessage({ fromPeer: "peer-a", toPeer: "peer-b", body: "first" });
			const secondId = busA.sendMessage({ fromPeer: "peer-a", toPeer: "peer-b", body: "second" });

			expect(busB.drainMessages("peer-b", { peek: true }).map(message => message.id)).toEqual([firstId, secondId]);
			expect(busB.unreadCount("peer-b")).toBe(2);
			expect(busB.drainMessages("peer-b").map(message => message.body)).toEqual(["first", "second"]);
			expect(busB.drainMessages("peer-b")).toEqual([]);
			expect(busB.unreadCount("peer-b")).toBe(0);
		} finally {
			busA.close();
			busB.close();
		}
	});

	it("sends, lists, peeks, and drains through the CLI bus adapter", async () => {
		const dbPath = await tempDbPath();
		const bus = new IrcExternalBus(dbPath);
		try {
			bus.registerPeer({ sessionId: "session-b", name: "peer-b", cwd: "/tmp/project-b", pid: 222 });

			const listIo = createCapturedIrcIo();
			expect(runIrcCommand({ action: "list", args: [], flags: {}, bus, io: listIo.io, nowMs: Date.now() }).exitCode).toBe(0);
			expect(listIo.stdout).toContain("peer-b");
			expect(listIo.stdout).toContain("/tmp/project-b");

			const sendIo = createCapturedIrcIo();
			expect(
				runIrcCommand({
					action: "send",
					args: ["peer-b", "hello", "from", "CLI"],
					flags: { from: "human" },
					bus,
					io: sendIo.io,
				}).exitCode,
			).toBe(0);
			expect(sendIo.stdout).toContain("from human");
			expect(bus.unreadCount("peer-b")).toBe(1);

			const peekIo = createCapturedIrcIo();
			expect(runIrcCommand({ action: "inbox", args: ["peer-b"], flags: { peek: true }, bus, io: peekIo.io }).exitCode).toBe(0);
			expect(peekIo.stdout).toContain("human -> peer-b: hello from CLI");
			expect(bus.unreadCount("peer-b")).toBe(1);

			const inboxIo = createCapturedIrcIo();
			expect(runIrcCommand({ action: "inbox", args: ["peer-b"], flags: {}, bus, io: inboxIo.io }).exitCode).toBe(0);
			expect(inboxIo.stdout).toContain("human -> peer-b: hello from CLI");
			expect(bus.unreadCount("peer-b")).toBe(0);
		} finally {
			bus.close();
		}
	});

	it("omits peers whose heartbeat is stale", async () => {
		const dbPath = await tempDbPath();
		const bus = new IrcExternalBus(dbPath);
		try {
			bus.registerPeer({ sessionId: "fresh-session", name: "fresh", cwd: "/tmp/fresh", pid: 333 });
			const db = new Database(dbPath);
			try {
				db.run("PRAGMA busy_timeout = 3000");
				db.query(
					"INSERT INTO peers (session_id, name, cwd, pid, last_seen) VALUES ($sessionId, $name, $cwd, $pid, $lastSeen)",
				).run({
					$sessionId: "stale-session",
					$name: "stale",
					$cwd: "/tmp/stale",
					$pid: 444,
					$lastSeen: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
				});
			} finally {
				db.close();
			}

			expect(bus.listPeers().map(peer => peer.name)).toEqual(["fresh"]);
		} finally {
			bus.close();
		}
	});
});
