import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isSubcommand, resolveCliArgv } from "@oh-my-pi/pi-coding-agent/cli-commands";
import { IrcExternalBus, type IrcExternalPeer } from "@oh-my-pi/pi-coding-agent/irc/bus-external";
import {
	getIdleReclaimerReceiptPath,
	readIdleReclaimerSessionReceipts,
	resumeIdleSession,
	runIdleReclaimerSweep,
} from "@oh-my-pi/pi-coding-agent/resource/idle-reclaimer";
import { SessionControlBus } from "@oh-my-pi/pi-coding-agent/session/session-control";

const HOUR_MS = 60 * 60 * 1000;

function journalLine(value: object): string {
	return `${JSON.stringify(value)}\n`;
}

async function writeTerminalJournal(file: string, sessionId: string, timestamp: number): Promise<void> {
	const at = new Date(timestamp).toISOString();
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(
		file,
		journalLine({ type: "session", version: 3, id: sessionId, cwd: "/work", timestamp: at }) +
			journalLine({
				type: "message",
				id: `${sessionId}-user`,
				parentId: null,
				timestamp: at,
				message: { role: "user", content: "finish" },
			}) +
			journalLine({
				type: "message",
				id: `${sessionId}-assistant`,
				parentId: `${sessionId}-user`,
				timestamp: at,
				message: { role: "assistant", provider: "test", model: "test", stopReason: "stop", content: [] },
			}),
		"utf8",
	);
	const date = new Date(timestamp);
	await fs.utimes(file, date, date);
}

function registerPeer(
	bus: IrcExternalBus,
	input: {
		readonly sessionId: string;
		readonly sessionFile: string;
		readonly ownerEpoch: string;
		readonly pid: number;
		readonly state: "idle" | "working";
	},
): void {
	bus.registerPeer({
		sessionId: input.sessionId,
		name: input.sessionId,
		cwd: "/work with spaces",
		pid: input.pid,
		sessionFile: input.sessionFile,
		ownerEpoch: input.ownerEpoch,
	});
	bus.updatePeerState(input.sessionId, input.state);
}

