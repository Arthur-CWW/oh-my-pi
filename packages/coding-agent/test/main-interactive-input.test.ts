import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { submitInteractiveInput } from "@oh-my-pi/pi-coding-agent/main";
import type { SubmittedUserInput } from "@oh-my-pi/pi-coding-agent/modes/types";
import { discoverTitleSystemPromptFile } from "@oh-my-pi/pi-coding-agent/system-prompt";

const cleanupDirs: string[] = [];

afterEach(async () => {
	await Promise.all(cleanupDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function createInput(overrides: Partial<SubmittedUserInput> = {}): SubmittedUserInput {
	return {
		text: "hello",
		attachments: undefined,
		cancelled: false,
		started: false,
		...overrides,
	};
}

describe("discoverTitleSystemPromptFile", () => {
	it("discovers TITLE_SYSTEM.md from the project omp config directory", async () => {
		const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-title-system-"));
		cleanupDirs.push(projectDir);
		const configDir = path.join(projectDir, ".omp");
		await fs.mkdir(configDir, { recursive: true });
		const promptPath = path.join(configDir, "TITLE_SYSTEM.md");
		await fs.writeFile(promptPath, "custom title prompt");

		expect(discoverTitleSystemPromptFile(projectDir)).toBe(promptPath);
	});
});

describe("submitInteractiveInput", () => {
	it("routes already-started synthetic continue submissions to a hidden developer prompt", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => false),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async () => true),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: false,
		};
		const input = createInput({ text: "resume now", started: true, synthetic: true });

		await submitInteractiveInput(mode, session, input);

		expect(mode.markPendingSubmissionStarted).not.toHaveBeenCalled();
		expect(session.prompt).toHaveBeenCalledWith("resume now", { synthetic: true, expandPromptTemplates: false });
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input, false);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("skips prompting when optimistic submission was cancelled before start", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => false),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async () => true),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: false,
		};
		const input = createInput();

		await submitInteractiveInput(mode, session, input);

		expect(mode.markPendingSubmissionStarted).toHaveBeenCalledWith(input);
		expect(session.prompt).not.toHaveBeenCalled();
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input, false);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("routes hidden custom submissions through promptCustomMessage with followUp queueing", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async () => true),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: false,
		};
		const input = createInput({ text: "continue goal", customType: "goal-continuation" });

		await submitInteractiveInput(mode, session, input);

		expect(session.prompt).not.toHaveBeenCalled();
		// Even when idle, followUp is passed so a background turn that starts in the
		// read-vs-dispatch gap queues the message instead of throwing AgentBusyError.
		expect(session.promptCustomMessage).toHaveBeenCalledWith(
			{
				customType: "goal-continuation",
				content: "continue goal",
				display: false,
				attribution: "agent",
			},
			{ streamingBehavior: "followUp" },
		);
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input, false);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("passes followUp on a plain idle submission so a racing turn queues instead of erroring", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async () => true),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: false,
		};
		const input = createInput({ text: "loop prompt" });

		await submitInteractiveInput(mode, session, input);

		expect(session.prompt).toHaveBeenCalledWith("loop prompt", { attachments: undefined, streamingBehavior: "followUp" });
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("honors an explicit steer intent on the submission instead of forcing followUp", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async () => true),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: true,
		};
		const input = createInput({ text: "interrupt now", streamingBehavior: "steer" });

		await submitInteractiveInput(mode, session, input);

		expect(session.prompt).toHaveBeenCalledWith("interrupt now", {
			attachments: undefined,
			streamingBehavior: "steer",
		});
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("queues goal-continuation as followUp when streaming", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async () => true),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: true,
		};
		const input = createInput({ text: "continue goal", customType: "goal-continuation" });

		await submitInteractiveInput(mode, session, input);

		expect(session.prompt).not.toHaveBeenCalled();
		expect(session.promptCustomMessage).toHaveBeenCalledWith(
			{
				customType: "goal-continuation",
				content: "continue goal",
				display: false,
				attribution: "agent",
			},
			{ streamingBehavior: "followUp" },
		);
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input, false);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("queues a plain submission as followUp when streaming", async () => {
		const mode = {
			markPendingSubmissionStarted: vi.fn(() => true),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async () => true),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: true,
		};
		const input = createInput({ text: "loop prompt" });

		await submitInteractiveInput(mode, session, input);

		expect(session.prompt).toHaveBeenCalledWith("loop prompt", { attachments: undefined, streamingBehavior: "followUp" });
		expect(session.promptCustomMessage).not.toHaveBeenCalled();
		expect(mode.finishPendingSubmission).toHaveBeenCalledWith(input, false);
		expect(mode.showError).not.toHaveBeenCalled();
	});

	it("admits a submission once when duplicate callbacks race a turn boundary", async () => {
		const admittedIds = new Set<string>();
		const journal: string[] = [];
		const mode = {
			markPendingSubmissionStarted: vi.fn((candidate: SubmittedUserInput) => {
				const id = candidate.submissionId;
				if (candidate.started || id === undefined || admittedIds.has(id)) return false;
				candidate.started = true;
				admittedIds.add(id);
				return true;
			}),
			finishPendingSubmission: vi.fn(),
			showError: vi.fn(),
			checkShutdownRequested: vi.fn(async () => {}),
		};
		const session = {
			prompt: vi.fn(async (text: string) => {
				journal.push(text);
				await Promise.resolve();
				return true;
			}),
			promptCustomMessage: vi.fn(async () => {}),
			isStreaming: false,
		};
		const input = createInput({ submissionId: "editor-submit-44", text: "go on" });

		await Promise.all([submitInteractiveInput(mode, session, input), submitInteractiveInput(mode, session, input)]);

		expect(mode.markPendingSubmissionStarted).toHaveBeenCalledTimes(2);
		expect(session.prompt).toHaveBeenCalledTimes(1);
		expect(journal).toEqual(["go on"]);
		expect(mode.showError).not.toHaveBeenCalled();
	});
});
