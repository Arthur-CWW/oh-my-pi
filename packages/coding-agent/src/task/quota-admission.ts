import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import type { CustomEntry, FileEntry } from "../session/session-entries";

export interface QuotaAdmissionSettings {
	enabled: boolean;
	reservePercent: number;
	emaAlpha: number;
	hysteresisPercent: number;
}

export const DEFAULT_QUOTA_ADMISSION_SETTINGS: QuotaAdmissionSettings = {
	enabled: true,
	reservePercent: 2,
	emaAlpha: 0.25,
	hysteresisPercent: 1,
};

export interface QuotaModel {
	providerId: string;
	modelId: string;
	selector: string;
	capacityWeight?: number;
}

export interface QuotaRetrySignal {
	providerId: string;
	modelId: string;
	retryAtMs?: number;
	resetAtMs?: number;
}

export interface QuotaSample {
	poolId: string;
	windowId: string;
	modelId: string;
	observedAtMs: number;
	remainingPercent: number;
	resetAtMs?: number;
	emaBurnPerHour: number;
}

export interface QuotaPressure {
	poolId: string;
	windowId: string;
	modelId: string;
	remainingPercent: number;
	resetAtMs?: number;
	emaBurnPerHour: number;
	projectedEmptyAtMs?: number;
	deficitPerHour: number;
	reason: "reserve" | "projected-empty" | "rate-wait";
}

export interface QuotaDecision {
	atMs: number;
	model: QuotaModel;
	outcome: "admit" | "block" | "reroute";
	poolId?: string;
	windowId?: string;
	reason?: QuotaPressure["reason"];
	routedModel?: QuotaModel;
	ratePerHour?: number;
	projectedEmptyAt?: number;
	deficitPerHour?: number;
	resetAt?: number;
}

export interface QuotaAdmissionState {
	samples: QuotaSample[];
	decisions: QuotaDecision[];
}


const MAX_SAMPLES_PER_KEY = 2;
export const MAX_QUOTA_SAMPLE_KEYS = 128;
const MAX_DECISIONS = 128;
/** Retained usage may gate a new admission only within this explicit fallback window. */
export const QUOTA_SAMPLE_MAX_AGE_MS = 15 * 60_000;

function isQuotaSampleFresh(sample: QuotaSample, nowMs: number): boolean {
	return sample.observedAtMs > nowMs || nowMs - sample.observedAtMs <= QUOTA_SAMPLE_MAX_AGE_MS;
}

function compactQuotaAdmissionState(state: QuotaAdmissionState, nowMs = Date.now()): QuotaAdmissionState {
	const samplesByKey = new Map<string, QuotaSample[]>();
	for (const sample of state.samples) {
		if (!isQuotaSampleFresh(sample, nowMs)) continue;
		const key = `${sample.poolId}\0${sample.windowId}\0${sample.modelId}`;
		const samples = samplesByKey.get(key);
		if (samples) samples.push(sample);
		else samplesByKey.set(key, [sample]);
	}
	const samples = [...samplesByKey.values()]
		.map(group => {
			group.sort((left, right) => right.observedAtMs - left.observedAtMs);
			return group.slice(0, MAX_SAMPLES_PER_KEY);
		})
		.sort((left, right) => right[0].observedAtMs - left[0].observedAtMs)
		.slice(0, MAX_QUOTA_SAMPLE_KEYS)
		.flat();
	samples.sort((left, right) => left.observedAtMs - right.observedAtMs);
	const decisions = state.decisions.slice(-MAX_DECISIONS);
	return { samples, decisions };
}
export const QUOTA_ADMISSION_CUSTOM_TYPE = "quota_admission_state";

