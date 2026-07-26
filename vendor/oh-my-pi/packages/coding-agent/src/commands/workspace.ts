import * as path from "node:path";
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	buildWorkspaceStorageStatus,
	listSparsePatterns,
	planWorkspaceStorageMigration,
	validateSparsePatterns,
} from "../cli/workspace-storage-cli";

const STORAGE_ACTIONS = ["status", "guard", "migrate"] as const;

export default Command.make(
	"workspace",
	{
		namespace: Argument.choice("namespace", ["storage"] as const).pipe(
			Argument.withDescription("Workspace management namespace"),
		),
		action: Argument.choice("action", STORAGE_ACTIONS).pipe(
			Argument.withDescription("Storage status, sparse guard, or dry-run migration plan"),
		),
		lane: Flag.optional(
			Flag.string("lane").pipe(
				Flag.withDescription("Workspace lane class checked by storage guard"),
			),
		),
		"waive-full-sparse": Flag.boolean("waive-full-sparse").pipe(
			Flag.withDescription("Allow exact `.` sparse pattern for an implementation lane"),
			Flag.withDefault(false),
		),
		"search-root": Flag.optional(
			Flag.string("search-root").pipe(
				Flag.withDescription("Explicit root whose immediate local/* workspaces are inspected"),
			),
		),
		"dry-run": Flag.boolean("dry-run").pipe(
			Flag.withDescription("Project migration commands without changing any path"),
			Flag.withDefault(false),
		),
	},
	(config) =>
		Effect.promise(async () => {
			if (config.action === "status") {
				process.stdout.write(`${JSON.stringify(await buildWorkspaceStorageStatus(), null, 2)}\n`);
				return;
			}
			if (config.action === "guard") {
				const lane = Option.getOrUndefined(config.lane);
				if (lane === undefined || lane.trim().length === 0) {
					throw new Error("omp workspace storage guard requires --lane");
				}
				const repositoryRoot = path.resolve(process.cwd());
				const patterns = await listSparsePatterns(repositoryRoot);
				const validation = validateSparsePatterns(patterns, lane, config["waive-full-sparse"]);
				if (!validation.allowed)
					throw new Error(validation.reason ?? "Sparse pattern guard rejected the workspace");
				process.stdout.write(
					`${JSON.stringify({ repositoryRoot, patterns, validation }, null, 2)}\n`,
				);
				return;
			}
			const searchRoot = Option.getOrUndefined(config["search-root"]);
			if (searchRoot === undefined) {
				throw new Error("omp workspace storage migrate requires --search-root PATH");
			}
			const plan = await planWorkspaceStorageMigration({
				searchRoot,
				dryRun: config["dry-run"],
			});
			process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
		}),
).pipe(
	Command.withDescription("Inspect and plan machine-local workspace storage"),
	Command.withExamples([
		{
			command: "omp workspace storage status",
			description: "Print canonical stores and registry state as JSON",
		},
		{
			command: "omp workspace storage guard --lane implementation",
			description: "Reject a full sparse checkout for an implementation lane",
		},
		{
			command: "omp workspace storage migrate --search-root PATH --dry-run",
			description: "Print deterministic guarded migration and rollback commands",
		},
	]),
);
