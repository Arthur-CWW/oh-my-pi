import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { expandSlashCommandAsync, type FileSlashCommand } from "../../src/extensibility/slash-commands";
import { IrcExternalBus } from "../../src/irc/bus-external";
import { createFleetCapability } from "../../src/session/fleet-capability";
import { buildAwayPacket } from "../../src/session/away-packet";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../../src/session/session-control";
import { resolvePromptVariables, type PromptVariableContext } from "../../src/commands/prompt-vars";

const command = (content: string): FileSlashCommand => ({
	name: "brief",
	description: "brief fixture",
	content,
	source: "test",
});

function context(journalPath: string, nowMs: number): PromptVariableContext {
	return {
		nowMs,
		session: {
			sessionId: "session-brief",
			name: "BriefSession",
			workstream: "harness",
			goal: { objective: "Ship prompt variables", status: "active" },
			todoHead: "Wire expansion seam",
			journalPath,
			binaryVersion: "1.0.0",
			binaryDigest: "a".repeat(64),
		},
	};
}

function baseJournalEntries(): Record<string, unknown>[] {
	return [
		{
			type: "session",
			version: 4,
			id: "session-brief",
			timestamp: "2026-07-17T20:00:00.000Z",
			cwd: "/tmp/brief",
		},
		{
			type: "message",
			id: "human",
			parentId: null,
			timestamp: "2026-07-17T21:33:00.000Z",
			message: { role: "user", attribution: "user", content: [{ type: "text", text: "pause" }] },
		},
		{
			type: "custom",
			id: "pre-away",
			parentId: null,
			timestamp: "2026-07-17T21:00:00.000Z",
			customType: "child_lifecycle",
			data: {
				version: 1,
				agentId: "old-child",
				childSessionFile: "/tmp/old.jsonl",
				parentSessionFile: "/tmp/brief.jsonl",
				state: "completed",
				updatedAt: "2026-07-17T21:00:00.000Z",
			},
		},
		{
			type: "custom_message",
			id: "hidden-continuation",
			parentId: null,
			timestamp: "2026-07-17T23:30:00.000Z",
			customType: "goal-continuation",
			content: "continue",
			display: false,
			attribution: "agent",
		},
		{
			type: "message",
			id: "steer",
			parentId: null,
			timestamp: "2026-07-17T23:45:00.000Z",
			message: { role: "user", attribution: "user", steering: true, content: [{ type: "text", text: "steer" }] },
		},
		{
			type: "custom",
			id: "child",
			parentId: null,
			timestamp: "2026-07-17T23:00:00.000Z",
			customType: "child_lifecycle",
			data: {
				version: 1,
				agentId: "new-child",
				childSessionFile: "/tmp/new.jsonl",
				parentSessionFile: "/tmp/brief.jsonl",
				state: "running",
				updatedAt: "2026-07-17T23:00:00.000Z",
				label: "Parser",
			},
		},
		{
			type: "custom",
			id: "error",
			parentId: null,
			timestamp: "2026-07-18T00:00:00.000Z",
			customType: "ui_error",
			data: { version: 2, lastTimestamp: Date.parse("2026-07-18T00:00:00.000Z"), cause: "provider", message: "rate limited" },
		},
		{
			type: "custom",
			id: "todo",
			parentId: null,
			timestamp: "2026-07-18T01:00:00.000Z",
			customType: "user_todo_edit",
			data: { phases: [{ name: "Build", tasks: [{ content: "Finish packet", status: "in_progress" }] }] },
		},
		{
			type: "workflow_change",
			id: "goal",
			parentId: null,
			timestamp: "2026-07-18T02:00:00.000Z",
			from: { kind: "goal", phase: "active", goalId: "goal-1" },
			previous: { mode: { kind: "goal", phase: "active", goalId: "goal-1" }, activeToolNames: [] },
			next: { kind: "none" },
			command: {
				schemaVersion: 1,
				commandId: "goal-complete",
				correlationId: "goal-complete-correlation",
				expectedSessionRevision: 1,
				committedSessionRevision: 2,
				request: { kind: "transitionGoalMode", transition: { kind: "exit", goalId: "goal-1", disposition: "completed" } },
			},
		},
	];
}

async function writeJournal(path: string, entries = baseJournalEntries()): Promise<void> {
	await Bun.write(path, `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`);
}

