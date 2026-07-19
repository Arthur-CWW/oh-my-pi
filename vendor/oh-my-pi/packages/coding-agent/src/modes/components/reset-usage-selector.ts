export {
	makeResetUsageAccountId,
	makeResetUsageSelectorAdapter,
	makeResetSpendDeduplication,
	makeSpendResetInterpreter,
	resetUsageAccountsFromStatus,
	resetUsageSelectorOutput,
	replaceResetUsageAccounts,
	resetSpendOutputToSelectorMsg,
	RESET_USAGE_ACTION,
} from "../mvu/reset-usage-adapter";
export type {
	ResetUsageAction,
	ResetSpendCommand,
	ResetSpendFailure,
	ResetSpendOutput,
	ResetSpendReceipt,
	ResetSpendDeduplication,
	ResetUsageAccountId,
	ResetUsageAccountRow,
	ResetUsageSelectorAdapter,
} from "../mvu/reset-usage-adapter";

import { Container, Spacer, Text } from "@oh-my-pi/pi-tui";
import type { ResetUsageAccountId, ResetUsageSelectorAdapter } from "../mvu/reset-usage-adapter";
import type { SelectorModel } from "../mvu/selector";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";

/** Renderer-only reset-credit picker. Arming and nonce-deduplicated spending live in the route runtime. */
export class ResetUsageSelectorComponent extends Container {
	readonly #adapter: ResetUsageSelectorAdapter;

	constructor(adapter: ResetUsageSelectorAdapter) {
		super();
		this.#adapter = adapter;
		this.apply(adapter.initialModel);
	}

	apply(model: SelectorModel<ResetUsageAccountId>): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Spend a saved rate-limit reset:"), 0, 0));
		this.addChild(new Spacer(1));
		for (const id of model.filteredIds) {
			const row = this.#adapter.rows.get(id);
			if (!row) continue;
			const selected = id === model.selectedId;
			const armed = model.mode._tag === "Confirm" && model.mode.arm.targetId === id;
			const suffix = armed ? theme.fg("warning", "  Press Enter again to spend 1 reset") : "";
			this.addChild(new Text(`${selected ? theme.fg("accent", `${theme.nav.cursor} ${row.label}`) : `  ${row.label}`}${suffix}`, 0, 0));
		}
		if (model.filteredIds.length === 0) this.addChild(new Text(theme.fg("muted", "  No saved resets"), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(`${keyHint("tui.select.confirm", "select/confirm")} · ${keyHint("ui.dismiss", "back")}`, 0, 0));
		this.addChild(new DynamicBorder());
		this.invalidate();
	}
}
