import { Container, type SelectItem, SelectList, Spacer, Text } from "@oh-my-pi/pi-tui";
import { getSelectListTheme, theme } from "../theme/theme";
import type { DiagnosticEvent, FocusCmuxOwnerAction } from "../utils/error-inbox";
import { CMUX_OWNER_UNAVAILABLE_MESSAGE, type FocusCmuxOwnerResult } from "../utils/cmux-owner-navigation";
import { DynamicBorder } from "./dynamic-border";
export type DiagnosticActionHandler = (action: FocusCmuxOwnerAction) => Promise<FocusCmuxOwnerResult>;

export interface ErrorSelectorOptions {
	readonly onAction?: DiagnosticActionHandler;
	readonly onUpdate?: () => void;
}

function isOpenFleetIncident(err: DiagnosticEvent): boolean {
	return !err.resolved && err.source === "fleet" && err.category === "fleet-incident" && err.status === "open";
}

export function formatDiagnosticLabel(err: DiagnosticEvent): string {
	const time = new Date(err.lastTimestamp).toISOString();
	let label = `[${time}]`;
	if (err.source) label += ` ${err.source}:`;
	if (err.count > 1) label += ` (x${err.count})`;

	if (err.resolved) return `[resolved] ${label}`;
	const incidentPrefix = isOpenFleetIncident(err) ? "[incident open] " : "";
	return err.unread ? `[unread] ${incidentPrefix}${label}` : `${incidentPrefix}${label}`;
}

export function formatDiagnosticDetail(err: DiagnosticEvent | null, actionMessage?: string): string {
	if (!err) return "";
	let out = isOpenFleetIncident(err) ? `${theme.bold("[incident open]")}\n` : "";
	if (err.count > 1) {
		out +=
			theme.bold(`Occurrences: `) +
			`${err.count} (first: ${new Date(err.firstTimestamp).toISOString()}, last: ${new Date(err.lastTimestamp).toISOString()})\n`;
	} else {
		out += theme.bold(`Timestamp: `) + `${new Date(err.lastTimestamp).toISOString()}\n`;
	}

	const fields: Array<[string, string | number | boolean | undefined]> = [
		["ID", err.id],
		["Source", err.source],
		["Category", err.category],
		["Cause", err.cause],
		["Disposition", err.disposition],
		["Provider", err.provider],
		["Model", err.model],
		["Session", err.session],
		["Agent", err.agent],
		["Tool", err.tool],
		["Job", err.job],
		["Operation", err.operation],
		["Status", err.status],
		["Code", err.code],
		["Retry", err.retry],
		["Reset", err.reset !== undefined ? new Date(err.reset).toISOString() : undefined],
		["Fingerprint", err.requestFingerprint],
		["Build", err.buildVersion],
		["Build digest", err.buildDigest],
		["Log pointer", err.logPointer],
		["Unread", err.unread],
		["Resolved", err.resolved],
	];

	for (const [key, val] of fields) {
		if (val !== undefined && val !== null && val !== "") {
			out += theme.bold(`${key}: `) + String(val) + "\n";
		}
	}

	out += "\n" + theme.bold("Headline:\n") + err.message;
	if (err.detail) out += "\n\n" + theme.bold("Raw detail:\n") + err.detail;

	if (err.causeChain && err.causeChain.length > 0) {
		out += "\n\n" + theme.bold("Cause chain:\n");
		for (let i = 0; i < err.causeChain.length; i++) {
			out += `${i + 1}. ${err.causeChain[i]}\n`;
		}
	}
	if (actionMessage) {
		out += `\n\n${actionMessage}`;
	}

	if (err.action) {
		out += "\n" + theme.fg("dim", "Focus active cmux session: Enter   Close: Esc");
	} else if (!err.resolved) {
		out += "\n" + theme.fg("dim", `Resolve: :errors resolve ${err.id}   Close: Esc/Enter`);
	}

	return out.trimEnd();
}

export class ErrorSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(errors: ReadonlyArray<DiagnosticEvent>, onDismiss: () => void, options: ErrorSelectorOptions = {}) {
		super();

		const byId = new Map<string, DiagnosticEvent>(errors.map(e => [e.id, e]));

		const items: SelectItem[] = errors.map(err => {
			const label = formatDiagnosticLabel(err);
			return {
				value: err.id,
				label: label,
				description: err.message.replace(/\n/g, " "),
			};
		});

		if (items.length === 0) {
			items.push({ value: "none", label: "No recent errors" });
		}

		const selectedError = errors[0];
		let selectedId = errors[0]?.id;
		let nextActionGeneration = 0;
		const actionMessages = new Map<string, string>();
		const pendingActions = new Map<string, number>();
		const detailText = new Text(formatDiagnosticDetail(selectedError ?? null), 1, 0);

		this.#selectList = new SelectList(items, Math.min(items.length, 10), getSelectListTheme());
		this.#selectList.onSelect = item => {
			const selected = byId.get(item.value);
			if (selected?.action?.kind !== "focus_cmux_owner" || !options.onAction) {
				onDismiss();
				return;
			}
			if (pendingActions.has(selected.id)) return;
			const generation = ++nextActionGeneration;
			pendingActions.set(selected.id, generation);
			void options.onAction(selected.action).then(
				result => {
					if (pendingActions.get(selected.id) !== generation) return;
					pendingActions.delete(selected.id);
					if (result.kind === "focused") {
						if (selectedId === selected.id) onDismiss();
						return;
					}
					const actionMessage =
						result.kind === "unavailable"
							? CMUX_OWNER_UNAVAILABLE_MESSAGE
							: `Could not focus the active cmux session: ${result.reason}. This view remains read-only.`;
					actionMessages.set(selected.id, actionMessage);
					if (selectedId !== selected.id) return;
					detailText.setText(formatDiagnosticDetail(selected, actionMessage));
					options.onUpdate?.();
				},
				error => {
					if (pendingActions.get(selected.id) !== generation) return;
					pendingActions.delete(selected.id);
					const reason = error instanceof Error ? error.message : String(error);
					const actionMessage = `Could not focus the active cmux session: ${reason}. This view remains read-only.`;
					actionMessages.set(selected.id, actionMessage);
					if (selectedId !== selected.id) return;
					detailText.setText(formatDiagnosticDetail(selected, actionMessage));
					options.onUpdate?.();
				},
			);
		};
		this.#selectList.onCancel = () => onDismiss();
		this.#selectList.onSelectionChange = item => {
			if (item.value === "none") return;
			selectedId = item.value;
			const found = byId.get(item.value);
			if (found) {
				detailText.setText(formatDiagnosticDetail(found, actionMessages.get(found.id)));
			}
		};

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(new Text(theme.bold("Error History") + theme.fg("dim", "  p pin/unpin · Ctrl-W w focus · Esc close"), 1, 0));
		this.addChild(this.#selectList);
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(detailText);
		this.addChild(new Spacer(1));
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
