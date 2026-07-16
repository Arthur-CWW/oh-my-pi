export type AgentHubViewerSequenceAction =
	| { readonly kind: "unhandled" }
	| { readonly kind: "pending" }
	| { readonly kind: "cancelled" }
	| { readonly kind: "first-line" }
	| { readonly kind: "display-row-down" }
	| { readonly kind: "display-row-up" }
	| { readonly kind: "logical-down" }
	| { readonly kind: "logical-up" }
	| { readonly kind: "open-errors" }
	| { readonly kind: "open-messages" }
	| { readonly kind: "open-bookmarks" }
	| { readonly kind: "refresh" }
	| { readonly kind: "send" }
	| { readonly kind: "unknown"; readonly chord: string };

export interface AgentHubViewerSequenceOptions {
	readonly prefix: boolean;
	readonly down: boolean;
	readonly up: boolean;
	readonly displayRows: boolean;
	readonly interrupt: boolean;
}

/** Vim-style `g` prefix shared by every Hub lane.
 *
 * There is deliberately no timeout: `g` has no standalone action, so waiting
 * preserves intent without introducing a latency race. The owner renders the
 * pending continuations until a bound second key, Escape, or an unknown key.
 */
export class AgentHubViewerSequence {
	#pending = false;

	get isPending(): boolean {
		return this.#pending;
	}

	handle(keyData: string, options: AgentHubViewerSequenceOptions): AgentHubViewerSequenceAction {
		if (!this.#pending) {
			if (!options.prefix) return { kind: "unhandled" };
			this.#pending = true;
			return { kind: "pending" };
		}

		this.reset();
		if (options.interrupt) return { kind: "cancelled" };
		if (options.prefix) return { kind: "first-line" };
		if (options.down) return { kind: options.displayRows ? "display-row-down" : "logical-down" };
		if (options.up) return { kind: options.displayRows ? "display-row-up" : "logical-up" };
		switch (keyData) {
			case "x":
				return { kind: "open-errors" };
			case "m":
				return { kind: "open-messages" };
			case "b":
				return { kind: "open-bookmarks" };
			case "r":
				return { kind: "refresh" };
			case "s":
				return { kind: "send" };
			default:
				return { kind: "unknown", chord: `g${keyData}` };
		}
	}

	reset(): void {
		this.#pending = false;
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
