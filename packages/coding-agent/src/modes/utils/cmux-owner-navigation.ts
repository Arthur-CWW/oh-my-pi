import { inspectLiveSessionOwnerView } from "../../session/session-ownership";
import { CmuxSocketClient } from "../../tools/browser/cmux/socket-client";
import type { FocusCmuxOwnerAction } from "./error-inbox";

export const CMUX_OWNER_UNAVAILABLE_MESSAGE =
	"The active cmux session is no longer available. This view remains read-only.";

export type FocusCmuxOwnerResult =
	| { readonly kind: "focused" }
	| { readonly kind: "unavailable" }
	| { readonly kind: "failed"; readonly reason: string };

export interface FocusCmuxOwnerOptions {
	readonly ownershipRoot?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly excludedOwnerEpoch?: string;
}

function errorReason(error: unknown): string {
	const reason = error instanceof Error ? error.message : String(error);
	return reason.replace(/[.\s]+$/, "") || "unknown error";
}

/** Revalidates a live owner view before focusing its cmux workspace and surface. */
export async function focusLiveCmuxOwner(
	sessionFile: string,
	sessionId: string,
	options: FocusCmuxOwnerOptions = {},
): Promise<FocusCmuxOwnerResult> {
	try {
		const view = await inspectLiveSessionOwnerView(sessionFile, sessionId, {
			root: options.ownershipRoot,
		});
		if (!view || view.ownerEpoch === options.excludedOwnerEpoch) return { kind: "unavailable" };

		const env = options.env ?? process.env;
		const password = view.cmux.socketPath === env.CMUX_SOCKET_PATH ? env.CMUX_SOCKET_PASSWORD || undefined : undefined;
		const client = new CmuxSocketClient({ socketPath: view.cmux.socketPath, password });
		try {
			await client.request("workspace.select", { workspace_id: view.cmux.workspaceId });
			await client.request("surface.focus", { surface_id: view.cmux.surfaceId });
		} finally {
			client.close();
		}
		return { kind: "focused" };
	} catch (error) {
		return { kind: "failed", reason: errorReason(error) };
	}
}

/** Revalidates the current owner before focusing it, rejecting the lost diagnostic epoch. */
export async function focusCmuxOwner(
	action: FocusCmuxOwnerAction,
	options: FocusCmuxOwnerOptions = {},
): Promise<FocusCmuxOwnerResult> {
	return focusLiveCmuxOwner(action.sessionFile, action.sessionId, {
		...options,
		excludedOwnerEpoch: action.lostOwnerEpoch,
	});
}
