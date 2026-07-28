/**
 * The single place that turns configuration into the host resource authority.
 *
 * Both entry points that can be *first* to need admission — a task spawn and a
 * revival-first lifecycle revive — resolve the authority here, so neither can
 * install a differently-budgeted singleton depending on which one ran first.
 */

import { settings as globalSettings, isSettingsInitialized, type Settings } from "../config/settings";
import { IrcExternalBus } from "../irc/bus-external";
import {
	HostAdmissionRejectedError,
	type HostMemoryPressureDoorbell,
	HostResourceAdmission,
} from "./host-resource-admission";
import type { HostResourceProbe } from "./host-resource-profile";
import { type ProcessIdentity, readProcessIdentity } from "./process-identity";

/** Only the global layer is read: host budgets are host-wide, never per-project. */
export type AdmissionSettingsSource = Pick<Settings, "getGlobal">;

function appendUniqueProcessIdentity(
	identities: ProcessIdentity[],
	candidate: ProcessIdentity | null | undefined,
): void {
	if (!candidate) return;
	for (const identity of identities) {
		if (
			identity.bootId === candidate.bootId &&
			identity.pid === candidate.pid &&
			identity.startFingerprint === candidate.startFingerprint
		) {
			return;
		}
	}
	identities.push(candidate);
}

/**
 * Every process that can own subagent trees on this host: this coordinator plus
 * each live external-bus peer. Deduplicated by full identity so a peer listed
 * under two rows cannot have its forest counted twice.
 *
 * The bus is a parameter because the process-wide one lives at a fixed path
 * under the real home directory: a test that has to publish peers writes into
 * the live fleet directory otherwise, and `os.homedir()` under Bun ignores a
 * reassigned `HOME`, so redirecting the environment cannot contain it.
 */
export function coordinatorRootIdentities(bus: IrcExternalBus = IrcExternalBus.global()): readonly ProcessIdentity[] {
	const unique: ProcessIdentity[] = [];
	appendUniqueProcessIdentity(unique, readProcessIdentity(process.pid));
	for (const peer of bus.listPeers()) {
		appendUniqueProcessIdentity(unique, peer.processIdentity ?? readProcessIdentity(peer.pid));
	}
	return unique;
}

/**
 * Resolve the process-wide host authority from configured budgets.
 *
 * When no settings source is available the authority is *not* created from
 * defaults: an already-configured authority is reused as-is (its budgets and
 * coordinator-roots callback stay untouched), and otherwise admission is
 * refused. A default-budget singleton installed by whichever path happened to
 * run first would silently outrank every `task.globalAdmission.*` setting for
 * the remaining life of the process.
 */
export function resolveGlobalHostResourceAdmission(options: {
	readonly onPressure: (doorbell: HostMemoryPressureDoorbell) => void | Promise<void>;
	readonly settings?: AdmissionSettingsSource;
	/**
	 * Host capacity to derive the profile from. Left unset in production so the
	 * live host is probed; supplied when the caller must be deterministic about
	 * capacity rather than inherit whatever cgroup it happens to run inside.
	 */
	readonly hostResourceProbe?: HostResourceProbe;
}): HostResourceAdmission {
	const source = options.settings ?? (isSettingsInitialized() ? globalSettings : undefined);
	if (!source) {
		if (!HostResourceAdmission.hasGlobal()) {
			throw new HostAdmissionRejectedError(
				"authority-unavailable",
				"Host resource admission requires initialized settings before the authority exists",
			);
		}
		return HostResourceAdmission.global({
			onPressure: options.onPressure,
			hostResourceProbe: options.hostResourceProbe,
		});
	}
	return HostResourceAdmission.global({
		memoryBudgetBytes: source.getGlobal("task.globalAdmission.memoryBudgetBytes"),
		userCap: source.getGlobal("task.globalAdmission.maxConcurrency"),
		childReservationBytes: source.getGlobal("task.globalAdmission.attemptReservationBytes"),
		coordinatorRoots: coordinatorRootIdentities,
		onPressure: options.onPressure,
		hostResourceProbe: options.hostResourceProbe,
	});
}
