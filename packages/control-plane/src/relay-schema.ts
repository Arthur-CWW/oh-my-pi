import { Schema } from "effect"

export type RelayJson = null | boolean | number | string | readonly RelayJson[] | { readonly [key: string]: RelayJson }

export const RELAY_MAX_BODY_BYTES = 64 * 1024
export const RELAY_MAX_JSON_DEPTH = 8
export const RELAY_MAX_JSON_ARRAY_ITEMS = 128
export const RELAY_MAX_JSON_OBJECT_KEYS = 64
export const RELAY_MAX_JSON_STRING_LENGTH = 16 * 1024

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/
const nodeIdPattern = /^node_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sha256Pattern = /^[0-9a-f]{64}$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const RelayJsonShapeSchema: Schema.Codec<RelayJson> = Schema.suspend((): Schema.Codec<RelayJson> =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(RelayJsonShapeSchema),
    Schema.Record(Schema.String, RelayJsonShapeSchema),
  ]),
)
export const RelayJsonSchema = Schema.declare<RelayJson>((value): value is RelayJson => {
  try {
    json(value, "relay JSON")
    Schema.decodeUnknownSync(RelayJsonShapeSchema)(value)
    return true
  } catch {
    return false
  }
})

const NodeIdentityV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), nodeId: Schema.String, hostEpoch: Schema.String, displayName: Schema.String, protocolVersions: Schema.Array(Schema.Literal(1)), observedAt: Schema.Int,
})
export type NodeIdentityV1 = Schema.Schema.Type<typeof NodeIdentityV1ShapeSchema>

const PeerRouteV1ShapeSchema = Schema.Struct({ v: Schema.Literal(1), nodeId: Schema.String, peerId: Schema.String, endpoint: Schema.String })
export type PeerRouteV1 = Schema.Schema.Type<typeof PeerRouteV1ShapeSchema>

const RelayCursorV1ShapeSchema = Schema.Struct({ v: Schema.Literal(1), originNodeId: Schema.String, streamId: Schema.String, sequence: Schema.Int })
export type RelayCursorV1 = Schema.Schema.Type<typeof RelayCursorV1ShapeSchema>

const RelayOriginV1Schema = Schema.Struct({ nodeId: Schema.String, hostEpoch: Schema.String, sessionId: Schema.String, agentId: Schema.optionalKey(Schema.String), streamId: Schema.String, sequence: Schema.Int })
const RelayDestinationV1Schema = Schema.Struct({ nodeId: Schema.String, peerId: Schema.String })
const RelayEnvelopeV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), envelopeId: Schema.String, origin: RelayOriginV1Schema, destination: RelayDestinationV1Schema,
  kind: Schema.Literals(["irc", "task", "control", "event"]), createdAt: Schema.Int, expiresAt: Schema.optionalKey(Schema.Int), payloadVersion: Schema.Int, payloadHash: Schema.String, payload: RelayJsonSchema,
})
export type RelayEnvelopeV1 = Schema.Schema.Type<typeof RelayEnvelopeV1ShapeSchema>

const RelayAckV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), destinationNodeId: Schema.String, envelopeId: Schema.String, acceptedAt: Schema.Int, destinationCursor: Schema.optionalKey(RelayCursorV1ShapeSchema),
  disposition: Schema.Literals(["accepted", "duplicate", "rejected"]), rejectionCode: Schema.optionalKey(Schema.String),
})
export type RelayAckV1 = Schema.Schema.Type<typeof RelayAckV1ShapeSchema>

const WorkPacketV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), packetId: Schema.String, envelopeId: Schema.String, originNodeId: Schema.String, destinationNodeId: Schema.String, idempotency: Schema.Literals(["safe", "unsafe"]),
  payloadVersion: Schema.Int, payload: RelayJsonSchema, createdAt: Schema.Int, expiresAt: Schema.optionalKey(Schema.Int),
})
export type WorkPacketV1 = Schema.Schema.Type<typeof WorkPacketV1ShapeSchema>

const WorkLeaseV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), packetId: Schema.String, leaseEpoch: Schema.String, ownerNodeId: Schema.String, ownerSessionId: Schema.String,
  ownerAgentId: Schema.String, acquiredAt: Schema.Int, renewBy: Schema.Int, attempt: Schema.Int,
})
export type WorkLeaseV1 = Schema.Schema.Type<typeof WorkLeaseV1ShapeSchema>

const WorkEventV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), eventId: Schema.String, packetId: Schema.String, leaseEpoch: Schema.optionalKey(Schema.String),
  kind: Schema.Literals(["queued", "leased", "renewed", "released", "completed", "failed", "orphaned", "expired"]), occurredAt: Schema.Int, detail: Schema.optionalKey(RelayJsonSchema),
})
export type WorkEventV1 = Schema.Schema.Type<typeof WorkEventV1ShapeSchema>

