import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import type { CliConfig, CommandCtor } from "@oh-my-pi/pi-utils/cli";
import Fleet from "../src/commands/fleet";
import {
	collectFleetErrors,
	collectFleetStatus,
	formatFleetErrors,
	formatFleetPrune,
	formatFleetStatus,
	pruneFleetPeers,
} from "../src/cli/fleet-cli";
import { collectFleetOverview, formatFleetOverviewJson } from "../src/cli/fleet-overview";
import { formatFleetRolloutPlan } from "../src/cli/fleet-operation-format";

import { IrcExternalBus } from "../src/irc/bus-external";
import { createFleetCapability } from "../src/session/fleet-capability";
import { RolloutJournal } from "../src/session/rollout-journal";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../src/session/session-control";
import { FleetIncidentStore } from "../src/task/fleet-incident";

const NOW = Date.parse("2026-07-15T12:00:00.000Z");

// checkpoint-gate exports OMP_FLEET_REGISTER=0 (ephemeral-session roster guard);
// these fixtures construct real buses in tmp dbs and must register anyway.
process.env.OMP_FLEET_REGISTER = "1";

const FLEET_CONFIG: CliConfig = {
	bin: "omp",
	version: "test",
	commands: new Map<string, CommandCtor>(),
};

async function runFleet(argv: readonly string[]): Promise<void> {
	await new Fleet([...argv], FLEET_CONFIG).run();
}

async function runFleetWithOutput(argv: readonly string[]): Promise<string> {
	const originalWrite = process.stdout.write.bind(process.stdout);
	let output = "";
	process.stdout.write = ((chunk: string | Uint8Array): boolean => {
		output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
		return true;
	}) as typeof process.stdout.write;
	try {
		await runFleet(argv);
		return output;
	} finally {
		process.stdout.write = originalWrite;
	}
}

async function withFleetLabelFixture(
	setup: (bus: IrcExternalBus, root: string) => void,
	run: (ircDbPath: string) => Promise<void>,
): Promise<void> {
	using tempDir = TempDir.createSync("@omp-fleet-cli-label-");
	const previousHome = process.env.HOME;
	const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.HOME = tempDir.path();
	process.env.OMP_SESSION_CONTROL_DB = `${tempDir.path()}/control.sqlite`;
	const ircDbPath = `${tempDir.path()}/.omp/agent/irc-bus.sqlite`;
	try {
		const bus = new IrcExternalBus(ircDbPath);
		try {
			setup(bus, tempDir.path());
		} finally {
			bus.close();
		}
		await run(ircDbPath);
	} finally {
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	}
}

describe("fleet overview argument validation", () => {
	it("rejects unknown flags with the offending token and valid flags", async () => {
		await expect(runFleet(["overview", "--unknown-flag"])).rejects.toThrow(
			"overview does not accept --unknown-flag; valid flags: --all, --json, --workstream",
		);
	});

	it("rejects misspelled and irrelevant flags", async () => {
		await expect(runFleet(["overview", "--jso"])).rejects.toThrow(
			"overview does not accept --jso; valid flags: --all, --json, --workstream",
		);
		await expect(runFleet(["overview", "--digest", "abc"])).rejects.toThrow(
			"overview does not accept --digest; valid flags: --all, --json, --workstream",
		);
	});

	it("rejects extra positional arguments", async () => {
		await expect(runFleet(["overview", "session-a", "unexpected"])).rejects.toThrow(
			"overview does not accept unexpected; valid flags: --all, --json, --workstream",
		);
	});

	it("accepts the real overview flags", async () => {
		const output = await runFleetWithOutput(["overview", "--json", "--all", "--workstream", "fleet-alpha"]);
		expect(() => JSON.parse(output)).not.toThrow();
	});
});

