import { beforeAll, describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import {
	type CommandModeContext,
	dispatchCommandLine,
	parseCommandLine,
} from "@oh-my-pi/pi-coding-agent/modes/command-registry";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/assistant-message";
import { CommandLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/command-line";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { createIrcMessageCard } from "@oh-my-pi/pi-coding-agent/tools/irc";

beforeAll(async () => {
	await initTheme(false);
});
class CommandFixture implements CommandModeContext {
	wrap = false;
	rich = true;
	versionRuns = 0;
	feedback: string[] = [];

	toggleWrap(): boolean {
		this.wrap = !this.wrap;
		return this.wrap;
	}

	toggleRich(): boolean {
		this.rich = !this.rich;
		return this.rich;
	}

	runVersion(): void {
		this.versionRuns += 1;
	}

	showFeedback(message: string): void {
		this.feedback.push(message);
	}
}

const ASSISTANT_FIXTURE: AssistantMessage = {
	role: "assistant",
	content: [{ type: "text", text: "**bold words**" }],
	api: "anthropic-messages",
	provider: "anthropic",
	model: "fixture",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "stop",
	timestamp: 0,
};

describe("colon command registry", () => {
	it("parses and dispatches seeded commands", async () => {
		const ctx = new CommandFixture();
		expect(parseCommandLine(" :WRAP  ")).toEqual({ name: "wrap", args: [] });
		expect(await dispatchCommandLine("wrap", ctx)).toBe(true);
		expect(ctx.wrap).toBe(true);
		expect(await dispatchCommandLine("version", ctx)).toBe(true);
		expect(ctx.versionRuns).toBe(1);
	});

	it("names the known commands for an unknown command", async () => {
		const ctx = new CommandFixture();
		expect(await dispatchCommandLine("wat", ctx)).toBe(false);
		expect(ctx.feedback.at(-1)).toContain('"wat"');
		for (const known of ["wrap", "rich", "version"]) expect(ctx.feedback.at(-1)).toContain(known);
	});

	it("Esc exits only the command prompt", () => {
		const ctx = new CommandFixture();
		let exits = 0;
		const prompt = new CommandLineComponent(ctx, () => {
			exits += 1;
		});
		prompt.handleInput("x");
		prompt.handleInput("\x1b");
		expect(exits).toBe(1);
		expect(prompt.input.getValue()).toBe("x");
	});
});

describe("transcript command rendering", () => {
	it("wrap changes a long IRC aside from one body row to multiple rows", () => {
		let wrap = false;
		const card = createIrcMessageCard(
			{ kind: "incoming", from: "YaziTreeImplementer", body: "word ".repeat(30).trim() },
			() => false,
			theme,
			() => wrap,
		);
		const truncated = card.render(36);
		wrap = true;
		card.invalidate?.();
		const wrapped = card.render(36);
		expect(truncated).toHaveLength(2);
		expect(wrapped.length).toBeGreaterThan(truncated.length);
	});

	it("rich toggle switches assistant text from Markdown to literal plain text", () => {
		const component = new AssistantMessageComponent(ASSISTANT_FIXTURE);
		expect(component.render(80).join("\n")).not.toContain("**bold words**");
		component.setRichRendering(false);
		expect(component.render(80).join("\n")).toContain("**bold words**");
	});
});
