/**
 * Types for the Extension Control Center dashboard.
 */
import type { SourceMeta } from "../../../capability/types";

/**
 * Extension kinds matching capability types.
 */
export type ExtensionKind =
	| "extension-module"
	| "skill"
	| "rule"
	| "tool"
	| "mcp"
	| "prompt"
	| "instruction"
	| "context-file"
	| "hook"
	| "slash-command";

/**
 * Extension state (active, disabled, or shadowed).
 */
export type ExtensionState = "active" | "disabled" | "shadowed";

/**
 * Reason why an extension is disabled.
 */
export type DisabledReason = "provider-disabled" | "item-disabled" | "shadowed";

/**
 * Unified extension representation for the dashboard.
 * Normalizes all capability types into a common shape.
 */
export interface Extension {
	/** Unique ID: `${kind}:${name}` */
	id: string;
	/** Extension kind */
	kind: ExtensionKind;
	/** Extension name */
	name: string;
	/** Display name (may differ from name) */
	displayName: string;
	/** Description if available */
	description?: string;
	/** Trigger pattern (slash command, glob, regex) */
	trigger?: string;
	/** Absolute path to source file */
	path: string;
	/** Source metadata */
	source: {
		provider: string;
		providerName: string;
		level: "user" | "project" | "native";
	};
	/** Current state */
	state: ExtensionState;
	/** Reason for disabled state */
	disabledReason?: DisabledReason;
	/** If shadowed, what shadows it */
	shadowedBy?: string;
	/** Raw item data for inspector */
	raw: unknown;
}


/**
 * Provider tab representation.
 */
export interface ProviderTab {
	/** Provider ID (or "all" for the ALL tab) */
	id: string;
	/** Display label */
	label: string;
	/** Whether provider is enabled (always true for "all") */
	enabled: boolean;
	/** Extension count for this provider */
	count: number;
}


/**
 * Create extension ID from kind and name.
 */
export function makeExtensionId(kind: ExtensionKind, name: string): string {
	return `${kind}:${name}`;
}

/**
 * Parse extension ID into kind and name.
 */
export function parseExtensionId(id: string): { kind: ExtensionKind; name: string } | null {
	const colonIdx = id.indexOf(":");
	if (colonIdx === -1) return null;
	return {
		kind: id.slice(0, colonIdx) as ExtensionKind,
		name: id.slice(colonIdx + 1),
	};
}

/**
 * Map SourceMeta to extension source shape.
 */
export function sourceFromMeta(meta: SourceMeta): Extension["source"] {
	return {
		provider: meta.provider,
		providerName: meta.providerName,
		level: meta.level,
	};
}
