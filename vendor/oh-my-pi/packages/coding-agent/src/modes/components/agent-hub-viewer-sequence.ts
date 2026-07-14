export type AgentHubViewerSequenceAction =
	| { readonly kind: "unhandled" }
	| { readonly kind: "pending" }
	| { readonly kind: "cancelled" }
	| { readonly kind: "first-line" }
	| { readonly kind: "display-row-down" }
	| { readonly kind: "display-row-up" }
	| { readonly kind: "logical-down" }
	| { readonly kind: "logical-up" };

export interface AgentHubViewerSequenceOptions {
	readonly prefix: boolean;
	readonly down: boolean;
	readonly up: boolean;
	readonly displayRows: boolean;
	readonly interrupt: boolean;
}

const DEFAULT_PREFIX_TIMEOUT_MS = 750;

/** Vim-style `g` prefix shared by Hub viewer lanes. */
export class AgentHubViewerSequence {
	#pendingUntil = 0;

	constructor(private readonly prefixTimeoutMs = DEFAULT_PREFIX_TIMEOUT_MS) {}

	handle(
		_keyData: string,
		options: AgentHubViewerSequenceOptions,
		nowMs = Date.now(),
	): AgentHubViewerSequenceAction {
		if (this.#pendingUntil !== 0 && nowMs >= this.#pendingUntil) this.reset();
		if (this.#pendingUntil === 0) {
			if (!options.prefix) return { kind: "unhandled" };
			this.#pendingUntil = nowMs + this.prefixTimeoutMs;
			return { kind: "pending" };
		}

		this.reset();
		if (options.interrupt) return { kind: "cancelled" };
		if (options.prefix) return { kind: "first-line" };
		if (options.down) return { kind: options.displayRows ? "display-row-down" : "logical-down" };
		if (options.up) return { kind: options.displayRows ? "display-row-up" : "logical-up" };
		return { kind: "cancelled" };
	}

	reset(): void {
		this.#pendingUntil = 0;
	}
}

/** Apply a viewer sequence motion to the display-row scroll offset. */
export function applyAgentHubViewerSequenceAction(
	offset: number,
	maxScroll: number,
	action: AgentHubViewerSequenceAction,
): number {
	const boundedMax = Math.max(0, maxScroll);
	switch (action.kind) {
		case "first-line":
			return 0;
		case "display-row-down":
		case "logical-down":
			return Math.min(Math.max(0, offset) + 1, boundedMax);
		case "display-row-up":
		case "logical-up":
			return Math.max(0, Math.min(offset, boundedMax) - 1);
		default:
			return Math.max(0, Math.min(offset, boundedMax));
	}
}
