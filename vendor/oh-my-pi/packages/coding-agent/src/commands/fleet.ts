import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	applyFleetLabel,
	collectFleetErrors,
	collectFleetStatus,
	formatFleetErrors,
	formatFleetLabel,
	formatFleetPrune,
	formatFleetStatus,
	pruneFleetPeers,
} from "../cli/fleet-cli";
import {
	executeFleetPinOperation,
	executeFleetRollback,
	executeFleetRollout,
	executeFleetUnpinOperation,
	formatFleetActionReceipts,
	formatFleetRolloutPlan,
	issueFleetControl,
	resolveFleetSelectors,
} from "../cli/fleet-operations";
import {
	collectFleetOverview,
	formatFleetOverview,
	formatFleetOverviewJson,
} from "../cli/fleet-overview";
import {
	collectToolIssueProjection,
	formatToolIssueProjection,
} from "../cli/tool-issue-projection";
import { SessionControlBus } from "../session/session-control";

const ACTIONS = [
	"status",
	"overview",
	"errors",
	"issues",
	"prune",
	"pause",
	"resume",
	"rollout",
	"rollback",
	"pin",
	"unpin",
	"label",
] as const;

function fail(message: string): never {
	throw new Error(`fleet: ${message}`);
}

/**
 * The declared fleet flag values in the shape the action handlers expect. Effect
 * parses every flag up front (rejecting genuinely unknown flags with its own
 * diagnostics), so per-action flag validation is value-based off this record.
 */
interface FleetFlags {
	readonly blessed: boolean;
	readonly digest: string | undefined;
	readonly canary: string | undefined;
	readonly "wave-size": number;
	readonly "dry-run": boolean;
	readonly apply: boolean;
	readonly to: string | undefined;
	readonly workstream: string | undefined;
	readonly summary: string | undefined;
	readonly claim: string[] | undefined;
	readonly name: string | undefined;
	readonly all: boolean;
	readonly since: string | undefined;
	readonly session: string | undefined;
	readonly rollout: string | undefined;
	readonly status: boolean;
	readonly "include-paused": boolean;
	readonly json: boolean;
}

const OVERVIEW_VALID_FLAGS = ["--all", "--json", "--workstream"].join(", ");
const OVERVIEW_VALID_KEYS: readonly string[] = ["all", "json", "workstream"];

const LABEL_VALID_FLAGS = ["--summary", "--name", "--workstream", "--claim"].join(", ");
const LABEL_VALID_KEYS: readonly string[] = ["summary", "name", "workstream", "claim"];

/** First set flag whose name is not in `valid`, rendered as `--name`. */
function invalidDeclaredFlag(flags: FleetFlags, valid: readonly string[]): string | undefined {
	const present: readonly (readonly [string, boolean])[] = [
		["blessed", flags.blessed],
		["digest", flags.digest !== undefined],
		["canary", flags.canary !== undefined],
		["wave-size", flags["wave-size"] !== 1],
		["dry-run", flags["dry-run"]],
		["apply", flags.apply],
		["to", flags.to !== undefined],
		["workstream", flags.workstream !== undefined],
		["summary", flags.summary !== undefined],
		["claim", flags.claim !== undefined],
		["name", flags.name !== undefined],
		["all", flags.all],
		["since", flags.since !== undefined],
		["session", flags.session !== undefined],
		["rollout", flags.rollout !== undefined],
		["status", flags.status],
		["include-paused", flags["include-paused"]],
		["json", flags.json],
	];
	for (const [name, set] of present) if (set && !valid.includes(name)) return `--${name}`;
	return undefined;
}

function overviewReject(token: string): never {
	fail(`overview does not accept ${token}; valid flags: ${OVERVIEW_VALID_FLAGS}`);
}

function labelReject(token: string): never {
	fail(`label does not accept ${token}; valid flags: ${LABEL_VALID_FLAGS}`);
}

