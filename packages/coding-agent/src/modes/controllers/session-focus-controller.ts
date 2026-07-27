/**
 * SessionFocusController - Weak retargeting primitive between the rendering/
 * input layer and the AgentSession it displays.
 *
 * Focusing re-points the transcript, streaming event subscription, status
 * line, and editor prompt/interrupt at a subagent's live AgentSession (from
 * AgentRegistry) without touching the main session underneath; unfocusing
 * re-attaches the main session and rebuilds the transcript from its
 * authoritative state.
 */

import { AgentLifecycleManager } from "../../registry/agent-lifecycle";
import { AgentRegistry, MAIN_AGENT_ID, type RegistryEvent } from "../../registry/agent-registry";
import type { AgentSession } from "../../session/agent-session";
import type { InteractiveModeContext } from "../types";

export class SessionFocusController {
	#focusedAgentId: string | undefined;
	/** Session currently attached while focused; undefined when unfocused. */
	#attachedSession: AgentSession | undefined;
	#pendingFocus: { id: string | undefined; session: AgentSession } | undefined;
	#registryUnsubscribe: (() => void) | undefined;
	#transition: Promise<void> = Promise.resolve();
	#mainAttachmentFailed = false;
	#drafts = new Map<AgentSession, { text: string; cursor: { line: number; col: number } }>();

	constructor(
		private ctx: InteractiveModeContext,
		private registry: AgentRegistry = AgentRegistry.global(),
		private lifecycle: () => AgentLifecycleManager = () => AgentLifecycleManager.global(),
	) {}

	get focusedAgentId(): string | undefined {
		return this.#pendingFocus?.id ?? this.#focusedAgentId;
	}

	/** Focused live session, undefined when unfocused. */
	get target(): AgentSession | undefined {
		return this.#pendingFocus?.session ?? this.#attachedSession;
	}

	/** Focus the main view on an agent's live session. Throws an Error with a user-displayable message. */
	focusAgent(id: string): Promise<void> {
		if (this.ctx.collabGuest) return Promise.reject(new Error("Viewing agents is unavailable in a collab session."));
		if (id === MAIN_AGENT_ID) return this.unfocus();
		return this.#serialize(() => this.#focusAgent(id));
	}

