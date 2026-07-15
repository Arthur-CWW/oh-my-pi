import { Editor, Input, type Component } from "@oh-my-pi/pi-tui";
import type { InteractiveModeContext } from "./types";

/** A composite surface with an internal text prompt can veto global `:` entry. */
export interface CommandModeActivationGuard {
	canEnterCommandMode(): boolean;
}

function hasActivationGuard(component: Component): component is Component & CommandModeActivationGuard {
	return "canEnterCommandMode" in component && typeof component.canEnterCommandMode === "function";
}

/**
 * Text inputs retain literal `:`. Normal-mode surfaces use it as a command-mode
 * prefix, including selectors and transcript/Hub viewers.
 */
export function canEnterCommandModeFromCurrentFocus(ctx: InteractiveModeContext): boolean {
	const focused = ctx.ui.getFocused();
	if (!focused) return false;
	if (focused === ctx.editor) return ctx.editor.getText().length === 0 && !ctx.editor.isShowingAutocomplete();
	if (focused instanceof Input || focused instanceof Editor) return false;
	return !hasActivationGuard(focused) || focused.canEnterCommandMode();
}
