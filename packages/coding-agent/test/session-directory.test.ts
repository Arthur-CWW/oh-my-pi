import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { IrcExternalBus } from "../src/irc/bus-external";
import { operatorDirectiveMessage } from "../src/session/operator-directive";
import {
	createOperatorDirectiveCommand,
	inspectSessionDirectory,
	issueOperatorDirective,
	querySessionDirectory,
	resolveSessionDirectorySelector,
	SessionDirectoryResolutionError,
} from "../src/session/session-directory";
import { SessionControlBus, type SessionControlCommand } from "../src/session/session-control";

const cleanupRoots: string[] = [];

async function fixture() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-session-directory-"));
	cleanupRoots.push(root);
	return {
		root,
		ircDbPath: path.join(root, "irc.sqlite"),
		controlDbPath: path.join(root, "control.sqlite"),
	};
}

function register(
	bus: IrcExternalBus,
	input: {
		sessionId: string;
		hostId: string;
		name: string;
		ownerEpoch?: string;
		workstream?: string;
		tags?: string[];
		claims?: string[];
	},
): void {
	bus.registerPeer({
		sessionId: input.sessionId,
		hostId: input.hostId,
		agentId: input.name,
		name: input.name,
		cwd: `/work/${input.name}`,
		pid: process.pid,
		ownerEpoch: input.ownerEpoch,
		labels: {
			workstream: input.workstream,
			tags: input.tags,
			claims: input.claims,
			model: "openai/gpt-5",
		},
	});
	bus.updatePeerState(input.sessionId, "idle");
}

