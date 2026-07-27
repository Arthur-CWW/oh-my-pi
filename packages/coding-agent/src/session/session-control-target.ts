import * as path from "node:path";
import { verifyExecutableDigest } from "../cli/restart-session";
import { appendErrorInboxEvent, type ErrorInboxWriter } from "./error-inbox-ledger";
import { decodeRolloutCheckpoint, type RolloutCheckpoint, type RolloutPauseProvenance } from "./rollout-checkpoint";
import {
	type FleetPinControlCommand,
	formatSessionControlFailure,
	isPolicyApplyControlCommand,
	type PolicyApplyCommandV1,
	type PolicyApplyControlCommand,
	type PrepareRolloutCommand,
	type PrepareRolloutIntent,
	SessionControlBus,
	type SessionControlCommand,
	type SessionControlResult,
	stopConfirmationToken,
	toPolicyApplyCommandV1,
} from "./session-control";
import { SessionStateCommandInFlightError } from "./session-manager";
import type { SessionOwnershipHandle } from "./session-ownership";

export interface SessionControlTargetActions {
	readonly policyApply?: (
		command: PolicyApplyCommandV1,
		controlCommand: PolicyApplyControlCommand,
	) => SessionControlResult | Promise<SessionControlResult>;
	readonly status: (command: SessionControlCommand) => SessionControlResult | Promise<SessionControlResult>;
	readonly pause: (command: SessionControlCommand) => void | Promise<void>;
	readonly resume: (command: SessionControlCommand) => void | Promise<void>;
	readonly fleetPinControl?: (command: FleetPinControlCommand) => SessionControlResult | Promise<SessionControlResult>;
	readonly prepareRollout?: (
		intent: PrepareRolloutIntent,
		pauseProvenance: RolloutPauseProvenance,
		command: PrepareRolloutCommand,
	) => RolloutCheckpoint | Promise<RolloutCheckpoint>;
	readonly restart: (command: SessionControlCommand, commit: () => void) => void | Promise<void>;
	readonly setModel: (
		selector: string,
		command: SessionControlCommand,
	) => SessionControlResult | Promise<SessionControlResult>;
	readonly compact: (
		instructions: string | undefined,
		command: SessionControlCommand,
	) => SessionControlResult | Promise<SessionControlResult>;
	readonly stop: (command: SessionControlCommand) => void | Promise<void>;
}

export interface SessionControlDiagnosticJournal extends ErrorInboxWriter {
	readonly flush?: () => Promise<void>;
}

export interface SessionControlTargetOptions {
	readonly ownership: SessionOwnershipHandle;
	readonly actions: SessionControlTargetActions;
	readonly bus?: SessionControlBus;
	readonly diagnosticJournal?: SessionControlDiagnosticJournal;
	readonly pollIntervalMs?: number;
}

export interface SessionControlTarget {
	readonly done: Promise<void>;
	stop(): Promise<void>;
}

async function assertCurrentOwner(ownership: SessionOwnershipHandle): Promise<void> {
	if (ownership.isFenced?.() || !(await ownership.isCurrent())) {
		throw new Error(`Session ownership epoch ${ownership.ownerEpoch} is no longer current`);
	}
}

function actionResult(command: SessionControlCommand, detail: SessionControlResult = {}): SessionControlResult {
	return { kind: command.intent.kind, ...((detail ?? {}) as object) };
}

function rolloutPauseCommand(command: PrepareRolloutCommand): SessionControlCommand {
	return { ...command, schemaVersion: 1, intent: { kind: "pause" } };
}

async function recordControlFailure(
	journal: SessionControlDiagnosticJournal | undefined,
	ownership: SessionOwnershipHandle,
	command: SessionControlCommand,
	failure: string,
): Promise<void> {
	if (!journal) return;
	try {
		const timestamp = Date.now();
		const separator = failure.indexOf(":");
		const persisted = appendErrorInboxEvent(journal, {
			id: `session-control:${command.commandId}`,
			firstTimestamp: timestamp,
			lastTimestamp: timestamp,
			message: failure,
			count: 1,
			source: "session-control-target",
			category: "session-control",
			errorClass: separator > 0 ? failure.slice(0, separator) : "ControlFailure",
			session: ownership.sessionId,
			operation: command.intent.kind,
			...(command.intent.kind === "prepare-rollout" ? { fleetRolloutId: command.intent.rolloutId } : {}),
			unread: true,
			resolved: false,
		});
		if (persisted) await journal.flush?.();
	} catch {
		// A diagnostic journal can share the session-state persistence gate that
		// rejected the action. Receipt completion must never recurse through it.
	}
}