export interface QuotaAdmissionStateRecord {
	version: 1;
	updatedAtMs: number;
	state: QuotaAdmissionState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeSample(value: unknown): QuotaSample | undefined {
	if (!isRecord(value)) return undefined;
	const { poolId, windowId, modelId, observedAtMs, remainingPercent, resetAtMs, emaBurnPerHour } = value;
	if (
		typeof poolId !== "string" ||
		typeof windowId !== "string" ||
		typeof modelId !== "string" ||
		typeof observedAtMs !== "number" ||
		!Number.isFinite(observedAtMs) ||
		typeof remainingPercent !== "number" ||
		!Number.isFinite(remainingPercent) ||
		(resetAtMs !== undefined && (typeof resetAtMs !== "number" || !Number.isFinite(resetAtMs))) ||
		typeof emaBurnPerHour !== "number" ||
		!Number.isFinite(emaBurnPerHour)
	) {
		return undefined;
	}
	return { poolId, windowId, modelId, observedAtMs, remainingPercent, resetAtMs, emaBurnPerHour };
}

function decodeQuotaModel(value: unknown): QuotaModel | undefined {
	if (!isRecord(value)) return undefined;
	const { providerId, modelId, selector, capacityWeight } = value;
	if (
		typeof providerId !== "string" ||
		typeof modelId !== "string" ||
		typeof selector !== "string" ||
		(capacityWeight !== undefined && (typeof capacityWeight !== "number" || !Number.isFinite(capacityWeight)))
	) {
		return undefined;
	}
	return { providerId, modelId, selector, capacityWeight };
}

function decodeDecision(value: unknown): QuotaDecision | undefined {
	if (!isRecord(value)) return undefined;
	const { atMs, model, outcome, poolId, windowId, reason, routedModel, ratePerHour, projectedEmptyAt, deficitPerHour, resetAt } =
		value;
	if (
		typeof atMs !== "number" ||
		!Number.isFinite(atMs) ||
		(outcome !== "admit" && outcome !== "block" && outcome !== "reroute") ||
		(poolId !== undefined && typeof poolId !== "string") ||
		(windowId !== undefined && typeof windowId !== "string") ||
		(reason !== undefined && reason !== "reserve" && reason !== "projected-empty" && reason !== "rate-wait") ||
		(ratePerHour !== undefined && (typeof ratePerHour !== "number" || !Number.isFinite(ratePerHour))) ||
		(projectedEmptyAt !== undefined && (typeof projectedEmptyAt !== "number" || !Number.isFinite(projectedEmptyAt))) ||
		(deficitPerHour !== undefined && (typeof deficitPerHour !== "number" || !Number.isFinite(deficitPerHour))) ||
		(resetAt !== undefined && (typeof resetAt !== "number" || !Number.isFinite(resetAt)))
	) {
		return undefined;
	}
	const decodedModel = decodeQuotaModel(model);
	const decodedRoutedModel = routedModel === undefined ? undefined : decodeQuotaModel(routedModel);
	if (!decodedModel || (routedModel !== undefined && !decodedRoutedModel)) return undefined;
	return {
		atMs,
		model: decodedModel,
		outcome,
		poolId,
		windowId,
		reason,
		routedModel: decodedRoutedModel,
		ratePerHour,
		projectedEmptyAt,
		deficitPerHour,
		resetAt,
	};
}

function decodeState(value: unknown): QuotaAdmissionState | undefined {
	if (!isRecord(value) || !Array.isArray(value.samples) || !Array.isArray(value.decisions)) return undefined;
	const samples = value.samples.map(decodeSample);
	const decisions = value.decisions.map(decodeDecision);
	if (samples.some(sample => sample === undefined) || decisions.some(decision => decision === undefined)) return undefined;
	return { samples: samples as QuotaSample[], decisions: decisions as QuotaDecision[] };
}

export function latestQuotaAdmissionState(
	entries: readonly FileEntry[],
	options: { nowMs?: number; maxAgeMs?: number } = {},
): QuotaAdmissionState | undefined {
	let latest: QuotaAdmissionStateRecord | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== QUOTA_ADMISSION_CUSTOM_TYPE) continue;
		const data = (entry as CustomEntry).data;
		if (!isRecord(data) || data.version !== 1 || typeof data.updatedAtMs !== "number" || !Number.isFinite(data.updatedAtMs)) {
			continue;
		}
		const state = decodeState(data.state);
		if (!state) continue;
		if (!latest || data.updatedAtMs >= latest.updatedAtMs) {
			latest = { version: 1, updatedAtMs: data.updatedAtMs, state };
		}
	}
	const maxAgeMs = options.maxAgeMs ?? QUOTA_SAMPLE_MAX_AGE_MS;
	const nowMs = options.nowMs ?? Date.now();
	if (latest && (!Number.isFinite(maxAgeMs) || maxAgeMs < 0 || nowMs - latest.updatedAtMs > maxAgeMs)) return undefined;
	return latest?.state;
}

export function createQuotaAdmissionStateRecord(state: QuotaAdmissionState, updatedAtMs = Date.now()): QuotaAdmissionStateRecord {
	return { version: 1, updatedAtMs, state };
}

function fingerprint(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
	}
	return (hash >>> 0).toString(36);
}

