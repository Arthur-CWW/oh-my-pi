import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import {
	BUILTIN_SLASH_COMMAND_DEFS,
	executeBuiltinSlashCommand,
} from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { RELOAD_TUI_UNAVAILABLE_MESSAGE } from "@oh-my-pi/pi-coding-agent/slash-commands/reload-tui";

function createRuntime(options: { requestHostReload?: () => void } = {}) {
	const showWarning = vi.fn();
	const showStatus = vi.fn();
	const setText = vi.fn();
	return {
		showWarning,
		showStatus,
		setText,
		runtime: {
			ctx: {
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				showWarning,
				showStatus,
				tuiHost: options.requestHostReload ? { requestHostReload: options.requestHostReload } : undefined,
			} as unknown as InteractiveModeContext,
		},
	};
}

describe("/reload-tui slash command", () => {
	it("is registered with runner-backed availability in command metadata", () => {
		const command = BUILTIN_SLASH_COMMAND_DEFS.find(item => item.name === "reload-tui");

		expect(command?.description).toContain("runner-backed disposable view only");
		expect(BUILTIN_SLASH_COMMAND_DEFS.some(item => item.name === "refresh-tui")).toBe(false);
	});

	it("invokes the active host reload capability exactly once", async () => {
		const requestHostReload = vi.fn();
		const harness = createRuntime({ requestHostReload });

		expect(await executeBuiltinSlashCommand("/reload-tui", harness.runtime)).toBe(true);
		expect(requestHostReload).toHaveBeenCalledTimes(1);
		expect(harness.showWarning).not.toHaveBeenCalled();
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("explains legacy InteractiveMode availability without submitting the command", async () => {
		const harness = createRuntime();

		expect(await executeBuiltinSlashCommand("/reload-tui", harness.runtime)).toBe(true);
		expect(harness.showWarning).toHaveBeenCalledWith(RELOAD_TUI_UNAVAILABLE_MESSAGE);
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("keeps /refresh-tui unknown", async () => {
		const harness = createRuntime();

		expect(await executeBuiltinSlashCommand("/refresh-tui", harness.runtime)).toBe(false);
		expect(harness.showWarning).not.toHaveBeenCalled();
		expect(harness.setText).not.toHaveBeenCalled();
	});
});