/** Detect transient busy errors that should produce a typed receipt, never an unhandled rejection. */
export function isSessionBusyError(error: unknown): boolean {
	if (error instanceof SessionStateCommandInFlightError) return true;
	if (error instanceof Error && error.name === "SessionStateCommandInFlightError") return true;
	return false;
}

/**
 * Start one epoch-fenced, serialized consumer for a live session authority.
 * The SQLite receipt is terminal before restart/stop handoff can end the process.
 */
export async function startSessionControlTarget(options: SessionControlTargetOptions): Promise<SessionControlTarget> {
	const { ownership, actions } = options;
	const bus = options.bus ?? new SessionControlBus();
	const ownsBus = options.bus === undefined;
	const pollIntervalMs = options.pollIntervalMs ?? 25;
	let stopping = false;
	let terminalAction = false;

	await assertCurrentOwner(ownership);
	bus.bindTarget(ownership.sessionId, ownership.ownerEpoch);
	if (bus.getPaused(ownership.sessionId)) {
		await actions.pause({
			schemaVersion: 1,
			commandId: "00000000-0000-4000-8000-000000000000",
			source: { kind: "local-cli", instanceId: "00000000-0000-4000-8000-000000000000", pid: 1 },
			sessionId: ownership.sessionId,
			targetOwnerEpoch: ownership.ownerEpoch,
			requestedAt: new Date(0).toISOString(),
			intent: { kind: "pause" },
		});
	}

	const apply = async (command: SessionControlCommand): Promise<void> => {
		try {
			await assertCurrentOwner(ownership);
			switch (command.intent.kind) {
				case "status": {
					const status = await actions.status(command);
					bus.complete(command.commandId, ownership.ownerEpoch, {
						kind: "status",
						sessionId: ownership.sessionId,
						ownerEpoch: ownership.ownerEpoch,
						paused: bus.getPaused(ownership.sessionId),
						stopConfirmationToken: stopConfirmationToken(ownership.sessionId, ownership.ownerEpoch),
						...((status ?? {}) as object),
					});
					return;
				}
				case "policy-apply": {
					if (!actions.policyApply || !isPolicyApplyControlCommand(command))
						throw new Error("Target does not support policy-apply");
					const policyCommand = toPolicyApplyCommandV1(command);
					const result = await actions.policyApply(policyCommand, command);
					await assertCurrentOwner(ownership);
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command, result));
					return;
				}
				case "pause":
					await actions.pause(command);
					await assertCurrentOwner(ownership);
					bus.setPaused(ownership.sessionId, ownership.ownerEpoch, true);
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command, { paused: true }));
					return;
				case "resume":
					await actions.resume(command);
					await assertCurrentOwner(ownership);
					bus.setPaused(ownership.sessionId, ownership.ownerEpoch, false);
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command, { paused: false }));
					return;
				case "fleet-pin":
				case "fleet-unpin": {
					const result = await (actions.fleetPinControl ?? actions.status)(command as FleetPinControlCommand);
					await assertCurrentOwner(ownership);
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command, result));
					return;
				}
				case "prepare-rollout": {
					if (!actions.prepareRollout) throw new Error("Target does not support prepare-rollout");
					if (ownership.buildRevision.digest !== command.intent.expectedDigest) {
						throw new Error(
							`Expected runner digest ${command.intent.expectedDigest}, found ${ownership.buildRevision.digest}`,
						);
					}
					const pauseProvenance: RolloutPauseProvenance = bus.getPaused(ownership.sessionId)
						? "manual"
						: "rollout";
					let cordon = bus.cordon(
						ownership.sessionId,
						ownership.ownerEpoch,
						command.intent.rolloutId,
						command.intent.expectedDigest,
						pauseProvenance,
					);
					if (pauseProvenance === "rollout") {
						await actions.pause(rolloutPauseCommand(command as PrepareRolloutCommand));
						await assertCurrentOwner(ownership);
						bus.setPaused(ownership.sessionId, ownership.ownerEpoch, true);
					}
					const checkpoint = await actions.prepareRollout(
						command.intent,
						pauseProvenance,
						command as PrepareRolloutCommand,
					);
					await assertCurrentOwner(ownership);
					cordon = bus.recordCordonCheckpoint({
						sessionId: ownership.sessionId,
						expectedOwnerEpoch: ownership.ownerEpoch,
						fleetRolloutId: command.intent.rolloutId,
						checkpointId: checkpoint.checkpointId,
					});
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command, { cordon, checkpoint }));
					return;
				}
				case "setModel": {
					const result = await actions.setModel(command.intent.selector, command);
					await assertCurrentOwner(ownership);
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command, result));
					return;
				}
				case "compact": {
					const result = await actions.compact(command.intent.instructions, command);
					await assertCurrentOwner(ownership);
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command, result));
					return;
				}
				case "restart": {
					if (command.schemaVersion === 2) {
						const cordon = bus.getCordon(ownership.sessionId);
						if (
							!cordon ||
							cordon.ownerEpoch !== ownership.ownerEpoch ||
							cordon.rolloutId !== command.intent.rolloutId
						) {
							throw new Error("Rollout restart requires the matching active cordon");
						}
						const receipt = bus.getReceipt(command.intent.checkpointCommandId);
						const result = receipt?.result as { checkpoint?: unknown } | undefined;
						const checkpoint = decodeRolloutCheckpoint(result?.checkpoint);
						if (
							receipt?.state !== "applied" ||
							checkpoint.outcome !== "Checkpointed" ||
							checkpoint.commandId !== command.intent.checkpointCommandId ||
							checkpoint.rolloutId !== command.intent.rolloutId ||
							checkpoint.ownerEpoch !== ownership.ownerEpoch ||
							checkpoint.expectedDigest !== ownership.buildRevision.digest ||
							checkpoint.journalCheckpoint.sessionId !== ownership.sessionId ||
							path.resolve(checkpoint.journalCheckpoint.sessionFile) !== path.resolve(ownership.sessionFile) ||
							cordon.expectedDigest !== checkpoint.expectedDigest
						) {
							throw new Error("Rollout restart requires a matching successful checkpoint receipt");
						}
						await verifyExecutableDigest(command.intent.executable, command.intent.targetDigest);
						await assertCurrentOwner(ownership);
					}
					terminalAction = true;
					let committed = false;
					await actions.restart(command, () => {
						bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command));
						committed = true;
					});
					if (!committed) throw new Error("Restart action returned without replacing the process");
					return;
				}
				case "stop": {
					const expected = stopConfirmationToken(ownership.sessionId, ownership.ownerEpoch);
					if (command.intent.confirmationToken !== expected) throw new Error("Invalid stop confirmation token");
					terminalAction = true;
					await actions.stop(command);
					bus.complete(command.commandId, ownership.ownerEpoch, actionResult(command));
					return;
				}
			}
		} catch (error) {
			const failure = formatSessionControlFailure(error);
			if (isSessionBusyError(error)) {
				bus.fail(command.commandId, ownership.ownerEpoch, failure, "session_state_command_in_flight");
				await recordControlFailure(options.diagnosticJournal, ownership, command, failure);
				return;
			}
			if (terminalAction) {
				const receipt = bus.getReceipt(command.commandId);
				if (receipt?.state !== "applied") bus.fail(command.commandId, ownership.ownerEpoch, failure);
				await recordControlFailure(options.diagnosticJournal, ownership, command, failure);
				throw error;
			}
			bus.fail(command.commandId, ownership.ownerEpoch, failure);
			await recordControlFailure(options.diagnosticJournal, ownership, command, failure);
		}
	};

	const done = (async () => {
		try {
			while (!stopping && !terminalAction) {
				if (ownership.isFenced?.() || !(await ownership.isCurrent())) break;
				const command = bus.claimNext(ownership.sessionId, ownership.ownerEpoch);
				if (command) await apply(command);
				else await Bun.sleep(pollIntervalMs);
			}
		} finally {
			bus.releaseTarget(ownership.sessionId, ownership.ownerEpoch);
			if (ownsBus) bus.close();
		}
	})();

	return {
		done,
		stop: async () => {
			stopping = true;
			await done;
		},
	};
}
