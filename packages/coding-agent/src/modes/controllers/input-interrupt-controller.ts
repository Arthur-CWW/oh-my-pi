import { matchesKey } from "@oh-my-pi/pi-tui";
import { USER_INTERRUPT_LABEL } from "../../session/messages";
import type { InteractiveModeContext } from "../types";
import { diagnosticInputFromError } from "../utils/error-inbox";

// Double-tap ← on an empty editor opens the Agent Hub (and, in a focused
// subagent view, ←← returns to the main session). The lower bound rejects
// terminal-synthesized pointer bursts; the upper bound starts a new gesture.
const LEFT_DOUBLE_TAP_MIN_GAP_MS = 40;
const LEFT_DOUBLE_TAP_MAX_GAP_MS = 500;

export class InputInterruptController {
	#focusedLeftTapListenerInstalled = false;
	#leftTapCount = 0;

	constructor(
		private ctx: InteractiveModeContext,
		private restoreQueuedMessagesToEditor: () => Promise<void>,
	) {}

	installFocusedLeftTapListener(): void {
		if (this.#focusedLeftTapListenerInstalled) return;
		this.#focusedLeftTapListenerInstalled = true;
		this.ctx.ui.addInputListener(data => {
			if (!this.ctx.focusedAgentId) return undefined;
			if (!matchesKey(data, "left")) return undefined;
			if (this.ctx.editor.getText().trim()) return undefined;
			this.#handleFocusedLeftTap();
			return { consume: true };
		});
	}

	interrupt(): void {
		if (this.ctx.focusedAgentId) {
			this.#interruptFocusedAgent();
		} else {
			this.#interruptMainSession();
		}
	}

	unfocus(): void {
		this.#handleFocusPromise(this.ctx.unfocusSession(), "Failed to return to the main session");
	}

	returnToFocusedParent(): void {
		this.#handleFocusPromise(this.#returnToFocusedParent(), "Failed to return to the parent session");
	}

	handleLeftAtStart(): void {
		if (this.ctx.focusedAgentId) {
			this.#handleFocusedLeftTap();
			return;
		}
		if (this.#detectLeftDoubleTap()) {
			this.ctx.showAgentHub({ requireContent: true });
		}
	}

	#handleFocusedLeftTap(): void {
		if (this.#detectLeftDoubleTap()) this.unfocus();
	}

	#handleFocusPromise(promise: Promise<void>, message: string): void {
		void promise.catch(error => {
			this.ctx.showError(`${message}: ${error instanceof Error ? error.message : String(error)}`);
		});
	}

	#interruptFocusedAgent(): void {
		const id = this.ctx.focusedAgentId;
		if (!id) return;
		const target = this.ctx.viewSession;
		this.#handleFocusPromise(target.abort({ reason: USER_INTERRUPT_LABEL }), "Failed to interrupt the focused agent");
		this.#handleFocusPromise(
			this.#returnToFocusedParent(`Interrupted ${id}; returned to parent with draft preserved`),
			"Failed to return to the parent session",
		);
	}

	#interruptMainSession(): void {
		if (this.ctx.loopModeEnabled) this.ctx.pauseLoop();
		this.ctx.cancelPendingSubmission();
		void this.restoreQueuedMessagesToEditor().catch(error => {
			this.ctx.showError(diagnosticInputFromError(error, this.ctx.sessionManager.getSessionFile()));
		});
		void this.ctx.session.abort({ reason: USER_INTERRUPT_LABEL }).catch(error => {
			this.ctx.showError(diagnosticInputFromError(error, this.ctx.sessionManager.getSessionFile()));
		});
	}

	async #returnToFocusedParent(status = "Returned to parent with draft preserved"): Promise<void> {
		if (!this.ctx.focusedAgentId) return;
		await this.ctx.focusParentSession();
		this.ctx.showStatus(status);
	}

	/**
	 * Detect a deliberate double-← gesture, rejecting terminal-synthesized arrow
	 * bursts. Only the second tap in a human-plausible sequence fires.
	 */
	#detectLeftDoubleTap(): boolean {
		const now = Date.now();
		const sinceLast = now - this.ctx.lastLeftTapTime;
		this.ctx.lastLeftTapTime = now;
		if (sinceLast >= LEFT_DOUBLE_TAP_MAX_GAP_MS) {
			this.#leftTapCount = 1;
			return false;
		}
		this.#leftTapCount += 1;
		if (this.#leftTapCount === 2 && sinceLast >= LEFT_DOUBLE_TAP_MIN_GAP_MS) {
			this.#leftTapCount = 0;
			this.ctx.lastLeftTapTime = 0;
			return true;
		}
		return false;
	}
}