async function withFixture(
	run: (fixture: {
		readonly root: string;
		readonly agentDir: string;
		readonly ircDbPath: string;
		readonly controlDbPath: string;
	}) => Promise<void>,
): Promise<void> {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-idle-reclaimer-"));
	try {
		const agentDir = path.join(root, "agent");
		await fs.mkdir(agentDir, { recursive: true });
		await run({
			root,
			agentDir,
			ircDbPath: path.join(agentDir, "irc-bus.sqlite"),
			controlDbPath: path.join(agentDir, "session-control.sqlite"),
		});
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
}

describe("Majordomo idle reclaimer", () => {
	it("reclaims only an idle, terminal, childless, locally owned session and writes resumable command receipts", async () => {
		await withFixture(async ({ root, agentDir, ircDbPath, controlDbPath }) => {
			const nowMs = Date.UTC(2026, 6, 26, 12);
			const oldMs = nowMs - 7 * HOUR_MS;
			const sessions = [
				{ id: "idle-childless", state: "idle" as const, pid: 4101 },
				{ id: "busy-session", state: "working" as const, pid: 4102 },
				{ id: "child-holder", state: "idle" as const, pid: 4103 },
			];
			const irc = new IrcExternalBus(ircDbPath);
			const control = new SessionControlBus(controlDbPath);
			try {
				for (const session of sessions) {
					const sessionFile = path.join(root, "sessions", `${session.id}.jsonl`);
					await writeTerminalJournal(sessionFile, session.id, oldMs);
					registerPeer(irc, {
						sessionId: session.id,
						sessionFile,
						ownerEpoch: `owner-${session.id}`,
						pid: session.pid,
						state: session.state,
					});
					control.bindTarget(session.id, `owner-${session.id}`);
				}
			} finally {
				irc.close();
				control.close();
			}
			const admission = new Database(ircDbPath);
			admission.run("CREATE TABLE resource_leases (session_id TEXT NOT NULL)");
			admission.run("CREATE TABLE resource_waiters (session_id TEXT NOT NULL)");
			admission.query("INSERT INTO resource_leases (session_id) VALUES (?)").run("child-holder");
			admission.close();

			const stopped: string[] = [];
			const terminated: string[] = [];
			const result = await runIdleReclaimerSweep({
				enabled: true,
				agentDir,
				ircDbPath,
				controlDbPath,
				admissionDbPath: ircDbPath,
				nowMs: () => nowMs,
				verifyHostOwnership: async (peer: IrcExternalPeer) => ({
					identity: { bootId: "local-boot", pid: peer.pid, startFingerprint: `start-${peer.pid}` },
					processGroupId: peer.pid,
				}),
				requestGracefulStop: async candidate => {
					stopped.push(candidate.peer.sessionId);
					return { applied: true, state: "applied" };
				},
				terminateProcessGroup: async candidate => {
					terminated.push(candidate.peer.sessionId);
					return "graceful-control";
				},
			});

			expect(result.selected).toEqual(["idle-childless"]);
			expect(result.reclaimed).toEqual(["idle-childless"]);
			expect(stopped).toEqual(["idle-childless"]);
			expect(terminated).toEqual(["idle-childless"]);
			expect(result.skipped).toContainEqual({ sessionId: "busy-session", reason: "peer-not-idle" });
			expect(result.skipped).toContainEqual({ sessionId: "child-holder", reason: "child-attempts-active" });

			const receipts = await readIdleReclaimerSessionReceipts(agentDir);
			expect(receipts.map(receipt => receipt.event)).toEqual(["checkpointed", "reclaimed"]);
			const reclaimed = receipts[1];
			expect(reclaimed.resume.command).toContain("omp launch --cwd '/work with spaces' --resume");
			expect(reclaimed.commands.gracefulStop).toContain("session-control stop idle-childless");
			expect(reclaimed.commands.terminate).toEqual(["/bin/kill -TERM -- -4101", "/bin/kill -KILL -- -4101"]);

			let launched: { argv: readonly string[]; cwd: string } | undefined;
			const resumed = await resumeIdleSession("idle-child", {
				agentDir,
				write: () => {},
				launch: async (argv, cwd) => {
					launched = { argv, cwd };
					return 0;
				},
			});
			expect(resumed.exitCode).toBe(0);
			expect(launched).toEqual({ argv: reclaimed.resume.argv, cwd: "/work with spaces" });
		});
	});

	it("records a disabled sweep without reading stores or invoking reclaim actions", async () => {
		await withFixture(async ({ agentDir }) => {
			let actions = 0;
			const result = await runIdleReclaimerSweep({
				enabled: false,
				agentDir,
				verifyHostOwnership: async () => {
					actions += 1;
					return undefined;
				},
				requestGracefulStop: async () => {
					actions += 1;
					return { applied: true, state: "applied" };
				},
				terminateProcessGroup: async () => {
					actions += 1;
					return "graceful-control";
				},
			});
			expect(result.enabled).toBe(false);
			expect(result.selected).toEqual([]);
			expect(actions).toBe(0);
			const records = (await fs.readFile(getIdleReclaimerReceiptPath(agentDir), "utf8"))
				.trim()
				.split("\n")
				.map(line => JSON.parse(line) as { type: string; enabled: boolean });
			expect(records).toHaveLength(1);
			expect(records[0]).toMatchObject({ type: "idle-reclaimer-sweep", enabled: false });
		});
	});

	it("registers sessions resume as a management command", () => {
		expect(isSubcommand("sessions")).toBe(true);
		expect(resolveCliArgv(["sessions", "resume", "abc"])).toEqual({
			argv: ["sessions", "resume", "abc"],
		});
	});
});
