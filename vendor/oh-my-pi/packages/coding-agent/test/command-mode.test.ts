import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import {
	applyCommandModeCompletion,
	type CommandModeCommand,
	type CommandModeContext,
	commandModeCommandsForView,
	dispatchCommandLine,
	getCommandModeCompletions,
	parseCommandLine,
	TUI_COLON_COMMAND_NAMES,
} from "@oh-my-pi/pi-coding-agent/modes/command-registry";
import { AssistantMessageComponent } from "@oh-my-pi/pi-coding-agent/modes/components/assistant-message";
import {
	CommandLineComponent,
	CommandOutputOverlayComponent,
	canEnterCommandMode,
	installCommandLine,
} from "@oh-my-pi/pi-coding-agent/modes/components/command-line";
import { initTheme, theme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { toggleRichTranscript } from "@oh-my-pi/pi-coding-agent/modes/transcript-commands";
import type { TranscriptDisplayContext } from "@oh-my-pi/pi-coding-agent/modes/transcript-display";
import { HistoryStorage } from "@oh-my-pi/pi-coding-agent/session/history-storage";
import { BUILTIN_SLASH_COMMAND_DEFS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import { formatLoopStats } from "@oh-my-pi/pi-coding-agent/slash-commands/loopstats";
import { createIrcMessageCard } from "@oh-my-pi/pi-coding-agent/tools/irc";
import { Container, CURSOR_MARKER, Input } from "@oh-my-pi/pi-tui";

const commandHistoryTempDirs: string[] = [];

afterEach(async () => {
	HistoryStorage.resetInstance();
	await Promise.all(commandHistoryTempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

beforeAll(async () => {
	await initTheme(false);
});
class CommandFixture implements CommandModeContext {
	wrap = false;
	rich = true;
	versionRuns = 0;
	loopStatsRuns = 0;
	tabsRuns = 0;
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
	handleRouteCommand(): void {}
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

	showLoopStats(): void {
		this.loopStatsRuns += 1;
		this.feedback.push(
			formatLoopStats({
				totalViolations: 2,
				maxBlockedMs: 418,
				violations: [
					{
						timestamp: 1720000000000,
						blockedMs: 418,
						phase: "ui.render",
						pid: 123,
						attribution: "session-1",
					},
				],
			}),
		);
	}
	showTabs(): void {
		this.tabsRuns += 1;
		this.feedback.push("Browser tab pool\n  tabs: 1\n  main owner=session/Main purpose=browser");
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
		expect(await dispatchCommandLine("loopstats", ctx)).toBe(true);
		expect(ctx.loopStatsRuns).toBe(1);
		const loopStats = ctx.feedback.at(-1) ?? "";
		expect(loopStats).toContain("total violations: 2");
		expect(loopStats).toContain("max blocked ms: 418");
		expect(loopStats).toContain("phase=ui.render");
		expect(loopStats).toContain("attribution=session-1");
		expect(await dispatchCommandLine("tabs", ctx)).toBe(true);
		expect(ctx.tabsRuns).toBe(1);
		expect(ctx.feedback.at(-1)).toContain("Browser tab pool");
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
		expect(feedback).toContain(":rich — toggle rich Markdown rendering");
		expect(feedback).toContain("Viewer shortcuts");
		expect(feedback).toContain("Agent Hub shortcuts");
		expect(feedback).toContain("Command-line shortcuts");
		expect(feedback).toContain("za toggle fold");
		expect(feedback).toContain("J scroll five lines down");
		expect(feedback).not.toContain("enter input mode");
	});
	it(":help remains the global command documentation surface", async () => {
		const help = new CommandFixture();
		expect(await dispatchCommandLine(":help", help)).toBe(true);
		expect(help.feedback.at(-1)).toContain("press ? for selected-agent metadata");
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
			"help",
			"route",
			"wrap",
			"rich",
			"errors",
			"version",
			"loopstats",
			"tabs",
			"changelog",
			"hotkeys",
			"bookmark",
			"bookmarks",
		]);
		expect(await dispatchCommandLine(":id", ctx, childCommands)).toBe(true);
		expect(ctx.feedback.at(-1)).toContain("agent id: CardQualityAudit");
		expect(ctx.copied.at(-1)).toBe("019f6141-df73-7000-b792-985f12d9db5d/CardQualityAudit");
	});

	it("renders colon output in a bottom overlay without moving transcript scroll", async () => {
		let listener: ((data: string) => { consume?: boolean } | undefined) | undefined;
		const editor = { getText: () => "", isShowingAutocomplete: () => false, render: () => [] };
		const viewer = { scrollOffset: 37, render: () => [] };
		let focused: unknown = viewer;
		let overlayHidden = false;
		const overlays: Array<{ component: unknown; options: Record<string, unknown> }> = [];
		const editorContainer = new Container();
		editorContainer.addChild(editor);
		const ui = {
			addInputListener: (next: typeof listener) => {
				listener = next;
			},
			getFocused: () => focused,
			setFocus: (next: unknown) => {
				focused = next;
			},
			showOverlay: (component: unknown, options: Record<string, unknown>) => {
				overlays.push({ component, options });
				return {
					hide: () => {
						overlayHidden = true;
					},
				};
			},
			requestRender: () => {},
			loopWatchdogSnapshot: {
				totalViolations: 1,
				maxBlockedMs: 23,
				violations: [],
			},
		};
		const interactive = {
			editor,
			editorContainer,
			ui,
			focusedAgentId: undefined,
		};

		installCommandLine(interactive as never);
		expect(listener?.(":")).toEqual({ consume: true });
		expect(focused).toBeInstanceOf(CommandLineComponent);
		expect(editorContainer.children).toEqual([editor]);

		const commandLine = focused as CommandLineComponent;
		commandLine.handleInput("\x1b");
		commandLine.input.setValue("loopstats");
		commandLine.handleInput("\r");
		await Bun.sleep(0);
		const output = overlays.at(-1);
		expect(output?.component).toBeInstanceOf(CommandOutputOverlayComponent);
		expect(output?.options).toMatchObject({
			anchor: "bottom-center",
			width: "100%",
			margin: { bottom: 1 },
		});
		expect(Bun.stripANSI((output?.component as CommandOutputOverlayComponent).render(100).join("\n"))).toContain(
			"Loop watchdog",
		);
		expect(overlayHidden).toBe(true);
		expect(viewer.scrollOffset).toBe(37);
		(output?.component as CommandOutputOverlayComponent).handleInput("x");
	});

	it("opens colon mode uniformly from non-insert surfaces and keeps insert-mode colon literal", () => {
		let editorText = "";
		const editor = {
			getText: () => editorText,
			setText: (text: string) => {
				editorText = text;
			},
			isShowingAutocomplete: () => false,
		};
		let focused: unknown = editor;
		const interactive = { editor, ui: { getFocused: () => focused } };

		expect(canEnterCommandMode(interactive as never)).toBe(true);
		editor.setText("draft");
		expect(canEnterCommandMode(interactive as never)).toBe(false);
		editor.setText("");

		for (const surface of [
			{ name: "Hub", canEnterCommandMode: () => false },
			{ name: "viewer sequence" },
			{ name: "transcript scroll" },
			{ name: "roster" },
		]) {
			focused = surface;
			expect(canEnterCommandMode(interactive as never), surface.name).toBe(true);
		}

		focused = new Input();
		expect(canEnterCommandMode(interactive as never)).toBe(false);
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
		prompt.handleInput("definitely-not-a-command");
		expect(prompt.render(80)).toHaveLength(1);
	});

	it("dismisses completions before exiting the command prompt", () => {
		const ctx = new CommandFixture();
		let exits = 0;
		const prompt = new CommandLineComponent(ctx, () => {
			exits += 1;
		});
		prompt.handleInput("\x1b");
		expect(exits).toBe(0);
		expect(prompt.input.getValue()).toBe("");
		prompt.handleInput("\x1b");
		expect(exits).toBe(1);
	});

	it("makes Tab apply every cycled completion before Enter submits it", async () => {
		const ctx = new CommandFixture();
		const ran: string[] = [];
		const commands: readonly CommandModeCommand[] = ["first", "second", "third"].map(name => ({
			name,
			description: name,
			run: () => {
				ran.push(name);
			},
		}));
		const done: string[] = [];
		const prompt = new CommandLineComponent(ctx, reason => done.push(reason), { commands });

		prompt.handleInput("\t");
		expect(prompt.input.getValue()).toBe("second");
		prompt.handleInput("\t");
		expect(prompt.input.getValue()).toBe("third");
		prompt.handleInput("\x1b[Z");
		expect(prompt.input.getValue()).toBe("second");
		prompt.handleInput("\r");
		await Promise.resolve();

		expect(ran).toEqual(["second"]);
		expect(done).toEqual(["submit"]);
	});

	it("uses arrows and Ctrl-N/P for menu navigation, then history when dismissed", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-command-history-"));
		commandHistoryTempDirs.push(dir);
		HistoryStorage.resetInstance();
		const storage = HistoryStorage.open(path.join(dir, "history.db"));
		await storage.addToChannel("command", "older");
		await storage.addToChannel("command", "newer");

		const ctx = new CommandFixture();
		const prompt = new CommandLineComponent(ctx, () => {}, {
			commands: [
				{ name: "first", description: "first", run: () => {} },
				{ name: "second", description: "second", run: () => {} },
			],
			historyStorage: storage,
		});
		prompt.handleInput("\x1b[B");
		prompt.handleInput("\x10");
		prompt.handleInput("\x1b");
		prompt.input.setValue("draft");

		prompt.handleInput("\x10");
		expect(prompt.input.getValue()).toBe("newer");
		prompt.handleInput("\x1b[A");
		expect(prompt.input.getValue()).toBe("older");
		prompt.handleInput("\x0e");
		expect(prompt.input.getValue()).toBe("newer");
		prompt.handleInput("\x1b[B");
		expect(prompt.input.getValue()).toBe("draft");
	});

	it("persists accepted :id commands only in colon history", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-command-submit-"));
		commandHistoryTempDirs.push(dir);
		HistoryStorage.resetInstance();
		const storage = HistoryStorage.open(path.join(dir, "history.db"));
		const ctx = new CommandFixture();
		const prompt = new CommandLineComponent(ctx, () => {}, { historyStorage: storage });

		prompt.handleInput("\t");
		expect(prompt.input.getValue()).toBe("id");
		prompt.handleInput("\r");
		await Bun.sleep(120);

		expect(ctx.copied.at(-1)).toBe("019f6141-df73-7000-b792-985f12d9db5d/Main");
		expect(storage.getRecent(10)).toEqual([]);
		expect(storage.getRecent(10, "command").map(entry => entry.prompt)).toEqual(["id"]);
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
	it(":rich immediately changes a cached IRC body in the focused view", async () => {
		const view = {
			transcriptMode: "rich" as const,
			transcriptWrap: false,
			richTranscript: true,
			chatContainer: { children: [] as unknown[], invalidate: () => {} },
			streamingComponent: undefined,
			toggleTranscriptMode: () => {},
			ui: { resetDisplay: () => {} },
		};
		const card = createIrcMessageCard(
			{ kind: "incoming", from: "YaziTreeImplementer", body: "**bold** words" },
			() => false,
			theme,
			view,
		);
		view.chatContainer.children.push(card);
		const command = new CommandFixture();
		command.toggleRich = () => toggleRichTranscript(view as never);

		const rich = card.render(80).join("\n");
		expect(rich).not.toContain("**bold**");
		expect(await dispatchCommandLine(":rich", command)).toBe(true);
		const plain = card.render(80).join("\n");
		expect(plain).toContain("**bold**");
		expect(plain).not.toBe(rich);
	});
});