const RelayHealthV1ShapeSchema = Schema.Struct({
  v: Schema.Literal(1), nodeId: Schema.String, observedAt: Schema.Int, status: Schema.Literals(["healthy", "degraded", "offline"]), pendingEnvelopes: Schema.Int,
  oldestPendingAt: Schema.optionalKey(Schema.Int), lastAcceptedAt: Schema.optionalKey(Schema.Int), detail: Schema.optionalKey(Schema.String),
})
export type RelayHealthV1 = Schema.Schema.Type<typeof RelayHealthV1ShapeSchema>

export const NodeIdentityV1Schema = strictSchema(NodeIdentityV1ShapeSchema, validateNodeIdentity)
export const PeerRouteV1Schema = strictSchema(PeerRouteV1ShapeSchema, validatePeerRoute)
export const RelayCursorV1Schema = strictSchema(RelayCursorV1ShapeSchema, validateCursor)
export const RelayEnvelopeV1Schema = strictSchema(RelayEnvelopeV1ShapeSchema, validateEnvelope)
export const RelayAckV1Schema = strictSchema(RelayAckV1ShapeSchema, validateAck)
export const WorkPacketV1Schema = strictSchema(WorkPacketV1ShapeSchema, validateWorkPacket)
export const WorkLeaseV1Schema = strictSchema(WorkLeaseV1ShapeSchema, validateWorkLease)
export const WorkEventV1Schema = strictSchema(WorkEventV1ShapeSchema, validateWorkEvent)
export const RelayHealthV1Schema = strictSchema(RelayHealthV1ShapeSchema, validateRelayHealth)

function strictSchema<T>(shape: Schema.Codec<T>, validate: (value: unknown) => void): Schema.declare<T> {
  return Schema.declare<T>((value): value is T => {
    try {
      validate(value)
      Schema.decodeUnknownSync(shape)(value)
      return true
    } catch {
      return false
    }
  })
}

export function decodeNodeIdentityV1(value: unknown): Readonly<NodeIdentityV1> {
  return decode(NodeIdentityV1Schema, value, validateNodeIdentity)
}

export function decodePeerRouteV1(value: unknown): Readonly<PeerRouteV1> {
  return decode(PeerRouteV1Schema, value, validatePeerRoute)
}

export function decodeRelayCursorV1(value: unknown): Readonly<RelayCursorV1> {
  return decode(RelayCursorV1Schema, value, validateCursor)
}

export function decodeRelayEnvelopeV1(value: unknown): Readonly<RelayEnvelopeV1> {
  return decode(RelayEnvelopeV1Schema, value, validateEnvelope)
}

export function decodeRelayAckV1(value: unknown): Readonly<RelayAckV1> {
  return decode(RelayAckV1Schema, value, validateAck)
}

export function decodeWorkPacketV1(value: unknown): Readonly<WorkPacketV1> {
  return decode(WorkPacketV1Schema, value, validateWorkPacket)
}

export function decodeWorkLeaseV1(value: unknown): Readonly<WorkLeaseV1> {
  return decode(WorkLeaseV1Schema, value, validateWorkLease)
}

export function decodeWorkEventV1(value: unknown): Readonly<WorkEventV1> {
  return decode(WorkEventV1Schema, value, validateWorkEvent)
}

export function decodeRelayHealthV1(value: unknown): Readonly<RelayHealthV1> {
  return decode(RelayHealthV1Schema, value, validateRelayHealth)
}

export const makeNodeIdentityV1 = decodeNodeIdentityV1
export const makePeerRouteV1 = decodePeerRouteV1
export const makeRelayCursorV1 = decodeRelayCursorV1
export const makeRelayEnvelopeV1 = decodeRelayEnvelopeV1
export const makeRelayAckV1 = decodeRelayAckV1
export const makeWorkPacketV1 = decodeWorkPacketV1
export const makeWorkLeaseV1 = decodeWorkLeaseV1
export const makeWorkEventV1 = decodeWorkEventV1
export const makeRelayHealthV1 = decodeRelayHealthV1

function decode<T>(schema: Schema.Codec<T>, value: unknown, validate: (value: unknown) => void): Readonly<T> {
  validate(value)
  return freeze(Schema.decodeUnknownSync(schema)(value))
}

function validateNodeIdentity(value: unknown): void {
  const record = object(value, ["v", "nodeId", "hostEpoch", "displayName", "protocolVersions", "observedAt"])
  version(record)
  nodeId(record.nodeId)
  identifier(record.hostEpoch, "hostEpoch")
  boundedString(record.displayName, "displayName", 128)
  array(record.protocolVersions, "protocolVersions", 1).forEach((item) => integer(item, "protocolVersion", 1))
  timestamp(record.observedAt, "observedAt")
}