describe("fleet label action", () => {
	it("applies summary, name, and workstream flags alone and together", async () => {
		await withFleetLabelFixture(
			(bus, root) => {
				for (const [sessionId, name] of [
					["summary-peer", "summary-spawn"],
					["name-peer", "name-spawn"],
					["workstream-peer", "workstream-spawn"],
					["combined-peer", "combined-spawn"],
				]) {
					bus.registerPeer({ sessionId, name, cwd: root });
				}
			},
			async ircDbPath => {
				const summaryOutput = await runFleetWithOutput(["label", "summary-peer", "--summary", "s".repeat(300)]);
				expect(summaryOutput).toBe("APPLIED\tsessionId=summary-peer\tfield=summary\n");

				const nameOutput = await runFleetWithOutput(["label", "name-peer", "--name", "name-renamed"]);
				expect(nameOutput).toBe("APPLIED\tsessionId=name-peer\tfield=name\n");

				const workstreamOutput = await runFleetWithOutput([
					"label",
					"workstream-peer",
					"--workstream",
					"fleet-alpha",
				]);
				expect(workstreamOutput).toBe("APPLIED\tsessionId=workstream-peer\tfield=workstream\n");

				const combinedOutput = await runFleetWithOutput([
					"label",
					"combined-peer",
					"--summary",
					"combined summary",
					"--name",
					"combined-renamed",
					"--workstream",
					"fleet-beta",
				]);
				expect(combinedOutput).toBe(
					[
						"APPLIED\tsessionId=combined-peer\tfield=summary",
						"APPLIED\tsessionId=combined-peer\tfield=name",
						"APPLIED\tsessionId=combined-peer\tfield=workstream",
						"",
					].join("\n"),
				);

				const verify = new IrcExternalBus(ircDbPath, { readonly: true });
				try {
					const peers = new Map(verify.listPeers({ includeStale: true }).map(peer => [peer.sessionId, peer]));
					expect(peers.get("summary-peer")?.labels?.summary).toHaveLength(280);
					expect(peers.get("name-peer")?.name).toBe("name-renamed");
					expect(peers.get("name-peer")?.labels?.spawnName).toBe("name-spawn");
					expect(peers.get("workstream-peer")?.labels?.workstream).toBe("fleet-alpha");
					expect(peers.get("combined-peer")?.name).toBe("combined-renamed");
					expect(peers.get("combined-peer")?.labels).toMatchObject({
						summary: "combined summary",
						workstream: "fleet-beta",
						spawnName: "combined-spawn",
					});
				} finally {
					verify.close();
				}
			},
		);
	});
	it("sets repeatable claims as a full set, clears them, and exposes them in overview JSON", async () => {
		await withFleetLabelFixture(
			(bus, root) => {
				bus.registerPeer({
					sessionId: "claims-peer",
					name: "claims-peer",
					cwd: root,
					labels: { claims: ["old-claim"] },
				});
			},
			async ircDbPath => {
				const setOutput = await runFleetWithOutput([
					"label",
					"claims-peer",
					"--claim",
					"src/",
					"--claim",
					"stream-alpha",
				]);
				expect(setOutput).toBe("APPLIED\tsessionId=claims-peer\tfield=claims\n");

				const afterSet = new IrcExternalBus(ircDbPath, { readonly: true });
				try {
					expect(afterSet.listPeers({ includeStale: true }).find(peer => peer.sessionId === "claims-peer")?.labels?.claims).toEqual([
						"src",
						"stream-alpha",
					]);
				} finally {
					afterSet.close();
				}

				const clearOutput = await runFleetWithOutput(["label", "claims-peer", "--claim", ""]);
				expect(clearOutput).toBe("APPLIED\tsessionId=claims-peer\tfield=claims\n");
				const afterClear = new IrcExternalBus(ircDbPath, { readonly: true });
				try {
					expect(afterClear.listPeers({ includeStale: true }).find(peer => peer.sessionId === "claims-peer")?.labels?.claims).toBeUndefined();
				} finally {
					afterClear.close();
				}

				const setAgainOutput = await runFleetWithOutput(["label", "claims-peer", "--claim", "src"]);
				expect(setAgainOutput).toBe("APPLIED\tsessionId=claims-peer\tfield=claims\n");
				const overviewOutput = await runFleetWithOutput(["overview", "--json"]);
				expect(() => JSON.parse(overviewOutput)).not.toThrow();
				const overviewRows = JSON.parse(
					formatFleetOverviewJson(collectFleetOverview({ ircDbPath, isProcessAlive: () => true })),
				) as Array<{ session_id: string; claims: readonly string[] }>;
				expect(overviewRows.find(row => row.session_id === "claims-peer")?.claims).toEqual(["src"]);
			},
		);
	});


	it("skips an explicit peer name while applying another field", async () => {
		await withFleetLabelFixture(
			(bus, root) => {
				bus.registerPeer({
					sessionId: "explicit-peer",
					name: "operator-name",
					cwd: root,
					explicitName: true,
				});
			},
			async ircDbPath => {
				const output = await runFleetWithOutput([
					"label",
					"explicit-peer",
					"--summary",
					"observer summary",
					"--name",
					"ambient-name",
				]);
				expect(output).toBe(
					[
						"APPLIED\tsessionId=explicit-peer\tfield=summary",
						"SKIPPED\tsessionId=explicit-peer\tfield=name\treason=explicit_name",
						"",
					].join("\n"),
				);
				const verify = new IrcExternalBus(ircDbPath, { readonly: true });
				try {
					const peer = verify.listPeers({ includeStale: true }).find(item => item.sessionId === "explicit-peer");
					expect(peer?.name).toBe("operator-name");
					expect(peer?.labels?.summary).toBe("observer summary");
				} finally {
					verify.close();
				}
			},
		);
	});

	it("rejects unknown sessions, zero flags, and unknown flags", async () => {
		await expect(runFleet(["label", "label-peer"])).rejects.toThrow(
			"label requires at least one of --summary, --name, --workstream",
		);
		await expect(runFleet(["label", "label-peer", "--unknown-flag"])).rejects.toThrow(
			"label does not accept --unknown-flag; valid flags: --summary, --name, --workstream",
		);
		await withFleetLabelFixture(
			(bus, root) => {
				bus.registerPeer({ sessionId: "known-peer", name: "known", cwd: root });
			},
			async () => {
				await expect(runFleet(["label", "missing-peer", "--summary", "summary"])).rejects.toThrow(
					"label unknown session missing-peer",
				);
			},
		);
	});
});

