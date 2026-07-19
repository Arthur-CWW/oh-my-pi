export {
	makeOAuthProviderId,
	makeOAuthSelectorAdapter,
	makeOAuthValidationSource,
	oauthSelectorOutput,
} from "../mvu/oauth-selector-adapter";
export type {
	OAuthAuthState,
	OAuthAction,
	OAuthProviderId,
	OAuthProviderItem,
	OAuthSelectorAdapter,
	OAuthSelectorModel,
	OAuthSelectorMsg,
	OAuthSelectorOutput,
	OAuthValidationMsg,
} from "../mvu/oauth-selector-adapter";

import { Container, Spacer, Text, truncateToWidth } from "@oh-my-pi/pi-tui";
import type { OAuthSelectorAdapter, OAuthSelectorModel } from "../mvu/oauth-selector-adapter";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";

const MAX_VISIBLE = 10;

function queryOf(model: OAuthSelectorModel): string {
	const mode = model.mode;
	if (mode._tag === "Filter") return mode.query;
	if (mode._tag === "PreviewFocus" || mode._tag === "Confirm") {
		return mode.returnTo._tag === "Filter" ? mode.returnTo.query : "";
	}
	return "";
}

/** Renderer-only OAuth list. Selection, filtering, validation, and settlement live in the route runtime. */
export class OAuthSelectorComponent extends Container {
	readonly #title: string;
	readonly #adapter: OAuthSelectorAdapter;

	constructor(mode: "login" | "logout", adapter: OAuthSelectorAdapter) {
		super();
		this.#adapter = adapter;
		this.#title = mode === "login" ? "Select provider to login:" : "Select provider to logout:";
		this.apply(adapter.initialModel);
	}

	apply(model: OAuthSelectorModel): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold(this.#title), 0, 0));
		this.addChild(new Spacer(1));
		const ids = model.filteredIds;
		const selectedIndex = Math.max(0, ids.findIndex(id => id === model.selectedId));
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(MAX_VISIBLE / 2), Math.max(0, ids.length - MAX_VISIBLE)));
		for (const id of ids.slice(start, start + MAX_VISIBLE)) {
			const item = this.#adapter.items.get(id);
			if (!item) continue;
			const selected = id === model.selectedId;
			const state = model.validation.get(id) ?? item.authState;
			const status = state === "checking"
				? theme.fg("warning", ` ${theme.status.pending} checking`)
				: state === "invalid"
					? theme.fg("error", ` ${theme.status.error} invalid`)
					: state === "valid"
						? theme.fg("success", ` ${theme.status.enabled} logged in`)
						: "";
			const label = item.available ? item.name : theme.fg("dim", item.name);
			this.addChild(new Text(truncateToWidth(`${selected ? theme.fg("accent", `${theme.nav.cursor} ${label}`) : `  ${label}`}${status}`, 120), 0, 0));
		}
		if (ids.length === 0) this.addChild(new Text(theme.fg("muted", "  No matching providers"), 0, 0));
		const query = queryOf(model);
		if (query.length > 0) this.addChild(new Text(theme.fg("muted", `  Search: ${query}`), 0, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(`${keyHint("tui.select.confirm", "select")} · ${keyHint("ui.dismiss", "back")}`, 0, 0));
		this.addChild(new DynamicBorder());
		this.invalidate();
	}
}