afterEach(async () => {
	await Promise.all(cleanupRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe("session directory", () => {
	it("refuses cross-host same-name ambiguity and resolves only with an exact host", async () => {
		const paths = await fixture();
		const bus = new IrcExternalBus(paths.ircDbPath);
		register(bus, { sessionId: "session-a", hostId: "host-a", name: "builder", workstream: "harness" });
		register(bus, { sessionId: "session-b", hostId: "host-b", name: "builder", workstream: "harness" });
		const rows = await querySessionDirectory({ ...paths, includeProcessProfile: false });

		expect(() => resolveSessionDirectorySelector(rows, "builder")).toThrow(SessionDirectoryResolutionError);
		expect(resolveSessionDirectorySelector(rows, "builder", { hostId: "host-b" }).sessionId).toBe("session-b");
		expect((await inspectSessionDirectory("session-a", paths)).hostId).toBe("host-a");
		bus.close();
	});

	it("filters exact indexed fields and applies deterministic sort order", async () => {
		const paths = await fixture();
		const bus = new IrcExternalBus(paths.ircDbPath);
		register(bus, { sessionId: "session-z", hostId: "host-b", name: "zeta", workstream: "harness", tags: ["gpu"], claims: ["vendor"] });
		register(bus, { sessionId: "session-a", hostId: "host-a", name: "alpha", workstream: "harness", tags: ["gpu"], claims: ["vendor"] });
		register(bus, { sessionId: "session-x", hostId: "host-a", name: "other", workstream: "primer", tags: ["cpu"] });

		const rows = await querySessionDirectory({
			...paths,
			includeProcessProfile: false,
			workstream: "harness",
			tags: ["gpu"],
			claim: "vendor",
			sort: "hostId",
		});
		expect(rows.map(row => row.sessionId)).toEqual(["session-a", "session-z"]);
		const searched = await querySessionDirectory({ ...paths, includeProcessProfile: false, text: "ALP" });
		expect(searched.map(row => row.sessionId)).toEqual(["session-a"]);
		bus.close();
	});

	it("keeps operator labels authoritative across heartbeat and restart registration", async () => {
		const paths = await fixture();
		const bus = new IrcExternalBus(paths.ircDbPath);
		register(bus, { sessionId: "session-a", hostId: "host-a", name: "ambient", workstream: "runtime" });
		expect(bus.setPeerOperatorName("session-a", "majordomo")).toBeTrue();
		expect(bus.mergePeerOperatorLabels("session-a", { summary: "owned summary", workstream: "operator-stream", tags: ["critical"] })).toBeTrue();

		bus.heartbeat("session-a", { summary: "", workstream: "runtime", tags: [] });
		bus.registerPeer({
			sessionId: "session-a",
			hostId: "host-a",
			name: "ambient-after-restart",
			cwd: "/work/ambient",
			pid: process.pid,
			ownerEpoch: "owner-2",
			labels: { summary: "", workstream: "runtime", tags: [] },
		});
		const row = (await querySessionDirectory({ ...paths, includeProcessProfile: false }))[0]!;
		expect(row).toMatchObject({ name: "majordomo", summary: "owned summary", workstream: "operator-stream", tags: ["critical"] });
		bus.close();
	});

	it("serves readers while independent SQLite writers update the indexed projection", async () => {
		const paths = await fixture();
		const bootstrap = new IrcExternalBus(paths.ircDbPath);
		bootstrap.close();
		await Promise.all([
			...Array.from({ length: 12 }, async (_, index) => {
				const writer = new IrcExternalBus(paths.ircDbPath);
				register(writer, { sessionId: `session-${index}`, hostId: `host-${index % 2}`, name: `worker-${index}`, workstream: "harness" });
				writer.close();
			}),
			...Array.from({ length: 8 }, async () => {
				await querySessionDirectory({ ...paths, includeProcessProfile: false, sort: "sessionId" });
			}),
		]);
		const rows = await querySessionDirectory({ ...paths, includeProcessProfile: false });
		expect(rows).toHaveLength(12);
	});
});

describe("operator directives", () => {
	it("refuses a stale directory owner before appending a command", async () => {
		const paths = await fixture();
		const peers = new IrcExternalBus(paths.ircDbPath);
		register(peers, { sessionId: "session-a", hostId: "host-a", name: "agent-a", ownerEpoch: "old-owner" });
		const control = new SessionControlBus(paths.controlDbPath);
		control.bindTarget("session-a", "new-owner");

		await expect(issueOperatorDirective({ ...paths, selector: "session-a", delegatedThrough: "Main", intent: "Inspect the failure", idempotencyKey: "directive-1", timeoutMs: 50 })).rejects.toThrow("Stale owner");
		expect(control.listReceipts()).toHaveLength(0);
		control.close();
		peers.close();
	});

	it("delivers once with durable idempotency, provenance, ack/result, and agent attribution", async () => {
		const paths = await fixture();
		const peers = new IrcExternalBus(paths.ircDbPath);
		register(peers, { sessionId: "session-a", hostId: "host-a", name: "agent-a", ownerEpoch: "owner-a" });
		const control = new SessionControlBus(paths.controlDbPath);
		control.bindTarget("session-a", "owner-a");
		let delivered: SessionControlCommand | undefined;
		const delivery = (async () => {
			for (let attempts = 0; attempts < 1_000; attempts++) {
				const command = control.claimNext("session-a", "owner-a");
				if (command) {
					delivered = command;
					control.complete(command.commandId, "owner-a", { kind: "operatorDirective", queued: true });
					return;
				}
				await Bun.sleep(1);
			}
			throw new Error("Directive was not delivered to the owner queue");
		})();
		const request = { ...paths, selector: "session-a", delegatedThrough: "Main", intent: "Inspect the failure", idempotencyKey: "directive-1", timeoutMs: 1_000 };
		const first = await issueOperatorDirective(request);
		await delivery;
		const replay = await issueOperatorDirective(request);
		expect(first).toMatchObject({ state: "applied", acknowledgedAt: expect.any(String), result: { kind: "operatorDirective", queued: true } });
		expect(replay.commandId).toBe(first.commandId);
		expect(control.listReceipts()).toHaveLength(1);
		expect(delivered?.intent).toEqual({ kind: "operatorDirective", issuedBy: "arthur", delegatedThrough: "Main", intent: "Inspect the failure", idempotencyKey: "directive-1" });
		const payload = operatorDirectiveMessage(delivered as Extract<SessionControlCommand, { intent: { kind: "operatorDirective" } }>);
		expect(payload.message).toMatchObject({ customType: "operator:directive", attribution: "agent", details: { issuedBy: "arthur", delegatedThrough: "Main" } });
		expect(payload.message.content).toContain("not a direct user message from Arthur");
		control.close();
		peers.close();
	});

	it("replays an acknowledged directive after owner restart with the same command identity", async () => {
		const paths = await fixture();
		const bus = new SessionControlBus(paths.controlDbPath);
		bus.bindTarget("session-a", "owner-a");
		const command = createOperatorDirectiveCommand({ sessionId: "session-a", targetOwnerEpoch: "owner-a", delegatedThrough: "Main", intent: "Continue", idempotencyKey: "resume-1" });
		bus.request(command);
		expect(bus.claimNext("session-a", "owner-a")?.commandId).toBe(command.commandId);
		expect(bus.getReceipt(command.commandId)?.state).toBe("acknowledged");
		bus.bindTarget("session-a", "owner-a");
		expect(bus.claimNext("session-a", "owner-a")?.commandId).toBe(command.commandId);
		bus.complete(command.commandId, "owner-a", { replayed: true });
		expect(bus.getReceipt(command.commandId)).toMatchObject({ state: "applied", result: { replayed: true } });
		bus.close();
	});
});
