import { beforeAll, describe, expect, it } from "bun:test";
import xterm from "@xterm/headless";
import { visibleWidth } from "@oh-my-pi/pi-tui";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import {
	BashInteractiveOverlayComponent,
	buildInteractivePtyCommand,
	buildInteractivePtyEnv,
} from "@oh-my-pi/pi-coding-agent/tools/bash-interactive";

describe("interactive bash PTY environment", () => {
	it("starts from the resolved shell environment and applies command overrides", () => {
		const shellEnv = {
			PATH: "/mise/shims:/usr/bin:/bin",
			SHELL: "/bin/zsh",
			TERM: "dumb",
			OMPCODE: "1",
		};

		expect(buildInteractivePtyEnv(shellEnv, { CUSTOM: "value", SHELL: "/bin/bash" })).toEqual({
			PATH: "/mise/shims:/usr/bin:/bin",
			SHELL: "/bin/bash",
			TERM: "xterm-256color",
			OMPCODE: "1",
			CUSTOM: "value",
		});
	});

	it("lets an explicit TERM override the PTY default", () => {
		expect(buildInteractivePtyEnv({ PATH: "/usr/bin:/bin" }, { TERM: "screen-256color" })).toEqual({
			PATH: "/usr/bin:/bin",
			TERM: "screen-256color",
		});
	});

	it("restores the resolved PATH after login startup files run", () => {
		const command = buildInteractivePtyCommand("command -v bun", "/bin/zsh", {
			PATH: "/mise/shims:/usr/bin:/bin",
		});

		expect(command).toBe("PATH='/mise/shims:/usr/bin:/bin'; export PATH; command -v bun");
	});
});

describe("BashInteractiveOverlayComponent rendering", () => {
	beforeAll(async () => {
		await Settings.init({ inMemory: true });
		await initTheme(false);
	});

	it("renders the console overlay without an enclosing box frame", () => {
		const overlay = new BashInteractiveOverlayComponent("echo hi", theme, () => 24, xterm.Terminal);
		overlay.setComplete({ exitCode: 0, cancelled: false, timedOut: false });

		const width = 60;
		const plain = overlay.render(width).map(line => Bun.stripANSI(line));
		overlay.dispose();

		// No box-frame corners, tee-joins, side verticals, or horizontal rules.
		expect(plain.join("\n")).not.toMatch(/[┌┐└┘╭╮╰╯┬┴├┤┼│─]/);
		// The header carries the command, indented one space in place of the
		// removed left border; every row is padded to the full width.
		expect(plain[0]).toStartWith(" ");
		expect(plain[0]).toContain("echo hi");
		expect(plain.every(line => visibleWidth(line) === width)).toBe(true);
	});
});
