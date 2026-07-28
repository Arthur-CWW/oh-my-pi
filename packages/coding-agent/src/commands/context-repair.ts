import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import {
	appendContextRepairLedgerEvent,
	contextRepairOverlayStates,
	makeContextRepairControlEvent,
	readContextRepairLedger,
} from "../session/context-repair";

const ACTIONS = ["review", "disable", "enable", "revert"] as const;

export default Command.make(
	"context-repair",
	{
		action: Argument.choice("action", ACTIONS).pipe(Argument.withDescription("Review or control a context overlay")),
		overlayId: Argument.optional(
			Argument.string("overlay-id").pipe(
				Argument.withDescription("Overlay ID (required for disable, enable, or revert)"),
			),
		),
		ledger: Flag.string("ledger").pipe(Flag.withDescription("Append-only context repair ledger path")),
		reason: Flag.optional(Flag.string("reason").pipe(Flag.withDescription("Reason for the control event"))),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output JSON"), Flag.withDefault(false)),
	},
	config =>
		Effect.promise(async () => {
			const events = await readContextRepairLedger(config.ledger);
			const states = contextRepairOverlayStates(events);
			if (config.action === "review") {
				const requestedOverlayId = Option.getOrUndefined(config.overlayId);
				const selected = requestedOverlayId
					? states.filter(state => state.overlay.id === requestedOverlayId)
					: states;
				if (requestedOverlayId && selected.length === 0) {
					throw new Error(`context-repair: unknown overlay ${requestedOverlayId}`);
				}
				if (config.json) {
					process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
					return;
				}
				const lines = ["OVERLAY\tCHECKPOINT\tSTATE\tCONFIDENCE\tPLANNER"];
				for (const state of selected) {
					const status = state.reverted ? "reverted" : state.enabled ? "enabled" : "disabled";
					lines.push(
						`${state.overlay.id}\t${state.overlay.refusalCheckpointId}\t${status}\t${state.overlay.confidence}\t${state.overlay.plannerModel}`,
					);
				}
				process.stdout.write(`${lines.join("\n")}\n`);
				return;
			}

			if (Option.isNone(config.overlayId)) {
				throw new Error(`context-repair: ${config.action} requires an overlay ID`);
			}
			const overlayId = config.overlayId.value;
			const state = states.find(candidate => candidate.overlay.id === overlayId);
			if (!state) throw new Error(`context-repair: unknown overlay ${overlayId}`);
			if (state.reverted) throw new Error(`context-repair: overlay ${overlayId} is permanently reverted`);
			if (config.action === "enable" && state.enabled) throw new Error(`context-repair: overlay ${overlayId} is already enabled`);
			if (config.action === "disable" && !state.enabled) throw new Error(`context-repair: overlay ${overlayId} is already disabled`);
			const reason = Option.getOrUndefined(config.reason)?.trim();
			if (!reason) throw new Error(`context-repair: ${config.action} requires --reason`);
			const control = makeContextRepairControlEvent({ overlayId, action: config.action, reason });
			await appendContextRepairLedgerEvent(config.ledger, control);
			process.stdout.write(config.json ? `${JSON.stringify(control, null, 2)}\n` : `${control.action}\t${overlayId}\n`);
		}),
).pipe(
	Command.withDescription("Review, disable, enable, or revert context-repair overlays without rewriting transcripts"),
	Command.withExamples([
		{ command: "omp context-repair review --ledger ./session.context-repair.jsonl" },
		{ command: "omp context-repair disable <overlay-id> --ledger ./session.context-repair.jsonl --reason 'review'" },
		{ command: "omp context-repair revert <overlay-id> --ledger ./session.context-repair.jsonl --reason 'unsafe'" },
	]),
);
