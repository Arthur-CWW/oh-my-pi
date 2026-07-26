import * as fs from "node:fs/promises";
import { resolveVerifiedReleaseExecutable } from "../cli/restart-session";
import { decodeJournalEntries, projectJournalEntries } from "../journal/projection";
import {
	type ReleaseRegistryValidationOptions,
	resolveNewestInstalledRelease,
	resolveReleaseValidationPaths,
} from "./release-registry-validation";
import { RolloutJournal, type RolloutPeerSnapshot } from "./rollout-journal";
import { SESSION_CONTROL_DB_PATH, SessionControlBus, type SessionSpawnCordon } from "./session-control";

const SHA256 = /^[a-f0-9]{64}$/;
export const SESSION_BINARY_ROUTE_DIGEST_ENV = "OMP_SESSION_BINARY_ROUTE_DIGEST";

export type SessionBinaryRoutingDecision =
	| "active-cordon"
	| "explicit-pin"
	| "newest-installed"
	| "missing-pin-fallback-newest"
	| "current-build-fallback";

// Type alias (not interface) so receipts stay assignable to Record<string, unknown>
// journal payload parameters without casts.
export type SessionBinaryRoutingReceipt = {
	readonly version: 1;
	readonly decision: SessionBinaryRoutingDecision;
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly currentDigest: string;
	readonly selectedDigest: string;
	readonly selectedExecutable: string;
	readonly requestedDigest?: string;
	readonly fallbackReason?: string;
	readonly cordon?: {
		readonly rolloutId: string;
		readonly ownerEpoch: string;
		readonly expectedDigest: string;
	};
	readonly observedRollout?: {
		readonly rolloutId: string;
		readonly phase: RolloutPeerSnapshot["phase"];
		readonly targetDigest: string;
		readonly usedForRouting: false;
	};
	readonly recordedAt: string;
};

export interface SessionBinaryRoute {
	readonly executable: string;
	readonly receipt: SessionBinaryRoutingReceipt;
}

