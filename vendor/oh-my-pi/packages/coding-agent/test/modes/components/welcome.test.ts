import { afterEach, beforeAll, describe, expect, it, vi } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { WelcomeComponent } from "@oh-my-pi/pi-coding-agent/modes/components/welcome";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";

describe("WelcomeComponent tips", () => {
	beforeAll(async () => {
		await Settings.init({ inMemory: true });
		await initTheme(false);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("selects standard tip when preset is not unicode", () => {
		vi.spyOn(theme, "getSymbolPreset").mockReturnValue("nerd");

		const welcome = new WelcomeComponent("1.0.0", "model", "provider");
		expect(welcome.tip).not.toBe("Please use nerdfont 😭.");
		expect(welcome.tip).toBeDefined();
	});

	it("selects nerdfont tip with 10% probability under unicode preset", () => {
		vi.spyOn(theme, "getSymbolPreset").mockReturnValue("unicode");

		// 9% chance => selects special tip
		vi.spyOn(Math, "random").mockReturnValue(0.09);
		const welcomeSpecial = new WelcomeComponent("1.0.0", "model", "provider");
		expect(welcomeSpecial.tip).toBe("Please use nerdfont 😭.");

		// 10% chance => selects regular tip
		vi.spyOn(Math, "random").mockReturnValue(0.1);
		const welcomeRegular = new WelcomeComponent("1.0.0", "model", "provider");
		expect(welcomeRegular.tip).not.toBe("Please use nerdfont 😭.");
		expect(welcomeRegular.tip).toBeDefined();
	});
});

describe("WelcomeComponent rendering", () => {
	beforeAll(async () => {
		await Settings.init({ inMemory: true });
		await initTheme(false);
	});

	it("renders the welcome panel without an enclosing box frame", () => {
		const welcome = new WelcomeComponent("1.2.3", "test-model", "test-provider", [
			{ name: "recent-session-name", timeAgo: "2h ago" },
		]);
		const plain = welcome.render(100).map(line => Bun.stripANSI(line));
		const joined = plain.join("\n");

		// No box-frame corners or tee-joins anywhere in the panel…
		expect(joined).not.toMatch(/[┌┐└┘╭╮╰╯┬┴├┤┼]/);
		// …and no enclosing side verticals: content rows never start or end with a
		// vertical bar (a single middle divider between the two columns is allowed).
		for (const line of plain) {
			expect(line.startsWith("│")).toBe(false);
			expect(line.endsWith("│")).toBe(false);
		}

		// Heading, both columns, and the recent-session entry are preserved.
		expect(joined).toContain("Welcome back!");
		expect(joined).toContain("v1.2.3");
		expect(joined).toContain("test-model");
		expect(joined).toContain("test-provider");
		expect(joined).toContain("recent-session-name");
	});
});
