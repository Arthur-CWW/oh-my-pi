import { Schema } from "effect"

/**
 * Wire contract between the host runner and the in-guest agent.
 *
 * This module is the only place raw bytes become values. Every frame is decoded with a
 * schema before anything else in the package sees it; an undecodable frame is a hard
 * failure, never a skipped line.
 */

export const PROTOCOL_VERSION = 1

export type JsonValue =
	| null
	| boolean
	| number
	| string
	| readonly JsonValue[]
	| { readonly [key: string]: JsonValue }

export const JsonValueSchema: Schema.Codec<JsonValue> = Schema.suspend(
	(): Schema.Codec<JsonValue> =>
		Schema.Union([
			Schema.Null,
			Schema.Boolean,
			Schema.Number,
			Schema.String,
			Schema.Array(JsonValueSchema),
			Schema.Record(Schema.String, JsonValueSchema),
		]),
)

export const SignalNameSchema = Schema.Literals([
	"SIGTERM",
	"SIGKILL",
	"SIGINT",
	"SIGHUP",
	"SIGSTOP",
	"SIGCONT",
	"SIGUSR1",
	"SIGUSR2",
])
export type SignalName = Schema.Schema.Type<typeof SignalNameSchema>

/**
 * Host-observable identity of a guest process. `pid` alone is reusable, so the agent also
 * reports the process start ticks read from /proc, which fences a stale pid against a
 * recycled one.
 */
export const ObservedProcessSchema = Schema.Struct({
	process: Schema.String,
	incarnation: Schema.Int,
	pid: Schema.Int,
	startTicks: Schema.Int,
	cgroup: Schema.String,
	argv: Schema.Array(Schema.String),
	tz: Schema.Union([Schema.String, Schema.Null]),
	startedAtWallMs: Schema.Number,
})
export type ObservedProcess = Schema.Schema.Type<typeof ObservedProcessSchema>

export const ProcessExitSchema = Schema.Struct({
	process: Schema.String,
	incarnation: Schema.Int,
	pid: Schema.Int,
	startTicks: Schema.Int,
	exitCode: Schema.Union([Schema.Int, Schema.Null]),
	termSignal: Schema.Union([Schema.String, Schema.Null]),
	monotonicNs: Schema.Number,
	wallMs: Schema.Number,
})
export type ProcessExit = Schema.Schema.Type<typeof ProcessExitSchema>

export const BarrierEventSchema = Schema.Struct({
	kind: Schema.Literal("event"),
	event: Schema.Literal("barrier"),
	name: Schema.String,
	occurrence: Schema.Int,
	detail: Schema.Record(Schema.String, JsonValueSchema),
	monotonicNs: Schema.Number,
	wallMs: Schema.Number,
})
export type BarrierEvent = Schema.Schema.Type<typeof BarrierEventSchema>

export const ExitEventSchema = Schema.Struct({
	kind: Schema.Literal("event"),
	event: Schema.Literal("exit"),
	exit: ProcessExitSchema,
})

export const ReadyEventSchema = Schema.Struct({
	kind: Schema.Literal("event"),
	event: Schema.Literal("ready"),
	protocolVersion: Schema.Int,
	agent: Schema.Struct({
		version: Schema.String,
		python: Schema.String,
		kernel: Schema.String,
		bootId: Schema.String,
		cgroupVersion: Schema.Int,
		tz: Schema.String,
	}),
})
export type ReadyEvent = Schema.Schema.Type<typeof ReadyEventSchema>

export const LogEventSchema = Schema.Struct({
	kind: Schema.Literal("event"),
	event: Schema.Literal("log"),
	level: Schema.Literals(["debug", "info", "warn", "error"]),
	message: Schema.String,
})
export type LogEvent = Schema.Schema.Type<typeof LogEventSchema>

export const GuestEventSchema = Schema.Union([
	BarrierEventSchema,
	ExitEventSchema,
	ReadyEventSchema,
	LogEventSchema,
])
export type GuestEvent = Schema.Schema.Type<typeof GuestEventSchema>

export const GuestReplyOkSchema = Schema.Struct({
	kind: Schema.Literal("reply"),
	id: Schema.Int,
	ok: Schema.Literal(true),
	op: Schema.String,
	result: JsonValueSchema,
})

