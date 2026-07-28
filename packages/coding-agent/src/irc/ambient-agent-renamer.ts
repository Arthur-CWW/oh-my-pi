import type { IrcExternalBus, IrcExternalPeer } from "./bus-external";

export const DEFAULT_AMBIENT_RENAME_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_STALE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RENAMES = 3;
const AUTO_NAME_PATTERN = /-[a-z0-9]{6}$/i;

export interface AmbientRenameCompletionOptions {
	model: "smol";
}

/** Same narrow shape as the stateless completion helper exposed to agents. */
export type AmbientRenameCompletion = (prompt: string, options: AmbientRenameCompletionOptions) => Promise<string>;

export interface AmbientAgentRenamerOptions {
	bus: Pick<IrcExternalBus, "listPeers" | "updatePeerName">;
	complete: AmbientRenameCompletion;
	intervalMs?: number;
	staleMs?: number;
	maxRenamesPerTick?: number;
	now?: () => number;
	setInterval?: (callback: () => void, intervalMs: number) => ReturnType<typeof setInterval>;
	clearInterval?: (timer: ReturnType<typeof setInterval>) => void;
}

export class AmbientAgentRenamer {
	readonly #options: AmbientAgentRenamerOptions;
	#timer: ReturnType<typeof setInterval> | undefined;
	#tickRunning = false;

	constructor(options: AmbientAgentRenamerOptions) {
		this.#options = options;
	}

	start(): void {
		if (this.#timer) return;
		const schedule = this.#options.setInterval ?? setInterval;
		const timer = schedule(
			() => void this.tick(),
			this.#options.intervalMs ?? DEFAULT_AMBIENT_RENAME_INTERVAL_MS,
		) as ReturnType<typeof setInterval>;
		this.#timer = timer;
		timer.unref?.();
	}

	stop(): void {
		if (this.#timer) (this.#options.clearInterval ?? clearInterval)(this.#timer);
		this.#timer = undefined;
	}

	async tick(): Promise<void> {
		if (this.#tickRunning) return;
		this.#tickRunning = true;
		try {
			const now = (this.#options.now ?? Date.now)();
			const staleMs = this.#options.staleMs ?? DEFAULT_STALE_MS;
			const limit = this.#options.maxRenamesPerTick ?? DEFAULT_MAX_RENAMES;
			let renamed = 0;
			for (const peer of this.#options.bus.listPeers()) {
				if (renamed >= limit) break;
				if (!isEligible(peer, now, staleMs)) continue;
				try {
					const proposed = normalizeLabel(await this.#options.complete(buildPrompt(peer), { model: "smol" }));
					if (!proposed || !materiallyDifferent(peer.name, proposed)) continue;
					if (this.#options.bus.updatePeerName(peer.sessionId, proposed)) renamed++;
				} catch {
					// Ambient automation must never compete with or disrupt a busy provider.
				}
			}
		} finally {
			this.#tickRunning = false;
		}
	}
}

function isEligible(peer: IrcExternalPeer, now: number, staleMs: number): boolean {
	if (peer.explicitName || !AUTO_NAME_PATTERN.test(peer.name)) return false;
	const activityAt = Date.parse(peer.stateTs ?? peer.lastSeen);
	return Number.isFinite(activityAt) && now - activityAt >= staleMs;
}

function buildPrompt(peer: IrcExternalPeer): string {
	return `Write a 2-5 word present-participle display label for this coding session. Return only the label.\nWorkspace: ${peer.cwd}\nCurrent state: ${peer.state}\nCurrent automatic name: ${peer.name}`;
}

function normalizeLabel(value: string): string {
	return value
		.trim()
		.replace(/^['"`]|['"`]$/g, "")
		.replace(/\s+/g, " ")
		.slice(0, 60);
}

function materiallyDifferent(current: string, proposed: string): boolean {
	const normalize = (value: string) =>
		value
			.toLocaleLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();
	return normalize(current) !== normalize(proposed);
}
