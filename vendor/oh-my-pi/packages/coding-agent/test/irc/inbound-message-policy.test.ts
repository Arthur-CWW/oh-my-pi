import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { IrcExternalBus, type IrcExternalMessageAudience } from "../../src/irc/bus-external";
import { prepareExternalIrcInboundMessage } from "../../src/irc/inbound-message-policy";
import { ArtifactManager } from "../../src/session/artifacts";

interface IsolatedReceiver {
	readonly artifacts: ArtifactManager;
	readonly bus: IrcExternalBus;
	readonly root: string;
}

async function withIsolatedReceiver(run: (receiver: IsolatedReceiver) => Promise<void>): Promise<void> {
	using tmp = TempDir.createSync("@omp-irc-inbound-");
	const previousHome = process.env.HOME;
	const previousConfigRoot = process.env.OMP_CONFIG_ROOT;
	const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.HOME = tmp.path();
	process.env.OMP_CONFIG_ROOT = `${tmp.path()}/config`;
	process.env.OMP_SESSION_CONTROL_DB = `${tmp.path()}/session-control.sqlite`;
	const bus = new IrcExternalBus(`${tmp.path()}/irc-bus.sqlite`);
	try {
		await run({
			artifacts: new ArtifactManager(`${tmp.path()}/artifacts`),
			bus,
			root: tmp.path(),
		});
	} finally {
		bus.close();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousConfigRoot === undefined) delete process.env.OMP_CONFIG_ROOT;
		else process.env.OMP_CONFIG_ROOT = previousConfigRoot;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	}
}

async function receive(
	receiver: IsolatedReceiver,
	body: string,
	audience: IrcExternalMessageAudience,
	inlineBodyMaxBytes: number,
) {
	receiver.bus.sendMessage({
		fromPeer: "sender-session",
		toPeer: "receiver-session",
		body,
		audience,
	});
	const message = receiver.bus.pollMessages("receiver-session")[0];
	if (!message) throw new Error("Expected an inbound IRC message");
	return prepareExternalIrcInboundMessage(message, {
		inlineBodyMaxBytes,
		saveArtifact: content => receiver.artifacts.save(content, "irc"),
	});
}

describe("external IRC inbound payload hygiene", () => {
	it("stores an oversized broadcast and injects only a neutral reference envelope", async () => {
		await withIsolatedReceiver(async receiver => {
			const sourceMarker = "PRIVATE_BROADCAST_PAYLOAD";
			const body = `${sourceMarker}:${"x".repeat(256)}`;
			const prepared = await receive(receiver, body, "broadcast", 64);

			expect(prepared.body).toContain("Sender: sender-session");
			expect(prepared.body).toContain("Topic: general coordination");
			expect(prepared.body).toContain("Reference: artifact://0");
			expect(prepared.body).not.toContain(sourceMarker);
			expect(await Bun.file(`${receiver.artifacts.dir}/0.irc.log`).text()).toBe(body);
		});
	});

	it("stores a topic-isolated broadcast even when it is below the byte bound", async () => {
		await withIsolatedReceiver(async receiver => {
			const sourceMarker = "BLENDER_NODE_RECIPE";
			const body = `Blender camera animation notes: ${sourceMarker}`;
			const prepared = await receive(receiver, body, "broadcast", 4096);

			expect(prepared.topic).toBe("media production");
			expect(prepared.body).toContain("Reference: artifact://0");
			expect(prepared.body).not.toContain(sourceMarker);
			expect(await Bun.file(`${receiver.artifacts.dir}/0.irc.log`).text()).toBe(body);
		});
	});

	it("keeps a small benign direct message byte-identical and inline", async () => {
		await withIsolatedReceiver(async receiver => {
			const body = "Please review receipt 42.\nKeep this spacing intact.";
			const prepared = await receive(receiver, body, "direct", 4096);

			expect(prepared.body).toBe(body);
			expect(prepared.artifactUri).toBeUndefined();
			expect(await receiver.artifacts.listFiles()).toEqual([]);
		});
	});

	it("stores an oversized direct message rather than inserting its body", async () => {
		await withIsolatedReceiver(async receiver => {
			const sourceMarker = "OVERSIZED_DIRECT_SOURCE";
			const body = `${sourceMarker}:${"z".repeat(128)}`;
			const prepared = await receive(receiver, body, "direct", 32);

			expect(prepared.body).toContain("Reference: artifact://0");
			expect(prepared.body).not.toContain(sourceMarker);
			expect(await Bun.file(`${receiver.artifacts.dir}/0.irc.log`).text()).toBe(body);
		});
	});

	it("decodes durable rows written before audience metadata as direct messages", async () => {
		await withIsolatedReceiver(async receiver => {
			const legacyPath = `${receiver.root}/legacy-irc.sqlite`;
			const legacy = new Database(legacyPath);
			legacy.run(
				"CREATE TABLE peers (session_id TEXT PRIMARY KEY, name TEXT, cwd TEXT, pid INTEGER, last_seen TEXT)",
			);
			legacy.run(
				"CREATE TABLE messages (id INTEGER PRIMARY KEY, ts TEXT, from_peer TEXT, to_peer TEXT, body TEXT, origin TEXT, delivered INTEGER DEFAULT 0)",
			);
			legacy.run(
				"INSERT INTO messages (ts, from_peer, to_peer, body, origin) VALUES ('2026-07-26T00:00:00.000Z', 'old-sender', 'receiver-session', 'legacy body', 'agent')",
			);
			legacy.close();

			const readonlyBus = new IrcExternalBus(legacyPath, { readonly: true });
			try {
				expect(readonlyBus.pollMessages("receiver-session")[0]).toMatchObject({
					body: "legacy body",
					audience: "direct",
				});
			} finally {
				readonlyBus.close();
			}
		});
	});
});