export const GuestReplyErrSchema = Schema.Struct({
	kind: Schema.Literal("reply"),
	id: Schema.Int,
	ok: Schema.Literal(false),
	op: Schema.String,
	error: Schema.Struct({
		code: Schema.String,
		message: Schema.String,
		detail: Schema.String,
	}),
})
export const GuestFrameSchema = Schema.Union([
	GuestReplyOkSchema,
	GuestReplyErrSchema,
	GuestEventSchema,
])
export type GuestFrame = Schema.Schema.Type<typeof GuestFrameSchema>

/** Decodes one newline-delimited control-channel frame straight from its JSON text. */
export const decodeGuestFrameLine = Schema.decodeUnknownResult(
	Schema.fromJsonString(GuestFrameSchema),
)

/* ---------------------------------------------------------------------- *
 * Requests. Every guest operation is a member of this union, so the runner
 * cannot emit an operation the guest agent does not implement, and the
 * scenario API has exactly one place where new capabilities are declared.
 * ---------------------------------------------------------------------- */

const request = <Op extends string, Fields extends Schema.Struct.Fields>(
	op: Op,
	fields: Fields,
) => Schema.Struct({ id: Schema.Int, op: Schema.Literal(op), ...fields })

export const GuestRequestSchema = Schema.Union([
	request("hello", {}),
	request("mountScratch", {
		mount: Schema.String,
		path: Schema.String,
		quotaMiB: Schema.Int,
		fs: Schema.Literals(["ext4", "tmpfs"]),
	}),
	request("spawn", {
		process: Schema.String,
		argv: Schema.Array(Schema.String),
		cwd: Schema.String,
		env: Schema.Record(Schema.String, Schema.String),
		tz: Schema.Union([Schema.String, Schema.Null]),
	}),
	request("signal", { process: Schema.String, signal: SignalNameSchema }),
	request("setProcessTz", { process: Schema.String, tz: Schema.String }),
	request("setCgroupMemory", { process: Schema.String, maxBytes: Schema.Int }),
	request("setCgroupCpu", { process: Schema.String, quotaPercent: Schema.Int }),
	request("fillFilesystem", { mount: Schema.String, leaveFreeBytes: Schema.Int }),
	request("releaseFilesystem", { mount: Schema.String }),
	request("sqliteLockHold", {
		hold: Schema.String,
		path: Schema.String,
		mode: Schema.Literals(["shared", "reserved", "exclusive"]),
	}),
	request("sqliteLockRelease", { hold: Schema.String }),
	request("networkPartition", { link: Schema.String }),
	request("networkDelay", {
		link: Schema.String,
		delayMs: Schema.Int,
		jitterMs: Schema.Int,
	}),
	request("networkReset", { link: Schema.String }),
	request("probeSqlite", {
		path: Schema.String,
		sql: Schema.String,
		params: Schema.Array(JsonValueSchema),
	}),
	request("probeFile", { path: Schema.String, includeText: Schema.Boolean }),
	request("processTable", {}),
	request("collectArtifacts", {
		paths: Schema.Array(Schema.String),
		into: Schema.String,
	}),
	request("shutdown", {}),
])
export type GuestRequest = Schema.Schema.Type<typeof GuestRequestSchema>

export const encodeGuestRequestLine = Schema.encodeUnknownSync(
	Schema.fromJsonString(GuestRequestSchema),
)

/* ---------------------------------------------------------------------- *
 * Per-operation result schemas. The runner decodes the `result` payload of
 * every reply with the schema for the op it issued, so a guest that returns
 * the wrong shape fails the run instead of silently widening.
 * ---------------------------------------------------------------------- */

export const MountInfoSchema = Schema.Struct({
	mount: Schema.String,
	path: Schema.String,
	fs: Schema.String,
	device: Schema.String,
	totalBytes: Schema.Int,
	freeBytes: Schema.Int,
})
export type MountInfo = Schema.Schema.Type<typeof MountInfoSchema>

export const FillResultSchema = Schema.Struct({
	mount: Schema.String,
	path: Schema.String,
	freeBytesBefore: Schema.Int,
	freeBytesAfter: Schema.Int,
	balloonBytes: Schema.Int,
	balloonPath: Schema.String,
})
export type FillResult = Schema.Schema.Type<typeof FillResultSchema>

export const ReleaseResultSchema = Schema.Struct({
	mount: Schema.String,
	freeBytesAfter: Schema.Int,
	removedBytes: Schema.Int,
})
export type ReleaseResult = Schema.Schema.Type<typeof ReleaseResultSchema>

