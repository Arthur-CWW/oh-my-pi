import { beforeAll, describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { CURSOR_MARKER } from "@oh-my-pi/pi-tui";
import {
	type CommandModeContext,
	applyCommandModeCompletion,
	dispatchCommandLine,
	getCommandModeCompletions,
	parseCommandLine,
	TUI_COLON_COMMAND_NAMES,
} from "@oh-my-pi/pi-coding-agent/modes/command-registry";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/assistant-message";
import { CommandLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/command-line";
import type { TranscriptDisplayContext } from "@oh-my-pi/pi-coding-agent/modes/transcript-display";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
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

	handleErrorsCommand(): void {}
	async showPrimitivesInspector(): Promise<void> {}
	showCopySelector(): void {}
	handleDumpCommand(): void {}
	async handleJobsCommand(): Promise<void> {}
	async handleChangelogCommand(): Promise<void> {}
	handleHotkeysCommand(): void {}
	handleToolsCommand(): void {}
	handleContextCommand(): void {}

	showVersion(): void {
		this.versionRuns += 1;
	}

	showFeedback(message: string): void {
		this.feedback.push(message);
	}
}

class TranscriptDisplayFixture {
	#state = { transcriptWrap: false, richTranscript: true };

	get context(): TranscriptDisplayContext {
		return this.#state;
	}

	setWrap(value: boolean): void {
		this.#state.transcriptWrap = value;
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

	it(":commands lists the command registry and interaction shortcuts", async () => {
		const ctx = new CommandFixture();
		expect(await dispatchCommandLine(":commands", ctx)).toBe(true);
		const feedback = ctx.feedback.at(-1) ?? "";
		expect(feedback).toContain(":wrap — toggle wrapping");
		expect(feedback).toContain(":commands — list TUI colon commands and shortcuts");
		expect(feedback).toContain("Viewer shortcuts");
		expect(feedback).toContain("Agent Hub shortcuts");
		expect(feedback).toContain("Command-line shortcuts");
		expect(feedback).toContain("za toggle fold");
		expect(feedback).toContain("J scroll five lines down");
		expect(feedback).not.toContain("enter input mode");
	});

	it("filters and selects :commands as a normal colon completion", () => {
		const completions = getCommandModeCompletions(":comm");
		expect(completions.map(completion => completion.value)).toEqual(["commands"]);
		expect(applyCommandModeCompletion(":comm", completions[0]!)).toBe(":commands");
	});

	it("keeps migrated colon commands out of slash autocomplete", () => {
		const slashNames = new Set(BUILTIN_SLASH_COMMAND_DEFS.map(command => command.name));
		for (const name of TUI_COLON_COMMAND_NAMES) expect(slashNames).not.toContain(name);
	});

	it("renders completions above the colon prompt with the cursor at column one", () => {
		const prompt = new CommandLineComponent(new CommandFixture(), () => {});
		prompt.input.focused = true;
		const lines = prompt.render(80);
		const inputLine = lines.at(-1) ?? "";
		expect(lines.slice(0, -1).some(line => Bun.stripANSI(line).includes("commands"))).toBe(true);
		expect(Bun.stripANSI(inputLine).startsWith(":")).toBe(true);
		expect(inputLine.indexOf(CURSOR_MARKER)).toBe(1);
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
		const fixture = new TranscriptDisplayFixture();
		const display = fixture.context;
		const card = createIrcMessageCard(
			{ kind: "incoming", from: "YaziTreeImplementer", body: "word ".repeat(30).trim() },
			() => false,
			theme,
			display,
		);
		const truncated = card.render(36);
		fixture.setWrap(true);
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