function validatePeerRoute(value: unknown): void {
  const record = object(value, ["v", "nodeId", "peerId", "endpoint"])
  version(record)
  nodeId(record.nodeId)
  identifier(record.peerId, "peerId")
  endpoint(record.endpoint)
}

function validateCursor(value: unknown): void {
  const record = object(value, ["v", "originNodeId", "streamId", "sequence"])
  version(record)
  nodeId(record.originNodeId)
  identifier(record.streamId, "streamId")
  integer(record.sequence, "sequence", 0)
}

function validateEnvelope(value: unknown): void {
  const record = object(value, ["v", "envelopeId", "origin", "destination", "kind", "createdAt", "expiresAt", "payloadVersion", "payloadHash", "payload"])
  version(record)
  uuid(record.envelopeId, "envelopeId")
  const origin = object(record.origin, ["nodeId", "hostEpoch", "sessionId", "agentId", "streamId", "sequence"])
  nodeId(origin.nodeId); identifier(origin.hostEpoch, "origin.hostEpoch"); identifier(origin.sessionId, "origin.sessionId")
  optionalIdentifier(origin.agentId, "origin.agentId"); identifier(origin.streamId, "origin.streamId"); integer(origin.sequence, "origin.sequence", 0)
  const destination = object(record.destination, ["nodeId", "peerId"])
  nodeId(destination.nodeId); identifier(destination.peerId, "destination.peerId")
  literal(record.kind, "kind", ["irc", "task", "control", "event"])
  timestamp(record.createdAt, "createdAt"); optionalTimestamp(record.expiresAt, "expiresAt")
  integer(record.payloadVersion, "payloadVersion", 1); hash(record.payloadHash, "payloadHash"); json(record.payload, "payload")
}

function validateAck(value: unknown): void {
  const record = object(value, ["v", "destinationNodeId", "envelopeId", "acceptedAt", "destinationCursor", "disposition", "rejectionCode"])
  version(record); nodeId(record.destinationNodeId); uuid(record.envelopeId, "envelopeId"); timestamp(record.acceptedAt, "acceptedAt")
  if (record.destinationCursor !== undefined) validateCursor(record.destinationCursor); literal(record.disposition, "disposition", ["accepted", "duplicate", "rejected"])
  optionalIdentifier(record.rejectionCode, "rejectionCode")
  if (record.disposition === "rejected" && record.rejectionCode === undefined) throw new Error("rejectionCode is required for rejected acknowledgements")
  if (record.disposition === "rejected" && record.destinationCursor !== undefined) throw new Error("destinationCursor is not allowed for rejected acknowledgements")
  if (record.disposition !== "rejected" && record.rejectionCode !== undefined) throw new Error("rejectionCode is only allowed for rejected acknowledgements")
}

function validateWorkPacket(value: unknown): void {
  const record = object(value, ["v", "packetId", "envelopeId", "originNodeId", "destinationNodeId", "idempotency", "payloadVersion", "payload", "createdAt", "expiresAt"])
  version(record); uuid(record.packetId, "packetId"); uuid(record.envelopeId, "envelopeId"); nodeId(record.originNodeId); nodeId(record.destinationNodeId)
  literal(record.idempotency, "idempotency", ["safe", "unsafe"]); integer(record.payloadVersion, "payloadVersion", 1); json(record.payload, "payload"); timestamp(record.createdAt, "createdAt"); optionalTimestamp(record.expiresAt, "expiresAt")
}

function validateWorkLease(value: unknown): void {
  const record = object(value, ["v", "packetId", "leaseEpoch", "ownerNodeId", "ownerSessionId", "ownerAgentId", "acquiredAt", "renewBy", "attempt"])
  version(record); uuid(record.packetId, "packetId"); uuid(record.leaseEpoch, "leaseEpoch"); nodeId(record.ownerNodeId); identifier(record.ownerSessionId, "ownerSessionId"); identifier(record.ownerAgentId, "ownerAgentId")
  timestamp(record.acquiredAt, "acquiredAt"); timestamp(record.renewBy, "renewBy"); integer(record.attempt, "attempt", 1)
  if ((record.renewBy as number) <= (record.acquiredAt as number)) throw new Error("renewBy must be after acquiredAt")
}

function validateWorkEvent(value: unknown): void {
  const record = object(value, ["v", "eventId", "packetId", "leaseEpoch", "kind", "occurredAt", "detail"])
  version(record); uuid(record.eventId, "eventId"); uuid(record.packetId, "packetId"); optionalUuid(record.leaseEpoch, "leaseEpoch")
  literal(record.kind, "kind", ["queued", "leased", "renewed", "released", "completed", "failed", "orphaned", "expired"]); timestamp(record.occurredAt, "occurredAt")
  if (record.detail !== undefined) json(record.detail, "detail")
}

