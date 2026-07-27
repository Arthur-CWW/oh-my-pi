import { stripVTControlCharacters } from "node:util";
import { getKeybindings, type TabBarTheme } from "@oh-my-pi/pi-tui";
import { formatKeyHints } from "../config/keybindings";
import { theme } from "./theme/theme";

// ═══════════════════════════════════════════════════════════════════════════
// Text Sanitization
// ═══════════════════════════════════════════════════════════════════════════

/** Sanitize text for display in a single-line status. Strips ANSI/VT escape sequences, maps remaining C0/C1 control characters to spaces, collapses whitespace, trims. */
export function sanitizeStatusText(text: string): string {
	return stripVTControlCharacters(text)
		.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// Tab Bar Theme
// ═══════════════════════════════════════════════════════════════════════════

/** Shared tab bar theme used by model-selector and settings-selector. */
export function getTabBarTheme(): TabBarTheme {
	return {
		label: (text: string) => theme.bold(theme.fg("accent", text)),
		activeTab: (text: string) => theme.bold(theme.bg("selectedBg", theme.fg("text", text))),
		inactiveTab: (text: string) => theme.fg("muted", text),
		mutedTab: (text: string) => theme.fg("dim", text),
		hoverTab: (text: string) => theme.bg("selectedBg", theme.fg("text", text)),
		hint: (text: string) => theme.fg("dim", text),
	};
}

// ═══════════════════════════════════════════════════════════════════════════
// Working-message hint
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Suffix appended to the loader's working message with the effective interrupt
 * shortcut. The leading space is consumed by the loader renderer's matching.
 */
export function interruptHint(): string {
	const keyHint = formatKeyHints(getKeybindings().getKeys("app.interrupt"));
	return ` ${theme.format.bracketLeft}${keyHint}${theme.format.bracketRight}`;
}

export { parseCommandArgs } from "../utils/command-args";
