import { beforeAll, describe, expect, it } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { CURSOR_MARKER } from "@oh-my-pi/pi-tui";
import {
	type CommandModeContext,
	applyCommandModeCompletion,
	commandModeCommandsForView,
	dispatchCommandLine,
	getCommandModeCompletions,
	parseCommandLine,
	TUI_COLON_COMMAND_NAMES,
} from "@oh-my-pi/pi-coding-agent/modes/command-registry";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/assistant-message";
import { canEnterCommandMode, CommandLineComponent } from "@oh-my-pi/pi-coding-agent/modes/components/command-line";
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
	copied: string[] = [];
	identity = {
		sessionId: "019f6141-df73-7000-b792-985f12d9db5d",
		sessionName: "Identity repro",
		agentId: "Main",
		journalPath: "/tmp/session.jsonl",
		binaryVersion: "16.0.1+fork.test",
	};

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

	getSessionIdentity() {
		return this.identity;
	}

	copyIdentityHandle(handle: string): void {
		this.copied.push(handle);
	}

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

	it(":id and :whoami emit a structured identity and copy the paste-ready handle", async () => {
		const ctx = new CommandFixture();
		for (const command of [":id", ":whoami"]) expect(await dispatchCommandLine(command, ctx)).toBe(true);
		const output = ctx.feedback.at(-1) ?? "";
		expect(output).toContain("session id: 019f6141-df73-7000-b792-985f12d9db5d");
		expect(output).toContain("session name: Identity repro");
		expect(output).toContain("agent id: Main");
		expect(output).toContain("journal: /tmp/session.jsonl");
		expect(output).toContain("status segment: session (renders 019f6141)");
		expect(ctx.copied).toEqual([
			"019f6141-df73-7000-b792-985f12d9db5d/Main",
			"019f6141-df73-7000-b792-985f12d9db5d/Main",
		]);
	});

	it("keeps colon mode and view-local commands available while a child is focused", async () => {
		const ctx = new CommandFixture();
		ctx.identity = { ...ctx.identity, agentId: "CardQualityAudit", journalPath: "/tmp/CardQualityAudit.jsonl" };
		const childCommands = commandModeCommandsForView(true);
		const editor = { getText: () => "", isShowingAutocomplete: () => false };
		const interactive = {
			focusedAgentId: "CardQualityAudit",
			editor,
			ui: { getFocused: () => editor },
		};
		expect(canEnterCommandMode(interactive as never)).toBe(true);
		expect(childCommands.map(command => command.name)).toEqual([
			"commands",
			"id",
			"wrap",
			"rich",
			"errors",
			"version",
			"changelog",
			"hotkeys",
		]);
		expect(await dispatchCommandLine(":id", ctx, childCommands)).toBe(true);
		expect(ctx.feedback.at(-1)).toContain("agent id: CardQualityAudit");
		expect(ctx.copied.at(-1)).toBe("019f6141-df73-7000-b792-985f12d9db5d/CardQualityAudit");
	});

	it("filters and selects :commands as a normal colon completion", () => {
		const completions = getCommandModeCompletions(":comm");
		expect(completions.map(completion => completion.value)).toEqual(["commands"]);
		expect(applyCommandModeCompletion(":comm", completions[0]!)).toBe(":commands");
		expect(completions[0]?.description).toContain("list TUI colon commands");
		expect(getCommandModeCompletions(":id").map(completion => completion.value)).toEqual(["id"]);
		expect(getCommandModeCompletions(":who").map(completion => completion.value)).toEqual(["whoami"]);
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
