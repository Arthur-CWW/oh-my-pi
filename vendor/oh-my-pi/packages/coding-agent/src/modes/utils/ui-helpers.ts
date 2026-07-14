import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, Usage } from "@oh-my-pi/pi-ai";
import { type Component, Spacer, Text, TruncatedText } from "@oh-my-pi/pi-tui";
import type { AdvisorMessageDetails } from "../../advisor";
import { COLLAB_PROMPT_MESSAGE_TYPE } from "../../collab/protocol";
import { settings } from "../../config/settings";
import { getFileSnapshotStore } from "../../edit/file-snapshot-store";
import { createAdvisorMessageCard } from "../../modes/components/advisor-message";
import { AssistantMessageComponent } from "../../modes/components/assistant-message";
import { createBackgroundTanDispatchBlock } from "../../modes/components/background-tan-message";
import { BashExecutionComponent } from "../../modes/components/bash-execution";
import { BranchSummaryMessageComponent } from "../../modes/components/branch-summary-message";
import { CollabPromptMessageComponent } from "../../modes/components/collab-prompt-message";
import {
	CompactionSummaryMessageComponent,
	createHandoffSummaryMessageComponent,
} from "../../modes/components/compaction-summary-message";
import { CustomMessageComponent } from "../../modes/components/custom-message";
import { DynamicBorder } from "../../modes/components/dynamic-border";
import { EvalExecutionComponent } from "../../modes/components/eval-execution";
import {
	type LateDiagnosticsFile,
	LateDiagnosticsMessageComponent,
} from "../../modes/components/late-diagnostics-message";
import {
	ReadToolGroupComponent,
	readArgsHaveTarget,
	readArgsTargetInternalUrl,
} from "../../modes/components/read-tool-group";
import { SkillMessageComponent } from "../../modes/components/skill-message";
import { ToolExecutionComponent } from "../../modes/components/tool-execution";
import { TranscriptBlock } from "../../modes/components/transcript-container";
import { createUsageRowBlock } from "../../modes/components/usage-row";
import { UserMessageComponent } from "../../modes/components/user-message";
import { materializeImageReferenceLinksSync } from "../../modes/image-references";
import { theme } from "../../modes/theme/theme";
import type { InteractiveModeContext } from "../../modes/types";
import {
	BACKGROUND_TAN_DISPATCH_MESSAGE_TYPE,
	type CustomMessage,
	isSilentAbort,
	LSP_LATE_DIAGNOSTIC_MESSAGE_TYPE,
	resolveAbortLabel,
	SKILL_PROMPT_MESSAGE_TYPE,
	type SkillPromptDetails,
} from "../../session/messages";
import type { SessionContext } from "../../session/session-context";
import { createIrcMessageCard } from "../../tools/irc";
import { formatBytes, formatDuration } from "../../tools/render-utils";
import { canonicalizeMessage, normalizeThinkingDisplay } from "../../utils/thinking-display";
import type { CollabPromptDetails } from "../collab-presentation-types";

type TextBlock = { type: "text"; text: string };
interface RenderInitialMessagesOptions {
	preserveExistingChat?: boolean;
	clearTerminalHistory?: boolean;
}

type QueuedMessages = {
	readonly steering: readonly string[];
	readonly followUp: readonly string[];
};

function imageLinksForMessage(
	message: Extract<AgentMessage, { role: "developer" | "user" }>,
	putBlobSync: InteractiveModeContext["sessionManager"]["putBlobSync"],
): (string | undefined)[] | undefined {
	if (typeof message.content === "string") return undefined;
	const images = message.content.filter(
		(content): content is ImageContent =>
			content.type === "image" && typeof content.data === "string" && typeof content.mimeType === "string",
	);
	return materializeImageReferenceLinksSync(images, putBlobSync);
}

export class UiHelpers {
	constructor(private ctx: InteractiveModeContext) {}

	/** Extract text content from a user message */
	getUserMessageText(message: Message): string {
		if (message.role !== "user") return "";
		const textBlocks =
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.filter((content): content is TextBlock => content.type === "text");
		return textBlocks.map(block => block.text).join("");
	}

