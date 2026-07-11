import { Container, type SelectItem, SelectList, Spacer, Text } from "@oh-my-pi/pi-tui";
import { getSelectListTheme, theme } from "../theme/theme";
import type { DiagnosticEvent } from "../utils/error-inbox";
import { DynamicBorder } from "./dynamic-border";

export function formatDiagnosticDetail(err: DiagnosticEvent | null): string {
	if (!err) return "";
	let out = "";
	if (err.count > 1) {
		out += theme.bold(`Occurrences: `) + `${err.count} (first: ${new Date(err.firstTimestamp).toISOString()}, last: ${new Date(err.lastTimestamp).toISOString()})\n`;
	} else {
		out += theme.bold(`Timestamp: `) + `${new Date(err.lastTimestamp).toISOString()}\n`;
	}

	const fields: Array<[string, string | number | boolean | undefined]> = [
		["ID", err.id],
		["Source", err.source],
		["Category", err.category],
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
		["Log pointer", err.logPointer],
		["Unread", err.unread],
		["Resolved", err.resolved],
	];

	for (const [key, val] of fields) {
		if (val !== undefined && val !== null && val !== "") {
			out += theme.bold(`${key}: `) + String(val) + "\n";
		}
	}

	out += "\n" + theme.bold("Message:\n") + err.message;

	if (err.causeChain && err.causeChain.length > 0) {
		out += "\n\n" + theme.bold("Cause chain:\n");
		for (let i = 0; i < err.causeChain.length; i++) {
			out += `${i + 1}. ${err.causeChain[i]}\n`;
		}
	}

	if (!err.resolved) {
		out += "\n" + theme.fg("dim", `Resolve: /errors resolve ${err.id}   Close: Esc/Enter`);
	}

	return out.trimEnd();
}

export class ErrorSelectorComponent extends Container {
	#selectList: SelectList;

	constructor(errors: ReadonlyArray<DiagnosticEvent>, onDismiss: () => void) {
		super();

		const byId = new Map<string, DiagnosticEvent>(errors.map(e => [e.id, e]));

		const items: SelectItem[] = errors.map(err => {
			const time = new Date(err.lastTimestamp).toISOString();
			let label = `[${time}]`;
			if (err.source) label += ` ${err.source}:`;
			if (err.count > 1) label += ` (x${err.count})`;
			if (err.resolved) label = `[resolved] ${label}`;
			else if (err.unread) label = `[unread] ${label}`;
			return {
				value: err.id,
				label: label,
				description: err.message.replace(/\n/g, " "),
			};
		});

		if (items.length === 0) {
			items.push({ value: "none", label: "No recent errors" });
		}

		const detailText = new Text(formatDiagnosticDetail(errors.length > 0 ? errors[0] : null), 1, 0);

		this.#selectList = new SelectList(items, Math.min(items.length, 10), getSelectListTheme());
		this.#selectList.onSelect = () => onDismiss();
		this.#selectList.onCancel = () => onDismiss();
		this.#selectList.onSelectionChange = (item) => {
			if (item.value === "none") return;
			const found = byId.get(item.value);
			if (found) detailText.setText(formatDiagnosticDetail(found));
		};

		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(new Text(theme.bold("Error History"), 1, 0));
		this.addChild(this.#selectList);
		this.addChild(new DynamicBorder(str => theme.fg("dim", str)));
		this.addChild(detailText);
		this.addChild(new Spacer(1));
	}

	getSelectList(): SelectList {
		return this.#selectList;
	}
}
