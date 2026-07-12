import type { ContextUsage } from "../extensibility/extensions/types";

/** Presentation metadata attached to collab prompt transcript entries. */
export interface CollabPromptDetails {
	from?: string;
}

/** Host-derived values needed to render a guest's status line. */
export interface CollabSessionState {
	contextUsage?: ContextUsage;
}
