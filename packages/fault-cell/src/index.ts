export { FaultCell, type CellAcceleration, type CellBootOptions } from "./cell"
export { GuestChannel, GuestReplyFailure, type ChannelWaiters, type ResultDecoder } from "./channel"
export {
	ArtifactError,
	CellProvisionError,
	CellTimeoutError,
	ControlChannelError,
	FaultNotAppliedError,
	GuestOperationError,
	ScenarioDefinitionError,
	toTypedFailure,
	type FaultCellError,
	type TypedFailure,
} from "./errors"
export { makeRunId, RunIdSchema, type RunId } from "./ids"
export {
	decideOutcome,
	MANIFEST_VERSION,
	RunManifestSchema,
	decodeRunManifest,
	encodeRunManifest,
	type Acceleration,
	type InputHash,
	type InvariantRecord,
	type ProbeRecord,
	type RunManifest,
	type StepRecord,
} from "./manifest"
export {
	Observation,
	collectedToRecord,
	numberCell,
	stringCell,
	type AppliedFault,
	type ArtifactRecord,
	type ObservationInput,
	type ProbeValue,
	type SqliteRow,
} from "./observation"
export {
	PROTOCOL_VERSION,
	decodeGuestFrameLine,
	encodeGuestRequestLine,
	type BarrierEvent,
	type GuestFrame,
	type GuestRequest,
	type JsonValue,
	type ObservedProcess,
	type ProcessExit,
	type SignalName,
} from "./protocol"
export { QmpClient } from "./qmp"
export { scenarioRegistry, type RegisteredScenario } from "./registry"
export { RUNNER_VERSION, runScenario, type RunOptions, type RunOutcome } from "./runner"
export {
	missing,
	satisfied,
	violated,
	type CellSpec,
	type InvariantOutcome,
	type InvariantSpec,
	type ProbeSpec,
	type ProcessSpec,
	type ScenarioDefinition,
	type ScenarioPlan,
	type ScenarioStep,
	type ScratchMountSpec,
} from "./scenario"
export {
	capture,
	inputHash,
	resolveGit,
	resolveHost,
	resolveNixpkgs,
	sha256OfFile,
	sha256OfText,
	sha256OfTree,
	type GitProvenance,
	type HostProvenance,
	type ResolvedNixpkgs,
} from "./provenance"
