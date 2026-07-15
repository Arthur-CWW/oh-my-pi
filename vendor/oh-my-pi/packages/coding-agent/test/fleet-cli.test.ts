import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { collectFleetErrors, collectFleetStatus, formatFleetErrors, formatFleetStatus } from "../src/cli/fleet-cli";
import { IrcExternalBus } from "../src/irc/bus-external";
import { createFleetCapability } from "../src/session/fleet-capability";
import { RolloutJournal } from "../src/session/rollout-journal";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../src/session/session-control";
import { FleetIncidentStore } from "../src/task/fleet-incident";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");

function journalText(args: {
	id: string;
	workstream: string;
	errors: ReadonlyArray<{
		id: string;
		cause: string;
		timestamp: number;
		buildDigest: string;
		rolloutId?: string;
		count?: number;
	}>;
}): string {
	const header = {
		type: "session",
		version: 4,
		id: args.id,
		timestamp: "2026-07-15T10:00:00.000Z",
		cwd: "/fixture",
		workstream: { kind: "workstream", id: args.workstream },
	};
	const entries = args.errors.map(error => ({
		type: "custom",
		id: error.id,
		parentId: null,
		timestamp: new Date(error.timestamp).toISOString(),
		customType: "ui_error",
		data: {
			version: 2,
			firstTimestamp: error.timestamp,
			lastTimestamp: error.timestamp,
			message: `failure ${error.cause}`,
			cause: error.cause,
			count: error.count ?? 1,
			unread: true,
			resolved: false,
			buildDigest: error.buildDigest,
			rolloutId: error.rolloutId,
		},
	}));
	return `${[...[header], ...entries].map(value => JSON.stringify(value)).join("\n")}\n`;
}

async function bytes(path: string): Promise<readonly number[]> {
	return Array.from(await Bun.file(path).bytes());
}

