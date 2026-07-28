import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { commandEntry, type OmpCommandEntry, run } from "@oh-my-pi/pi-utils/cli";
import { Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

const GoodCommand = Command.make(
	"good",
	{ verbose: Flag.boolean("verbose").pipe(Flag.withDescription("be loud")) },
	() => Effect.void,
).pipe(Command.withDescription("prints good things"));

// The dispatcher sets `process.exitCode` on user-facing errors; reset it so the
// unknown-command assertion never leaks a failing code into the test process.
afterEach(() => {
	process.exitCode = 0;
});

describe("run() dispatch", () => {
	// Contract: `omp <cmd> --help` must import only the requested command module.
	// Loading the whole table would let any unrelated command whose import hangs
	// or crashes take down every per-command help invocation.
	it("loads only the requested command for per-command help", async () => {
		let brokenLoads = 0;
		const commands: OmpCommandEntry[] = [
			commandEntry({ name: "good", load: async () => GoodCommand }),
			commandEntry({
				name: "broken",
				load: async () => {
					brokenLoads++;
					throw new Error("import-time crash");
				},
			}),
		];
		const logs: string[] = [];
		const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.map(value => String(value)).join(" "));
		});
		try {
			await run({ bin: "omp", version: "0.0.0", argv: ["good", "--help"], commands });
		} finally {
			logSpy.mockRestore();
		}
		expect(brokenLoads).toBe(0);
		const help = logs.join("\n");
		expect(help).toContain("prints good things");
		expect(help).toContain("--verbose");
	});

	// Contract: a matched command runs with argv parsed into its typed config,
	// and no sibling module is imported to get there.
	it("dispatches parsed argv to the matched command and loads only it", async () => {
		let brokenLoads = 0;
		let observed: boolean | undefined;
		const dispatchGood = Command.make(
			"good",
			{ verbose: Flag.boolean("verbose") },
			config =>
				Effect.sync(() => {
					observed = config.verbose;
				}),
		).pipe(Command.withDescription("prints good things"));
		const commands: OmpCommandEntry[] = [
			commandEntry({ name: "good", load: async () => dispatchGood }),
			commandEntry({
				name: "broken",
				load: async () => {
					brokenLoads++;
					throw new Error("import-time crash");
				},
			}),
		];
		await run({ bin: "omp", version: "0.0.0", argv: ["good", "--verbose"], commands });
		expect(observed).toBe(true);
		expect(brokenLoads).toBe(0);
	});

	// Contract: aliases resolve to the canonical command without importing peers.
	it("resolves aliases to the canonical command", async () => {
		let observed = false;
		const worktree = Command.make("worktree", {}, () =>
			Effect.sync(() => {
				observed = true;
			}),
		).pipe(Command.withDescription("manage worktrees"));
		const commands: OmpCommandEntry[] = [
			commandEntry({ name: "worktree", load: async () => worktree, aliases: ["wt"] }),
		];
		await run({ bin: "omp", version: "0.0.0", argv: ["wt"], commands });
		expect(observed).toBe(true);
	});

	// Contract: `--version` is a fast path that prints `bin/version` and imports
	// no command module.
	it("prints the version without loading any command", async () => {
		let loads = 0;
		const commands: OmpCommandEntry[] = [
			commandEntry({
				name: "good",
				load: async () => {
					loads++;
					return GoodCommand;
				},
			}),
		];
		const writes: string[] = [];
		const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(chunk => {
			writes.push(String(chunk));
			return true;
		});
		try {
			await run({ bin: "omp", version: "0.0.0", argv: ["--version"], commands });
		} finally {
			stdoutSpy.mockRestore();
		}
		expect(writes.join("")).toBe("omp/0.0.0\n");
		expect(loads).toBe(0);
	});

	// Contract: root help lists every registered subcommand with its description.
	it("lists registered subcommands in root help", async () => {
		const tidy = Command.make("tidy", {}, () => Effect.void).pipe(Command.withDescription("cleans up"));
		const commands: OmpCommandEntry[] = [
			commandEntry({ name: "good", load: async () => GoodCommand }),
			commandEntry({ name: "tidy", load: async () => tidy }),
		];
		const logs: string[] = [];
		const logSpy = spyOn(console, "log").mockImplementation((...args: unknown[]) => {
			logs.push(args.map(value => String(value)).join(" "));
		});
		try {
			await run({ bin: "omp", version: "0.0.0", argv: ["--help"], commands });
		} finally {
			logSpy.mockRestore();
		}
		const help = logs.join("\n");
		expect(help).toContain("good");
		expect(help).toContain("prints good things");
		expect(help).toContain("tidy");
		expect(help).toContain("cleans up");
	});

	// Contract: an unknown command writes a deterministic error and fails.
	it("reports an unknown command on stderr and sets a failing exit code", async () => {
		const commands: OmpCommandEntry[] = [commandEntry({ name: "good", load: async () => GoodCommand })];
		const errors: string[] = [];
		const stderrSpy = spyOn(process.stderr, "write").mockImplementation(chunk => {
			errors.push(String(chunk));
			return true;
		});
		try {
			await run({ bin: "omp", version: "0.0.0", argv: ["nope"], commands });
			expect(errors.join("")).toContain("Error: command nope not found");
			expect(process.exitCode).toBe(1);
		} finally {
			stderrSpy.mockRestore();
		}
	});
});
