import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import type { FrictionClass, FrictionRow } from "../session/friction-ledger";
import { FRICTION_CLASSES, readFrictions } from "../session/friction-ledger";

const ACTIONS = ["list", "stats"] as const;

const LIST_FLAG_NAMES = ["--class", "--model", "--session", "--since", "--json", "--path"] as const;
const LIST_VALID_FLAGS = LIST_FLAG_NAMES.join(", ");
const STATS_FLAG_NAMES = ["--since", "--json", "--path"] as const;
const STATS_VALID_FLAGS = STATS_FLAG_NAMES.join(", ");

function fail(message: string): never {
	throw new Error(`friction: ${message}`);
}

function rejectAction(action: "list" | "stats", token: string): never {
	const validFlags = action === "list" ? LIST_VALID_FLAGS : STATS_VALID_FLAGS;
	fail(`${action} does not accept ${token}; valid flags: ${validFlags}`);
}

function resolveLedgerPath(pathFlag: string | undefined): string | undefined {
	return pathFlag ?? process.env.OMP_FRICTION_LEDGER_PATH ?? process.env.OMP_FRICTION_LEDGER;
}

function sortedNewestFirst<T extends { readonly ts: string }>(rows: readonly T[]): T[] {
	return [...rows].sort((left, right) => Date.parse(right.ts) - Date.parse(left.ts));
}

function formatList(rows: readonly FrictionRow[]): string {
	const lines = ["TS\tSESSION_ID\tAGENT_ID\tMODEL\tCLASS\tNOTE\tBINARY_VERSION\tBINARY_DIGEST"];
	for (const row of rows) {
		const note = row.note.replace(/[\t\r\n]+/g, " ");
		lines.push(
			[row.ts, row.sessionId, row.agentId, row.model, row.class, note, row.binaryVersion, row.binaryDigest].join(
				"\t",
			),
		);
	}
	return `${lines.join("\n")}\n`;
}

interface FrictionStats {
	readonly groups: readonly { readonly class: string; readonly model: string; readonly count: number }[];
	readonly sessions: readonly { readonly sessionId: string; readonly count: number }[];
}

function buildStats(rows: readonly FrictionRow[]): FrictionStats {
	const groups = new Map<string, { readonly class: string; readonly model: string; count: number }>();
	const sessions = new Map<string, number>();
	for (const row of rows) {
		const groupKey = `${row.class}\u0000${row.model}`;
		const group = groups.get(groupKey);
		if (group) group.count += 1;
		else groups.set(groupKey, { class: row.class, model: row.model, count: 1 });
		sessions.set(row.sessionId, (sessions.get(row.sessionId) ?? 0) + 1);
	}
	return {
		groups: [...groups.values()].sort(
			(left, right) =>
				right.count - left.count || left.class.localeCompare(right.class) || left.model.localeCompare(right.model),
		),
		sessions: [...sessions.entries()]
			.map(([sessionId, count]) => ({ sessionId, count }))
			.sort((left, right) => right.count - left.count || left.sessionId.localeCompare(right.sessionId)),
	};
}

function formatStats(stats: FrictionStats): string {
	const lines = ["CLASS\tMODEL\tCOUNT"];
	for (const group of stats.groups) lines.push(`${group.class}\t${group.model}\t${group.count}`);
	lines.push("", "SESSION_ID\tCOUNT");
	for (const session of stats.sessions) lines.push(`${session.sessionId}\t${session.count}`);
	return `${lines.join("\n")}\n`;
}

export default Command.make(
	"friction",
	{
		action: Argument.choice("action", ACTIONS).pipe(Argument.withDescription("Friction action")),
		value: Argument.string("value").pipe(
			Argument.withDescription("Unexpected positional argument"),
			Argument.variadic(),
		),
		class: Flag.optional(
			Flag.choice("class", FRICTION_CLASSES).pipe(Flag.withDescription("Filter by friction class")),
		),
		model: Flag.optional(Flag.string("model").pipe(Flag.withDescription("Filter by model"))),
		session: Flag.optional(Flag.string("session").pipe(Flag.withDescription("Filter by session ID"))),
		since: Flag.optional(
			Flag.string("since").pipe(Flag.withDescription("Filter at or after an ISO timestamp")),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON"), Flag.withDefault(false)),
		path: Flag.optional(Flag.string("path").pipe(Flag.withDescription("Friction ledger JSONL path"))),
	},
	config =>
		Effect.promise(async () => {
			const action = config.action;
			if (config.value.length > 0) rejectAction(action, config.value[0] ?? "(unknown positional)");

			if (
				action === "stats" &&
				(Option.isSome(config.class) || Option.isSome(config.model) || Option.isSome(config.session))
			) {
				rejectAction(
					action,
					Option.isSome(config.class) ? "--class" : Option.isSome(config.model) ? "--model" : "--session",
				);
			}

			const rows: readonly FrictionRow[] = await readFrictions(
				{
					...(Option.isNone(config.class) ? {} : { class: config.class.value }),
					...(Option.isNone(config.model) ? {} : { model: config.model.value }),
					...(Option.isNone(config.session) ? {} : { sessionId: config.session.value }),
					...(Option.isNone(config.since) ? {} : { since: config.since.value }),
				},
				resolveLedgerPath(Option.getOrUndefined(config.path)),
			);

			if (action === "list") {
				const ordered = sortedNewestFirst(rows);
				process.stdout.write(config.json ? `${JSON.stringify(ordered, null, 2)}\n` : formatList(ordered));
				return;
			}

			const stats = buildStats(rows);
			process.stdout.write(config.json ? `${JSON.stringify(stats, null, 2)}\n` : formatStats(stats));
		}),
).pipe(
	Command.withDescription("Inspect aggregated agent friction reports"),
	Command.withExamples([
		{ command: "omp friction list" },
		{ command: "omp friction list --class capability-gap --since 2026-07-01T00:00:00.000Z" },
		{ command: "omp friction stats --json" },
	]),
);
