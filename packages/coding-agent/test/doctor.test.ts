import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { formatDoctorReport, runDoctor } from "../src/commands/doctor";
import { IrcExternalBus } from "../src/irc/bus-external";
import { createFleetCapability } from "../src/session/fleet-capability";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../src/session/session-control";
import { registerKernelOwnership } from "../src/eval/kernel-ownership";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");
const BUILD_DIGEST = "a".repeat(64);

function journal(id: string): string {
	return `${JSON.stringify({
		type: "session",
		version: 4,
		id,
		timestamp: "2026-07-15T10:00:00.000Z",
		cwd: "/fixture",
	})}\n`;
}

describe("omp doctor", () => {
	it("reports and applies only dead stale peers and dead promote locks", async () => {
		using tempDir = TempDir.createSync("@omp-doctor-");
		const ircDbPath = `${tempDir.path()}/irc.sqlite`;
		const sessionsRoot = `${tempDir.path()}/sessions`;
		const deadJournal = `${sessionsRoot}/dead/dead.jsonl`;
		const liveJournal = `${sessionsRoot}/live/live.jsonl`;
		await Bun.write(deadJournal, journal("dead-session"));
		await Bun.write(liveJournal, journal("live-session"));
		const capability = createFleetCapability({
			buildDigest: BUILD_DIGEST,
			productVersion: "16.0.1",
			controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
		});
		const bus = new IrcExternalBus(ircDbPath);
		bus.registerPeer({
			sessionId: "dead-session",
			name: "dead-fixture",
			cwd: tempDir.path(),
			pid: 999_991,
			sessionFile: deadJournal,
			buildDigest: BUILD_DIGEST,
			version: "16.0.1",
			fleetCapability: capability,
		});
		bus.registerPeer({
			sessionId: "live-session",
			name: "live-session",
			cwd: tempDir.path(),
			pid: process.pid,
			sessionFile: liveJournal,
			buildDigest: BUILD_DIGEST,
			version: "16.0.1",
			fleetCapability: capability,
		});
		bus.updatePeerState("dead-session", "idle");
		bus.updatePeerState("live-session", "working");
		bus.close();

		const database = new Database(ircDbPath);
		database
			.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id = 'dead-session'")
			.run({ $lastSeen: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() });
		database
			.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id = 'live-session'")
			.run({ $lastSeen: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString() });
		database.close();

		const promoteLockPath = `${tempDir.path()}/promote.lock`;
		await Bun.write(
			promoteLockPath,
			JSON.stringify({ pid: 999_992, token: "dead-lock", timestamp: NOW - 60 * 60 * 1000 }),
		);
		const journalBefore = await Bun.file(liveJournal).bytes();
		const preview = await runDoctor({
			ircDbPath,
			sessionsRoot,
			promoteLockPath,
			nowMs: NOW,
			isProcessAlive: pid => pid === process.pid,
		});
		expect(preview.mode).toBe("read-only");
		expect(preview.actions).toMatchObject({ pruneCandidates: 1, peersPruned: 0, stalePromoteLockCleared: false });
		expect(preview.findings.filter(item => item.kind === "dead-stale-peer")).toHaveLength(1);
		expect(preview.findings.filter(item => item.kind === "orphaned-test-temp-row")).toHaveLength(1);
		const lockPreview = preview.findings.find(item => item.kind === "promote-lock");
		expect(lockPreview).toMatchObject({ severity: "warning", safeToApply: true, applied: false });
		expect(JSON.parse(formatDoctorReport(preview))).toMatchObject({ schemaVersion: 1, mode: "read-only" });

		const applied = await runDoctor({
			ircDbPath,
			sessionsRoot,
			promoteLockPath,
			nowMs: NOW,
			apply: true,
			isProcessAlive: pid => pid === process.pid,
		});
		expect(applied.actions).toMatchObject({ pruneCandidates: 1, peersPruned: 1, stalePromoteLockCleared: true });
		expect(applied.summary.applied).toBe(3);
		expect(applied.findings.filter(item => item.applied)).toHaveLength(3);
		expect(await Bun.file(promoteLockPath).exists()).toBe(false);
		expect(await Bun.file(liveJournal).bytes()).toEqual(journalBefore);

		const verify = new IrcExternalBus(ircDbPath, { readonly: true });
		expect(verify.listPeers({ includeStale: true }).map(peer => peer.sessionId)).toEqual(["live-session"]);
		verify.close();
	});
	it("reports orphaned kernels with owner attribution and spares live owners", async () => {
		using tempDir = TempDir.createSync("@omp-doctor-kernel-");
		const dead = await registerKernelOwnership({
			kind: "python",
			kernelId: "dead-kernel",
			sessionId: "dead-session",
			ownerPid: 999_991,
			kernelPid: 999_992,
			root: tempDir.path(),
		});
		const live = await registerKernelOwnership({
			kind: "node-repl",
			kernelId: "live-kernel",
			sessionId: "live-session",
			ownerPid: process.pid,
			kernelPid: process.pid,
			root: tempDir.path(),
		});

		const preview = await runDoctor({
			kernelOwnershipRoot: tempDir.path(),
			isProcessAlive: pid => pid === process.pid,
		});
		expect(preview.findings.filter(item => item.kind === "orphaned-kernels")).toMatchObject([
			{ evidence: { sessionId: "dead-session", ownerPid: 999_991 }, safeToApply: true, applied: false },
		]);
		expect(preview.actions.orphanedKernels).toBe(1);
		expect(await Bun.file(dead.path).exists()).toBe(true);
		expect(await Bun.file(live.path).exists()).toBe(true);

		const applied = await runDoctor({
			kernelOwnershipRoot: tempDir.path(),
			apply: true,
			isProcessAlive: pid => pid === process.pid,
		});
		expect(applied.actions.kernelsReaped).toBe(1);
		expect(applied.findings.find(item => item.kind === "orphaned-kernels")?.applied).toBe(true);
		expect(await Bun.file(dead.path).exists()).toBe(false);
		expect(await Bun.file(live.path).exists()).toBe(true);
		await live.unregister();
	}, 20_000);
});
