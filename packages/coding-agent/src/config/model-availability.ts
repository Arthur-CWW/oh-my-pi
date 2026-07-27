import type { Api, Model } from "@oh-my-pi/pi-ai/types";
import { logger } from "@oh-my-pi/pi-utils";
import type { AuthStorage } from "../session/auth-storage";
import { settings } from "./settings";

export type ProviderDiscoveryStatus = "idle" | "ok" | "empty" | "cached" | "unavailable" | "unauthenticated";

export interface ProviderDiscoveryState {
	provider: string;
	status: ProviderDiscoveryStatus;
	optional: boolean;
	stale: boolean;
	fetchedAt?: number;
	models: string[];
	error?: string;
}

export interface ModelAvailabilitySnapshot {
	generation: number;
	models: readonly Model<Api>[];
	refreshingProviders: readonly string[];
	staleProviders: readonly string[];
}

interface ModelAvailabilityOptions {
	authStorage: AuthStorage;
	getModels: () => readonly Model<Api>[];
	getKeylessProviders: () => ReadonlySet<string>;
}

export function getDisabledProviderIdsFromSettings(): Set<string> {
	try {
		return new Set(settings.get("disabledProviders"));
	} catch {
		return new Set();
	}
}

/** Owns the registry's stale-while-refresh snapshot and change notification state. */
export class ModelAvailability {
	#lastAvailableModelsByProvider = new Map<string, readonly Model<Api>[]>();
	#listeners = new Set<(snapshot: ModelAvailabilitySnapshot) => void>();
	#signature?: string;
	#backgroundRefresh?: Promise<void>;

	constructor(readonly options: ModelAvailabilityOptions) {
		options.authStorage.onGenerationChanged(() => this.#emitChanged());
	}

	createCheck(): (model: Model<Api>) => boolean {
		const disabledProviders = getDisabledProviderIdsFromSettings();
		const keylessProviders = this.options.getKeylessProviders();
		const byProvider = new Map<string, boolean>();
		return model => {
			let available = byProvider.get(model.provider);
			if (available === undefined) {
				available =
					!disabledProviders.has(model.provider) &&
					(keylessProviders.has(model.provider) || this.options.authStorage.hasAuth(model.provider));
				byProvider.set(model.provider, available);
			}
			return available;
		};
	}

	getSnapshot(): ModelAvailabilitySnapshot {
		const refreshState = this.options.authStorage.getRefreshState();
		const refreshing = new Set(refreshState.refreshingProviders);
		const disabled = getDisabledProviderIdsFromSettings();
		const keylessProviders = this.options.getKeylessProviders();
		for (const provider of disabled) {
			this.#lastAvailableModelsByProvider.delete(provider);
		}

		const currentByProvider = new Map<string, Model<Api>[]>();
		for (const model of this.options.getModels()) {
			const models = currentByProvider.get(model.provider);
			if (models) {
				models.push(model);
			} else {
				currentByProvider.set(model.provider, [model]);
			}
		}

		const models: Model<Api>[] = [];
		const staleProviders: string[] = [];
		const refreshingProviders = refreshState.refreshingProviders.filter(provider => !disabled.has(provider));
		for (const [provider, providerModels] of currentByProvider) {
			if (disabled.has(provider)) {
				this.#lastAvailableModelsByProvider.delete(provider);
				continue;
			}
			const hasAuth = keylessProviders.has(provider) || this.options.authStorage.hasAuth(provider);
			// Authenticated rows remain current during refresh. Only an auth gap may
			// borrow the registry-owned last-known rows below.
			if (hasAuth) {
				models.push(...providerModels);
				this.#lastAvailableModelsByProvider.set(provider, providerModels);
				continue;
			}
			const staleModels = refreshing.has(provider) ? this.#lastAvailableModelsByProvider.get(provider) : undefined;
			if (staleModels) {
				models.push(...staleModels);
				staleProviders.push(provider);
			} else if (!refreshing.has(provider)) {
				this.#lastAvailableModelsByProvider.delete(provider);
			}
		}

		refreshingProviders.sort();
		staleProviders.sort();
		return { generation: refreshState.generation, models, refreshingProviders, staleProviders };
	}

	onChanged(listener: (snapshot: ModelAvailabilitySnapshot) => void): () => void {
		this.#listeners.add(listener);
		if (this.#signature === undefined) {
			this.#signature = this.#getSignature(this.getSnapshot());
		}
		return () => this.#listeners.delete(listener);
	}

	refreshInBackground(refresh: () => Promise<void>): void {
		if (this.#backgroundRefresh) return;
		const refreshPromise = refresh()
			.catch(error => {
				logger.warn("background model refresh failed", {
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				if (this.#backgroundRefresh === refreshPromise) this.#backgroundRefresh = undefined;
			});
		this.#backgroundRefresh = refreshPromise;
	}

	#getSignature(snapshot: ModelAvailabilitySnapshot): string {
		return [
			snapshot.models.map(model => `${model.provider}/${model.id}`).join("\n"),
			snapshot.refreshingProviders.join("\n"),
			snapshot.staleProviders.join("\n"),
		].join("\0");
	}

	#emitChanged(): void {
		const snapshot = this.getSnapshot();
		const signature = this.#getSignature(snapshot);
		if (signature === this.#signature) return;
		this.#signature = signature;
		for (const listener of [...this.#listeners]) {
			try {
				listener(snapshot);
			} catch (error) {
				logger.debug("Model availability listener failed", { error: String(error) });
			}
		}
	}
}