describe("fleet inspection projections", () => {
	it("groups and filters journaled errors while keeping incidents distinct and source-addressable", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-cli-errors-");
		const root = `${tempDir.path()}/sessions`;
		const alphaDir = `${root}/alpha`;
		const betaDir = `${root}/beta`;
		await Bun.write(
			`${alphaDir}/alpha.jsonl`,
			journalText({
				id: "session-alpha",
				workstream: "fleet-alpha",
				errors: [
					{
						id: "e1",
						cause: "network",
						timestamp: NOW - 5_000,
						buildDigest: "digest-a",
						rolloutId: "rollout-a",
						count: 2,
					},
					{ id: "e2", cause: "provider", timestamp: NOW - 4_000, buildDigest: "digest-a" },
				],
			}),
		);
		await Bun.write(
			`${betaDir}/beta.jsonl`,
			journalText({
				id: "session-beta",
				workstream: "fleet-beta",
				errors: [
					{ id: "e3", cause: "network", timestamp: NOW - 3_000, buildDigest: "digest-b", rolloutId: "rollout-b" },
				],
			}),
		);
		const controlDbPath = `${tempDir.path()}/control.sqlite`;
		const incidentStore = new FleetIncidentStore(controlDbPath, {
			threshold: 1,
			now: () => NOW - 2_000,
			createId: () => "incident-network",
		});
		incidentStore.recordFailure({
			evidenceKey: "incident-evidence",
			agent: "remote-agent",
			job: "network-job",
			failureClass: "network",
			occurredAt: NOW - 2_000,
			journalUri: "history://remote-agent",
			message: "shared outage",
		});
		incidentStore.close();

		const projection = await collectFleetErrors({ sessionsRoot: root, controlDbPath, nowMs: NOW });
		expect(projection.errors.map(row => [row.sessionId, row.cause, row.count])).toEqual([
			["session-alpha", "network", 2],
			["session-alpha", "provider", 1],
			["session-beta", "network", 1],
		]);
		expect(projection.errors.every(row => row.sourceJournalUri.startsWith("file://"))).toBe(true);
		expect(projection.incidents.map(incident => incident.id)).toEqual(["incident-network"]);
		const rendered = formatFleetErrors(projection);
		expect(rendered).toContain("ERRORS\nSESSION\tWORKSTREAM\tCAUSE");
		expect(rendered).toContain("file://");
		expect(rendered).toContain("INCIDENTS\nINCIDENT\tSTATUS\tCAUSE");

		const bySession = await collectFleetErrors({ sessionsRoot: root, controlDbPath, session: "session-beta" });
		expect(bySession.errors.map(row => row.cause)).toEqual(["network"]);
		const byWorkstream = await collectFleetErrors({ sessionsRoot: root, controlDbPath, workstream: "fleet-alpha" });
		expect(byWorkstream.errors.map(row => row.cause)).toEqual(["network", "provider"]);
		const byRollout = await collectFleetErrors({ sessionsRoot: root, controlDbPath, rollout: "rollout-a" });
		expect(byRollout.errors.map(row => row.sessionId)).toEqual(["session-alpha"]);
		const recent = await collectFleetErrors({ sessionsRoot: root, controlDbPath, since: "4s", nowMs: NOW });
		expect(recent.errors.map(row => row.sessionId)).toEqual(["session-alpha", "session-beta"]);
	});

	it("shows stale peers with --all, compatibility and rollout state without mutating sources", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-cli-status-");
		const root = `${tempDir.path()}/sessions`;
		const freshJournal = `${root}/fresh/fresh.jsonl`;
		const staleJournal = `${root}/stale/stale.jsonl`;
		await Bun.write(freshJournal, journalText({ id: "session-fresh", workstream: "fleet-alpha", errors: [] }));
		await Bun.write(staleJournal, journalText({ id: "session-stale", workstream: "fleet-alpha", errors: [] }));
		const ircDbPath = `${tempDir.path()}/irc.sqlite`;
		const capability = createFleetCapability({
			buildDigest: "digest-current",
			productVersion: "1.2.3",
			controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
			workstream: { kind: "workstream", id: "fleet-alpha" },
		});
		const bus = new IrcExternalBus(ircDbPath);
		bus.registerPeer({
			sessionId: "session-fresh",
			name: "fresh-peer",
			cwd: "/fixture",
			sessionFile: freshJournal,
			ownerEpoch: "epoch-fresh",
			fleetCapability: capability,
		});
		bus.updatePeerState("session-fresh", "idle");
		bus.registerPeer({
			sessionId: "session-stale",
			name: "stale-peer",
			cwd: "/fixture",
			sessionFile: staleJournal,
			ownerEpoch: "epoch-stale",
			buildDigest: "legacy-digest",
			version: "0.9.0",
		});
		bus.updatePeerState("session-stale", "working");
		bus.close();
		const editDb = new Database(ircDbPath);
		editDb.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id = 'session-stale'").run({
			$lastSeen: new Date(NOW - 20 * 60_000).toISOString(),
		});
		editDb.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id = 'session-fresh'").run({
			$lastSeen: new Date(NOW - 1_000).toISOString(),
		});
		editDb.close();
		const controlDbPath = `${tempDir.path()}/control.sqlite`;
		const rollout = new RolloutJournal(controlDbPath);
		rollout.beginRun({ rolloutId: "rollout-current", targetDigest: "digest-current", targetVersion: "1.2.3" });
		rollout.updatePeer({
			rolloutId: "rollout-current",
			sessionId: "session-fresh",
			sessionFile: freshJournal,
			name: "fresh-peer",
			phase: "planned",
		});
		rollout.close();

		const sourcePaths = [freshJournal, staleJournal, ircDbPath, controlDbPath];
		const before = await Promise.all(sourcePaths.map(bytes));
		const rows = await collectFleetStatus({ ircDbPath, controlDbPath, all: true, nowMs: NOW });
		expect(rows.map(row => [row.sessionId, row.freshness, row.compatibility])).toEqual([
			["session-fresh", "fresh", "compatible"],
			["session-stale", "stale", "LegacyIncompatible"],
		]);
		expect(rows[0]?.rollout).toBe("rollout-current:planned");
		expect(rows[1]?.buildDigest).toBe("legacy-digest");
		expect(formatFleetStatus(rows)).toContain("session-stale\tstale-peer\tfleet-alpha\tstale\tworking");
		const freshOnly = await collectFleetStatus({ ircDbPath, controlDbPath, nowMs: NOW });
		expect(freshOnly.map(row => row.sessionId)).toEqual(["session-fresh"]);
		await collectFleetErrors({ sessionsRoot: root, controlDbPath });
		const after = await Promise.all(sourcePaths.map(bytes));
		expect(after).toEqual(before);
	});
});
