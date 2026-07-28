import { Schema } from "effect"
import { RunIdSchema } from "./ids"
import { TypedFailureSchema } from "./errors"
import { AppliedFaultSchema, ArtifactRecordSchema } from "./observation"
import {
	BarrierEventSchema,
	JsonValueSchema,
	ObservedProcessSchema,
	ProcessExitSchema,
} from "./protocol"
import { CellSpecSchema, InvariantOutcomeSchema, ScenarioPlanSchema } from "./scenario"

/**
 * One manifest shape for every application. Nothing in here is scenario- or product-specific:
 * a SQLite atomicity cell, an agent-lifecycle cell, and a network-partition cell all emit the
 * same document, so runs are comparable and rerunnable without reading the scenario source.
 */

export const MANIFEST_VERSION = 1

export const InputHashSchema = Schema.Struct({
	name: Schema.String,
	kind: Schema.Literals(["scenario-plan", "cell-spec", "guest-agent", "guest-payload", "nix-expr"]),
	path: Schema.String,
	bytes: Schema.Int,
	sha256: Schema.String,
})
export type InputHash = Schema.Schema.Type<typeof InputHashSchema>

export const NixProvenanceSchema = Schema.Struct({
	nixVersion: Schema.String,
	/** Store path the `nixpkgs` flake reference resolved to at run time. */
	nixpkgsStorePath: Schema.String,
	nixpkgsNarHash: Schema.String,
	nixpkgsLastModified: Schema.Union([Schema.Int, Schema.Null]),
	/** Store path of the generated run-vm script. This is the cell's Nix generation. */
	vmStorePath: Schema.String,
})
export type NixProvenance = Schema.Schema.Type<typeof NixProvenanceSchema>

export const GitProvenanceSchema = Schema.Struct({
	commit: Schema.String,
	dirty: Schema.Boolean,
	describe: Schema.String,
})

export const HostProvenanceSchema = Schema.Struct({
	hostname: Schema.String,
	kernel: Schema.String,
	arch: Schema.String,
	qemuVersion: Schema.String,
})

/**
 * Whether the run was hardware-accelerated. `kvmEnabled` comes from QMP `query-kvm` inside the
 * live guest, not from the presence of /dev/kvm, so a silent TCG fallback is always visible.
 */
export const AccelerationSchema = Schema.Struct({
	requested: Schema.String,
	kvmPresent: Schema.Boolean,
	kvmEnabled: Schema.Boolean,
	source: Schema.Literal("qmp:query-kvm"),
})
export type Acceleration = Schema.Schema.Type<typeof AccelerationSchema>

export const StepRecordSchema = Schema.Struct({
	index: Schema.Int,
	tag: Schema.String,
	summary: Schema.String,
	startedAtWallMs: Schema.Number,
	durationMs: Schema.Number,
	outcome: Schema.Literals(["ok", "failed"]),
	detail: Schema.Record(Schema.String, JsonValueSchema),
})
export type StepRecord = Schema.Schema.Type<typeof StepRecordSchema>

export const ProbeRecordSchema = Schema.Struct({
	name: Schema.String,
	kind: Schema.Literals(["Sqlite", "File", "ProcessTable"]),
	stepIndex: Schema.Int,
	target: Schema.String,
	rowCount: Schema.Int,
	sha256: Schema.String,
	value: JsonValueSchema,
})
export type ProbeRecord = Schema.Schema.Type<typeof ProbeRecordSchema>

export const InvariantRecordSchema = Schema.Struct({
	name: Schema.String,
	description: Schema.String,
	role: Schema.Literals(["invariant", "negative-control"]),
	outcome: InvariantOutcomeSchema,
})
export type InvariantRecord = Schema.Schema.Type<typeof InvariantRecordSchema>

export const RunManifestSchema = Schema.Struct({
	manifestVersion: Schema.Literal(MANIFEST_VERSION),
	runId: RunIdSchema,
	outcome: Schema.Literals(["passed", "failed"]),
	startedAtWallMs: Schema.Number,
	finishedAtWallMs: Schema.Number,
	durationMs: Schema.Number,
	seed: Schema.Int,
	scenario: Schema.Struct({
		id: Schema.String,
		version: Schema.String,
		description: Schema.String,
		modulePath: Schema.String,
		sha256: Schema.String,
	}),
	provenance: Schema.Struct({
		git: GitProvenanceSchema,
		nix: NixProvenanceSchema,
		host: HostProvenanceSchema,
		runnerVersion: Schema.String,
		protocolVersion: Schema.Int,
	}),
	acceleration: AccelerationSchema,
	inputs: Schema.Array(InputHashSchema),
	cell: CellSpecSchema,
	plan: ScenarioPlanSchema,
	steps: Schema.Array(StepRecordSchema),
	faults: Schema.Array(AppliedFaultSchema),
	barriers: Schema.Array(BarrierEventSchema),
	exits: Schema.Array(ProcessExitSchema),
	observedProcesses: Schema.Array(ObservedProcessSchema),
	probes: Schema.Array(ProbeRecordSchema),
	invariants: Schema.Array(InvariantRecordSchema),
	artifacts: Schema.Array(ArtifactRecordSchema),
	failure: Schema.Union([TypedFailureSchema, Schema.Null]),
})
export type RunManifest = Schema.Schema.Type<typeof RunManifestSchema>

export const encodeRunManifest = Schema.encodeUnknownSync(RunManifestSchema)
export const decodeRunManifest = Schema.decodeUnknownSync(RunManifestSchema)

/**
 * A run passes only when every declared invariant is `Satisfied`. `Missing` telemetry counts
 * as a failure by construction — there is no code path that treats absent evidence as a pass.
 */
export function decideOutcome(
	records: readonly InvariantRecord[],
	failure: object | null,
): "passed" | "failed" {
	if (failure !== null && failure !== undefined) return "failed"
	if (records.length === 0) return "failed"
	return records.every((record) => record.outcome._tag === "Satisfied") ? "passed" : "failed"
}
