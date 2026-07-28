import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import { IrcExternalBus, isIrcExternalPeerFresh } from "../irc/bus-external";
import {
	decodeSessionControlCommand,
	isPolicyApplyControlCommand,
	SESSION_CONTROL_DB_PATH,
} from "../session/session-control";

export interface PolicyLiveSession {
	readonly sessionId: string;
	readonly name?: string;
	readonly workstream?: string;
	readonly appliedSequence: number;
}

interface PolicyCommandRow {
	command_json: string;
}

export interface PolicyFleetInspectionOptions {
	readonly ircDbPath?: string;
	readonly controlDbPath?: string;
	readonly nowMs?: number;
}

function appliedSequences(controlDbPath: string | undefined): ReadonlyMap<string, number> {
	const sequences = new Map<string, number>();
	if (controlDbPath === undefined || !fs.existsSync(controlDbPath)) return sequences;
	let database: Database | undefined;
	try {
		database = new Database(controlDbPath, { readonly: true });
		database.run("PRAGMA busy_timeout = 3000");
		const rows = database
			.query<PolicyCommandRow, []>(
				`SELECT c.command_json
				 FROM control_commands c
				 JOIN control_receipts r ON r.command_id=c.command_id
				 WHERE r.state='applied'
				 ORDER BY r.completed_at, r.rowid`,
			)
			.all();
		for (const row of rows) {
			const command = decodeSessionControlCommand(JSON.parse(row.command_json));
			if (!isPolicyApplyControlCommand(command)) continue;
			const current = sequences.get(command.sessionId) ?? 0;
			if (command.intent.policySequence > current) sequences.set(command.sessionId, command.intent.policySequence);
		}
	} catch {
		return new Map();
	} finally {
		database?.close();
	}
	return sequences;
}

/** Read-only fleet/session-control adapter for policy inspection surfaces. */
export function listLivePolicySessions(options: PolicyFleetInspectionOptions = {}): readonly PolicyLiveSession[] {
	let bus: IrcExternalBus | undefined;
	try {
		bus = new IrcExternalBus(options.ircDbPath, { readonly: true });
		const sequences = appliedSequences(options.controlDbPath ?? SESSION_CONTROL_DB_PATH);
		return bus
			.listPeers({ includeStale: true })
			.filter(peer => isIrcExternalPeerFresh(peer.lastSeen, options.nowMs))
			.map(peer => ({
				sessionId: peer.sessionId,
				name: peer.name,
				...(peer.fleetCapability?.workstream?.kind !== "workstream"
					? {}
					: { workstream: peer.fleetCapability.workstream.id }),
				appliedSequence: sequences.get(peer.sessionId) ?? 0,
			}));
	} catch {
		return [];
	} finally {
		bus?.close();
	}
}