function numberInRange(value: number, fallback: number, min: number, max: number): number {
	return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function remainingPercent(limit: UsageLimit): number | undefined {
	const amount = limit.amount;
	if (typeof amount.remainingFraction === "number") return amount.remainingFraction * 100;
	if (typeof amount.usedFraction === "number") return (1 - amount.usedFraction) * 100;
	if (typeof amount.remaining === "number" && typeof amount.limit === "number" && amount.limit > 0) {
		return (amount.remaining / amount.limit) * 100;
	}
	if (typeof amount.used === "number" && typeof amount.limit === "number" && amount.limit > 0) {
		return ((amount.limit - amount.used) / amount.limit) * 100;
	}
	return undefined;
}

function accountFingerprint(report: UsageReport, limit: UsageLimit): string {
	if (limit.scope.shared === true) return "shared";
	const scope = limit.scope;
	const metadata = report.metadata;
	const account = scope.accountId ?? scope.projectId ?? scope.orgId ?? metadata?.accountId ?? metadata?.email;
	return fingerprint(typeof account === "string" && account ? account : "default");
}

/** A provider/account quota bucket. Window identity is tracked separately on each sample. */
export function quotaPoolId(report: UsageReport, limit: UsageLimit): string {
	return `${report.provider}:${accountFingerprint(report, limit)}`;
}

function modelMatches(sample: QuotaSample, model: QuotaModel): boolean {
	return sample.modelId === "*" || sample.modelId === model.modelId;
}

/**
 * Pure quota gate. Callers persist `state` wherever their own durable session
 * journal lives; the controller neither performs I/O nor selects provider names.
 */
export class QuotaAdmissionController {
	readonly #settings: QuotaAdmissionSettings;
	#state: QuotaAdmissionState;
	readonly #rateWaits = new Map<string, number>();

	constructor(settings: Partial<QuotaAdmissionSettings> = {}, state: QuotaAdmissionState = { samples: [], decisions: [] }) {
		this.#settings = {
			enabled: settings.enabled ?? DEFAULT_QUOTA_ADMISSION_SETTINGS.enabled,
			reservePercent: numberInRange(settings.reservePercent ?? NaN, DEFAULT_QUOTA_ADMISSION_SETTINGS.reservePercent, 0, 100),
			emaAlpha: numberInRange(settings.emaAlpha ?? NaN, DEFAULT_QUOTA_ADMISSION_SETTINGS.emaAlpha, 0.01, 1),
			hysteresisPercent: numberInRange(settings.hysteresisPercent ?? NaN, DEFAULT_QUOTA_ADMISSION_SETTINGS.hysteresisPercent, 0, 100),
		};
		this.#state = compactQuotaAdmissionState(state);
	}

	get state(): QuotaAdmissionState {
		this.#state = compactQuotaAdmissionState(this.#state);
		return this.#state;
	}

	observeReports(reports: readonly UsageReport[]): QuotaSample[] {
		const observed: QuotaSample[] = [];
		for (const report of reports) {
			const observedAtMs = Number.isFinite(report.fetchedAt) && report.fetchedAt > 0 ? report.fetchedAt : Date.now();
			for (const limit of report.limits) {
				const remaining = remainingPercent(limit);
				if (remaining === undefined) continue;
				const poolId = quotaPoolId(report, limit);
				const windowId = limit.window?.id ?? limit.scope.windowId ?? limit.id;
				const modelId = limit.scope.modelId ?? "*";
				const duplicate = this.#state.samples.findLast(
					sample =>
						sample.poolId === poolId &&
						sample.windowId === windowId &&
						sample.modelId === modelId &&
						sample.observedAtMs === observedAtMs,
				);
				if (duplicate) continue;
				const previous = this.#state.samples.findLast(
					sample => sample.poolId === poolId && sample.windowId === windowId && sample.modelId === modelId,
				);
				const resetAtMs = limit.window?.resetsAt;
				const resetRebaseline =
					previous &&
					((resetAtMs !== undefined && previous.resetAtMs !== undefined && resetAtMs !== previous.resetAtMs) ||
						remaining > previous.remainingPercent);
				const elapsedHours = previous && !resetRebaseline ? (observedAtMs - previous.observedAtMs) / 3_600_000 : 0;
				const burn =
					previous && elapsedHours > 0 ? Math.max(0, (previous.remainingPercent - remaining) / elapsedHours) : 0;
				const emaBurnPerHour =
					previous && !resetRebaseline
						? previous.emaBurnPerHour * (1 - this.#settings.emaAlpha) + burn * this.#settings.emaAlpha
						: burn;
				const sample: QuotaSample = {
					poolId,
					windowId,
					modelId,
					observedAtMs,
					remainingPercent: numberInRange(remaining, 0, 0, 100),
					resetAtMs,
					emaBurnPerHour,
				};
				this.#state.samples.push(sample);
				observed.push(sample);
			}
		}
		this.#state = compactQuotaAdmissionState(this.#state);
		return observed;
	}

	recordRetry(signal: QuotaRetrySignal): void {
		const until = signal.retryAtMs ?? signal.resetAtMs;
		if (until && Number.isFinite(until)) this.#rateWaits.set(`${signal.providerId}/${signal.modelId}`, until);
	}

	admit(model: QuotaModel, candidates: readonly QuotaModel[] = [], nowMs = Date.now()): QuotaDecision {
		if (!this.#settings.enabled) return this.#record({ atMs: nowMs, model, outcome: "admit" });
		const pressure = this.#pressureFor(model, nowMs);
		if (!pressure) return this.#recordAdmit(model, nowMs);
		const alternative = this.#bestReliefCandidate(candidates, pressure, nowMs);
		if (alternative) {
			return this.#record({
				atMs: nowMs,
				model,
				outcome: "reroute",
				poolId: pressure.poolId,
				windowId: pressure.windowId,
				reason: pressure.reason,
				routedModel: alternative,
				ratePerHour: pressure.emaBurnPerHour,
				projectedEmptyAt: pressure.projectedEmptyAtMs,
				deficitPerHour: pressure.deficitPerHour,
				resetAt: pressure.resetAtMs,
			});
		}
		return this.#record({
			atMs: nowMs,
			model,
			outcome: "block",
			poolId: pressure.poolId,
			windowId: pressure.windowId,
			reason: pressure.reason,
			ratePerHour: pressure.emaBurnPerHour,
			projectedEmptyAt: pressure.projectedEmptyAtMs,
			deficitPerHour: pressure.deficitPerHour,
			resetAt: pressure.resetAtMs,
		});
	}

	#bestReliefCandidate(candidates: readonly QuotaModel[], pressure: QuotaPressure, nowMs: number): QuotaModel | undefined {
		let best: { model: QuotaModel; score: number } | undefined;
		for (const candidate of candidates) {
			const healthyKeys = this.#healthyKeysFor(candidate, nowMs).filter(
				key => !this.#quotaKeysOverlap(key, pressure),
			);
			if (healthyKeys.length === 0) continue;
			const remaining = Math.min(...healthyKeys.map(key => key.remainingPercent));
			const score = (candidate.capacityWeight ?? 1) * remaining;
			if (!best || score > best.score) best = { model: candidate, score };
		}
		return best?.model;
	}

	#pressureFor(model: QuotaModel, nowMs: number): QuotaPressure | undefined {
		const waitUntil = this.#rateWaits.get(`${model.providerId}/${model.modelId}`);
		if (waitUntil !== undefined && waitUntil > nowMs) {
			return {
				poolId: `${model.providerId}:rate-wait`,
				windowId: "retry",
				modelId: model.modelId,
				remainingPercent: 0,
				resetAtMs: waitUntil,
				emaBurnPerHour: 0,
				deficitPerHour: 0,
				reason: "rate-wait",
			};
		}
		const samplesByPool = new Map<string, QuotaSample[]>();
		for (const sample of this.#latestSamplesFor(model, nowMs)) {
			const samples = samplesByPool.get(sample.poolId);
			if (samples) samples.push(sample);
			else samplesByPool.set(sample.poolId, [sample]);
		}
		let firstPressure: QuotaPressure | undefined;
		for (const samples of samplesByPool.values()) {
			const poolPressure = samples.map(sample => this.#pressureForSample(model, sample, nowMs)).find(Boolean);
			if (!poolPressure) return undefined;
			firstPressure ??= poolPressure;
		}
		return firstPressure;
	}

	#latestSamplesFor(model: QuotaModel, nowMs: number): QuotaSample[] {
		const latest = new Map<string, QuotaSample>();
		for (const sample of this.#state.samples) {
			if (!sample.poolId.startsWith(`${model.providerId}:`) || !modelMatches(sample, model)) continue;
			if (!isQuotaSampleFresh(sample, nowMs)) continue;
			if (sample.resetAtMs !== undefined && sample.resetAtMs <= nowMs) continue;
			const key = `${sample.poolId}\0${sample.windowId}\0${sample.modelId}`;
			const previous = latest.get(key);
			if (!previous || sample.observedAtMs > previous.observedAtMs) latest.set(key, sample);
		}
		return [...latest.values()];
	}

	#recordAdmit(model: QuotaModel, nowMs: number): QuotaDecision {
		const samples = this.#latestSamplesFor(model, nowMs);
		const primary = samples[0];
		const decision: QuotaDecision = {
			atMs: nowMs,
			model,
			outcome: "admit",
			poolId: primary?.poolId,
			windowId: primary?.windowId,
			ratePerHour: primary?.emaBurnPerHour,
			resetAt: primary?.resetAtMs,
		};
		for (let index = 1; index < samples.length; index++) {
			const sample = samples[index];
			this.#state.decisions.push({
				atMs: nowMs,
				model,
				outcome: "admit",
				poolId: sample.poolId,
				windowId: sample.windowId,
				ratePerHour: sample.emaBurnPerHour,
				resetAt: sample.resetAtMs,
			});
		}
		return this.#record(decision);
	}

	#healthyKeysFor(model: QuotaModel, nowMs: number): Array<{ poolId: string; windowId: string; modelId: string; remainingPercent: number }> {
		const waitUntil = this.#rateWaits.get(`${model.providerId}/${model.modelId}`);
		if (waitUntil !== undefined && waitUntil > nowMs) return [];
		const samples = this.#latestSamplesFor(model, nowMs);
		const pressures = samples
			.map(sample => this.#pressureForSample(model, sample, nowMs))
			.filter((pressure): pressure is QuotaPressure => pressure !== undefined);
		const keys: Array<{ poolId: string; windowId: string; modelId: string; remainingPercent: number }> = [];
		for (const sample of samples) {
			if (pressures.some(pressure => this.#quotaKeysOverlap(sample, pressure))) continue;
			keys.push({
				poolId: sample.poolId,
				windowId: sample.windowId,
				modelId: sample.modelId,
				remainingPercent: sample.remainingPercent,
			});
		}
		return keys;
	}

	#quotaKeysOverlap(
		left: { poolId: string; windowId: string; modelId: string },
		right: { poolId: string; windowId: string; modelId: string },
	): boolean {
		return (
			left.poolId === right.poolId &&
			left.windowId === right.windowId &&
			(left.modelId === "*" || right.modelId === "*" || left.modelId === right.modelId)
		);
	}

	#pressureForSample(model: QuotaModel, sample: QuotaSample, nowMs: number): QuotaPressure | undefined {
		const latestKeyedDecision = this.#state.decisions.findLast(
			decision =>
				decision.poolId === sample.poolId &&
				decision.windowId === sample.windowId &&
				(sample.modelId === "*" || decision.model.modelId === sample.modelId),
		);
		const previouslyBlocked = latestKeyedDecision !== undefined && latestKeyedDecision.outcome !== "admit";
		const reserve = this.#settings.reservePercent + (previouslyBlocked ? this.#settings.hysteresisPercent : 0);
		const remainingAboveReserve = sample.remainingPercent - reserve;
		const hoursToReset =
			sample.resetAtMs !== undefined && sample.resetAtMs > nowMs ? (sample.resetAtMs - nowMs) / 3_600_000 : undefined;
		const projectedEmptyAtMs =
			sample.emaBurnPerHour > 0 && remainingAboveReserve > 0
				? sample.observedAtMs + (remainingAboveReserve / sample.emaBurnPerHour) * 3_600_000
				: undefined;
		const allowedBurn = hoursToReset !== undefined && hoursToReset > 0 ? remainingAboveReserve / hoursToReset : undefined;
		const deficitPerHour =
			allowedBurn !== undefined ? Math.max(0, sample.emaBurnPerHour - Math.max(0, allowedBurn)) : 0;
		if (sample.remainingPercent <= reserve) {
			return {
				poolId: sample.poolId,
				windowId: sample.windowId,
				modelId: sample.modelId,
				remainingPercent: sample.remainingPercent,
				resetAtMs: sample.resetAtMs,
				emaBurnPerHour: sample.emaBurnPerHour,
				projectedEmptyAtMs,
				deficitPerHour,
				reason: "reserve",
			};
		}
		if (projectedEmptyAtMs !== undefined && (sample.resetAtMs === undefined || projectedEmptyAtMs < sample.resetAtMs)) {
			return {
				poolId: sample.poolId,
				windowId: sample.windowId,
				modelId: sample.modelId,
				remainingPercent: sample.remainingPercent,
				resetAtMs: sample.resetAtMs,
				emaBurnPerHour: sample.emaBurnPerHour,
				projectedEmptyAtMs,
				deficitPerHour,
				reason: "projected-empty",
			};
		}
		return undefined;
	}

	#record(decision: QuotaDecision): QuotaDecision {
		this.#state.decisions.push(decision);
		this.#state = compactQuotaAdmissionState(this.#state);
		return decision;
	}
}
