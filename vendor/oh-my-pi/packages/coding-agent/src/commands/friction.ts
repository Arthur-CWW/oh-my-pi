import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
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

function findInvalidFlag(argv: readonly string[], validFlags: readonly string[]): string | undefined {
	for (const token of argv) {
		if (token === "--" || !token.startsWith("-")) continue;
		if (validFlags.some(flag => token === flag || token.startsWith(`${flag}=`))) continue;
		return token;
	}
	return undefined;
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

export default class Friction extends Command {
	static description = "Inspect aggregated agent friction reports";

	static args = {
		action: Args.string({
			description: "Friction action",
			required: true,
			options: [...ACTIONS],
		}),
		value: Args.string({ description: "Unexpected positional argument", required: false }),
	};

	static flags = {
		class: Flags.string({ description: "Filter by friction class", options: [...FRICTION_CLASSES] }),
		model: Flags.string({ description: "Filter by model" }),
		session: Flags.string({ description: "Filter by session ID" }),
		since: Flags.string({ description: "Filter at or after an ISO timestamp" }),
		json: Flags.boolean({ description: "Output JSON", default: false }),
		path: Flags.string({ description: "Friction ledger JSONL path" }),
	};

	static examples = [
		"omp friction list",
		"omp friction list --class capability-gap --since 2026-07-01T00:00:00.000Z",
		"omp friction stats --json",
	];

	async run(): Promise<void> {
		const parseFriction = async () => {
			try {
				return await this.parse(Friction);
			} catch (error) {
				const action = this.argv[0];
				if (action === "list" || action === "stats") {
					const validFlags = action === "list" ? LIST_FLAG_NAMES : STATS_FLAG_NAMES;
					const invalidFlag = findInvalidFlag(this.argv.slice(1), validFlags);
					if (invalidFlag) rejectAction(action, invalidFlag);
				}
				throw error;
			}
		};
		const { args, flags, argv } = await parseFriction();
		const action = args.action;
		if (action !== "list" && action !== "stats") fail(`unknown action ${action ?? "(missing)"}`);
		if (args.value !== undefined) rejectAction(action, args.value);

		const invalidFlag = findInvalidFlag(this.argv.slice(1), action === "list" ? LIST_FLAG_NAMES : STATS_FLAG_NAMES);
		if (invalidFlag) rejectAction(action, invalidFlag);
		if (argv.length > 1) rejectAction(action, argv[1] ?? "(unknown positional)");

		if (
			action === "stats" &&
			(flags.class !== undefined || flags.model !== undefined || flags.session !== undefined)
		) {
			rejectAction(
				action,
				flags.class !== undefined ? "--class" : flags.model !== undefined ? "--model" : "--session",
			);
		}

		const rows: readonly FrictionRow[] = await readFrictions(
			{
				...(flags.class === undefined ? {} : { class: flags.class as FrictionClass }),
				...(flags.model === undefined ? {} : { model: flags.model }),
				...(flags.session === undefined ? {} : { sessionId: flags.session }),
				...(flags.since === undefined ? {} : { since: flags.since }),
			},
			resolveLedgerPath(flags.path),
		);

		if (action === "list") {
			const ordered = sortedNewestFirst(rows);
			process.stdout.write(flags.json ? `${JSON.stringify(ordered, null, 2)}\n` : formatList(ordered));
			return;
		}

		const stats = buildStats(rows);
		process.stdout.write(flags.json ? `${JSON.stringify(stats, null, 2)}\n` : formatStats(stats));
	}
}
