import { describe, expect, it } from "bun:test";
import { buildInteractivePtyCommand, buildInteractivePtyEnv } from "@oh-my-pi/pi-coding-agent/tools/bash-interactive";

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
