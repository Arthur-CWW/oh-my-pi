import { Schema } from "effect"

/** The cell could not be provisioned: nix evaluation/build or qemu launch failed. */
export class CellProvisionError extends Schema.TaggedErrorClass<CellProvisionError>()(
	"CellProvisionError",
	{
		phase: Schema.Literals(["resolve-nixpkgs", "write-spec", "nix-build", "launch", "connect"]),
		message: Schema.String,
		detail: Schema.optionalKey(Schema.String),
	},
) {}

/** The control channel to the guest agent broke or produced undecodable traffic. */
export class ControlChannelError extends Schema.TaggedErrorClass<ControlChannelError>()(
	"ControlChannelError",
	{
		reason: Schema.Literals(["closed", "undecodable", "timeout", "protocol"]),
		message: Schema.String,
		frame: Schema.optionalKey(Schema.String),
	},
) {}

/** The guest agent executed the operation and reported a typed failure. */
export class GuestOperationError extends Schema.TaggedErrorClass<GuestOperationError>()(
	"GuestOperationError",
	{
		op: Schema.String,
		code: Schema.String,
		message: Schema.String,
		detail: Schema.optionalKey(Schema.String),
	},
) {}

/** A bounded wait for a barrier, exit, or reply elapsed. */
export class CellTimeoutError extends Schema.TaggedErrorClass<CellTimeoutError>()(
	"CellTimeoutError",
	{
		waitingFor: Schema.String,
		timeoutMs: Schema.Int,
		observed: Schema.String,
	},
) {}

/**
 * A fault was requested but the cell could not prove it took effect. Never downgraded to a
 * warning: an unverified injection makes every downstream invariant meaningless.
 */
export class FaultNotAppliedError extends Schema.TaggedErrorClass<FaultNotAppliedError>()(
	"FaultNotAppliedError",
	{
		fault: Schema.String,
		target: Schema.String,
		expected: Schema.String,
		observed: Schema.String,
	},
) {}

/** A scenario referenced a process, mount, link, probe, or hold it never declared. */
export class ScenarioDefinitionError extends Schema.TaggedErrorClass<ScenarioDefinitionError>()(
	"ScenarioDefinitionError",
	{
		scenario: Schema.String,
		message: Schema.String,
	},
) {}

/** Artifact collection or manifest emission failed on the host side. */
export class ArtifactError extends Schema.TaggedErrorClass<ArtifactError>()("ArtifactError", {
	operation: Schema.Literals(["collect", "hash", "write-manifest", "write-log"]),
	path: Schema.String,
	message: Schema.String,
}) {}

export type FaultCellError =
	| CellProvisionError
	| ControlChannelError
	| GuestOperationError
	| CellTimeoutError
	| FaultNotAppliedError
	| ScenarioDefinitionError
	| ArtifactError

/** Stable, manifest-embeddable projection of any runner failure. */
export const TypedFailureSchema = Schema.Struct({
	tag: Schema.String,
	summary: Schema.String,
	fields: Schema.Record(Schema.String, Schema.String),
})
export type TypedFailure = Schema.Schema.Type<typeof TypedFailureSchema>

export function toTypedFailure(error: FaultCellError): TypedFailure {
	const fields: Record<string, string> = {}
	for (const [key, value] of Object.entries(error)) {
		if (key === "_tag" || value === undefined) continue
		fields[key] = typeof value === "string" ? value : JSON.stringify(value)
	}
	return {
		tag: error._tag,
		summary: `${error._tag}: ${fields.message ?? fields.summary ?? Object.values(fields).join(" ")}`,
		fields,
	}
}
