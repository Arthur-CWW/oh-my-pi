import type { Model } from "@oh-my-pi/pi-ai";
import { formatNumber } from "@oh-my-pi/pi-utils";
import type { ProviderDiscoveryState } from "../../config/model-availability";
import { theme } from "../../modes/theme/theme";

export interface ModelSelectorItemClassification {
	disabled: boolean;
	contextOverflow: boolean;
	contextWarning: string | null;
}

export function classifyModelSelectorItem(options: {
	currentContextTokens: number;
	contextWindow?: number | null;
	disabledReason?: string | null;
}): ModelSelectorItemClassification {
	const contextWindow = options.contextWindow ?? 0;
	const contextOverflow =
		options.currentContextTokens > 0 && contextWindow > 0 && options.currentContextTokens > contextWindow;
	const disabledReason = options.disabledReason;
	return {
		disabled: disabledReason !== undefined && disabledReason !== null && disabledReason.length > 0,
		contextOverflow,
		contextWarning: contextOverflow
			? `context ${formatNumber(options.currentContextTokens).toLowerCase()} > ${formatNumber(contextWindow).toLowerCase()} — will compact on switch`
			: null,
	};
}

export function formatProviderTabLabel(providerId: string): string {
	return providerId.replace(/[-_]+/g, " ").toUpperCase();
}

export function formatContextWarningSuffix(model: Model, currentContextTokens: number): string {
	const warning = classifyModelSelectorItem({ currentContextTokens, contextWindow: model.contextWindow }).contextWarning;
	return warning ? ` ${theme.fg("dim", `⚠ ${warning}`)}` : "";
}

export function formatAuthStatusSuffix(
	providerId: string,
	staleProviders: ReadonlySet<string>,
	refreshingProviders: ReadonlySet<string>,
): string {
	if (staleProviders.has(providerId)) return ` ${theme.fg("warning", "[stale — refreshing auth]")}`;
	if (refreshingProviders.has(providerId)) return ` ${theme.fg("warning", "[refreshing auth]")}`;
	return "";
}

export function formatProviderRefreshStatus(options: {
	providerId: string | undefined;
	providerRefreshes: ReadonlySet<string>;
	authRefreshes: ReadonlySet<string>;
	staleProviders: ReadonlySet<string>;
	spinnerFrame: number;
}): string | undefined {
	const providerId = options.providerId;
	if (!providerId || (!options.providerRefreshes.has(providerId) && !options.authRefreshes.has(providerId))) {
		return undefined;
	}
	const spinnerFrames = theme.spinnerFrames;
	const spinner =
		spinnerFrames.length > 0 ? spinnerFrames[options.spinnerFrame % spinnerFrames.length] : theme.status.pending;
	const detail = options.staleProviders.has(providerId)
		? "Refreshing authentication; showing last-known models..."
		: options.authRefreshes.has(providerId)
			? "Refreshing authentication..."
			: `Refreshing ${formatProviderTabLabel(providerId)} in background...`;
	return theme.fg("warning", `  ${spinner} ${detail}`);
}

function formatDiscoveryErrorHint(error: string | undefined): string | undefined {
	if (!error) return undefined;
	const httpMatch = error.match(/^HTTP (\d+) from (.+)$/);
	if (!httpMatch) return undefined;
	const [, statusCode, url] = httpMatch;
	if (statusCode === "404") {
		return `  Discovery endpoint ${url} returned 404. Point baseUrl at the host that serves /models (usually .../v1).`;
	}
	return `  Discovery failed: ${error}`;
}

export function formatDiscoveryAge(fetchedAt: number | undefined): string | undefined {
	if (!fetchedAt) return undefined;
	const ageMs = Math.max(0, Date.now() - fetchedAt);
	if (ageMs < 60_000) return "less than a minute ago";
	return `${Math.round(ageMs / 60_000)}m ago`;
}

export function formatProviderEmptyStateMessage(
	state: ProviderDiscoveryState,
	age: string | undefined,
): string | undefined {
	switch (state.status) {
		case "cached":
			return age
				? `  Using cached model list from ${age}. Live refresh is still pending.`
				: "  Using cached model list. Live refresh is still pending.";
		case "unavailable":
			return (
				formatDiscoveryErrorHint(state.error) ??
				(age ? `  Provider unavailable. Using cached model list from ${age}.` : "  Provider unavailable.")
			);
		case "unauthenticated":
			return "  Provider requires authentication before models can be discovered.";
		case "idle":
			return "  Provider has not been refreshed yet.";
		case "empty":
			return "  Discovery succeeded but returned 0 models. Check that /models returns { data: [{ id }] }.";
		case "ok":
			return undefined;
	}
}
