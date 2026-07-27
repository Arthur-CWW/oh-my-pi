import type {
	BehaviorDashboardStats,
	CostDashboardStats,
	DashboardStats,
	MessageStats,
	ModelDashboardStats,
	OverviewStats,
	RequestDetails,
} from "./types";

const API_BASE = "/api";

interface ErrorPayload {
	error?: {
		code?: string;
		message?: string;
	};
}

export class StatsApiError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "StatsApiError";
	}
}

async function request<T>(url: string): Promise<T> {
	let response: Response;
	try {
		response = await fetch(url);
	} catch (error) {
		throw new StatsApiError(
			"NETWORK_ERROR",
			error instanceof Error ? error.message : "Unable to reach the stats server",
			0,
		);
	}
	if (!response.ok) {
		let payload: ErrorPayload | undefined;
		try {
			payload = (await response.json()) as ErrorPayload;
		} catch {
			// Older or intermediary HTTP errors may not have a JSON body.
		}
		throw new StatsApiError(
			payload?.error?.code ?? "HTTP_ERROR",
			payload?.error?.message ?? `Stats request failed with HTTP ${response.status}`,
			response.status,
		);
	}
	return response.json() as Promise<T>;
}

export function getStats(range = "24h"): Promise<DashboardStats> {
	return request(`${API_BASE}/stats?range=${encodeURIComponent(range)}`);
}

export function getOverviewStats(range = "24h"): Promise<OverviewStats> {
	return request(`${API_BASE}/stats/overview?range=${encodeURIComponent(range)}`);
}

export function getModelDashboardStats(range = "24h"): Promise<ModelDashboardStats> {
	return request(`${API_BASE}/stats/model-dashboard?range=${encodeURIComponent(range)}`);
}

export function getCostDashboardStats(range = "24h"): Promise<CostDashboardStats> {
	return request(`${API_BASE}/stats/costs?range=${encodeURIComponent(range)}`);
}

export function getRecentRequests(limit = 50): Promise<MessageStats[]> {
	return request(`${API_BASE}/stats/recent?limit=${limit}`);
}

export function getRecentErrors(limit = 50): Promise<MessageStats[]> {
	return request(`${API_BASE}/stats/errors?limit=${limit}`);
}

export function getRequestDetails(id: number): Promise<RequestDetails> {
	return request(`${API_BASE}/request/${id}`);
}

export function sync(): Promise<unknown> {
	return request(`${API_BASE}/sync`);
}

export function getBehaviorDashboardStats(range = "24h"): Promise<BehaviorDashboardStats> {
	return request(`${API_BASE}/stats/behavior?range=${encodeURIComponent(range)}`);
}
