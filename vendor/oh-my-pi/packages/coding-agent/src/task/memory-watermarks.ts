/**
 * Graduated memory backpressure for subagent workers.
 *
 * A worker that grows large degrades instead of dying: crossing the SOFT
 * watermark delivers one in-band notice over the same external IRC channel the
 * harness already uses to reach a running child, and crossing the HARD
 * watermark interrupts the current turn resumably (the durable journal is
 * untouched and the recorded failure class stays in the resumable set — see
 * `isMemoryWatermarkInterrupt` in `./subagent-failure`).
 *
 * Both watermarks are operator-configurable per host so a 128 GiB box is not
 * pinned to the ceiling that fits a laptop.
 */
import { Schema } from "effect";
import type { Settings } from "../config/settings";
import { IrcExternalBus } from "../irc/bus-external";
import { MEMORY_WATERMARK_MARKER } from "./subagent-failure";

/** Sender name attributed to the backpressure notice in the child's transcript. */
export const MEMORY_PRESSURE_NOTICE_PEER = "harness-memory";

/** The ceiling shipped before graduated backpressure existed; kept as the hard default. */
export const DEFAULT_MEMORY_HARD_WATERMARK_BYTES = 1536 * 1024 * 1024;
/** 75% of the hard default — enough headroom for a child to shed context before the interrupt. */
export const DEFAULT_MEMORY_SOFT_WATERMARK_BYTES = 1152 * 1024 * 1024;

export interface MemoryWatermarks {
	/** RSS above which the child is warned in band. 0 disables the warning stage. */
	readonly softBytes: number;
	/** RSS above which the child's turn is interrupted resumably. 0 disables the interrupt. */
	readonly hardBytes: number;
}

const WatermarkByteCountSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const MemoryWatermarksSchema = Schema.Struct({
	softBytes: WatermarkByteCountSchema,
	hardBytes: WatermarkByteCountSchema,
});

/**
 * Decode operator-supplied watermarks at the configuration boundary.
 *
 * A soft watermark at or above the hard one carries no information (the hard
 * branch always wins the same sample), so it is clamped down to the hard
 * watermark rather than rejected: bad config must not brick a session.
 */
export function decodeMemoryWatermarks(input: unknown): MemoryWatermarks {
	const decoded = Schema.decodeUnknownSync(MemoryWatermarksSchema)(input, { onExcessProperty: "error" });
	const hardBytes = decoded.hardBytes;
	const softBytes = hardBytes > 0 ? Math.min(decoded.softBytes, hardBytes) : decoded.softBytes;
	return { softBytes, hardBytes };
}

/** Resolve the per-host watermarks from settings. */
export function resolveMemoryWatermarks(settings: Settings): MemoryWatermarks {
	return decodeMemoryWatermarks({
		softBytes: settings.get("task.memorySoftWatermarkBytes"),
		hardBytes: settings.get("task.memoryHardWatermarkBytes"),
	});
}

function mib(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

/** In-band steering text asking a live child to shed footprint. Never terminates anything. */
export function memorySoftWatermarkNotice(rssBytes: number, watermarks: MemoryWatermarks): string {
	return (
		`<system-warning>Memory backpressure: this subagent's resident set is ${mib(rssBytes)}, ` +
		`past the ${mib(watermarks.softBytes)} soft watermark. Reduce your footprint now — stop re-reading large ` +
		`files, drop wide search output, and write bulk findings to disk instead of holding them in context. ` +
		`At ${mib(watermarks.hardBytes)} your turn is interrupted; the interrupt is resumable, but in-flight ` +
		`reasoning is lost.</system-warning>`
	);
}

/** Terminal message for a hard crossing. Contains the marker that keeps the outcome resumable. */
export function memoryHardWatermarkMessage(rssBytes: number, watermarks: MemoryWatermarks): string {
	return (
		`Subagent ${MEMORY_WATERMARK_MARKER}: resident set ${rssBytes} crossed the hard watermark ` +
		`${watermarks.hardBytes}; the turn was interrupted and can be resumed`
	);
}

/**
 * Terminal message for an unreadable RSS sample. Losing observability is treated
 * as a crossing (we cannot prove the worker is safe) but stays resumable.
 */
export function memoryWatermarkSampleInvalidMessage(reason: string, watermarks: MemoryWatermarks): string {
	return (
		`Subagent ${MEMORY_WATERMARK_MARKER}: resident-set sample was invalid (${reason}); ` +
		`conservatively interrupting against the ${watermarks.hardBytes}-byte hard watermark, resumable`
	);
}

/**
 * Deliver the soft notice to a live child.
 *
 * A subprocess worker registers itself on the external IRC bus under its agent
 * id (`spawn-worker-entry`), and a running `AgentSession` drains that bus at
 * every step boundary as a non-interrupting aside — so this reaches the child
 * mid-turn without touching its lifecycle.
 */
export function deliverMemoryPressureNotice(agentId: string, notice: string, bus?: IrcExternalBus): boolean {
	try {
		(bus ?? IrcExternalBus.global()).sendMessage({
			fromPeer: MEMORY_PRESSURE_NOTICE_PEER,
			toPeer: agentId,
			body: notice,
			audience: "direct",
			origin: "system",
		});
		return true;
	} catch {
		// The notice is advisory: a bus that cannot be opened must never fail a live run.
		return false;
	}
}
