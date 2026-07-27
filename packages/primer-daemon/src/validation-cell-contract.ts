import { Schema } from "effect"

export const VALIDATION_CELL_MANIFEST_VERSION = "primer.validation-cell-manifest.v1" as const
export const VALIDATION_CELL_RECEIPT_VERSION = "primer.validation-cell-receipt.v1" as const

const StrictDecodeOptions = { onExcessProperty: "error" } as const
const NonEmptyString = Schema.String.check(Schema.isMinLength(1), Schema.isPattern(/.*\S.*/))
const PositiveInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))
const NonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const Timestamp = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/))
const RelativeArtifactPath = Schema.String.check(
  Schema.isMaxLength(240),
  Schema.isPattern(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/),
)
const StringList = Schema.Array(NonEmptyString).check(Schema.isMinLength(1), Schema.isMaxLength(64))

const RequiredLayerSchema = <Name extends "state" | "process">(name: Name) =>
  Schema.Struct({
    layer: Schema.Literal(name),
    status: Schema.Literal("required"),
    assertions: StringList,
  })

const BrowserLayerSchema = Schema.Union([
  Schema.Struct({
    layer: Schema.Literal("browser"),
    status: Schema.Literal("required"),
    assertions: StringList,
  }),
  Schema.Struct({
    layer: Schema.Literal("browser"),
    status: Schema.Literal("skipped"),
    reason: NonEmptyString,
    nextLayer: Schema.Literal("receipt"),
  }),
])

const ArtifactPlanSchema = Schema.Struct({
  root: RelativeArtifactPath,
  maxTotalBytes: PositiveInteger,
  paths: Schema.Struct({
    errors: RelativeArtifactPath,
    network: RelativeArtifactPath,
    serverStdout: RelativeArtifactPath,
    serverStderr: RelativeArtifactPath,
    receipt: RelativeArtifactPath,
  }),
})

export const ValidationCellManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(VALIDATION_CELL_MANIFEST_VERSION),
  cell: Schema.Struct({
    id: NonEmptyString,
    version: PositiveInteger,
    description: NonEmptyString,
  }),
  scenario: Schema.Struct({
    id: NonEmptyString,
    workspace: Schema.Literal("temporary-directory"),
    database: Schema.Struct({
      engine: Schema.Literal("sqlite"),
      path: RelativeArtifactPath,
      mode: Schema.Literal("real"),
    }),
    server: Schema.Struct({
      transport: Schema.Literal("http"),
      host: Schema.Literal("127.0.0.1"),
      port: Schema.Literal(0),
      command: StringList,
      readinessPath: NonEmptyString,
    }),
    steps: StringList,
  }),
  layers: Schema.Struct({
    state: RequiredLayerSchema("state"),
    process: RequiredLayerSchema("process"),
    browser: BrowserLayerSchema,
  }),
  entropyControls: Schema.Struct({
    logicalClock: Schema.Struct({
      kind: Schema.Literal("fixed-sequence"),
      start: Timestamp,
      stepMs: PositiveInteger,
    }),
    randomSeed: NonNegativeInteger,
    provider: Schema.Literal("reject"),
    network: Schema.Literal("loopback-only"),
  }),
  oracle: Schema.Struct({
    kind: Schema.Literal("sqlite-http-process-restart"),
    assertions: StringList,
    invariant: NonEmptyString,
  }),
  budget: Schema.Struct({
    timeoutMs: PositiveInteger,
    maxHttpRequests: PositiveInteger,
    maxProcessStarts: PositiveInteger,
    maxRestarts: NonNegativeInteger,
  }),
  artifacts: ArtifactPlanSchema,
  cleanup: Schema.Struct({
    always: StringList,
    preserve: Schema.Array(RelativeArtifactPath).check(Schema.isMaxLength(16)),
  }),
  negativeControl: Schema.Struct({
    id: NonEmptyString,
    mutation: NonEmptyString,
    expectedOutcome: Schema.Literal("invariant-failure"),
    expectedInvariantFailure: NonEmptyString,
  }),
})

const AssertionReceiptSchema = Schema.Struct({
  id: NonEmptyString,
  status: Schema.Union([Schema.Literal("passed"), Schema.Literal("failed")]),
  detail: NonEmptyString,
})