export interface ResolveSessionBinaryRouteOptions {
	readonly sessionId: string;
	readonly sessionFile: string;
	readonly currentExecutable: string;
	readonly currentDigest: string;
	readonly controlDbPath?: string;
	readonly release?: ReleaseRegistryValidationOptions;
	readonly now?: () => string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExplicitPin(content: string): string | undefined {
	const projection = projectJournalEntries(decodeJournalEntries(content));
	if (!projection) return undefined;
	let digest: string | undefined;
	for (const entry of projection.entries) {
		if (entry.type !== "custom" || !isRecord(entry.data)) continue;
		if (entry.customType === "fleet_pin") {
			if (entry.data.action === "unpin") {
				digest = undefined;
				continue;
			}
			if (entry.data.action !== "pin") continue;
			const candidate = entry.data.digest;
			digest = typeof candidate === "string" && SHA256.test(candidate) ? candidate : undefined;
			continue;
		}
		// Compatibility with the pre-v2 per-session rollout projection.
		if (entry.customType === "fleet_channel") {
			const candidate = entry.data.digest ?? entry.data.pin;
			if (typeof candidate === "string" && SHA256.test(candidate)) digest = candidate;
		}
	}
	return digest;
}

async function readRoutingState(options: ResolveSessionBinaryRouteOptions): Promise<{
	readonly explicitPin?: string;
	readonly cordon?: SessionSpawnCordon;
	readonly rollout?: RolloutPeerSnapshot;
}> {
	let explicitPin: string | undefined;
	try {
		explicitPin = readExplicitPin(await fs.readFile(options.sessionFile, "utf8"));
	} catch {
		// Session loading owns missing/corrupt journal diagnostics. Routing remains fail-open.
	}

	const dbPath = options.controlDbPath ?? SESSION_CONTROL_DB_PATH;
	let cordon: SessionSpawnCordon | undefined;
	try {
		const control = new SessionControlBus(dbPath, { readonly: true });
		try {
			cordon = control.getCordon(options.sessionId);
		} finally {
			control.close();
		}
	} catch {
		// A missing pre-rollout database means no cordon exists.
	}

	let rollout: RolloutPeerSnapshot | undefined;
	try {
		const journal = new RolloutJournal(dbPath, { readonly: true });
		try {
			rollout = journal.latestForPeer({ sessionId: options.sessionId, sessionFile: options.sessionFile });
		} finally {
			journal.close();
		}
	} catch {
		// rollout_peers is an informational projection, never a routing prerequisite.
	}
	return { explicitPin, cordon, rollout };
}

/**
 * Select the build for a resumed session.
 *
 * Historical rollout_peers rows never pin a session. A live rollout_cordon is
 * temporary routing authority, then an explicit journal pin, then the globally
 * installed stable build. A missing explicit pin fails open to the installed
 * build and leaves a structured receipt for the resumed journal.
 */
export async function resolveSessionBinaryRoute(
	options: ResolveSessionBinaryRouteOptions,
): Promise<SessionBinaryRoute> {
	const state = await readRoutingState(options);
	const releasesDir = resolveReleaseValidationPaths(options.release).releasesDir;
	const recordedAt = (options.now ?? (() => new Date().toISOString()))();
	const rollout: SessionBinaryRoutingReceipt["observedRollout"] = state.rollout
		? {
				rolloutId: state.rollout.rolloutId,
				phase: state.rollout.phase,
				targetDigest: state.rollout.targetDigest,
				usedForRouting: false,
			}
		: undefined;

	if (state.cordon) {
		const executable = await resolveVerifiedReleaseExecutable(releasesDir, state.cordon.expectedDigest);
		return {
			executable,
			receipt: {
				version: 1,
				decision: "active-cordon",
				sessionId: options.sessionId,
				sessionFile: options.sessionFile,
				currentDigest: options.currentDigest,
				selectedDigest: state.cordon.expectedDigest,
				selectedExecutable: executable,
				requestedDigest: state.cordon.expectedDigest,
				cordon: {
					rolloutId: state.cordon.rolloutId,
					ownerEpoch: state.cordon.ownerEpoch,
					expectedDigest: state.cordon.expectedDigest,
				},
				...(rollout ? { observedRollout: rollout } : {}),
				recordedAt,
			},
		};
	}

	let newest: { readonly digest: string; readonly executable: string };
	let newestFailure: string | undefined;
	try {
		newest = await resolveNewestInstalledRelease(options.release);
	} catch (error) {
		newest = { digest: options.currentDigest, executable: options.currentExecutable };
		newestFailure = error instanceof Error ? error.message : String(error);
	}

	if (state.explicitPin) {
		try {
			const executable = await resolveVerifiedReleaseExecutable(releasesDir, state.explicitPin);
			return {
				executable,
				receipt: {
					version: 1,
					decision: "explicit-pin",
					sessionId: options.sessionId,
					sessionFile: options.sessionFile,
					currentDigest: options.currentDigest,
					selectedDigest: state.explicitPin,
					selectedExecutable: executable,
					requestedDigest: state.explicitPin,
					...(rollout ? { observedRollout: rollout } : {}),
					recordedAt,
				},
			};
		} catch (error) {
			const pinCause = error instanceof Error ? error.message : String(error);
			const pinFailure = `Pinned build ${state.explicitPin} unavailable or unsafe: ${pinCause}`;
			return {
				executable: newest.executable,
				receipt: {
					version: 1,
					decision: "missing-pin-fallback-newest",
					sessionId: options.sessionId,
					sessionFile: options.sessionFile,
					currentDigest: options.currentDigest,
					selectedDigest: newest.digest,
					selectedExecutable: newest.executable,
					requestedDigest: state.explicitPin,
					fallbackReason: newestFailure ? `${pinFailure}; newest lookup: ${newestFailure}` : pinFailure,
					...(rollout ? { observedRollout: rollout } : {}),
					recordedAt,
				},
			};
		}
	}

	return {
		executable: newest.executable,
		receipt: {
			version: 1,
			decision: newestFailure ? "current-build-fallback" : "newest-installed",
			sessionId: options.sessionId,
			sessionFile: options.sessionFile,
			currentDigest: options.currentDigest,
			selectedDigest: newest.digest,
			selectedExecutable: newest.executable,
			...(newestFailure ? { fallbackReason: newestFailure } : {}),
			...(rollout ? { observedRollout: rollout } : {}),
			recordedAt,
		},
	};
}
