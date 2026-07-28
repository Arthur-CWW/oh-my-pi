import { describe, expect, it } from "bun:test";
import { SETTINGS_SCHEMA } from "@oh-my-pi/pi-coding-agent/config/settings-schema";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";

describe("Codex usage-reset policy", () => {
	it("defaults to auto and accepts an explicit manual gate", () => {
		expect(SETTINGS_SCHEMA["auth.codexUsageReset"]).toMatchObject({
			type: "enum",
			values: ["auto", "manual"],
			default: "auto",
		});
		expect(Settings.isolated().get("auth.codexUsageReset")).toBe("auto");
		expect(Settings.isolated({ "auth.codexUsageReset": "manual" }).get("auth.codexUsageReset")).toBe("manual");
	});
});
