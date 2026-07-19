import {
	type Component,
	padding,
	truncateToWidth,
	visibleWidth,
} from "@oh-my-pi/pi-tui";
import { isProviderEnabled } from "../../../discovery";
import { theme } from "../../../modes/theme/theme";
import type { Extension, ExtensionKind, ExtensionState } from "./types";

export type ExtensionListRow =
	| { readonly _tag: "Master"; readonly key: string; readonly providerId: string; readonly providerName: string; readonly enabled: boolean }
	| { readonly _tag: "Kind"; readonly key: string; readonly kind: ExtensionKind; readonly label: string; readonly icon: string; readonly count: number }
	| { readonly _tag: "Extension"; readonly key: string; readonly extension: Extension };

export interface ExtensionListProjection {
	readonly query: string;
	readonly rows: readonly ExtensionListRow[];
	readonly totalRows: number;
	readonly selectedKey?: string;
	readonly focused: boolean;
	readonly masterProvider?: string;
}

function stateIcon(state: ExtensionState, masterDisabled: boolean): string {
	if (masterDisabled) return theme.fg("dim", theme.status.disabled);
	switch (state) {
		case "active": return theme.fg("success", theme.status.enabled);
		case "disabled": return theme.fg("dim", theme.status.disabled);
		case "shadowed": return theme.fg("warning", theme.status.shadowed);
	}
}

function padText(text: string, targetWidth: number): string {
	const width = visibleWidth(text);
	if (width >= targetWidth) return truncateToWidth(text, targetWidth);
	return text + padding(targetWidth - width);
}

function renderExtension(ext: Extension, selected: boolean, width: number, masterProvider?: string): string {
	const masterDisabled = masterProvider !== undefined && !isProviderEnabled(masterProvider);
	const effectivelyDisabled = masterDisabled || ext.state === "disabled";
	const icon = stateIcon(ext.state, masterDisabled);
	const nameWidth = Math.min(24, Math.max(1, width - 16));
	let name = ext.displayName;
	if (selected && !masterDisabled) name = theme.bold(theme.fg("accent", name));
	else if (effectivelyDisabled) name = theme.fg("dim", name);
	else if (ext.state === "shadowed") name = theme.fg("warning", name);
	let line = `   ${icon} ${padText(name, nameWidth)}`;
	if (ext.trigger) {
		const remaining = width - visibleWidth(line) - 2;
		if (remaining > 5) line += `  ${truncateToWidth(theme.fg(effectivelyDisabled ? "dim" : "muted", ext.trigger), remaining)}`;
	}
	if (selected) line = theme.bg("selectedBg", line);
	return truncateToWidth(line, width);
}

/** Pure row renderer consumed by the renderer-only TablePreview adapter. */
export function renderExtensionListRow(
	row: ExtensionListRow,
	selected: boolean,
	width: number,
	masterProvider?: string,
): string {
	switch (row._tag) {
		case "Master": {
			const checkbox = row.enabled ? theme.fg("success", theme.checkbox.checked) : theme.fg("dim", theme.checkbox.unchecked);
			let line = `${checkbox} ${theme.icon.package} Enable ${row.providerName}  ${theme.fg("warning", "(Master Switch)")}`;
			if (selected) line = theme.bg("selectedBg", theme.bold(theme.fg("accent", line)));
			else if (!row.enabled) line = theme.fg("dim", line);
			return truncateToWidth(line, width);
		}
		case "Kind": {
			let line = `${row.icon} ${row.label} ${theme.fg("muted", `(${row.count})`)}`;
			line = selected ? theme.bg("selectedBg", theme.bold(theme.fg("accent", line))) : theme.fg("muted", line);
			return truncateToWidth(line, width);
		}
		case "Extension":
			return renderExtension(row.extension, selected, width, masterProvider);
	}
}

/** Renderer-only extension inventory. Selection, search, and actions live in the route model. */
export class ExtensionList implements Component {
	#projection: ExtensionListProjection = { query: "", rows: [], totalRows: 0, focused: false };

	constructor(readonly requestComponentRender: (component: Component) => void) {}

	apply(projection: ExtensionListProjection): void {
		if (this.#projection === projection) return;
		this.#projection = projection;
		this.requestComponentRender(this);
	}

	invalidate(): void {}

	render(width: number): readonly string[] {
		const lines: string[] = [];
		const searchText = this.#projection.query || (this.#projection.focused ? "" : theme.fg("dim", "type to filter"));
		lines.push(`${theme.fg("muted", "Search: ")}${searchText}`);
		lines.push("");
		if (this.#projection.totalRows === 0) {
			lines.push(theme.fg("muted", "  No extensions found for this provider."));
			return lines;
		}
		const overflow = this.#projection.totalRows > this.#projection.rows.length;
		const rowWidth = Math.max(0, width - (overflow ? 1 : 0));
		for (const row of this.#projection.rows) {
			const selected = row.key === this.#projection.selectedKey;
			lines.push(renderExtensionListRow(row, selected, rowWidth, this.#projection.masterProvider));
		}
		if (overflow) {
			lines.push(theme.fg("muted", `… ${this.#projection.totalRows - this.#projection.rows.length} more`));
		}
		return lines;
	}

}
