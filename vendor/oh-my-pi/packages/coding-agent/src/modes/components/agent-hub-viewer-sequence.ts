export type AgentHubAttentionAction = "now" | "next" | "waiting" | "later" | "hidden" | "snooze" | "tags" | "bookmark" | "note";

export interface AgentHubAttentionTarget {
	readonly key: string;
	readonly label: string;
}

export type AgentHubViewerSequenceAction =
	| { readonly kind: "unhandled" }
	| { readonly kind: "pending" }
	| { readonly kind: "cancelled" }
	| { readonly kind: "first-line" }
	| { readonly kind: "display-row-down" }
	| { readonly kind: "display-row-up" }
	| { readonly kind: "logical-down" }
	| { readonly kind: "logical-up" }
	| { readonly kind: "attach-owner" }
	| { readonly kind: "open-errors" }
	| { readonly kind: "open-messages" }
	| { readonly kind: "open-bookmarks" }
	| { readonly kind: "refresh" }
	| { readonly kind: "send" }
	| { readonly kind: "open-triage"; readonly target: AgentHubAttentionTarget }
	| { readonly kind: "stage-attention"; readonly target: AgentHubAttentionTarget; readonly action: AgentHubAttentionAction }
	| { readonly kind: "commit-attention"; readonly target: AgentHubAttentionTarget; readonly action: AgentHubAttentionAction }
	| { readonly kind: "unknown"; readonly chord: string };

export interface AgentHubViewerSequenceOptions {
	readonly prefix: boolean;
	readonly down: boolean;
	readonly up: boolean;
	readonly displayRows: boolean;
	readonly dismiss: boolean;
	readonly target?: AgentHubAttentionTarget;
	readonly enter?: boolean;
	readonly attentionAction?: AgentHubAttentionAction;
}

export interface AgentHubViewerSequenceModel {
	readonly pendingG: boolean;
	readonly triage?: {
		readonly target: AgentHubAttentionTarget;
		readonly staged?: AgentHubAttentionAction;
	};
}

export interface AgentHubViewerSequenceTransition {
	readonly model: AgentHubViewerSequenceModel;
	readonly action: AgentHubViewerSequenceAction;
}

export const INITIAL_AGENT_HUB_VIEWER_SEQUENCE: AgentHubViewerSequenceModel = { pendingG: false };
export type AgentHubViewerFocus = "list" | "preview" | "triage";

/** Derive route focus from the committed sequence before keymap resolution. */
export function agentHubViewerFocus(
	model: AgentHubViewerSequenceModel,
	previewFocused: boolean,
): AgentHubViewerFocus {
	if (model.triage !== undefined) return "triage";
	return previewFocused ? "preview" : "list";
}

const ATTENTION_BY_KEY: Readonly<Record<string, AgentHubAttentionAction>> = {
	n: "now",
	x: "next",
	w: "waiting",
	l: "later",
	h: "hidden",
	s: "snooze",
	t: "tags",
	b: "bookmark",
	o: "note",
};

/**
 * Pure, per-Hub input reducer. Pending `g` always wins, followed by Triage,
 * followed by Browse. There is deliberately no timeout for `g`.
 */
export function reduceAgentHubViewerSequence(
	model: AgentHubViewerSequenceModel,
	keyData: string,
	options: AgentHubViewerSequenceOptions,
): AgentHubViewerSequenceTransition {
	if (model.pendingG) {
		const next = INITIAL_AGENT_HUB_VIEWER_SEQUENCE;
		if (options.dismiss) return { model: next, action: { kind: "cancelled" } };
		if (options.prefix) return { model: next, action: { kind: "first-line" } };
		if (options.down) {
			return { model: next, action: { kind: options.displayRows ? "display-row-down" : "logical-down" } };
		}
		if (options.up) {
			return { model: next, action: { kind: options.displayRows ? "display-row-up" : "logical-up" } };
		}
		const kind = {
			a: "attach-owner",
			x: "open-errors",
			m: "open-messages",
			b: "open-bookmarks",
			r: "refresh",
			s: "send",
		}[keyData] as "attach-owner" | "open-errors" | "open-messages" | "open-bookmarks" | "refresh" | "send" | undefined;
		return kind === undefined
			? { model: next, action: { kind: "unknown", chord: `g${keyData}` } }
			: { model: next, action: { kind } };
	}

	if (model.triage !== undefined) {
		if (options.dismiss) return { model: INITIAL_AGENT_HUB_VIEWER_SEQUENCE, action: { kind: "cancelled" } };
		if (options.enter && model.triage.staged !== undefined) {
			return {
				model: INITIAL_AGENT_HUB_VIEWER_SEQUENCE,
				action: { kind: "commit-attention", target: model.triage.target, action: model.triage.staged },
			};
		}
		const attention = options.attentionAction ?? ATTENTION_BY_KEY[keyData];
		if (attention !== undefined) {
			const triage = { ...model.triage, staged: attention };
			return {
				model: { pendingG: false, triage },
				action: { kind: "stage-attention", target: triage.target, action: attention },
			};
		}
		return { model, action: { kind: "unhandled" } };
	}

	if (options.prefix) return { model: { pendingG: true }, action: { kind: "pending" } };
	if (keyData === "a" && options.target !== undefined) {
		return {
			model: { pendingG: false, triage: { target: options.target } },
			action: { kind: "open-triage", target: options.target },
		};
	}
	return { model, action: { kind: "unhandled" } };
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
