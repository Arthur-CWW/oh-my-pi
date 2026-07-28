#!/usr/bin/env bun
/**
 * Direct pipeline runner — executes a swarm pipeline outside of the TUI.
 *
 * Usage: omp-swarm <yaml-path>
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Effect, Schema } from "effect";
import { Argument, CliError, Command, Param } from "effect/unstable/cli";
import { NodeServices } from "@effect/platform-node";
import { discoverAuthStorage } from "@oh-my-pi/pi-coding-agent";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { buildDependencyGraph, buildExecutionWaves, detectCycles } from "./swarm/dag";
import { PipelineController } from "./swarm/pipeline";
import { renderSwarmProgress } from "./swarm/render";
import { parseSwarmYaml, validateSwarmDefinition } from "./swarm/schema";
import { StateTracker } from "./swarm/state";

class SwarmPipelineError extends Schema.TaggedErrorClass<SwarmPipelineError>()("SwarmPipelineError", {
	reason: Schema.Literals(["validation", "cycle"]),
}) {}

const command = Command.make(
	"omp-swarm",
	{
		yamlPath: Argument.string("yaml-path").pipe(
			Param.withDescription("Path to YAML pipeline definition"),
		),
	},
	(config) =>
		Effect.gen(function* () {
			const resolvedPath = path.resolve(config.yamlPath);
			console.log(`Reading: ${resolvedPath}`);

			const content = yield* Effect.promise(() => Bun.file(resolvedPath).text());
			const def = parseSwarmYaml(content);

			console.log(`Swarm: ${def.name}`);
			console.log(`Mode: ${def.mode}`);
			console.log(`Target count: ${def.targetCount}`);
			console.log(`Agents: ${[...def.agents.keys()].join(", ")}`);

			// Validate
			const errors = validateSwarmDefinition(def);
			if (errors.length > 0) {
				console.error("Validation errors:", errors);
				return yield* new SwarmPipelineError({ reason: "validation" });
			}

			// Build DAG
			const deps = buildDependencyGraph(def);
			const cycles = detectCycles(deps);
			if (cycles) {
				console.error("Cycle detected:", cycles);
				return yield* new SwarmPipelineError({ reason: "cycle" });
			}
			const waves = buildExecutionWaves(deps);
			console.log(`Waves: ${waves.map((w, i) => `W${i + 1}:[${w.join(",")}]`).join(" -> ")}`);

			// Resolve workspace
			const workspace = path.isAbsolute(def.workspace)
				? def.workspace
				: path.resolve(path.dirname(resolvedPath), def.workspace);

			yield* Effect.promise(() => fs.mkdir(workspace, { recursive: true }));
			console.log(`Workspace: ${workspace}`);

			// Initialize
			const stateTracker = new StateTracker(workspace, def.name);
			yield* Effect.promise(() =>
				stateTracker.init([...def.agents.keys()], def.targetCount, def.mode),
			);

			// Auth + settings
			const authStorage = yield* Effect.promise(() => discoverAuthStorage());
			const modelRegistry = new ModelRegistry(authStorage);
			const settings = Settings.isolated();

			// Progress display
			let lastProgressDump = 0;
			const PROGRESS_INTERVAL_MS = 5000;

			// Run
			console.log("\n--- Pipeline starting ---\n");

			const controller = new PipelineController(def, waves, stateTracker);
			const result = yield* Effect.promise(() =>
				controller.run({
					workspace,
					onProgress: () => {
						const now = Date.now();
						if (now - lastProgressDump > PROGRESS_INTERVAL_MS) {
							lastProgressDump = now;
							const lines = renderSwarmProgress(stateTracker.state);
							console.log(lines.join("\n"));
							console.log();
						}
					},
					modelRegistry,
					settings,
				}),
			);

			console.log("\n--- Pipeline finished ---\n");
			console.log(`Status: ${result.status}`);
			console.log(`Iterations completed: ${result.iterations}/${def.targetCount}`);
			if (result.errors.length > 0) {
				console.log(`Errors (${result.errors.length}):`);
				for (const err of result.errors) {
					console.log(`  - ${err}`);
				}
			}
			console.log(`\nState saved to: ${stateTracker.swarmDir}`);

			// Final state dump
			const lines = renderSwarmProgress(stateTracker.state);
			console.log(lines.join("\n"));
		}),
).pipe(Command.withDescription("Execute a swarm pipeline outside of the TUI"));

const program = Command.run(command, { version: "16.0.1" });
Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer))).catch((error) => {
	if (!CliError.isCliError(error) && !(error instanceof SwarmPipelineError)) {
		console.error("Error:", error);
	}
	process.exitCode = 1;
});
