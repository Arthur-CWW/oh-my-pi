import { Editor, Input } from "@oh-my-pi/pi-tui";
import type { InteractiveModeContext } from "./types";

/**
 * Text inputs retain literal `:`. Normal-mode surfaces use it as a command-mode
 * prefix, including selectors and transcript/Hub viewers.
 */
export function canEnterCommandModeFromCurrentFocus(ctx: InteractiveModeContext): boolean {
	const focused = ctx.ui.getFocused();
	if (!focused) return false;
	if (focused === ctx.editor) {
		return (
			ctx.editor.getVimMode() !== "insert" &&
			ctx.editor.getText().length === 0 &&
			!ctx.editor.isShowingAutocomplete()
		);
	}
	if (focused instanceof Input || focused instanceof Editor) return false;
	return true;
}