export const CgroupMemoryResultSchema = Schema.Struct({
	process: Schema.String,
	cgroup: Schema.String,
	requestedBytes: Schema.Int,
	readBackBytes: Schema.Int,
})
export type CgroupMemoryResult = Schema.Schema.Type<typeof CgroupMemoryResultSchema>

export const CgroupCpuResultSchema = Schema.Struct({
	process: Schema.String,
	cgroup: Schema.String,
	requestedPercent: Schema.Int,
	readBack: Schema.String,
})
export type CgroupCpuResult = Schema.Schema.Type<typeof CgroupCpuResultSchema>

export const SqliteHoldResultSchema = Schema.Struct({
	hold: Schema.String,
	path: Schema.String,
	mode: Schema.Literals(["shared", "reserved", "exclusive"]),
	journalMode: Schema.String,
	held: Schema.Boolean,
})
export type SqliteHoldResult = Schema.Schema.Type<typeof SqliteHoldResultSchema>

export const NetworkResultSchema = Schema.Struct({
	link: Schema.String,
	operState: Schema.String,
	adminUp: Schema.Boolean,
	qdisc: Schema.String,
	delayMs: Schema.Int,
	jitterMs: Schema.Int,
	lossPercent: Schema.Int,
})
export type NetworkResult = Schema.Schema.Type<typeof NetworkResultSchema>

export const SqliteProbeResultSchema = Schema.Struct({
	path: Schema.String,
	sql: Schema.String,
	columns: Schema.Array(Schema.String),
	rows: Schema.Array(Schema.Array(JsonValueSchema)),
})
export type SqliteProbeResult = Schema.Schema.Type<typeof SqliteProbeResultSchema>

export const FileProbeResultSchema = Schema.Struct({
	path: Schema.String,
	exists: Schema.Boolean,
	bytes: Schema.Int,
	sha256: Schema.String,
	text: Schema.Union([Schema.String, Schema.Null]),
})
export type FileProbeResult = Schema.Schema.Type<typeof FileProbeResultSchema>

export const ProcessTableResultSchema = Schema.Struct({
	processes: Schema.Array(ObservedProcessSchema),
})

export const CollectedArtifactSchema = Schema.Struct({
	guestPath: Schema.String,
	relPath: Schema.String,
	bytes: Schema.Int,
	sha256: Schema.String,
})
export type CollectedArtifact = Schema.Schema.Type<typeof CollectedArtifactSchema>

export const CollectResultSchema = Schema.Struct({
	into: Schema.String,
	artifacts: Schema.Array(CollectedArtifactSchema),
})

export const TzResultSchema = Schema.Struct({
	process: Schema.String,
	tz: Schema.String,
})

export const AckResultSchema = Schema.Struct({ acknowledged: Schema.Literal(true) })

/** QMP `query-kvm` return value. The only authority on whether the run was accelerated. */
export const QmpKvmSchema = Schema.Struct({
	enabled: Schema.Boolean,
	present: Schema.Boolean,
})
export type QmpKvm = Schema.Schema.Type<typeof QmpKvmSchema>

export const QmpVersionSchema = Schema.Struct({
	qemu: Schema.Struct({
		major: Schema.Int,
		minor: Schema.Int,
		micro: Schema.Int,
	}),
	package: Schema.String,
})
export type QmpVersion = Schema.Schema.Type<typeof QmpVersionSchema>

export const QmpFrameSchema = Schema.Union([
	Schema.Struct({
		QMP: Schema.Struct({
			version: QmpVersionSchema,
			capabilities: Schema.Array(JsonValueSchema),
		}),
	}),
	Schema.Struct({ return: JsonValueSchema }),
	Schema.Struct({
		error: Schema.Struct({ class: Schema.String, desc: Schema.String }),
	}),
	Schema.Struct({
		event: Schema.String,
		timestamp: Schema.Struct({ seconds: Schema.Number, microseconds: Schema.Number }),
		data: Schema.optionalKey(JsonValueSchema),
	}),
])
export type QmpFrame = Schema.Schema.Type<typeof QmpFrameSchema>

export const decodeQmpFrameLine = Schema.decodeUnknownResult(Schema.fromJsonString(QmpFrameSchema))

/**
 * A request without its correlation id. `Omit` over a union collapses to the shared keys, so
 * this distributes explicitly and keeps every operation's own parameters visible.
 */
export type GuestRequestBody = GuestRequest extends infer Member
	? Member extends { readonly op: string }
		? Omit<Member, "id">
		: never
	: never
