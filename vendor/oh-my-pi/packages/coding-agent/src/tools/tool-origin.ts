import * as path from "node:path";

export type ToolOriginKind = "builtin" | "mcp" | "extension" | "skill";

/** Queryable provenance attached directly to each registered tool. */
export interface ToolOrigin {
	kind: ToolOriginKind;
	/** Module path, server plus launch command, extension path, or skill path. */
	source: string;
	/** Config file that caused registration, when distinct from the source. */
	registeredBy?: string;
}

export type ToolWithOrigin = {
	origin?: ToolOrigin;
};

/** Attach provenance to the registry object itself rather than maintaining a parallel map. */
export function setToolOrigin<T extends object>(tool: T, origin: ToolOrigin): T & { origin: ToolOrigin } {
	Object.defineProperty(tool, "origin", {
		value: origin,
		writable: true,
		enumerable: true,
		configurable: true,
	});
	return tool as T & { origin: ToolOrigin };
}

export function formatMCPServerSource(
	serverName: string,
	config: { type?: string; command?: string; args?: string[]; url?: string },
): string {
	const endpoint =
		config.type === "http" || config.type === "sse"
			? (config.url ?? config.type)
			: [config.command ?? "stdio", ...(config.args ?? [])].join(" ");
	return `${serverName}: ${endpoint}`;
}

export function compactToolOriginTag(origin: ToolOrigin | undefined, shorten: (value: string) => string): string {
	if (!origin) return "unknown";
	switch (origin.kind) {
		case "builtin":
			return "builtin";
		case "mcp": {
			const separator = origin.source.indexOf(":");
			const server = separator > 0 ? origin.source.slice(0, separator) : origin.source;
			return origin.registeredBy ? `mcp:${server} ← ${shorten(origin.registeredBy)}` : `mcp:${server}`;
		}
		case "extension":
			return `extension:${path.basename(origin.source)}`;
		case "skill":
			return `skill:${path.basename(origin.source)}`;
	}
}
