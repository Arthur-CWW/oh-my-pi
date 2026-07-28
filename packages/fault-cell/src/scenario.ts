import { Schema } from "effect"
import type { RunId } from "./ids"
import { JsonValueSchema, SignalNameSchema } from "./protocol"
import type { Observation } from "./observation"

/**
 * A scenario is data plus pure predicates.
 *
 * Topology, processes, steps, probes and artifacts are all declarative values, so they
 * hash into the run manifest and a rerun is byte-comparable. Invariants are pure functions
 * over decoded telemetry: they receive an {@link Observation}, never a shell, a socket, or
 * the cell itself. That is the structural reason a scenario cannot assert success by
 * shelling into an untyped check.
 */

export const ScratchMountSpecSchema = Schema.Struct({
	name: Schema.String,
	path: Schema.String,
	/** Hard size of the scratch filesystem. This is the ENOSPC quota for the mount. */
	quotaMiB: Schema.Int,
	fs: Schema.Literals(["ext4", "tmpfs"]),
})
export type ScratchMountSpec = Schema.Schema.Type<typeof ScratchMountSpecSchema>

export const LinkSpecSchema = Schema.Struct({
	name: Schema.String,
	guestInterface: Schema.String,
})
export type LinkSpec = Schema.Schema.Type<typeof LinkSpecSchema>

export const CellSpecSchema = Schema.Struct({
	memoryMiB: Schema.Int,
	cores: Schema.Int,
	diskMiB: Schema.Int,
	timeZone: Schema.String,
	/** nixpkgs attribute names made available inside the guest. */
	guestPackages: Schema.Array(Schema.String),
	kernelModules: Schema.Array(Schema.String),
	mounts: Schema.Array(ScratchMountSpecSchema),
	links: Schema.Array(LinkSpecSchema),
})
export type CellSpec = Schema.Schema.Type<typeof CellSpecSchema>

export const ProcessSpecSchema = Schema.Struct({
	name: Schema.String,
	argv: Schema.Array(Schema.String),
	cwd: Schema.String,
	env: Schema.Record(Schema.String, Schema.String),
	tz: Schema.Union([Schema.String, Schema.Null]),
})
export type ProcessSpec = Schema.Schema.Type<typeof ProcessSpecSchema>

export const ProbeSpecSchema = Schema.Union([
	Schema.Struct({
		_tag: Schema.Literal("Sqlite"),
		name: Schema.String,
		path: Schema.String,
		sql: Schema.String,
		params: Schema.Array(JsonValueSchema),
	}),
	Schema.Struct({
		_tag: Schema.Literal("File"),
		name: Schema.String,
		path: Schema.String,
		includeText: Schema.Boolean,
	}),
	Schema.Struct({
		_tag: Schema.Literal("ProcessTable"),
		name: Schema.String,
	}),
])
export type ProbeSpec = Schema.Schema.Type<typeof ProbeSpecSchema>

export const ScenarioStepSchema = Schema.Union([
	Schema.Struct({ _tag: Schema.Literal("Start"), process: Schema.String }),
	Schema.Struct({
		_tag: Schema.Literal("Signal"),
		process: Schema.String,
		signal: SignalNameSchema,
	}),
	Schema.Struct({ _tag: Schema.Literal("Restart"), process: Schema.String }),
	Schema.Struct({
		_tag: Schema.Literal("WaitForBarrier"),
		barrier: Schema.String,
		occurrence: Schema.Int,
		timeoutMs: Schema.Int,
	}),
	Schema.Struct({
		_tag: Schema.Literal("WaitForExit"),
		process: Schema.String,
		timeoutMs: Schema.Int,
	}),
	Schema.Struct({
		_tag: Schema.Literal("SetCgroupMemory"),
		process: Schema.String,
		maxBytes: Schema.Int,
	}),
	Schema.Struct({
		_tag: Schema.Literal("SetCgroupCpu"),
		process: Schema.String,
		quotaPercent: Schema.Int,
	}),
	Schema.Struct({
		_tag: Schema.Literal("FillFilesystem"),
		mount: Schema.String,
		leaveFreeBytes: Schema.Int,
	}),
	Schema.Struct({ _tag: Schema.Literal("ReleaseFilesystem"), mount: Schema.String }),
	Schema.Struct({
		_tag: Schema.Literal("SqliteLockHold"),
		hold: Schema.String,
		path: Schema.String,
		mode: Schema.Literals(["shared", "reserved", "exclusive"]),
	}),
	Schema.Struct({ _tag: Schema.Literal("SqliteLockRelease"), hold: Schema.String }),
	Schema.Struct({ _tag: Schema.Literal("NetworkPartition"), link: Schema.String }),
	Schema.Struct({
		_tag: Schema.Literal("NetworkDelay"),
		link: Schema.String,
		delayMs: Schema.Int,
		jitterMs: Schema.Int,
	}),
	Schema.Struct({ _tag: Schema.Literal("NetworkReset"), link: Schema.String }),
	Schema.Struct({
		_tag: Schema.Literal("SetProcessTz"),
		process: Schema.String,
		tz: Schema.String,
	}),
	Schema.Struct({ _tag: Schema.Literal("Probe"), probe: Schema.String }),
])
export type ScenarioStep = Schema.Schema.Type<typeof ScenarioStepSchema>

export const ScenarioPlanSchema = Schema.Struct({
	processes: Schema.Array(ProcessSpecSchema),
	steps: Schema.Array(ScenarioStepSchema),
	probes: Schema.Array(ProbeSpecSchema),
	/** Guest paths collected into the run directory and hashed on the host. */
	artifacts: Schema.Array(Schema.String),
})
export type ScenarioPlan = Schema.Schema.Type<typeof ScenarioPlanSchema>

export const InvariantOutcomeSchema = Schema.Union([
	Schema.Struct({ _tag: Schema.Literal("Satisfied"), detail: Schema.String }),
	Schema.Struct({ _tag: Schema.Literal("Violated"), detail: Schema.String }),
	/** Telemetry the invariant needs was absent or undecodable. Always fails the run. */
	Schema.Struct({ _tag: Schema.Literal("Missing"), detail: Schema.String }),
])
export type InvariantOutcome = Schema.Schema.Type<typeof InvariantOutcomeSchema>

export const satisfied = (detail: string): InvariantOutcome => ({ _tag: "Satisfied", detail })
export const violated = (detail: string): InvariantOutcome => ({ _tag: "Violated", detail })
export const missing = (detail: string): InvariantOutcome => ({ _tag: "Missing", detail })

export interface InvariantSpec {
	readonly name: string
	readonly description: string
	readonly evaluate: (observation: Observation) => InvariantOutcome
}

export interface ScenarioInput {
	readonly seed: number
	readonly runId: RunId
}

export interface ScenarioDefinition {
	readonly id: string
	readonly version: string
	readonly description: string
	readonly cell: CellSpec
	/**
	 * Directory of application files copied into the nix store and exposed inside the guest at
	 * `/etc/faultcell/payload`. This is the only application-specific input the runner takes;
	 * the runner itself knows nothing about what the payload does.
	 */
	readonly guestPayloadDir: string
	readonly plan: (input: ScenarioInput) => ScenarioPlan
	readonly invariants: readonly InvariantSpec[]
	/**
	 * Invariants that are expected to be violated by a correct harness. Running with
	 * `--negative-control` appends them so a passing run proves the assertion path can fail,
	 * not merely that nothing was checked.
	 */
	readonly negativeControls: readonly InvariantSpec[]
}
