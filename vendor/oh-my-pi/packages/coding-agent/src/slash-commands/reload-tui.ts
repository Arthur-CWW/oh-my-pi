export const RELOAD_TUI_COMMAND = "reload-tui" as const;

export const RELOAD_TUI_DESCRIPTION =
	"Reload the view's code in place — runner/session untouched (runner-backed disposable views only)";

export const RELOAD_TUI_UNAVAILABLE_MESSAGE =
	"This view runs in-process with the runner, so its code cannot be reloaded alone. Ctrl+L redraws; /restart swaps the whole process onto the installed binary (children are preserved and re-adopted).";

export interface TuiHostCapabilities {
	/** Request one host-level TUI code reload. The host owns deduplication and epoch fencing. */
	readonly requestHostReload?: () => void;
}

export function handleReloadTuiCommand(
	capabilities: TuiHostCapabilities | undefined,
	showUnavailable: (message: string) => void,
): void {
	const requestHostReload = capabilities?.requestHostReload;
	if (requestHostReload) {
		requestHostReload();
		return;
	}
	showUnavailable(RELOAD_TUI_UNAVAILABLE_MESSAGE);
}
