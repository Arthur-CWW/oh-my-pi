import type { CustomEntry, FileEntry, SessionEntry, SessionHeader } from "./session-entries";
import { loadJournalProjection } from "../journal/projection";
import { decodeChildLifecycleEntry } from "../task/child-lifecycle";

const MAX_PACKET_LINES = 80;
const MAX_ITEMS_PER_GROUP = 23;
const HUMAN_TIMESTAMP_FALLBACK = "1970-01-01T00:00:00.000Z";

export interface AwayPacketInput {
	readonly journalPath?: string;
	readonly entries?: readonly SessionEntry[];
	readonly header?: Pick<SessionHeader, "timestamp">;
	readonly nowMs?: number;
}

interface AwayEvent {
	readonly timestamp: number;
	readonly line: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteTimestamp(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function entryTimestamp(entry: { timestamp?: unknown }): number | undefined {
	return finiteTimestamp(entry.timestamp);
}

function formatClock(timestamp: number): string {
	const date = new Date(timestamp);
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function formatDuration(deltaMs: number): string {
	const totalMinutes = Math.max(0, Math.floor(deltaMs / 60_000));
	const days = Math.floor(totalMinutes / 1_440);
	const hours = Math.floor((totalMinutes % 1_440) / 60);
	const minutes = totalMinutes % 60;
	return days > 0 ? `${days}d${hours}h${minutes}m` : `${hours}h${minutes}m`;
}

function printable(value: string): string {
	return value.replace(/[\t\r\n]+/g, " ").trim();
}

function textField(data: Record<string, unknown>, ...keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = data[key];
		if (typeof value === "string" && value.trim()) return printable(value);
	}
	return undefined;
}

function lifecycleLabel(entry: CustomEntry, agentId: string): string {
	if (!isRecord(entry.data)) return agentId;
	return textField(entry.data, "label", "spawnName", "name") ?? agentId;
}

function lifecycleEvents(entries: readonly SessionEntry[], sinceMs: number): AwayEvent[] {
	const events: AwayEvent[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		const decoded = decodeChildLifecycleEntry(entry as FileEntry);
		if (decoded.kind !== "valid") continue;
		const timestamp = finiteTimestamp(decoded.record.updatedAt) ?? entryTimestamp(entry);
		if (timestamp === undefined || timestamp <= sinceMs) continue;
		const verb = decoded.record.state === "running" ? "spawned" : decoded.record.state;
		const label = lifecycleLabel(entry, decoded.record.agentId);
		events.push({
			timestamp,
			line: `- ${formatClock(timestamp)} ${verb} id=${decoded.record.agentId} label=${label}`,
		});
	}
	return events.sort((a, b) => b.timestamp - a.timestamp);
}

function errorEvents(entries: readonly SessionEntry[], sinceMs: number): AwayEvent[] {
	const events: AwayEvent[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== "ui_error" || !isRecord(entry.data)) continue;
		if (entry.data.version !== 2) continue;
		const timestamp = finiteTimestamp(entry.data.lastTimestamp) ?? entryTimestamp(entry);
		if (timestamp === undefined || timestamp <= sinceMs) continue;
		const cause = textField(entry.data, "cause", "category", "errorClass") ?? "unknown";
		const message = textField(entry.data, "message", "detail") ?? "-";
		events.push({ timestamp, line: `- ${formatClock(timestamp)} ${cause}: ${message}` });
	}
	return events.sort((a, b) => b.timestamp - a.timestamp);
}

function todoSummary(data: Record<string, unknown>): string {
	const phases = data.phases;
	if (!Array.isArray(phases)) return "todo updated";
	for (const phase of phases) {
		if (!isRecord(phase) || typeof phase.name !== "string" || !Array.isArray(phase.tasks)) continue;
		for (const task of phase.tasks) {
			if (!isRecord(task) || typeof task.content !== "string" || typeof task.status !== "string") continue;
			if (task.status === "in_progress" || task.status === "pending") {
				return `todo ${printable(phase.name)}: ${printable(task.content)} [${task.status}]`;
			}
		}
	}
	return "todo updated";
}

function workflowSummary(entry: SessionEntry): string | undefined {
	if (entry.type === "workflow_change") {
		const request = entry.command.request;
		if (request.kind === "transitionGoalMode") {
			const transition = request.transition;
			if (transition.kind === "enter" && transition.action === "create") return `goal started: ${printable(transition.objective)}`;
			if (transition.kind === "enter") return `goal resumed: ${printable(transition.goalId)}`;
			return `goal ${transition.disposition}: ${printable(transition.goalId)}`;
		}
	}
	if (entry.type === "custom" && entry.customType.startsWith("goal-") && isRecord(entry.data)) {
		const objective = textField(entry.data, "objective");
		return objective ? `${entry.customType}: ${objective}` : entry.customType;
	}
	return undefined;
}

function todoGoalEvents(entries: readonly SessionEntry[], sinceMs: number): AwayEvent[] {
	const events: AwayEvent[] = [];
	for (const entry of entries) {
		const timestamp = entryTimestamp(entry);
		if (timestamp === undefined || timestamp <= sinceMs) continue;
		if (entry.type === "custom" && entry.customType === "user_todo_edit" && isRecord(entry.data)) {
			events.push({ timestamp, line: `- ${formatClock(timestamp)} ${todoSummary(entry.data)}` });
			continue;
		}
		const summary = workflowSummary(entry);
		if (summary) events.push({ timestamp, line: `- ${formatClock(timestamp)} ${summary}` });
	}
	return events.sort((a, b) => b.timestamp - a.timestamp);
}

function isHumanInput(entry: SessionEntry): boolean {
	if (entry.type !== "message") return false;
	const message = entry.message as { role?: unknown; attribution?: unknown; steering?: unknown };
	// Human prompts are persisted as role=user, attribution=user. Queued steer
	// records retain steering=true, while hidden/system continuations are custom
	// messages or developer messages and therefore do not count as human input.
	return message.role === "user" && message.attribution === "user" && message.steering !== true;
}

function lastHumanInputTimestamp(entries: readonly SessionEntry[], fallback: number): number {
	let latest = Number.NEGATIVE_INFINITY;
	for (const entry of entries) {
		if (!isHumanInput(entry)) continue;
		const timestamp = entryTimestamp(entry);
		if (timestamp !== undefined && timestamp > latest) latest = timestamp;
	}
	if (Number.isFinite(latest)) return latest;
	return fallback;
}

function section(name: string, events: readonly AwayEvent[]): string[] {
	if (events.length === 0) return [];
	const lines = [name, ...events.slice(0, MAX_ITEMS_PER_GROUP).map(event => event.line)];
	const overflow = events.length - MAX_ITEMS_PER_GROUP;
	if (overflow > 0) lines.push(`- ... ${overflow} more ${name.toLowerCase()} events`);
	return lines;
}

/** Build the bounded away packet from the typed session journal projection. */
export async function buildAwayPacket(input: AwayPacketInput): Promise<string> {
	let entries: readonly SessionEntry[] = input.entries ?? [];
	let headerTimestamp = input.header?.timestamp;
	if (input.journalPath) {
		const projection = await loadJournalProjection(input.journalPath);
		if (projection) {
			entries = projection.entries;
			headerTimestamp = projection.header.timestamp;
		}
	}
	const nowMs = input.nowMs ?? Date.now();
	const fallback = finiteTimestamp(headerTimestamp) ?? finiteTimestamp(HUMAN_TIMESTAMP_FALLBACK) ?? nowMs;
	const awayStartMs = lastHumanInputTimestamp(entries, fallback);
	const groups = [
		section("LIFECYCLE", lifecycleEvents(entries, awayStartMs)),
		section("ERRORS", errorEvents(entries, awayStartMs)),
		section("TODO/GOAL", todoGoalEvents(entries, awayStartMs)),
	].filter(group => group.length > 0);
	const lines = [`AWAY ${formatDuration(nowMs - awayStartMs)} (${formatClock(awayStartMs)} → ${formatClock(nowMs)})`];
	for (const group of groups) lines.push(...group);
	if (groups.length === 0) lines.push("No deltas.");
	if (lines.length > MAX_PACKET_LINES) return `${lines.slice(0, MAX_PACKET_LINES - 1).join("\n")}\n- ... ${lines.length - MAX_PACKET_LINES + 1} more away events`;
	return lines.join("\n");
}