const ExecutedLayerReceiptSchema = Schema.Struct({
  status: Schema.Union([Schema.Literal("passed"), Schema.Literal("failed")]),
  assertions: Schema.Array(AssertionReceiptSchema).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
})

const BrowserReceiptSchema = Schema.Union([
  ExecutedLayerReceiptSchema,
  Schema.Struct({
    status: Schema.Literal("skipped"),
    assertions: Schema.Array(AssertionReceiptSchema).check(Schema.isMaxLength(0)),
    reason: NonEmptyString,
    nextLayer: Schema.Literal("receipt"),
  }),
])

const ReceiptArtifactSchema = Schema.Struct({
  kind: Schema.Union([
    Schema.Literal("errors"),
    Schema.Literal("network"),
    Schema.Literal("server-stdout"),
    Schema.Literal("server-stderr"),
    Schema.Literal("receipt"),
  ]),
  path: RelativeArtifactPath,
  bytes: NonNegativeInteger,
})

const ReceiptErrorSchema = Schema.Struct({
  layer: Schema.Union([Schema.Literal("state"), Schema.Literal("process"), Schema.Literal("browser"), Schema.Literal("runner")]),
  code: NonEmptyString,
  message: NonEmptyString,
  artifactPath: Schema.NullOr(RelativeArtifactPath),
})

export const ValidationCellReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal(VALIDATION_CELL_RECEIPT_VERSION),
  manifest: Schema.Struct({
    schemaVersion: Schema.Literal(VALIDATION_CELL_MANIFEST_VERSION),
    cellId: NonEmptyString,
    cellVersion: PositiveInteger,
  }),
  scenario: Schema.Struct({
    id: NonEmptyString,
    startedAt: Timestamp,
    completedAt: Timestamp,
  }),
  outcome: Schema.Union([Schema.Literal("passed"), Schema.Literal("failed")]),
  layers: Schema.Struct({
    state: ExecutedLayerReceiptSchema,
    process: ExecutedLayerReceiptSchema,
    browser: BrowserReceiptSchema,
  }),
  counts: Schema.Struct({
    httpRequests: NonNegativeInteger,
    sqliteWrites: NonNegativeInteger,
    processStarts: NonNegativeInteger,
    restarts: NonNegativeInteger,
    assertionsPassed: NonNegativeInteger,
    assertionsFailed: NonNegativeInteger,
  }),
  restartProof: Schema.Struct({
    beforePid: PositiveInteger,
    afterPid: PositiveInteger,
    databasePath: RelativeArtifactPath,
    persistedSchedulerDueAt: Timestamp,
    observedSchedulerDueAt: Timestamp,
  }),
  negativeControl: Schema.Struct({
    id: NonEmptyString,
    executed: Schema.Literal(true),
    expectedOutcome: Schema.Literal("invariant-failure"),
    expectedInvariantFailure: NonEmptyString,
    observedInvariantFailure: NonEmptyString,
  }),
  artifacts: Schema.Array(ReceiptArtifactSchema).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  errors: Schema.Array(ReceiptErrorSchema).check(Schema.isMaxLength(32)),
})

export type ValidationCellManifest = Schema.Schema.Type<typeof ValidationCellManifestSchema>
export type ValidationCellReceipt = Schema.Schema.Type<typeof ValidationCellReceiptSchema>
export type ValidationCellLayerName = keyof ValidationCellManifest["layers"]

export function decodeValidationCellManifest(input: unknown): ValidationCellManifest {
  return Schema.decodeUnknownSync(ValidationCellManifestSchema)(input, StrictDecodeOptions)
}

export function decodeValidationCellReceipt(input: unknown): ValidationCellReceipt {
  const receipt = Schema.decodeUnknownSync(ValidationCellReceiptSchema)(input, StrictDecodeOptions)
  if (receipt.scenario.completedAt < receipt.scenario.startedAt) {
    throw new Error("validation receipt completedAt precedes startedAt")
  }
  if (receipt.restartProof.beforePid === receipt.restartProof.afterPid) {
    throw new Error("validation receipt does not prove a full process restart")
  }
  if (receipt.restartProof.persistedSchedulerDueAt !== receipt.restartProof.observedSchedulerDueAt) {
    throw new Error("validation receipt scheduler persistence invariant failed")
  }
  return receipt
}
