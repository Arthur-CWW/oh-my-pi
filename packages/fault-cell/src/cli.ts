#!/usr/bin/env bun
import { Effect, FileSystem, Layer, Option, Path, Result, Stdio, Terminal } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner"
import { randomBytes } from "node:crypto"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { makeRunId } from "./ids"
import { resolveNixpkgs } from "./provenance"
import { scenarioRegistry } from "./registry"
import { runScenario } from "./runner"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..")

const cliRuntime = Layer.mergeAll(
	FileSystem.layerNoop({}),
	Path.layer,
	Stdio.layerTest({}),
	Layer.succeed(
		Terminal.Terminal,
		Terminal.make({
			columns: Effect.succeed(process.stdout.columns ?? 80),
			rows: Effect.succeed(process.stdout.rows ?? 24),
			readInput: Effect.die("Interactive input is unavailable"),
			readLine: Effect.die("Interactive input is unavailable"),
			display: (text) => Effect.sync(() => process.stdout.write(text)),
		}),
	),
	Layer.succeed(
		ChildProcessSpawner.ChildProcessSpawner,
		ChildProcessSpawner.make(() => Effect.die("Child process spawning is unavailable")),
	),
)

const listCommand = Command.make("list", {}, () =>
	Effect.sync(() => {
		for (const [id, entry] of scenarioRegistry) {
			process.stdout.write(`${id}\t${entry.definition.version}\t${entry.definition.description}\n`)
		}
	}),
).pipe(Command.withDescription("List registered fault-cell scenarios"))

const runCommand = Command.make(
	"run",
	{
		scenarioId: Argument.string("scenario-id"),
		seed: Flag.withDefault(Flag.integer("seed"), 1),
		runDir: Flag.optional(Flag.string("run-dir")),
		repoRoot: Flag.optional(Flag.string("repo-root")),
		nixpkgs: Flag.withDefault(Flag.string("nixpkgs"), "flake:nixpkgs"),
		negativeControl: Flag.boolean("negative-control"),
		bootTimeoutMs: Flag.withDefault(Flag.integer("boot-timeout-ms"), 300_000),
		requestTimeoutMs: Flag.withDefault(Flag.integer("request-timeout-ms"), 120_000),
	},
	(options) =>
		Effect.gen(function* () {
			const registered = scenarioRegistry.get(options.scenarioId)
			if (registered === undefined) {
				process.stderr.write(`unknown scenario "${options.scenarioId}"; try: fault-cell list\n`)
				process.exitCode = 1
				return
			}

			const runId = makeRunId(Date.now(), randomBytes(6))
			const runDir = resolve(
				Option.isSome(options.runDir)
					? options.runDir.value
					: join(process.cwd(), "fault-cell-runs", runId),
			)
			const repoRoot = resolve(
				Option.isSome(options.repoRoot) ? options.repoRoot.value : process.cwd(),
			)
			const nixpkgs = yield* Effect.try({
				try: () => resolveNixpkgs(options.nixpkgs),
				catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
			})
			const outcome = yield* Effect.result(
				runScenario({
					scenario: registered.definition,
					scenarioModulePath: registered.modulePath,
					runId,
					seed: options.seed,
					runDir,
					repoRoot,
					nixExprPath: join(packageRoot, "nix", "cell.nix"),
					agentPath: join(packageRoot, "guest", "agent.py"),
					nixpkgs,
					bootTimeoutMs: options.bootTimeoutMs,
					requestTimeoutMs: options.requestTimeoutMs,
					includeNegativeControls: options.negativeControl,
					onProgress: (line) => process.stdout.write(`${line}\n`),
				}),
			)

			if (Result.isFailure(outcome)) {
				process.stderr.write(`fault-cell: ${JSON.stringify(outcome.failure, null, 2)}\n`)
				process.exitCode = 2
				return
			}

			const { manifest, manifestPath, consoleLogPath } = outcome.success
			process.stdout.write(`\nrun ${manifest.runId} ${manifest.outcome.toUpperCase()}\n`)
			process.stdout.write(
				`acceleration: kvm ${manifest.acceleration.kvmEnabled ? "ENABLED (hardware)" : "DISABLED (TCG emulation)"} (present=${manifest.acceleration.kvmPresent}, via ${manifest.acceleration.source})\n`,
			)
			for (const record of manifest.invariants) {
				process.stdout.write(
					`  [${record.outcome._tag.toUpperCase()}] ${record.name} — ${record.outcome.detail}\n`,
				)
			}
			process.stdout.write(`manifest: ${manifestPath}\nconsole:  ${consoleLogPath}\n`)
			process.exitCode = manifest.outcome === "passed" ? 0 : 1
		}),
).pipe(
	Command.withDescription(
		"Run one scenario in a disposable NixOS VM; exit 0 only when every invariant is satisfied",
	),
)

export const faultCellCommand = Command.make("fault-cell").pipe(
	Command.withDescription("Disposable NixOS cells for reproducible fault injection"),
	Command.withSubcommands([listCommand, runCommand]),
)

export const faultCellCli = Command.runWith(faultCellCommand, { version: "0.1.0" })

export async function runFaultCellCli(argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
	await Effect.runPromise(faultCellCli(argv).pipe(Effect.provide(cliRuntime)))
}

if (import.meta.main) {
	try {
		await runFaultCellCli()
	} catch (cause) {
		process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`)
		process.exitCode = 1
	}
}
