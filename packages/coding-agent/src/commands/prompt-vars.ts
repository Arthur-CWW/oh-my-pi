import { collectFleetOverview } from "../cli/fleet-overview";
import { IRC_EXTERNAL_STALE_MS } from "../irc/bus-external";
import { buildAwayPacket } from "../session/away-packet";

export interface PromptVariableSession {
	readonly sessionId: string;
	readonly name: string;
	readonly workstream: string;
	readonly goal?: { readonly objective: string; readonly status: string };
	readonly todoHead: string;
	readonly journalPath: string;
	readonly binaryVersion: string;
	readonly binaryDigest: string;
}

export interface PromptVariableContext {
	readonly session: PromptVariableSession;
	readonly nowMs?: number;
	readonly fleet?: {
		readonly ircDbPath?: string;
		readonly isProcessAlive?: (pid: number) => boolean;
	};
}

export type PromptVariableName = "$SESSION_META" | "$AWAY_PACKET" | "$FLEET_COMPACT";
export type PromptVariableProvider = (context: PromptVariableContext) => string | Promise<string>;

function printable(value: string): string {
	return value.replace(/[\t\r\n]+/g, " ").trim();
}

function truncate(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max - 3)}...`;
}

function sessionMeta(context: PromptVariableContext): string {
	const session = context.session;
	const goal = session.goal ? `${printable(session.goal.objective)} [${printable(session.goal.status)}]` : "-";
	return [
		"SESSION_META",
		`session_id: ${printable(session.sessionId) || "-"}`,
		`name: ${printable(session.name) || "-"}`,
		`workstream: ${printable(session.workstream) || "-"}`,
		`goal: ${goal}`,
		`todo: ${printable(session.todoHead) || "-"}`,
		`journal: ${printable(session.journalPath) || "-"}`,
		`binary: ${printable(session.binaryVersion) || "-"} ${printable(session.binaryDigest) || "-"}`,
	].join("\n");
}

function versionSkew(context: PromptVariableContext, peerVersion: string): string {
	const localVersion = context.session.binaryVersion;
	if (!peerVersion || !localVersion) return "unknown";
	return peerVersion === localVersion ? "same" : "YES";
}

function fleetCompact(context: PromptVariableContext): string {
	const nowMs = context.nowMs ?? Date.now();
	const rows = collectFleetOverview({
		nowMs,
		ircDbPath: context.fleet?.ircDbPath,
		isProcessAlive: context.fleet?.isProcessAlive,
	}).filter(row => {
		const lastSeen = Date.parse(row.lastSeen);
		return Number.isFinite(lastSeen) && nowMs - lastSeen < IRC_EXTERNAL_STALE_MS;
	});
	const lines = ["FLEET_COMPACT"];
	const maxRows = 38;
	for (const row of rows.slice(0, maxRows)) {
		const summary = row.summary || row.objective || row.activity || row.todoHead || "-";
		lines.push(
			[
				printable(row.name) || "-",
				printable(row.displayState) || "-",
				printable(row.workstream) || "-",
				truncate(printable(summary), 80) || "-",
				`version-skew=${versionSkew(context, row.version)}`,
			].join(" | "),
		);
	}
	const overflow = rows.length - maxRows;
	if (overflow > 0) lines.push(`... ${overflow} more peers`);
	return lines.join("\n");
}

const PROMPT_VARIABLE_PROVIDERS: Record<PromptVariableName, PromptVariableProvider> = {
	$SESSION_META: sessionMeta,
	$AWAY_PACKET: context => buildAwayPacket({ journalPath: context.session.journalPath, nowMs: context.nowMs }),
	$FLEET_COMPACT: fleetCompact,
};

export function promptVariableNames(): readonly PromptVariableName[] {
	return Object.keys(PROMPT_VARIABLE_PROVIDERS) as PromptVariableName[];
}

/** Resolve only known variables present in a template; unknown `$VAR` tokens remain literal. */
export async function resolvePromptVariables(content: string, context: PromptVariableContext): Promise<string> {
	const used = promptVariableNames().filter(name => content.includes(name));
	if (used.length === 0) return content;
	let result = content;
	for (const name of used) {
		const provider = PROMPT_VARIABLE_PROVIDERS[name];
		result = result.replaceAll(name, await provider(context));
	}
	return result;
}
