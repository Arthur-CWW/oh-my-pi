export const RELOAD_TUI_COMMAND = "reload-tui" as const;

export const RELOAD_TUI_DESCRIPTION = "Reload TUI code (runner-backed disposable view only)";

export const RELOAD_TUI_UNAVAILABLE_MESSAGE =
	"TUI code reload requires a runner-backed disposable view; Ctrl+L only redraws this view.";

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
