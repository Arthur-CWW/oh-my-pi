import { getKeybindings, type KeyId, matchesKey } from "@oh-my-pi/pi-tui";

/**
 * Match the coding-agent interrupt key.
 *
 * Interactive mode installs a keybinding manager that exposes `app.interrupt`
 * globally. Isolated components may install a TUI-only registry without that
 * action, so fall back to the coding-agent's mandatory Ctrl+Q interrupt.
 */
export function matchesAppInterrupt(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getDefinition("app.interrupt") !== undefined) {
		return keybindings.matches(data, "app.interrupt");
	}
	return matchesKey(data, "ctrl+q");
}

/**
 * Match the coding-agent UI dismissal key.
 *
 * Isolated components may install a TUI-only keybinding registry without
 * `ui.dismiss`. Fall back to raw Escape only when the action is absent so an
 * explicitly empty binding remains disabled.
 */
export function matchesUiDismiss(data: string): boolean {
	const keybindings = getKeybindings();
	if (keybindings.getDefinition("ui.dismiss") !== undefined) {
		return keybindings.matches(data, "ui.dismiss");
	}
	return matchesKey(data, "escape") || matchesKey(data, "esc");
}

/** Match the generic selector cancel keybinding. */
export function matchesSelectCancel(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.cancel");
}

/** Match the generic selector up-navigation keybinding. */
export function matchesSelectUp(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.up");
}

/** Match the generic selector down-navigation keybinding. */
export function matchesSelectDown(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.down");
}

/** Match the generic selector page-up keybinding. */
export function matchesSelectPageUp(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.pageUp");
}

/** Match the generic selector page-down keybinding. */
export function matchesSelectPageDown(data: string): boolean {
	return getKeybindings().matches(data, "tui.select.pageDown");
}

/** Match contextual Vim navigation. Consumers must call these only outside text entry. */
function matchesContextualNavigation(
	data: string,
	action: Parameters<ReturnType<typeof getKeybindings>["getKeys"]>[0],
	fallback: KeyId,
): boolean {
	const keybindings = getKeybindings();
	return keybindings.getKeys(action).length > 0 ? keybindings.matches(data, action) : matchesKey(data, fallback);
}

export function matchesNavigationDown(data: string): boolean {
	return matchesContextualNavigation(data, "app.navigation.down", "j");
}

export function matchesNavigationUp(data: string): boolean {
	return matchesContextualNavigation(data, "app.navigation.up", "k");
}

export function matchesNavigationPageDown(data: string): boolean {
	return matchesContextualNavigation(data, "app.navigation.pageDown", "ctrl+d");
}

export function matchesNavigationPageUp(data: string): boolean {
	return matchesContextualNavigation(data, "app.navigation.pageUp", "ctrl+u");
}

export function matchesNavigationTop(data: string): boolean {
	return matchesContextualNavigation(data, "app.navigation.top", "g");
}

export function matchesNavigationBottom(data: string): boolean {
	return matchesContextualNavigation(data, "app.navigation.bottom", "shift+g");
}

export function matchesAppExternalEditor(data: string): boolean {
	const keybindings = getKeybindings();
	const externalEditorKeys = keybindings.getKeys("app.editor.external");
	if (externalEditorKeys.length > 0) {
		return keybindings.matches(data, "app.editor.external");
	}
	return matchesKey(data, "ctrl+g");
}
