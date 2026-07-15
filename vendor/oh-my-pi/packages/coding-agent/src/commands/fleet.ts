import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
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
	collectFleetErrors,
	collectFleetStatus,
	formatFleetErrors,
	formatFleetPrune,
	formatFleetStatus,
	pruneFleetPeers,
} from "../cli/fleet-cli";

const ACTIONS = ["status", "errors", "prune", "pause", "resume", "rollout", "rollback", "pin", "unpin"] as const;

function fail(message: string): never {
	throw new Error(`fleet: ${message}`);
}

export default class Fleet extends Command {
	static description = "Inspect and operate the local OMP fleet";

	static args = {
		action: Args.string({
			description: "Fleet action",
			required: true,
			options: ACTIONS,
		}),
		selector: Args.string({
			description: "Session ID, exact peer handle, or workstream:<slug>",
			required: false,
		}),
		value: Args.string({
			description: "Action value (digest, channel, rollout ID, or selector)",
			required: false,
		}),
	};

	static flags = {
		blessed: Flags.boolean({ description: "Select the blessed stable release", default: false }),
		digest: Flags.string({ description: "Select an exact 64-character release digest" }),
		canary: Flags.string({ description: "Explicit canary selector for rollout" }),
		"wave-size": Flags.integer({ description: "Rolling wave size", default: 1 }),
		"dry-run": Flags.boolean({ description: "Create and print a rollout plan without control sends", default: false }),
		apply: Flags.boolean({ description: "Apply a fleet prune (prune defaults to dry-run)", default: false }),
		to: Flags.string({ description: "Rollback target: previous or an exact digest" }),
		workstream: Flags.string({ description: "Filter by durable workstream ID" }),
		all: Flags.boolean({ description: "Include stale peers or select all peers", default: false }),
		since: Flags.string({ description: "Errors since ISO time or duration (for example 2h or 7d)" }),
		session: Flags.string({ description: "Filter errors by session ID" }),
		rollout: Flags.string({ description: "Filter errors by rollout ID" }),
	};

	static examples = [
		"# Show fresh fleet peers\n  omp fleet status",
		"# Include stale peers for one workstream\n  omp fleet status --all --workstream fleet-rollout",
		"# Preview stale dead test/temp peer index cleanup\n  omp fleet prune",
		"# Apply stale dead test/temp peer index cleanup\n  omp fleet prune --apply",
		"# Pause a peer by exact handle\n  omp fleet pause agent-handle",
		"# Pin one peer to an immutable digest\n  omp fleet pin agent-handle <sha256>",
		"# Journal a blessed rollout plan\n  omp fleet rollout --blessed --dry-run",
		"# Roll back one durable rollout to N-1\n  omp fleet rollback <rollout-id> --to previous",
	];

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Fleet);
		const action = args.action;
		const selector = args.selector;
		const value = args.value;
		const selectors = selector ? [selector] : [];

		if (flags.digest && flags.blessed) fail("--digest and --blessed are mutually exclusive");
		if (flags["wave-size"] !== undefined && (!Number.isSafeInteger(flags["wave-size"]) || flags["wave-size"] < 1))
			fail("--wave-size must be a positive integer");
		if (flags.apply && action !== "prune") fail("--apply is accepted only by fleet prune");
		if (flags.apply && flags["dry-run"]) fail("--apply and --dry-run are mutually exclusive");

		if (action === "status") {
			if (value || flags.digest || flags.blessed || flags.canary || flags.to || flags["wave-size"] !== 1 || flags["dry-run"])
				fail("status accepts only a selector, --workstream, and --all");
			let rows = await collectFleetStatus({ workstream: flags.workstream, all: flags.all });
			if (selector) rows = rows.filter(row => row.sessionId === selector || row.name === selector || row.workstream === selector || row.workstream === `workstream:${selector}`);
			process.stdout.write(formatFleetStatus(rows));
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
			if (selector || flags.digest || flags.blessed || flags.canary || flags.to || flags["wave-size"] !== 1 || flags["dry-run"] || flags.all)
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

		if (action === "pause" || action === "resume") {
			if (!selector || value || flags.digest || flags.blessed || flags.canary || flags.to || flags["wave-size"] !== 1 || flags["dry-run"] || flags.all)
				fail(`${action} requires one selector and no value flags`);
			const targets = await resolveFleetSelectors({ selectors, workstream: flags.workstream });
			if (targets.length === 0) fail(`${action} selector matched no fresh target`);
			const receipts = [];
			for (const target of targets) receipts.push(await issueFleetControl({ action, peer: target.peer }));
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
			const channel =
				value === "blessed" ? "blessed" : value === "canary" ? "canary" : "digest";
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
			if (!selector || value || flags.digest || flags.blessed || flags.canary || flags.to || flags["wave-size"] !== 1 || flags["dry-run"] || flags.all)
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
				fail("rollout requires exactly one of --blessed or --digest and accepts --workstream, --canary, --wave-size, --dry-run");
			if (flags.canary !== undefined && !flags.canary.trim()) fail("--canary requires a selector");
			const targets = await resolveFleetSelectors({ workstream: flags.workstream });
			if (targets.length === 0) fail("rollout matched no fresh targets");
			const result = await executeFleetRollout({
				peers: targets,
				explicitDigest: flags.digest,
				requestedChannel: flags.blessed ? "blessed" : undefined,
				canarySelector: flags.canary,
				waveSize: flags["wave-size"],
				dryRun: flags["dry-run"],
			});
			process.stdout.write(formatFleetRolloutPlan(result));
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
			let targets: Awaited<ReturnType<typeof resolveFleetSelectors>> = [];
			try {
				targets = await resolveFleetSelectors({
					selectors: selector ? [selector] : undefined,
					workstream: flags.workstream,
				});
			} catch {
				// A non-peer reference is interpreted as a durable rollout ID.
			}
			const result = await executeFleetRollback({
				rolloutId: targets.length === 0 ? reference : undefined,
				peers: targets,
				to: flags.to,
			});
			process.stdout.write(
				`${result.execution.receipts
					.map(receipt => `ROLLBACK\\tsessionId=${receipt.sessionId}\\ttargetId=${receipt.targetId}\\ttargetDigest=${receipt.targetDigest}\\tstate=${receipt.state}\\treason=${receipt.reason ?? "-"}\\n`)
					.join("")}`,
			);
			return;
		}

		fail(`unsupported action ${action as string}`);
	}
}
