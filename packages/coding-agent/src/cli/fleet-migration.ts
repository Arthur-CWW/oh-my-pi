import * as fs from "node:fs/promises";
import {
	attachFleetSession,
	checkpointFleetSession,
	correctFleetSession,
	exportFleetSession,
	importFleetSession,
	inspectFleetSession,
	migrateFleetSession,
	type FleetHost,
	type FleetMutationContext,
	type FleetSessionFiles,
} from "../fleet/migration-core";
import type { TerminalSessionWireClientHello } from "../runner/wire/client";

export const FLEET_MAJORDOMO_ACTIONS = [
	"inspect",
	"checkpoint",
	"correct",
	"export",
	"import",
	"migrate",
	"attach",
] as const;
export type FleetMajordomoAction = (typeof FLEET_MAJORDOMO_ACTIONS)[number];

interface FleetCliRequest {
	readonly host?: FleetHost;
	readonly destination?: FleetHost;
	readonly files?: FleetSessionFiles;
	readonly context?: FleetMutationContext;
	readonly cwd?: string;
	readonly sourceBundleDir?: string;
	readonly recordId?: string;
	readonly correctionAction?: "replace" | "redact";
	readonly replacement?: unknown;
	readonly reason?: string;
	readonly healthProof?: unknown;
	readonly socketPath?: string;
	readonly attachHello?: TerminalSessionWireClientHello;
}

function requireValue<T>(value: T | undefined, label: string): T {
	if (value === undefined) throw new Error(`fleet: request.${label} is required`);
	return value;
}

async function decodeRequest(file: string): Promise<FleetCliRequest> {
	const value = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new Error("fleet: request must be an object");
	return value as FleetCliRequest;
}

/** Thin, stable-JSON projection over the shared Majordomo API core. */
export async function runFleetMajordomoCli(
	action: FleetMajordomoAction,
	selector: string | undefined,
	requestFile: string,
	options: { readonly dryRun?: boolean } = {},
): Promise<string> {
	const request = await decodeRequest(requestFile);
	if (selector && request.files && selector !== request.files.sessionId)
		throw new Error(`fleet: selector ${selector} does not match request session ${request.files.sessionId}`);
	let result: unknown;
	switch (action) {
		case "inspect":
			result = await inspectFleetSession(requireValue(request.host, "host"), requireValue(request.files, "files"));
			break;
		case "checkpoint":
			result = await checkpointFleetSession(
				requireValue(request.host, "host"),
				requireValue(request.files, "files"),
				requireValue(request.context, "context"),
			);
			break;
		case "correct":
			result = await correctFleetSession(
				requireValue(request.host, "host"),
				requireValue(request.files, "files"),
				requireValue(request.context, "context"),
				{
					recordId: requireValue(request.recordId, "recordId"),
					action: requireValue(request.correctionAction, "correctionAction"),
					replacement: request.replacement,
					reason: requireValue(request.reason, "reason"),
				},
			);
			break;
		case "export":
			result = await exportFleetSession(
				requireValue(request.host, "host"),
				requireValue(request.files, "files"),
				requireValue(request.context, "context"),
				requireValue(request.cwd, "cwd"),
			);
			break;
		case "import":
			if (options.dryRun !== true) throw new Error("fleet: import requires --dry-run");
			result = await importFleetSession(
				requireValue(request.sourceBundleDir, "sourceBundleDir"),
				requireValue(request.destination, "destination"),
				requireValue(request.context, "context"),
				{ dryRun: true },
			);
			break;
		case "migrate":
			result = await migrateFleetSession(
				requireValue(request.host, "host"),
				requireValue(request.destination, "destination"),
				requireValue(request.files, "files"),
				requireValue(request.context, "context"),
				{
					cwd: requireValue(request.cwd, "cwd"),
					healthProof: async () => requireValue(request.healthProof, "healthProof"),
				},
			);
			break;
		case "attach": {
			const connection = await attachFleetSession(
				requireValue(request.socketPath, "socketPath"),
				requireValue(request.attachHello, "attachHello"),
			);
			try {
				result = {
					sessionId: connection.sessionId,
					ownerEpoch: connection.ownerEpoch,
				};
			} finally {
				await connection.controller.close();
			}
			break;
		}
	}
	return `${JSON.stringify({ schemaVersion: 1, action, selector: selector ?? null, result })}\n`;
}