export default Command.make(
	"fleet",
	{
		action: Argument.choice("action", ACTIONS).pipe(Argument.withDescription("Fleet action")),
		selector: Argument.optional(
			Argument.string("selector").pipe(
				Argument.withDescription("Session ID, exact peer handle, or workstream:<slug>"),
			),
		),
		value: Argument.optional(
			Argument.string("value").pipe(
				Argument.withDescription("Action value (digest, channel, rollout ID, or selector)"),
			),
		),
		blessed: Flag.boolean("blessed").pipe(
			Flag.withDescription("Select the blessed stable release"),
		),
		digest: Flag.optional(
			Flag.string("digest").pipe(
				Flag.withDescription("Select an exact 64-character release digest"),
			),
		),
		canary: Flag.optional(
			Flag.string("canary").pipe(Flag.withDescription("Explicit canary selector for rollout")),
		),
		"wave-size": Flag.integer("wave-size").pipe(
			Flag.withDescription("Rolling wave size"),
			Flag.withDefault(1),
		),
		"dry-run": Flag.boolean("dry-run").pipe(
			Flag.withDescription("Create and print a rollout plan without control sends"),
		),
		apply: Flag.boolean("apply").pipe(
			Flag.withDescription("Apply a fleet prune (prune defaults to dry-run)"),
		),
		to: Flag.optional(
			Flag.string("to").pipe(Flag.withDescription("Rollback target: previous or an exact digest")),
		),
		workstream: Flag.optional(
			Flag.string("workstream").pipe(Flag.withDescription("Filter by durable workstream ID")),
		),
		summary: Flag.optional(
			Flag.string("summary").pipe(Flag.withDescription("Observer summary to store on a peer")),
		),
		claim: Flag.string("claim").pipe(
			Flag.withDescription("Workspace path prefix or stream slug claim (repeatable)"),
			Flag.atLeast(0),
		),
		name: Flag.optional(
			Flag.string("name").pipe(Flag.withDescription("Ambient peer display name")),
		),
		all: Flag.boolean("all").pipe(Flag.withDescription("Include stale peers or select all peers")),
		since: Flag.optional(
			Flag.string("since").pipe(
				Flag.withDescription("Errors since ISO time or duration (for example 2h or 7d)"),
			),
		),
		session: Flag.optional(
			Flag.string("session").pipe(Flag.withDescription("Filter errors by session ID")),
		),
		rollout: Flag.optional(
			Flag.string("rollout").pipe(Flag.withDescription("Filter errors by rollout ID")),
		),
		status: Flag.boolean("status").pipe(
			Flag.withDescription("Show pause status instead of issuing a command"),
		),
		"include-paused": Flag.boolean("include-paused").pipe(
			Flag.withDescription("Include paused sessions in rollout"),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output as JSON (overview)")),
	},
	(config) =>
		Effect.promise(async () => {
			const flags: FleetFlags = {
				blessed: config.blessed,
				digest: Option.getOrUndefined(config.digest),
				canary: Option.getOrUndefined(config.canary),
				"wave-size": config["wave-size"],
				"dry-run": config["dry-run"],
				apply: config.apply,
				to: Option.getOrUndefined(config.to),
				workstream: Option.getOrUndefined(config.workstream),
				summary: Option.getOrUndefined(config.summary),
				claim: config.claim.length > 0 ? [...config.claim] : undefined,
				name: Option.getOrUndefined(config.name),
				all: config.all,
				since: Option.getOrUndefined(config.since),
				session: Option.getOrUndefined(config.session),
				rollout: Option.getOrUndefined(config.rollout),
				status: config.status,
				"include-paused": config["include-paused"],
				json: config.json,
			};
			const action = config.action;
			const selector = Option.getOrUndefined(config.selector);
			const value = Option.getOrUndefined(config.value);
			const selectors = selector ? [selector] : [];
			if (flags.claim !== undefined && action !== "label")
				fail("--claim is accepted only by fleet label");

			if (flags.digest && flags.blessed) fail("--digest and --blessed are mutually exclusive");
			if (
				flags["wave-size"] !== undefined &&
				(!Number.isSafeInteger(flags["wave-size"]) || flags["wave-size"] < 1)
			)
				fail("--wave-size must be a positive integer");
			if (flags.apply && action !== "prune") fail("--apply is accepted only by fleet prune");
			if (flags.apply && flags["dry-run"]) fail("--apply and --dry-run are mutually exclusive");

			if (action === "status") {
				if (
					value ||
					flags.digest ||
					flags.blessed ||
					flags.canary ||
					flags.to ||
					flags["wave-size"] !== 1 ||
					flags["dry-run"]
				)
					fail("status accepts only a selector, --workstream, and --all");
				let rows = await collectFleetStatus({ workstream: flags.workstream, all: flags.all });
				if (selector)
					rows = rows.filter(
						(row) =>
							row.sessionId === selector ||
							row.name === selector ||
							row.workstream === selector ||
							row.workstream === `workstream:${selector}`,
					);
				process.stdout.write(formatFleetStatus(rows));
				return;
			}

			if (action === "overview") {
				const invalidFlag = invalidDeclaredFlag(flags, OVERVIEW_VALID_KEYS);
				if (invalidFlag) overviewReject(invalidFlag);
				if (value) overviewReject(value);
				let rows = collectFleetOverview({ workstream: flags.workstream, all: flags.all });
				if (selector)
					rows = rows.filter(
						(row) =>
							row.sessionId === selector || row.name === selector || row.workstream === selector,
					);
				process.stdout.write(
					flags.json ? formatFleetOverviewJson(rows) : formatFleetOverview(rows),
				);
				return;
			}

			if (action === "label") {
				const invalidFlag = invalidDeclaredFlag(flags, LABEL_VALID_KEYS);
				if (invalidFlag) labelReject(invalidFlag);
				if (!selector) fail("label requires a session ID");
				if (value) labelReject(value);
				const claims =
					flags.claim === undefined
						? undefined
						: flags.claim.some((claim) => claim === "")
							? []
							: flags.claim;
				if (
					flags.summary === undefined &&
					flags.name === undefined &&
					flags.workstream === undefined &&
					claims === undefined
				)
					fail("label requires at least one of --summary, --name, --workstream, --claim");
				const result = applyFleetLabel({
					sessionId: selector,
					summary: flags.summary,
					name: flags.name,
					workstream: flags.workstream,
					claims,
				});
				if (!result.found) fail(`label unknown session ${selector}`);
				process.stdout.write(formatFleetLabel(result));
				return;
			}

			if (action === "prune") {
				if (
					selector ||
					value ||
					flags.digest ||
					flags.blessed ||
					flags.canary ||
					flags.to ||
					flags["wave-size"] !== 1 ||
					flags.all ||
					flags.since ||
					flags.session ||
					flags.rollout ||
					flags.workstream
				)
					fail("prune accepts only --dry-run or --apply");
				const result = pruneFleetPeers({ apply: flags.apply });
				process.stdout.write(formatFleetPrune(result, flags.apply));
				return;
			}

			if (action === "errors") {
				if (
					selector ||
					flags.digest ||
					flags.blessed ||
					flags.canary ||
					flags.to ||
					flags["wave-size"] !== 1 ||
					flags["dry-run"] ||
					flags.all
				)
					fail("errors accepts --since, --session, --workstream, and --rollout");
				process.stdout.write(
					formatFleetErrors(
						await collectFleetErrors({
							since: flags.since,
							session: flags.session,
							workstream: flags.workstream,
							rollout: flags.rollout,
						}),
					),
				);
				return;
			}

			if (action === "issues") {
				if (
					selector ||
					value ||
					flags.digest ||
					flags.blessed ||
					flags.canary ||
					flags.to ||
					flags["wave-size"] !== 1 ||
					flags["dry-run"] ||
					flags.all ||
					flags.rollout ||
					flags.status ||
					flags["include-paused"]
				)
					fail("issues accepts --since, --session, --workstream, and --json");
				const projection = await collectToolIssueProjection({
					since: flags.since,
					session: flags.session,
					workstream: flags.workstream,
					limit: 10,
				});
				process.stdout.write(
					flags.json
						? `${JSON.stringify(projection, null, 2)}\n`
						: formatToolIssueProjection(projection),
				);
				return;
			}

			if (action === "pause" || action === "resume") {
				if (flags.status && action === "pause") {
					const bus = new SessionControlBus();
					try {
						const paused = bus.listPaused();
						if (paused.length === 0) {
							process.stdout.write("No sessions are currently paused.\n");
						} else {
							const lines = paused.map(
								(row) =>
									`PAUSED\tsessionId=${row.sessionId}\townerEpoch=${row.ownerEpoch}\tsince=${row.updatedAt}\n`,
							);
							process.stdout.write(lines.join(""));
						}
					} finally {
						bus.close();
					}
					return;
				}
				if (
					value ||
					flags.digest ||
					flags.blessed ||
					flags.canary ||
					flags.to ||
					flags["wave-size"] !== 1 ||
					flags["dry-run"]
				)
					fail(`${action} accepts a selector (default all) and --workstream`);
				const targets = await resolveFleetSelectors({
					selectors,
					workstream: flags.workstream,
					all: !selector,
				});
				if (targets.length === 0) fail(`${action} selector matched no fresh target`);
				const receipts = [];
				for (const target of targets)
					receipts.push(await issueFleetControl({ action, peer: target.peer }));
				process.stdout.write(formatFleetActionReceipts(receipts));
				return;
			}

			if (action === "pin") {
				if (
					!selector ||
					!value ||
					flags.digest ||
					flags.blessed ||
					flags.canary ||
					flags.to ||
					flags["wave-size"] !== 1 ||
					flags["dry-run"] ||
					flags.all
				)
					fail("pin requires: omp fleet pin <selector> <digest|blessed|canary>");
				const channel = value === "blessed" ? "blessed" : value === "canary" ? "canary" : "digest";
				if (channel === "digest" && !/^[0-9a-f]{64}$/.test(value))
					fail("pin digest must be a full 64-character lowercase SHA-256 digest");
				const targets = await resolveFleetSelectors({ selectors, workstream: flags.workstream });
				if (targets.length === 0) fail("pin selector matched no fresh target");
				const result = await executeFleetPinOperation({
					channel,
					explicitDigest: channel === "digest" ? value : undefined,
					peers: targets,
				});
				process.stdout.write(formatFleetActionReceipts(result.receipts));
				return;
			}

			if (action === "unpin") {
				if (
					!selector ||
					value ||
					flags.digest ||
					flags.blessed ||
					flags.canary ||
					flags.to ||
					flags["wave-size"] !== 1 ||
					flags["dry-run"] ||
					flags.all
				)
					fail("unpin requires one selector and no channel flags");
				const targets = await resolveFleetSelectors({ selectors, workstream: flags.workstream });
				if (targets.length === 0) fail("unpin selector matched no fresh target");
				const result = await executeFleetUnpinOperation({ peers: targets });
				process.stdout.write(formatFleetActionReceipts(result.receipts));
				return;
			}

			if (action === "rollout") {
				if (
					selector ||
					value ||
					flags.to ||
					flags.session ||
					flags.rollout ||
					flags.all ||
					Number(flags.blessed) + Number(flags.digest !== undefined) !== 1
				)
					fail(
						"rollout requires exactly one of --blessed or --digest and accepts --workstream, --canary, --wave-size, --dry-run",
					);
				if (flags.canary !== undefined && !flags.canary.trim())
					fail("--canary requires a selector");
				const targets = await resolveFleetSelectors({ workstream: flags.workstream });
				if (targets.length === 0) fail("rollout matched no fresh targets");
				const result = await executeFleetRollout({
					peers: targets,
					explicitDigest: flags.digest,
					requestedChannel: flags.blessed ? "blessed" : undefined,
					canarySelector: flags.canary,
					waveSize: flags["wave-size"],
					dryRun: flags["dry-run"],
					includePaused: flags["include-paused"],
				});
				process.stdout.write(formatFleetRolloutPlan(result));
				if (result.execution?.state === "Frozen")
					fail(`rollout ${result.plan.fleetRolloutId} froze; inspect TARGET_ERROR rows above`);
				return;
			}

			if (action === "rollback") {
				if (
					flags.blessed ||
					flags.digest ||
					flags.canary ||
					flags["wave-size"] !== 1 ||
					flags["dry-run"] ||
					flags.all ||
					flags.since ||
					flags.session
				)
					fail("rollback accepts a rollout ID or selector and --to previous|<sha256>");
				if (!flags.to) fail("rollback requires --to previous or --to <sha256>");
				const reference = selector ?? flags.rollout;
				if (!reference) fail("rollback requires a rollout ID or selector");
				const targets = await (async () => {
					try {
						return await resolveFleetSelectors({
							selectors: selector ? [selector] : undefined,
							workstream: flags.workstream,
						});
					} catch {
						// A non-peer reference is interpreted as a durable rollout ID.
						return [];
					}
				})();
				const result = await executeFleetRollback({
					rolloutId: targets.length === 0 ? reference : undefined,
					peers: targets,
					to: flags.to,
				});
				process.stdout.write(
					`${result.execution.receipts
						.map(
							(receipt) =>
								`ROLLBACK\\tsessionId=${receipt.sessionId}\\ttargetId=${receipt.targetId}\\ttargetDigest=${receipt.targetDigest}\\tstate=${receipt.state}\\treason=${receipt.reason ?? "-"}\\n`,
						)
						.join("")}`,
				);
				return;
			}

			fail(`unsupported action ${action}`);
		}),
).pipe(
	Command.withDescription("Inspect and operate the local OMP fleet"),
	Command.withExamples([
		{ command: "omp fleet status", description: "Show fresh fleet peers" },
		{
			command: "omp fleet status --all --workstream fleet-rollout",
			description: "Include stale peers for one workstream",
		},
		{
			command: "omp fleet issues --since 36h",
			description: "Top recurring tool issues across evidence sources",
		},
		{ command: "omp fleet prune", description: "Preview stale dead test/temp peer index cleanup" },
		{
			command: "omp fleet prune --apply",
			description: "Apply stale dead test/temp peer index cleanup",
		},
		{ command: "omp fleet pause agent-handle", description: "Pause a peer by exact handle" },
		{
			command: "omp fleet pin agent-handle <sha256>",
			description: "Pin one peer to an immutable digest",
		},
		{
			command: "omp fleet rollout --blessed --dry-run",
			description: "Journal a blessed rollout plan",
		},
		{
			command: "omp fleet rollback <rollout-id> --to previous",
			description: "Roll back one durable rollout to N-1",
		},
		{ command: "omp fleet overview", description: "High-level fleet overview" },
		{ command: "omp fleet overview --json", description: "Machine-readable fleet overview" },
	]),
);