function validateRelayHealth(value: unknown): void {
  const record = object(value, ["v", "nodeId", "observedAt", "status", "pendingEnvelopes", "oldestPendingAt", "lastAcceptedAt", "detail"])
  version(record); nodeId(record.nodeId); timestamp(record.observedAt, "observedAt"); literal(record.status, "status", ["healthy", "degraded", "offline"])
  integer(record.pendingEnvelopes, "pendingEnvelopes", 0); optionalTimestamp(record.oldestPendingAt, "oldestPendingAt"); optionalTimestamp(record.lastAcceptedAt, "lastAcceptedAt"); optionalBoundedString(record.detail, "detail", 1024)
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("relay value must be an object")
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) if (!keys.includes(key)) throw new Error(`unexpected relay field: ${key}`)
  for (const key of keys) if (!(key in record) && optionalKeys[key] !== true) throw new Error(`missing relay field: ${key}`)
  return record
}

const optionalKeys: Record<string, true> = { agentId: true, expiresAt: true, destinationCursor: true, rejectionCode: true, leaseEpoch: true, detail: true, oldestPendingAt: true, lastAcceptedAt: true }
function version(record: Record<string, unknown>): void { integer(record.v, "v", 1); if (record.v !== 1) throw new Error("unsupported relay version") }
function nodeId(value: unknown): void { if (typeof value !== "string" || !nodeIdPattern.test(value)) throw new Error("invalid nodeId") }
function uuid(value: unknown, name: string): void { if (typeof value !== "string" || !uuidPattern.test(value)) throw new Error(`invalid ${name}`) }
function optionalUuid(value: unknown, name: string): void { if (value !== undefined) uuid(value, name) }
function hash(value: unknown, name: string): void { if (typeof value !== "string" || !sha256Pattern.test(value)) throw new Error(`invalid ${name}`) }
function identifier(value: unknown, name: string): void { if (typeof value !== "string" || !identifierPattern.test(value)) throw new Error(`invalid ${name}`) }
function optionalIdentifier(value: unknown, name: string): void { if (value !== undefined) identifier(value, name) }
function boundedString(value: unknown, name: string, max: number): void { if (typeof value !== "string" || value.length === 0 || value.length > max) throw new Error(`invalid ${name}`) }
function optionalBoundedString(value: unknown, name: string, max: number): void { if (value !== undefined) boundedString(value, name, max) }
function timestamp(value: unknown, name: string): void { integer(value, name, 0) }
function optionalTimestamp(value: unknown, name: string): void { if (value !== undefined) timestamp(value, name) }
function integer(value: unknown, name: string, minimum: number): void { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error(`invalid ${name}`) }
function literal(value: unknown, name: string, values: readonly string[]): void { if (typeof value !== "string" || !values.includes(value)) throw new Error(`invalid ${name}`) }
function array(value: unknown, name: string, max: number): readonly unknown[] { if (!Array.isArray(value) || value.length === 0 || value.length > max) throw new Error(`invalid ${name}`); return value }
function endpoint(value: unknown): void { if (typeof value !== "string" || value.length > 512) throw new Error("invalid endpoint"); let url: URL; try { url = new URL(value) } catch { throw new Error("invalid endpoint") }; if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("invalid endpoint") }
function json(value: unknown, name: string): void { if (!isRelayJson(value, 0)) throw new Error(`invalid ${name}`); let encoded: string; try { encoded = JSON.stringify(value) } catch { throw new Error(`invalid ${name}`) }; if (new TextEncoder().encode(encoded).byteLength > RELAY_MAX_BODY_BYTES) throw new Error(`oversized ${name}`) }
function isRelayJson(value: unknown, depth: number): value is RelayJson { if (depth > RELAY_MAX_JSON_DEPTH) return false; if (value === null || typeof value === "boolean") return true; if (typeof value === "number") return Number.isFinite(value); if (typeof value === "string") return value.length <= RELAY_MAX_JSON_STRING_LENGTH; if (Array.isArray(value)) return value.length <= RELAY_MAX_JSON_ARRAY_ITEMS && value.every((item) => isRelayJson(item, depth + 1)); if (typeof value !== "object") return false; const record = value as Record<string, unknown>; const entries = Object.entries(record); return entries.length <= RELAY_MAX_JSON_OBJECT_KEYS && entries.every(([key, item]) => key.length <= 256 && isRelayJson(item, depth + 1)) }
function freeze<T>(value: T): Readonly<T> { if (value !== null && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const item of Object.values(value as Record<string, unknown>)) freeze(item) }; return value }
