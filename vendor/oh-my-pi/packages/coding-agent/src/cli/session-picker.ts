import { Effect } from "effect";
import { ProcessTerminal, TUI, type Keybinding, type KeyId } from "@oh-my-pi/pi-tui";
import { logger } from "@oh-my-pi/pi-utils";
import { KeybindingsManager } from "../config/keybindings";
import { MVU_KEYMAP_TABLES } from "../config/mvu-keybindings";
import { makeInputLeaseManager } from "../modes/mvu/input-lease";
import { makeTerminalInputAdapter } from "../modes/mvu/input-adapter";
import { compileKeymapRegistry } from "../modes/mvu/keymap-registry";
import { makeKeymapId, type KeymapTable } from "../modes/mvu/schema";
import { mountMvuOverlay } from "../modes/mvu/route-host";
import { SessionSelectorComponent } from "../modes/components/session-selector";
import { HistoryStorage } from "../session/history-storage";
import type { SessionInfo } from "../session/session-listing";
import { SessionManager } from "../session/session-manager";
import { FileSessionStorage } from "../session/session-storage";

const SESSION_PICKER_KEYMAP: KeymapTable = {
	id: makeKeymapId("session-picker.adapter"),
	layer: "adapter",
	contexts: ["selector.global"],
	bindings: [
		{ key: "delete" as KeyId, action: "app.session.delete" as Keybinding, when: { mode: "Browse", focus: "list" } },
		{ key: "tab" as KeyId, action: "app.session.togglePath" as Keybinding, when: { mode: "Browse", focus: "list" } },
		{ key: "ctrl+c" as KeyId, action: "app.exit" as Keybinding, when: { mode: "Browse", focus: "list" } },
	],
};

/**
 * Show the MVU session selector and return the selected session, or null if
 * cancelled. Tab toggles between current-folder and all-projects scope; the
 * all-projects list is loaded lazily via `SessionManager.listAll`.
 */
export async function selectSession(
	sessions: SessionInfo[],
	options?: { allSessions?: SessionInfo[]; startInAllScope?: boolean },
): Promise<SessionInfo | null> {
	const { promise, resolve } = Promise.withResolvers<SessionInfo | null>();
	const ui = new TUI(new ProcessTerminal());
	let resolved = false;
	const storage = new FileSessionStorage();

	// Rank sessions with prompt-history matches too, recovering prompts the 4KB
	// session-list prefix never sees. Best-effort: a missing/locked history.db
	// must not break the picker.
	let historyMatcher: ((query: string) => string[]) | undefined;
	try {
		const history = HistoryStorage.open();
		historyMatcher = (query: string) => history.matchingSessionIds(query);
	} catch (error) {
		logger.warn("History storage unavailable for session ranking", { error: String(error) });
	}

	const selector = new SessionSelectorComponent(
		sessions,
		(session: SessionInfo) => {
			if (!resolved) {
				resolved = true;
				ui.stop();
				resolve(session);
			}
		},
		() => {
			if (!resolved) {
				resolved = true;
				ui.stop();
				resolve(null);
			}
		},
		() => {
			if (!resolved) {
				resolved = true;
				ui.stop();
				process.exit(0);
			}
		},
		{
				onDelete: async (session: SessionInfo) => {
					await storage.deleteSessionWithArtifacts(session.path);
					return true;
				},
				historyMatcher,
				loadAllSessions: () => SessionManager.listAll(storage),
				allSessions: options?.allSessions,
				startInAllScope: options?.startInAllScope,
				getTerminalRows: () => ui.terminal.rows,
			},
	);
	selector.setOnRequestRender(() => ui.requestRender());

	return Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const keybindings = KeybindingsManager.inMemory();
				const registry = yield* compileKeymapRegistry([...MVU_KEYMAP_TABLES, SESSION_PICKER_KEYMAP], keybindings);
				const leaseManager = yield* makeInputLeaseManager(ui, makeTerminalInputAdapter(), registry);
				const spec = selector.mountSpec;
				const route = yield* mountMvuOverlay({
					tui: ui,
					leaseManager,
					route: spec.route,
					component: selector,
					runtimeConfig: {
						componentId: spec.componentId,
						initialModel: spec.initialModel,
						update: spec.update,
						interpret: spec.interpret,
						inputCapacity: 256,
						messageCapacity: 256,
						commandCapacity: 64,
					},
				});
				ui.start();
				const result = yield* Effect.promise(() => promise);
				yield* route.close();
				return result;
			}),
		),
	);
}
