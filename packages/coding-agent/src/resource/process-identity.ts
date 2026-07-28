import * as fs from "node:fs";
import { Effect, Schema } from "effect";
import {
	bunSyncCommandExecutor,
	NonEmptyStringSchema,
	PositiveSafeIntSchema,
	PsDecodeError,
	type SyncCommandExecutor,
} from "./ps-command";

export const ProcessIdentitySchema = Schema.Struct({
	bootId: NonEmptyStringSchema,
	pid: PositiveSafeIntSchema,
	startFingerprint: NonEmptyStringSchema,
});
export type ProcessIdentity = typeof ProcessIdentitySchema.Type;

/**
 * Durable identities are persisted verbatim (SQLite columns, IRC peer rows), so
 * an unexpected key means the writer disagrees with this shape and the value
 * must not be trusted.
 */
const decodeIdentityStrict = Schema.decodeUnknownSync(ProcessIdentitySchema, { onExcessProperty: "error" });

let cachedBootId = "";

/**
 * Boot identity of the running kernel. Cheap on linux (a procfs read) and one
 * memoised `sysctl` on darwin; empty on any other platform, which callers treat
 * as "identity unprovable".
 */
const bootIdEffect = Effect.fn("HostResource.bootId")(function* (executor: SyncCommandExecutor) {
	if (cachedBootId) return cachedBootId;
	let bootId = "";
	if (process.platform === "linux") {
		try {
			bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim().replace(/\s+/g, " ");
		} catch {
			bootId = "";
		}
	} else if (process.platform === "darwin") {
		bootId = yield* Effect.orElseSucceed(executor("sysctl", ["-n", "kern.boottime"]), () => "");
	}
	if (bootId) cachedBootId = bootId;
	return bootId;
});

/**
 * Read a PID-reuse-safe identity for one live process.
 *
 * The effect is the boundary; {@link readProcessIdentity} is its adapter. Every
 * step is synchronous by construction (`Effect.sync`/`Effect.try` only), which
 * is what lets the adapter stay a plain call for callers inside SQLite
 * transactions and IRC peer listings that cannot await.
 */
export const readProcessIdentityEffect = Effect.fn("HostResource.readProcessIdentity")(function* (
	pid: number,
	executor: SyncCommandExecutor = bunSyncCommandExecutor,
) {
	if (!Number.isSafeInteger(pid) || pid <= 0) {
		return yield* Effect.fail(
			new PsDecodeError({ message: `Invalid pid ${pid}`, source: "process-identity" }),
		);
	}
	const bootId = yield* bootIdEffect(executor);
	const startFingerprint = yield* executor("ps", ["-o", "lstart=", "-p", String(pid)]);
	return yield* Effect.try({
		try: () => decodeIdentityStrict({ bootId, pid, startFingerprint }),
		catch: error =>
			new PsDecodeError({
				message: `Unable to decode identity for pid ${pid}: ${error}`,
				source: "process-identity",
			}),
	});
});

/** Sync adapter: an unprovable identity is `null`, never a partially trusted record. */
export function readProcessIdentity(pid: number): ProcessIdentity | null {
	return Effect.runSync(Effect.orElseSucceed(readProcessIdentityEffect(pid), () => null));
}

/** Boot identity of this host, or `""` when the platform cannot prove one. */
export function currentBootId(): string {
	return Effect.runSync(Effect.orElseSucceed(bootIdEffect(bunSyncCommandExecutor), () => ""));
}

/** True only when the same process still owns this PID on the same boot. */
export function matchesProcessIdentity(identity: ProcessIdentity): boolean {
	const current = readProcessIdentity(identity.pid);
	return (
		current !== null && current.bootId === identity.bootId && current.startFingerprint === identity.startFingerprint
	);
}

/** Decode a durable identity value (JSON string or object) without trusting its shape. */
export function decodeProcessIdentity(value: unknown): ProcessIdentity | undefined {
	let candidate = value;
	if (typeof candidate === "string") {
		try {
			candidate = JSON.parse(candidate) as unknown;
		} catch {
			return undefined;
		}
	}
	try {
		return decodeIdentityStrict(candidate);
	} catch {
		return undefined;
	}
}