	/**
	 * Show a status message in the chat.
	 *
	 * If multiple status messages are emitted back-to-back (without anything else being added to the chat),
	 * we update the previous status line instead of appending new ones to avoid log spam.
	 */
	showStatus(message: string, options?: { dim?: boolean }): void {
		const children = this.ctx.chatContainer.children;
		const last = children.length > 0 ? children[children.length - 1] : undefined;
		const secondLast = children.length > 1 ? children[children.length - 2] : undefined;
		const useDim = options?.dim ?? true;
		const rendered = useDim ? theme.fg("dim", message) : message;

		if (last && secondLast && last === this.ctx.lastStatusText && secondLast === this.ctx.lastStatusSpacer) {
			this.ctx.lastStatusText.setText(rendered);
			this.ctx.ui.requestRender();
			return;
		}

		const spacer = new Spacer(1);
		const text = new Text(rendered, 1, 0);
		this.ctx.present([spacer, text]);
		this.ctx.lastStatusSpacer = spacer;
		this.ctx.lastStatusText = text;
	}

	addMessageToChat(
		message: AgentMessage,
		options?: { populateHistory?: boolean; imageLinks?: readonly (string | undefined)[] },
	): Component[] {
		switch (message.role) {
			case "bashExecution": {
				const component = new BashExecutionComponent(message.command, this.ctx.ui, message.excludeFromContext);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(message.exitCode, message.cancelled, {
					truncation: message.meta?.truncation,
				});
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "pythonExecution": {
				const component = new EvalExecutionComponent(message.code, this.ctx.ui, message.excludeFromContext);
				if (message.output) {
					component.appendOutput(message.output);
				}
				component.setComplete(message.exitCode, message.cancelled, {
					truncation: message.meta?.truncation,
				});
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "hookMessage":
			case "custom": {
				if (message.display) {
					if (message.customType === "async-result") {
						const details = (
							message as CustomMessage<{
								jobId?: string;
								type?: "bash" | "task";
								label?: string;
								durationMs?: number;
								jobs?: Array<{
									jobId?: string;
									type?: "bash" | "task";
									label?: string;
									durationMs?: number;
								}>;
							}>
						).details;
						const jobs =
							details?.jobs && details.jobs.length > 0
								? details.jobs
								: [
										{
											jobId: details?.jobId,
											type: details?.type,
											label: details?.label,
											durationMs: details?.durationMs,
										},
									];
						const block = new TranscriptBlock();
						for (const job of jobs) {
							const jobId = job.jobId ?? "unknown";
							const typeLabel = job.type ? `[${job.type}]` : "[job]";
							const duration = typeof job.durationMs === "number" ? formatDuration(job.durationMs) : undefined;
							const line = [
								theme.fg("success", `${theme.status.done} Background job completed`),
								theme.fg("dim", typeLabel),
								theme.fg("accent", jobId),
								duration ? theme.fg("dim", `(${duration})`) : undefined,
							]
								.filter(Boolean)
								.join(" ");
							block.addChild(new Text(line, 1, 0));
						}
						this.ctx.chatContainer.addChild(block);
						break;
					}
					if (message.customType === LSP_LATE_DIAGNOSTIC_MESSAGE_TYPE) {
						const details = (
							message as CustomMessage<{
								files?: LateDiagnosticsFile[];
							}>
						).details;
						const component = new LateDiagnosticsMessageComponent(details?.files ?? []);
						component.setExpanded(this.ctx.toolOutputExpanded);
						this.ctx.chatContainer.addChild(component);
						break;
					}
					if (message.customType === COLLAB_PROMPT_MESSAGE_TYPE) {
						const component = new CollabPromptMessageComponent(message as CustomMessage<CollabPromptDetails>);
						this.ctx.chatContainer.addChild(component);
						break;
					}
					if (message.customType === SKILL_PROMPT_MESSAGE_TYPE) {
						const component = new SkillMessageComponent(message as CustomMessage<SkillPromptDetails>);
						component.setExpanded(this.ctx.toolOutputExpanded);
						this.ctx.chatContainer.addChild(component);
						break;
					}
					if (
						message.customType === "irc:incoming" ||
						message.customType === "irc:autoreply" ||
						message.customType === "irc:relay"
					) {
						const details = (
							message as CustomMessage<{
								from?: string;
								to?: string;
								message?: string;
								body?: string;
								replyTo?: string;
							}>
						).details;
						const kind =
							message.customType === "irc:incoming"
								? ("incoming" as const)
								: message.customType === "irc:autoreply"
									? ("autoreply" as const)
									: ("relay" as const);
						const card = createIrcMessageCard(
							{
								kind,
								from: details?.from,
								to: details?.to,
								body: kind === "incoming" ? details?.message : details?.body,
								replyTo: details?.replyTo,
								timestamp: message.timestamp,
							},
							() => this.ctx.toolOutputExpanded,
							theme,
							() => this.ctx.transcriptWrap,
						);
						this.ctx.chatContainer.addChild(card);
						return [card];
					}
					if (message.customType === "advisor") {
						const details = (message as CustomMessage<AdvisorMessageDetails>).details;
						this.ctx.chatContainer.addChild(
							createAdvisorMessageCard(details, () => this.ctx.toolOutputExpanded, theme),
						);
						break;
					}
					if (message.customType === BACKGROUND_TAN_DISPATCH_MESSAGE_TYPE) {
						this.ctx.chatContainer.addChild(createBackgroundTanDispatchBlock(message as CustomMessage<unknown>));
						break;
					}
					const handoffComponent = createHandoffSummaryMessageComponent(
						message as CustomMessage<unknown>,
						this.ctx.toolOutputExpanded,
					);
					if (handoffComponent) {
						this.ctx.chatContainer.addChild(handoffComponent);
						break;
					}
					const renderer = this.ctx.viewSession.extensionRunner?.getMessageRenderer(message.customType);
					// Both HookMessage and CustomMessage have the same structure, cast for compatibility
					const component = new CustomMessageComponent(message as CustomMessage<unknown>, renderer);
					component.setExpanded(this.ctx.toolOutputExpanded);
					this.ctx.chatContainer.addChild(component);
				}
				break;
			}
			case "compactionSummary": {
				const component = new CompactionSummaryMessageComponent(message);
				component.setExpanded(this.ctx.toolOutputExpanded);
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "branchSummary": {
				const component = new BranchSummaryMessageComponent(message);
				component.setExpanded(this.ctx.toolOutputExpanded);
				this.ctx.chatContainer.addChild(component);
				break;
			}
			case "fileMention": {
				// Render compact file mention display
				const block = new TranscriptBlock();
				for (const file of message.files) {
					let suffix: string;
					if (file.skippedReason === "tooLarge") {
						const size = typeof file.byteSize === "number" ? formatBytes(file.byteSize) : "unknown size";
						suffix = `(skipped: ${size})`;
					} else {
						suffix = file.image
							? "(image)"
							: file.lineCount === undefined
								? "(unknown lines)"
								: `(${file.lineCount} lines)`;
					}
					const text = `${theme.fg("dim", `${theme.tree.last} `)}${theme.fg("muted", "Read")} ${theme.fg(
						"accent",
						file.path,
					)} ${theme.fg("dim", suffix)}`;
					block.addChild(new Text(text, 0, 0));
				}
				if (block.children.length > 0) this.ctx.chatContainer.addChild(block);
				break;
			}
			case "user":
			case "developer": {
				const textContent = this.ctx.getUserMessageText(message);
				if (textContent) {
					const isSynthetic = message.role === "developer" ? true : (message.synthetic ?? false);
					const imageLinks =
						options?.imageLinks ??
						imageLinksForMessage(
							message,
							this.ctx.viewSession.sessionManager.putBlobSync.bind(this.ctx.viewSession.sessionManager),
						);
					const userComponent = new UserMessageComponent(
						textContent,
						isSynthetic,
						imageLinks,
						this.ctx.richTranscript,
					);
					this.ctx.chatContainer.addChild(userComponent);
					if (options?.populateHistory && message.role === "user" && !isSynthetic) {
						this.ctx.editor.addToHistory(textContent);
					}
				}
				break;
			}
			case "assistant": {
				let assistantComponent!: AssistantMessageComponent;
				assistantComponent = new AssistantMessageComponent(
					message,
					this.ctx.hideThinkingBlock,
					() => this.ctx.ui.requestComponentRender(assistantComponent),
					this.ctx.viewSession.extensionRunner?.getAssistantThinkingRenderers(),
					this.ctx.ui.imageBudget,
					this.ctx.richTranscript,
				);
				this.ctx.chatContainer.addChild(assistantComponent);
				break;
			}
			case "toolResult": {
				// Tool results are rendered inline with tool calls, handled separately
				break;
			}
			default: {
				message satisfies never;
			}
		}
		return [];
	}

	/**
	 * Render session context to chat. Used for initial load and rebuild after compaction.
	 * @param sessionContext Session context to render
	 * @param options.updateFooter Update footer state
	 * @param options.populateHistory Add user messages to editor history
	 */
	renderSessionContext(
		sessionContext: SessionContext,
		options: { updateFooter?: boolean; populateHistory?: boolean } = {},
	): void {
		// Preserved: message_start handler owns this lifecycle (see #783)
		this.ctx.pendingTools.clear();

		if (options.updateFooter) {
			this.ctx.statusLine.invalidate();
			this.ctx.updateEditorBorderColor();
		}

		let readGroup: ReadToolGroupComponent | null = null;
		const readToolCallArgs = new Map<string, Record<string, unknown>>();
		const readToolCallAssistantComponents = new Map<string, AssistantMessageComponent>();
		// The per-turn token-usage row (display.showTokenUsage) must land below the
		// turn's tool blocks. Read tool blocks are only created when their toolResult
		// message is processed (below), so appending the row in the assistant branch
		// would place it above a read run. Defer instead: stash the usage on the
		// assistant message, then flush it once the turn's tools are placed — right
		// before the next non-toolResult message and at end of rebuild — sealing the
		// read run so the row sits under it. Mirrors the live path, where the read
		// group is created during streaming and the row is appended below it.
		let pendingUsage: Usage | undefined;
		const flushPendingUsage = () => {
			if (!pendingUsage) return;
			readGroup?.seal();
			readGroup = null;
			this.ctx.chatContainer.addChild(createUsageRowBlock(pendingUsage));
			pendingUsage = undefined;
		};
		// Rebuild-time mirror of the event controller's displaceable-poll
		// bookkeeping: a `job` poll that found every watched job still running is
		// superseded by the next `job` call, so a rebuilt transcript collapses a
		// repeated-poll run to its final snapshot instead of replaying the spam.
		let waitingPoll: ToolExecutionComponent | null = null;
		const resolveWaitingPoll = (nextToolName?: string) => {
			const previous = waitingPoll;
			if (!previous) return;
			waitingPoll = null;
			if (nextToolName === "job" && previous.isDisplaceableBlock()) {
				this.ctx.chatContainer.removeChild(previous);
			}
			// Sealing freezes the block and stops the waiting-poll spinner that
			// updateResult armed.
			previous.seal();
		};
		for (const message of sessionContext.messages) {
			if (message.role !== "toolResult") flushPendingUsage();
			// Assistant messages need special handling for tool calls
			if (message.role === "assistant") {
				this.ctx.addMessageToChat(message);
				const lastChild = this.ctx.chatContainer.children[this.ctx.chatContainer.children.length - 1];
				const assistantComponent = lastChild instanceof AssistantMessageComponent ? lastChild : undefined;
				const hasVisibleAssistantContent = message.content.some(
					content =>
						(content.type === "text" && canonicalizeMessage(content.text)) ||
						(content.type === "thinking" && normalizeThinkingDisplay(content.thinking)),
				);
				if (hasVisibleAssistantContent) {
					// Rebuild reconstructs immutable history; seal (not finalize) so the
					// group freezes even if a read's result was never persisted —
					// finalize alone keeps a pending entry live and would stop the whole
					// transcript below it from committing to native scrollback.
					readGroup?.seal();
					readGroup = null;
				}
				const isAbortedSilently = message.stopReason === "aborted" && isSilentAbort(message.errorMessage);
				const hasErrorStop =
					!isAbortedSilently && (message.stopReason === "aborted" || message.stopReason === "error");
				const errorMessage = hasErrorStop
					? message.stopReason === "aborted"
						? resolveAbortLabel(message.errorMessage, this.ctx.viewSession.retryAttempt)
						: message.errorMessage || "Error"
					: null;

				// Render tool call components
				for (const content of message.content) {
					if (content.type !== "toolCall") {
						continue;
					}
					resolveWaitingPoll(content.name);

					if (
						content.name === "read" &&
						readArgsHaveTarget(content.arguments) &&
						!readArgsTargetInternalUrl(content.arguments)
					) {
						if (hasErrorStop && errorMessage) {
							if (!readGroup) {
								readGroup = new ReadToolGroupComponent({
									showContentPreview: this.ctx.settings.get("read.toolResultPreview"),
								});
								readGroup.setExpanded(this.ctx.toolOutputExpanded);
								this.ctx.chatContainer.addChild(readGroup);
							}
							readGroup.updateArgs(content.arguments, content.id);
							readGroup.updateResult(
								{ content: [{ type: "text", text: errorMessage }], isError: true },
								false,
								content.id,
							);
						} else {
							const normalizedArgs =
								content.arguments && typeof content.arguments === "object" && !Array.isArray(content.arguments)
									? (content.arguments as Record<string, unknown>)
									: {};
							readToolCallArgs.set(content.id, normalizedArgs);
							if (assistantComponent) {
								readToolCallAssistantComponents.set(content.id, assistantComponent);
							}
						}
						continue;
					}

					readGroup?.seal();
					readGroup = null;
					const tool = this.ctx.viewSession.getToolByName(content.name);
					const renderArgs =
						"partialJson" in content
							? { ...content.arguments, __partialJson: content.partialJson }
							: content.arguments;
					const component = new ToolExecutionComponent(
						content.name,
						renderArgs,
						{
							snapshots: getFileSnapshotStore(this.ctx.viewSession),
							showImages: settings.get("terminal.showImages"),
							editFuzzyThreshold: settings.get("edit.fuzzyThreshold"),
							editAllowFuzzy: settings.get("edit.fuzzyMatch"),
							liveRegion: this.ctx.chatContainer,
						},
						tool,
						this.ctx.ui,
						this.ctx.viewSession.sessionManager.getCwd(),
						content.id,
					);
					component.setExpanded(this.ctx.toolOutputExpanded);
					this.ctx.chatContainer.addChild(component);

					if (hasErrorStop && errorMessage) {
						component.updateResult(
							{ content: [{ type: "text", text: errorMessage }], isError: true },
							false,
							content.id,
						);
					} else {
						this.ctx.pendingTools.set(content.id, component);
					}
				}
				pendingUsage = this.ctx.settings.get("display.showTokenUsage") ? message.usage : undefined;
			} else if (message.role === "toolResult") {
				const pendingReadComponent = this.ctx.pendingTools.get(message.toolCallId);
				const isReadGroupResult =
					message.toolName === "read" &&
					(!pendingReadComponent || pendingReadComponent instanceof ReadToolGroupComponent);
				if (isReadGroupResult) {
					const assistantComponent = readToolCallAssistantComponents.get(message.toolCallId);
					const images: ImageContent[] = message.content.filter(
						(content): content is ImageContent => content.type === "image",
					);
					if (images.length > 0 && assistantComponent && settings.get("terminal.showImages")) {
						assistantComponent.setToolResultImages(message.toolCallId, images);
						const hasText = message.content.some(c => c.type === "text");
						if (!hasText) {
							readToolCallArgs.delete(message.toolCallId);
							readToolCallAssistantComponents.delete(message.toolCallId);
							continue;
						}
					}
					let component = this.ctx.pendingTools.get(message.toolCallId);
					if (!component) {
						if (!readGroup) {
							readGroup = new ReadToolGroupComponent({
								showContentPreview: this.ctx.settings.get("read.toolResultPreview"),
							});
							readGroup.setExpanded(this.ctx.toolOutputExpanded);
							this.ctx.chatContainer.addChild(readGroup);
						}
						const args = readToolCallArgs.get(message.toolCallId);
						if (args) {
							readGroup.updateArgs(args, message.toolCallId);
						}
						component = readGroup;
						this.ctx.pendingTools.set(message.toolCallId, readGroup);
					}
					component.updateResult(message, false, message.toolCallId);
					this.ctx.pendingTools.delete(message.toolCallId);
					readToolCallArgs.delete(message.toolCallId);
					readToolCallAssistantComponents.delete(message.toolCallId);
					continue;
				}

				// Match tool results to pending tool components
				const component = this.ctx.pendingTools.get(message.toolCallId);
				if (component) {
					component.updateResult(message, false, message.toolCallId);
					this.ctx.pendingTools.delete(message.toolCallId);
					if (
						message.toolName === "job" &&
						component instanceof ToolExecutionComponent &&
						component.isDisplaceableBlock()
					) {
						waitingPoll = component;
					}
				}
			} else {
				// A user prompt closes the displacement window, same as the live path.
				if (message.role === "user") resolveWaitingPoll();
				// All other messages use standard rendering
				this.ctx.addMessageToChat(message, options);
			}
		}
		flushPendingUsage();

		// The trailing read run has no following break to close it; seal so the
		// rebuilt group freezes (even with a never-persisted result) and commits to
		// native scrollback like every other historical block.
		readGroup?.seal();
		// A trailing waiting poll is final history on rebuild; seal it so it
		// freezes (and its spinner timer stops) like every other block.
		resolveWaitingPoll();

		this.ctx.pendingTools.clear();
		this.ctx.ui.requestRender();
	}

	renderInitialMessages(options: RenderInitialMessagesOptions = {}): void {
		// This path is used to rebuild the visible chat transcript (e.g. after custom/debug UI).
		// Clear existing rendered chat first to avoid duplicating the full session in the container.
		// On a non-preserving rebuild the existing blocks are discarded for good, so
		// dispose them (stopping any live timers/subscriptions) before clearing. When
		// preserving, the same instances are re-added below, so detach without dispose.
		const preservedChatChildren = options.preserveExistingChat ? this.ctx.chatContainer.children : undefined;
		if (preservedChatChildren) {
			this.ctx.chatContainer.clear();
		} else {
			this.ctx.resetTranscript();
		}
		this.ctx.pendingMessagesContainer.clear();
		this.ctx.pendingBashComponents = [];
		this.ctx.pendingPythonComponents = [];

		// Display always uses the full-history transcript: compactions show as
		// inline dividers instead of restarting the visible conversation.
		const context = this.ctx.viewSession.buildTranscriptSessionContext();
		this.ctx.renderSessionContext(context, {
			updateFooter: true,
			populateHistory: !this.ctx.focusedAgentId,
		});

		// Show compaction info if session was compacted
		const allEntries = this.ctx.viewSession.sessionManager.getEntries();
		let compactionCount = 0;
		for (const entry of allEntries) {
			if (entry.type === "compaction") {
				compactionCount++;
			}
		}
		if (compactionCount > 0) {
			const times = compactionCount === 1 ? "1 time" : `${compactionCount} times`;
			this.ctx.showStatus(`Session compacted ${times}`);
		}
		if (options.clearTerminalHistory) {
			this.ctx.ui.requestRender(true, { clearScrollback: true });
		}
		if (preservedChatChildren && preservedChatChildren.length > 0) {
			for (const child of preservedChatChildren) {
				this.ctx.chatContainer.addChild(child);
			}
			this.ctx.ui.requestRender();
		}
	}

	clearEditor(): void {
		this.ctx.editor.setText("");
		this.ctx.pendingImages = [];
		this.ctx.pendingImageLinks = [];
		this.ctx.editor.imageLinks = undefined;
		this.ctx.ui.requestRender();
	}

	showError(errorMessage: string): void {
		this.ctx.present([
			new Spacer(1),
			new Text(theme.fg("error", `Error: ${errorMessage}`), 1, 0),
			new Text(theme.fg("dim", `(/errors for history)`), 1, 0),
		]);
	}

	showWarning(warningMessage: string): void {
		this.ctx.present([new Spacer(1), new Text(theme.fg("warning", `Warning: ${warningMessage}`), 1, 0)]);
	}

	showNewVersionNotification(newVersion: string): void {
		const block = new TranscriptBlock();
		block.addChild(new DynamicBorder(text => theme.fg("warning", text)));
		block.addChild(
			new Text(
				theme.bold(theme.fg("warning", "Update Available")) +
					"\n" +
					theme.fg("muted", `New version ${newVersion} is available. Run: `) +
					theme.fg("accent", "omp update"),
				1,
				0,
			),
		);
		block.addChild(new DynamicBorder(text => theme.fg("warning", text)));
		this.ctx.present(block);
	}

	updatePendingMessagesDisplay(): void {
		this.ctx.pendingMessagesContainer.clear();
		// An admitted or running durable item already owns the live turn and is
		// rendered as the user transcript message. Only work not yet delivered
		// belongs in the pending queue, otherwise one physical submit appears twice.
		const durableProjection = this.ctx.viewSession
			.getQueuedInputProjection()
			.toSorted((left, right) => left.sequence - right.sequence);
		const durableSummary = (input: (typeof durableProjection)[number]): string =>
			"text" in input.payload ? input.payload.text : `[${input.payload.message.customType}]`;
		const durablePayloadCounts = new Map<string, number>();
		for (const input of durableProjection) {
			const key = `${input.deliveryClass}\0${durableSummary(input)}`;
			durablePayloadCounts.set(key, (durablePayloadCounts.get(key) ?? 0) + 1);
		}
		const durableInputs = durableProjection.filter(
			input =>
				input.state !== "admitted" &&
				input.state !== "running" &&
				input.state !== "completed" &&
				input.state !== "cancelled",
		);

		const legacyEntries: Array<{ deliveryClass: "steer" | "followUp"; text: string }> = [];
		const queuedMessages = this.ctx.viewSession.getQueuedMessages() as QueuedMessages;
		for (const [deliveryClass, messages] of [
			["steer", queuedMessages.steering],
			["followUp", queuedMessages.followUp],
		] as const) {
			for (const text of messages) {
				const key = `${deliveryClass}\0${text}`;
				const durablePayloadCount = durablePayloadCounts.get(key) ?? 0;
				if (durablePayloadCount > 0) {
					durablePayloadCounts.set(key, durablePayloadCount - 1);
					continue;
				}
				legacyEntries.push({ deliveryClass, text });
			}
		}

		const pendingCount = durableInputs.length + legacyEntries.length;
		if (pendingCount === 0) return;

		this.ctx.pendingMessagesContainer.addChild(new Spacer(1));
		this.ctx.pendingMessagesContainer.addChild(
			new TruncatedText(theme.fg("dim", `Pending inputs (${pendingCount}):`), 1, 0),
		);
		for (const input of durableInputs) {
			const imageMarker = input.payload.kind === "user" && input.payload.images?.length ? " [image]" : "";
			const queuedText = theme.fg(
				"dim",
				`#${input.sequence} ${input.deliveryClass} · ${input.state} · ${input.inputId.slice(0, 8)}: ${durableSummary(input)}${imageMarker}`,
			);
			this.ctx.pendingMessagesContainer.addChild(new TruncatedText(queuedText, 1, 0));
		}
		for (const entry of legacyEntries) {
			const queuedText = theme.fg("dim", `legacy ${entry.deliveryClass} · queued · core: ${entry.text}`);
			this.ctx.pendingMessagesContainer.addChild(new TruncatedText(queuedText, 1, 0));
		}
		const dequeueKey = this.ctx.keybindings.getDisplayString("app.message.dequeue") || "Alt+Up";
		const hintText = theme.fg("dim", `${theme.tree.hook} ${dequeueKey} to edit one item`);
		this.ctx.pendingMessagesContainer.addChild(new TruncatedText(hintText, 1, 0));
	}

	isKnownSlashCommand(text: string): boolean {
		if (!text.startsWith("/")) return false;
		const spaceIndex = text.indexOf(" ");
		const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
		if (!commandName) return false;
		if (this.ctx.session.extensionRunner?.getCommand(commandName)) return true;
		for (const command of this.ctx.session.customCommands) {
			if (command.command.name === commandName) return true;
		}
		return this.ctx.fileSlashCommands.has(commandName);
	}

	/** Move pending bash components from pending area to chat */
	flushPendingBashComponents(): void {
		for (const component of this.ctx.pendingBashComponents) {
			this.ctx.pendingMessagesContainer.removeChild(component);
			this.ctx.chatContainer.addChild(component);
		}
		this.ctx.pendingBashComponents = [];
		for (const component of this.ctx.pendingPythonComponents) {
			this.ctx.pendingMessagesContainer.removeChild(component);
			this.ctx.chatContainer.addChild(component);
		}
		this.ctx.pendingPythonComponents = [];
	}

	findLastAssistantMessage(): AssistantMessage | undefined {
		for (let i = this.ctx.viewSession.messages.length - 1; i >= 0; i--) {
			const message = this.ctx.viewSession.messages[i];
			if (message?.role === "assistant") {
				return message as AssistantMessage;
			}
		}
		return undefined;
	}

	extractAssistantText(message: AssistantMessage): string {
		let text = "";
		for (const content of message.content) {
			if (content.type === "text") {
				text += content.text;
			}
		}
		return text.trim();
	}
}