function journalText(args: {
	id: string;
	workstream: string;
	errors: ReadonlyArray<{
		id: string;
		cause: string;
		timestamp: number;
		buildDigest: string;
		buildVersion?: string;
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
			id: error.id,
			firstTimestamp: error.timestamp,
			lastTimestamp: error.timestamp,
			message: `failure ${error.cause}`,
			cause: error.cause,
			count: error.count ?? 1,
			unread: true,
			resolved: false,
			buildVersion: error.buildVersion,
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
						timestamp: NOW - 6_000,
						buildVersion: "16.0.1",
						buildDigest: "digest-a",
						rolloutId: "rollout-a",
						count: 1,
					},
					{
						id: "e1",
						cause: "network",
						timestamp: NOW - 5_000,
						buildVersion: "16.0.1",
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
		expect(projection.errors[0]?.buildVersion).toBe("16.0.1");
		expect(projection.errors.every(row => row.sourceJournalUri.startsWith("file://"))).toBe(true);
		expect(projection.incidents.map(incident => incident.id)).toEqual(["incident-network"]);
		const rendered = formatFleetErrors(projection);
		expect(rendered).toContain("BUILD_VERSION\tBUILD_DIGEST");
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
		expect(rows[0]?.rssMb).toBeGreaterThan(0);
		expect(rows[0]?.cpuPercent).toBeGreaterThanOrEqual(0);
		expect(rows[0]?.uptime).toMatch(/^(?:\d+-)?\d{1,3}:\d{2}(?::\d{2})?$/);
		const statusOutput = formatFleetStatus(rows);
		expect(statusOutput.split("\n")[0]).toContain("RSS_MB\tCPU%\tUPTIME");
		expect(statusOutput.trimEnd().split("\n")).toHaveLength(3);
		expect(rows[0]?.rollout).toBe("rollout-current:planned");
		expect(rows[1]?.buildDigest).toBe("legacy-digest");
		expect(formatFleetStatus(rows)).toContain("session-stale\tstale-peer\tfleet-alpha\tstale\tworking");
		const freshOnly = await collectFleetStatus({ ircDbPath, controlDbPath, nowMs: NOW });
		expect(freshOnly.map(row => row.sessionId)).toEqual(["session-fresh"]);
		await collectFleetErrors({ sessionsRoot: root, controlDbPath });
		const after = await Promise.all(sourcePaths.map(bytes));
		expect(after).toEqual(before);
	});

	it("renders dashes for a dead peer process", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-cli-resources-");
		const ircDbPath = `${tempDir.path()}/irc.sqlite`;
		const controlDbPath = `${tempDir.path()}/control.sqlite`;
		const bus = new IrcExternalBus(ircDbPath);
		bus.registerPeer({
			sessionId: "dead-session",
			name: "dead-peer",
			cwd: tempDir.path(),
			pid: 999_999_999,
		});
		bus.updatePeerState("dead-session", "idle");
		bus.close();

		const rows = await collectFleetStatus({ ircDbPath, controlDbPath, all: true });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.rssMb).toBeUndefined();
		const output = formatFleetStatus(rows);
		expect(output.trimEnd().split("\n")).toHaveLength(2);
		expect(output.trimEnd().split("\n")[1]?.endsWith("\t-\t-\t-")).toBe(true);
	});

	it("does not project recovered onto an old-digest peer row", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-cli-recovered-");
		const sessionFile = `${tempDir.path()}/session.jsonl`;
		await Bun.write(sessionFile, journalText({ id: "saved-session", workstream: "fleet-alpha", errors: [] }));
		const ircDbPath = `${tempDir.path()}/irc.sqlite`;
		const bus = new IrcExternalBus(ircDbPath);
		bus.registerPeer({
			sessionId: "saved-session",
			name: "old-peer",
			cwd: "/fixture",
			sessionFile,
			ownerEpoch: "old-epoch",
			buildDigest: "old-digest",
			version: "1.2.2",
		});
		bus.updatePeerState("saved-session", "idle");
		bus.close();
		const editDb = new Database(ircDbPath);
		editDb.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id = 'saved-session'").run({
			$lastSeen: new Date(NOW - 20 * 60_000).toISOString(),
		});
		editDb.close();

		const controlDbPath = `${tempDir.path()}/control.sqlite`;
		const rollout = new RolloutJournal(controlDbPath);
		rollout.beginRun({ rolloutId: "rollout-recovered", targetDigest: "new-digest", targetVersion: "1.2.3" });
		for (const phase of ["planned", "requested", "applied", "recovered"] as const) {
			rollout.updatePeer({
				rolloutId: "rollout-recovered",
				sessionId: "saved-session",
				sessionFile,
				name: "saved-session",
				phase,
			});
		}
		rollout.close();

		const rows = await collectFleetStatus({ ircDbPath, controlDbPath, all: true, nowMs: NOW });
		expect(rows).toHaveLength(1);
		expect(rows[0]?.buildDigest).toBe("old-digest");
		expect(rows[0]?.rollout).toBe("-");
	});

	it("dry-runs and applies only stale dead test/temp heartbeat rows without deleting journals", async () => {
		using tempDir = TempDir.createSync("@omp-fleet-cli-prune-");
		const ircDbPath = `${tempDir.path()}/irc.sqlite`;
		const journalPath = `${tempDir.path()}/session.jsonl`;
		await Bun.write(journalPath, '{"type":"session"}\n');
		const bus = new IrcExternalBus(ircDbPath);
		const fakeCapability = createFleetCapability({
			buildDigest: "0".repeat(64),
			productVersion: "session-runner-test",
			controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
		});
		bus.registerPeer({
			sessionId: "stale-test",
			name: "fixture",
			cwd: tempDir.path(),
			pid: 999_999,
			sessionFile: journalPath,
			buildDigest: "0".repeat(64),
			version: "session-runner-test",
			fleetCapability: fakeCapability,
		});
		bus.registerPeer({
			sessionId: "stale-legitimate",
			name: "legacy",
			cwd: "/Users/operator/project",
			pid: 999_998,
			sessionFile: journalPath,
		});
		bus.registerPeer({
			sessionId: "fresh-test",
			name: "fresh-fixture",
			cwd: tempDir.path(),
			pid: 999_997,
			buildDigest: "0".repeat(64),
			version: "session-runner-test",
			fleetCapability: fakeCapability,
		});
		bus.close();
		const editDb = new Database(ircDbPath);
		editDb.query("UPDATE peers SET last_seen = $lastSeen WHERE session_id <> 'fresh-test'").run({
			$lastSeen: new Date(NOW - 8 * 24 * 60 * 60 * 1000).toISOString(),
		});
		editDb.close();

		const before = await bytes(ircDbPath);
		const preview = pruneFleetPeers({
			ircDbPath,
			nowMs: NOW,
			retentionMs: 7 * 24 * 60 * 60 * 1000,
			isProcessAlive: () => false,
		});
		expect(preview.candidates.map(item => item.peer.sessionId)).toEqual(["stale-test"]);
		expect(preview.deleted).toBe(0);
		expect(formatFleetPrune(preview, false)).toContain("DRY_RUN\tcandidates=1\tdeleted=0");
		expect(await bytes(ircDbPath)).toEqual(before);

		const applied = pruneFleetPeers({
			ircDbPath,
			nowMs: NOW,
			retentionMs: 7 * 24 * 60 * 60 * 1000,
			isProcessAlive: () => false,
			apply: true,
		});
		expect(applied.deleted).toBe(1);
		const verify = new IrcExternalBus(ircDbPath, { readonly: true });
		expect(
			verify
				.listPeers({ includeStale: true })
				.map(peer => peer.sessionId)
				.sort(),
		).toEqual(["fresh-test", "stale-legitimate"]);
		verify.close();
		expect(await Bun.file(journalPath).text()).toBe('{"type":"session"}\n');
	});

	it("prints typed per-target rollout failures", () => {
		const output = formatFleetRolloutPlan({
			mode: "active",
			plan: {
				fleetRolloutId: "rollout-failed",
				target: { digest: "a".repeat(64), source: { kind: "blessed" } },
				previousDigest: "b".repeat(64),
				waves: [],
				excluded: [],
				orderedTargets: [],
				maxUnavailable: 1,
			},
			execution: {
				state: "Frozen",
				completed: [],
				skipped: [],
				failures: [
					{
						targetId: "target-1",
						sessionId: "session-1",
						phaseReached: "CordonRequested",
						awaitedCondition: "prepare-rollout terminal receipt",
						commandId: "command-1",
						timedOut: true,
						buildVersion: "16.0.1",
						buildDigest: "digest-target",
						cause: "Timed out\nlast receipt state=requested",
					},
				],
			},
		});
		expect(output).toContain("EXECUTION\tFrozen\t-");
		expect(output).toContain(
			"TARGET_ERROR\ttargetId=target-1\tsessionId=session-1\tphase=CordonRequested\tawaited=prepare-rollout terminal receipt\tcommandId=command-1\ttimedOut=true\tbuildVersion=16.0.1\tbuildDigest=digest-target\tcause=Timed out last receipt state=requested",
		);
	});
	it("prints succeeded rollout skips once with a normalized reason", () => {
		const output = formatFleetRolloutPlan({
			mode: "active",
			plan: {
				fleetRolloutId: "rollout-skipped",
				target: { digest: "a".repeat(64), source: { kind: "blessed" } },
				previousDigest: "b".repeat(64),
				waves: [],
				excluded: [],
				orderedTargets: [],
				maxUnavailable: 1,
			},
			execution: {
				state: "Succeeded",
				completed: ["session-2"],
				skipped: [
					{
						targetId: "target-1",
						sessionId: "session-1",
						phaseReached: "CordonRequested",
						commandId: "command-1",
						reason: "state command\nstill in flight",
					},
				],
			},
		});
		expect(output).toContain("EXECUTION\tSucceeded\tsession-2");
		expect(output).toContain(
			"SKIPPED\ttargetId=target-1\tsessionId=session-1\tphase=CordonRequested\tcommandId=command-1\treason=state command still in flight",
		);
		expect(output).not.toContain("TARGET_ERROR");
		expect(output.match(/^SKIPPED\t/gm)).toHaveLength(1);
	});

});