	/** Focus the focused agent's parent agent, falling back to the main session. No-op when unfocused. */
	focusParent(): Promise<void> {
		return this.#serialize(async () => {
			const focusedId = this.#focusedAgentId;
			if (!focusedId) {
				if (this.#mainAttachmentFailed) await this.#restoreMain();
				return;
			}
			const parentId = this.registry.get(focusedId)?.parentId;
			const parent = parentId && parentId !== MAIN_AGENT_ID ? this.registry.get(parentId) : undefined;
			if (parent && parent.status !== "parked" && parent.status !== "aborted") {
				await this.#focusAgent(parent.id);
				return;
			}
			await this.#unfocus();
		});
	}

	/** Return to the main session. No-op when unfocused. */
	unfocus(): Promise<void> {
		return this.#serialize(() => this.#unfocus());
	}

	dispose(): void {
		this.#registryUnsubscribe?.();
		this.#registryUnsubscribe = undefined;
	}

	#serialize(operation: () => Promise<void>): Promise<void> {
		const result = this.#transition.then(operation, operation);
		this.#transition = result.catch(() => {});
		return result;
	}

	async #focusAgent(id: string): Promise<void> {
		const session = await this.lifecycle().ensureLive(id);
		if (id === this.#focusedAgentId && session === this.#attachedSession) return;

		const previousId = this.#focusedAgentId;
		const previousSession = this.#attachedSession;
		this.#saveDraft(previousSession ?? this.ctx.session);
		try {
			await this.#attach(session, id);
			this.#focusedAgentId = id;
			this.#attachedSession = session;
			this.#registryUnsubscribe ??= this.registry.onChange(event => this.#onRegistryEvent(event));
			const dismissKey = this.ctx.keybindings.getDisplayString("ui.dismiss");
			this.ctx.showStatus(`Viewing agent ${id} — ${dismissKey} returns to main, Alt+Shift+← returns to parent`);
		} catch (error) {
			const failure = this.#asError(error as object);
			this.#focusedAgentId = previousId;
			this.#attachedSession = previousSession;
			throw failure;
		}
	}

	async #unfocus(): Promise<void> {
		if (!this.#attachedSession && !this.#mainAttachmentFailed) return;
		const previous = this.#attachedSession;
		let draftError: Error | undefined;
		try {
			this.#saveDraft(previous);
		} catch (error) {
			draftError = this.#asError(error as object);
		}

		// Keep the committed focus until the main session has attached. #attach
		// rolls the visible UI back to this session on failure; clearing here
		// would leave its live subscription attached while the controller claimed
		// to be unfocused, stranding parent navigation.
		await this.#restoreMain();
		this.#focusedAgentId = undefined;
		this.#attachedSession = undefined;
		if (draftError) {
			throw draftError;
		}
		this.ctx.showStatus("Returned to main session");
	}

	async #restoreMain(): Promise<void> {
		try {
			await this.#attach(this.ctx.session, undefined);
			this.#mainAttachmentFailed = false;
		} catch (error) {
			this.#mainAttachmentFailed = true;
			throw this.#asError(error as object);
		}
	}

	#onRegistryEvent(event: RegistryEvent): void {
		if (event.ref.id !== this.#focusedAgentId) return;
		const gone = event.type === "removed";
		const dead = event.type === "status_changed" && (event.ref.status === "parked" || event.ref.status === "aborted");
		if (!gone && !dead) return;
		void this.unfocus()
			.then(() => {
				this.ctx.showStatus(
					`Agent ${event.ref.id} is ${gone ? "gone" : event.ref.status}; returned to main session`,
				);
			})
			.catch(error => {
				const failure = this.#asError(error as object);
				this.ctx.showError(`Could not return to the main session. ${this.#message(failure)}`);
			});
	}

	#saveDraft(session: AgentSession | undefined): void {
		if (!session || !this.ctx.editor) return;
		this.#drafts.set(session, { text: this.ctx.editor.getText(), cursor: this.ctx.editor.getCursor() });
	}

	#restoreDraft(session: AgentSession): void {
		if (!this.ctx.editor) return;
		const draft = this.#drafts.get(session);
		this.ctx.editor.setText(draft?.text ?? "");
		if (!draft) return;

		for (let line = this.ctx.editor.getCursor().line; line > draft.cursor.line; line--) {
			this.ctx.editor.handleInput("\x1b[A");
		}
		this.ctx.editor.handleInput("\x1b[H");
		while (this.ctx.editor.getCursor().col < draft.cursor.col) {
			const cursor = this.ctx.editor.getCursor();
			this.ctx.editor.handleInput("\x1b[C");
			if (this.ctx.editor.getCursor().col === cursor.col) break;
		}
	}

	/** Acquire a replacement subscription before disposing the current one. */
	async #attach(target: AgentSession, focusedAgentId: string | undefined): Promise<void> {
		const previousUnsubscribe = this.ctx.unsubscribe;
		const previousSession = this.#attachedSession;
		const previousId = this.#focusedAgentId;
		let replacementUnsubscribe: (() => void) | undefined;

		try {
			let assistantStreamSynced = false;
			replacementUnsubscribe = target.subscribe(async event => {
				if (event.type === "message_start" && event.message.role === "assistant") {
					assistantStreamSynced = true;
				} else if (
					event.type === "message_update" &&
					event.message.role === "assistant" &&
					!assistantStreamSynced
				) {
					assistantStreamSynced = true;
					await this.ctx.eventController.handleEvent({ type: "message_start", message: event.message });
				}
				await this.ctx.eventController.handleEvent(event);
			});

			this.#pendingFocus = { id: focusedAgentId, session: target };
			this.ctx.clearTransientSessionUi();
			this.ctx.eventController.resetTranscriptAnchors();
			this.ctx.statusLine.setSession(target, focusedAgentId);
			this.ctx.renderInitialMessages({ clearTerminalHistory: true });
			if (target.isStreaming) await this.ctx.eventController.handleEvent({ type: "agent_start" });
			this.ctx.updateEditorBorderColor();
			this.#restoreDraft(target);
			this.ctx.ui.requestRender();
		} catch (error) {
			const failure = this.#asError(error as object);
			this.#pendingFocus = undefined;
			replacementUnsubscribe?.();
			this.#restoreVisibleAttachment(previousSession ?? this.ctx.session, previousId);
			throw failure;
		}

		this.#pendingFocus = undefined;
		this.ctx.unsubscribe = replacementUnsubscribe;
		try {
			previousUnsubscribe?.();
		} catch (error) {
			const failure = this.#asError(error as object);
			this.ctx.showError(`The previous session could not detach. ${this.#message(failure)}`);
		}
	}

	#restoreVisibleAttachment(session: AgentSession, focusedAgentId: string | undefined): void {
		this.ctx.statusLine.setSession(session, focusedAgentId);
		this.ctx.clearTransientSessionUi();
		this.ctx.eventController.resetTranscriptAnchors();
		this.ctx.renderInitialMessages({ clearTerminalHistory: true });
		this.ctx.updateEditorBorderColor();
		this.#restoreDraft(session);
		this.ctx.ui.requestRender();
	}

	#asError(error: Error): Error;
	#asError(error: object): Error;
	#asError(error: Error | object): Error {
		return error instanceof Error ? error : new Error("Unexpected focus transition failure");
	}

	#message(error: Error): string {
		return error.message;
	}
}
