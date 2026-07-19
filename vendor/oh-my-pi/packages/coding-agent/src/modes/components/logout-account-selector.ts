export {
	logoutAccountSelectorOutput,
	makeLogoutAccountId,
	makeLogoutAccountSelectorAdapter,
	replaceLogoutAccounts,
} from "../mvu/logout-account-adapter";
export type {
	LogoutAccountAction,
	LogoutAccountId,
	LogoutAccountRow,
	LogoutAccountSelectorAdapter,
	LogoutAccountSelectorClosed,
	LogoutAccountSelectorOutput,
	LogoutAccountSelected,
} from "../mvu/logout-account-adapter";

import { Container, Spacer, Text } from "@oh-my-pi/pi-tui";
import type { LogoutAccountId, LogoutAccountSelectorAdapter } from "../mvu/logout-account-adapter";
import type { SelectorModel } from "../mvu/selector";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";

/** Renderer-only account picker; the route runtime is the sole selection authority. */
export class LogoutAccountSelectorComponent extends Container {
	readonly #providerName: string;
	readonly #adapter: LogoutAccountSelectorAdapter;

	constructor(providerName: string, adapter: LogoutAccountSelectorAdapter) {
		super();
		this.#providerName = providerName;
		this.#adapter = adapter;
		this.apply(adapter.initialModel);
	}

	apply(model: SelectorModel<LogoutAccountId>): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(`Select ${this.#providerName} account to log out:`), 0, 0));
		this.addChild(new Spacer(1));
		for (const id of model.filteredIds) {
			const row = this.#adapter.rows.get(id);
			if (!row) continue;
			const selected = id === model.selectedId;
			const active = row.account.active ? theme.fg("success", " (active)") : "";
			this.addChild(new Text(`${selected ? theme.fg("accent", `${theme.nav.cursor} ${row.label}`) : `  ${row.label}`}${active}`, 0, 0));
		}
		if (model.filteredIds.length === 0) this.addChild(new Text(theme.fg("muted", "  No accounts"), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(`${keyHint("tui.select.confirm", "log out")} · ${keyHint("ui.dismiss", "back")}`, 0, 0));
		this.addChild(new DynamicBorder());
		this.invalidate();
	}
}