describe("prompt variable expansion", () => {
	it("resolves all v1 variables with arguments and preserves unknown variables", async () => {
		using tmp = TempDir.createSync("@omp-prompt-vars-");
		const journalPath = `${tmp.path()}/brief.jsonl`;
		await writeJournal(journalPath);
		const nowMs = Date.parse("2026-07-18T04:15:00.000Z");
		const result = await expandSlashCommandAsync(
			"/brief ship it",
			[command("$SESSION_META\n$AWAY_PACKET\n$FLEET_COMPACT\n$ARGUMENTS\n$UNKNOWN")],
			context(journalPath, nowMs),
		);
		expect(result).toContain("session_id: session-brief");
		expect(result).toContain("goal: Ship prompt variables [active]");
		expect(result).toContain("AWAY 6h42m");
		expect(result).toContain("ship it");
		expect(result).toContain("$UNKNOWN");
	});

	it("leaves a command without variables on the legacy expansion path", async () => {
		using tmp = TempDir.createSync("@omp-prompt-vars-");
		const journalPath = `${tmp.path()}/brief.jsonl`;
		await writeJournal(journalPath);
		const result = await expandSlashCommandAsync("/brief input", [command("No variables")], context(journalPath, Date.now()));
		expect(result).toBe("No variables\n\ninput");
	});
});

describe("away packet", () => {
	it("uses only real human user records as the away clock", async () => {
		using tmp = TempDir.createSync("@omp-away-packet-");
		const journalPath = `${tmp.path()}/brief.jsonl`;
		await writeJournal(journalPath);
		const packet = await buildAwayPacket({ journalPath, nowMs: Date.parse("2026-07-18T04:15:00.000Z") });
		expect(packet).toContain("AWAY 6h42m (2026-07-17 21:33 → 2026-07-18 04:15)");
		expect(packet).toContain("id=new-child label=Parser");
		expect(packet).toContain("provider: rate limited");
		expect(packet).toContain("todo Build: Finish packet [in_progress]");
		expect(packet).toContain("goal completed: goal-1");
		expect(packet).not.toContain("old-child");
	});

	it("bounds deltas and reports overflow counts", async () => {
		using tmp = TempDir.createSync("@omp-away-packet-");
		const journalPath = `${tmp.path()}/brief.jsonl`;
		const entries = baseJournalEntries();
		for (let index = 0; index < 100; index += 1) {
			entries.push({
				type: "custom",
				id: `child-${index}`,
				parentId: null,
				timestamp: "2026-07-18T03:00:00.000Z",
				customType: "child_lifecycle",
				data: {
					version: 1,
					agentId: `worker-${index}`,
					childSessionFile: `/tmp/${index}.jsonl`,
					parentSessionFile: "/tmp/brief.jsonl",
					state: "completed",
					updatedAt: `2026-07-18T03:${String(index % 60).padStart(2, "0")}:00.000Z`,
				},
			});
		}
		await writeJournal(journalPath, entries);
		const packet = await buildAwayPacket({ journalPath, nowMs: Date.parse("2026-07-18T04:15:00.000Z") });
		expect(packet.split("\n").length).toBeLessThanOrEqual(80);
		expect(packet).toContain("more lifecycle events");
	});
});

describe("fleet compact", () => {
	it("formats live peers, excludes stale peers, and bounds rows", () => {
		using tmp = TempDir.createSync("@omp-fleet-compact-");
		const dbPath = `${tmp.path()}/bus.sqlite`;
		// checkpoint-gate exports OMP_FLEET_REGISTER=0; this fixture bus must register anyway.
		const priorRegister = process.env.OMP_FLEET_REGISTER;
		process.env.OMP_FLEET_REGISTER = "1";
		const bus = new IrcExternalBus(dbPath);
		if (priorRegister === undefined) delete process.env.OMP_FLEET_REGISTER;
		else process.env.OMP_FLEET_REGISTER = priorRegister;
		for (let index = 0; index < 45; index += 1) {
			const id = `peer-${index}`;
			bus.registerPeer({
				sessionId: id,
				name: `Peer${index}`,
				cwd: tmp.path(),
				pid: process.pid,
				labels: { objective: `Objective ${index}`, summary: `Summary ${index}` },
				fleetCapability: createFleetCapability({
					buildDigest: "a".repeat(64),
					productVersion: "1.0.0",
					controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
				}),
			});
			bus.updatePeerState(id, "working");
		}
		const db = new Database(dbPath);
		db.run("UPDATE peers SET last_seen = ? WHERE session_id = ?", ["2020-01-01T00:00:00.000Z", "peer-44"]);
		db.close();
		bus.close();

		const result = resolvePromptVariables(
			"$FLEET_COMPACT",
			{
				nowMs: Date.now(),
				session: {
					sessionId: "local",
					name: "local",
					workstream: "harness",
					todoHead: "",
					journalPath: "",
					binaryVersion: "1.0.0",
					binaryDigest: "a".repeat(64),
				},
				fleet: { ircDbPath: dbPath },
			},
		);
		expect(result).toBeInstanceOf(Promise);
		return result.then(compact => {
			expect(compact).not.toContain("Peer44");
			expect(compact).toContain("Peer0 | working | - | Summary 0 | version-skew=same");
			expect(compact).toContain("more peers");
			expect(compact.split("\n").length).toBeLessThanOrEqual(40);
		});
	});
});
