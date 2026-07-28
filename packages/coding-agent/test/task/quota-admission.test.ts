import { describe, expect, it } from "bun:test";
import type { UsageLimit, UsageReport } from "@oh-my-pi/pi-ai";
import {
	MAX_QUOTA_SAMPLE_KEYS,
	QUOTA_SAMPLE_MAX_AGE_MS,
	QuotaAdmissionController,
	createQuotaAdmissionStateRecord,
	latestQuotaAdmissionState,
	type QuotaAdmissionState,
	type QuotaModel,
} from "../../src/task/quota-admission";

const HOUR = 3_600_000;
const now = 1_800_000_000_000;

function limit(args: {
	id: string;
	remaining: number;
	modelId?: string;
	accountId?: string;
	resetAt?: number;
	shared?: boolean;
}): UsageLimit {
	return {
		id: args.id,
		label: args.id,
		scope: {
			provider: "openai-codex",
			accountId: args.accountId,
			modelId: args.modelId,
			shared: args.shared,
		},
		window: { id: args.id, label: args.id, resetsAt: args.resetAt },
		amount: { remainingFraction: args.remaining / 100, unit: "percent" },
	};
}

function report(provider: UsageReport["provider"], fetchedAt: number, limits: UsageLimit[], metadata?: Record<string, unknown>): UsageReport {
	return { provider, fetchedAt, limits, metadata };
}

function model(providerId: string, modelId: string, capacityWeight?: number): QuotaModel {
	return { providerId, modelId, selector: `${providerId}/${modelId}`, capacityWeight };
}

describe("QuotaAdmissionController", () => {
	it("does not treat shared same-pool aliases as relief", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5, hysteresisPercent: 0 });
		controller.observeReports([
			report("openai-codex", now, [limit({ id: "5h", remaining: 4, shared: true, resetAt: now + HOUR })]),
		]);

		const decision = controller.admit(model("openai-codex", "luna"), [model("openai-codex", "sol"), model("openai-codex", "terra")], now);

		expect(decision.outcome).toBe("block");
		expect(decision.routedModel).toBeUndefined();
	});

	it("reroutes automatic selection to a healthy independent pool", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5, hysteresisPercent: 0 });
		controller.observeReports([
			report("openai-codex", now, [limit({ id: "5h", remaining: 3, modelId: "luna", accountId: "a", resetAt: now + HOUR })]),
			report("openai-codex", now, [limit({ id: "5h", remaining: 90, modelId: "sol", accountId: "b", resetAt: now + HOUR })]),
		]);

		const decision = controller.admit(model("openai-codex", "luna"), [model("openai-codex", "sol")], now);

		expect(decision.outcome).toBe("reroute");
		expect(decision.routedModel?.modelId).toBe("sol");
		expect(decision.poolId).toBeDefined();
		expect(decision.windowId).toBe("5h");
	});

	it("admits same-provider model when another credential pool is healthy", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5, hysteresisPercent: 0 });
		controller.observeReports([
			report("openai-codex", now, [limit({ id: "5h", remaining: 3, accountId: "a", resetAt: now + HOUR })]),
			report("openai-codex", now, [limit({ id: "5h", remaining: 90, accountId: "b", resetAt: now + HOUR })]),
		]);

		const decision = controller.admit(model("openai-codex", "luna"), [], now);

		expect(decision.outcome).toBe("admit");
	});

	it("reroutes to same credential only when the model/window scope is independent", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5, hysteresisPercent: 0 });
		controller.observeReports([
			report("openai-codex", now, [
				limit({ id: "5h", remaining: 3, modelId: "luna", accountId: "a", resetAt: now + HOUR }),
				limit({ id: "5h", remaining: 90, modelId: "sol", accountId: "a", resetAt: now + HOUR }),
			]),
		]);

		const decision = controller.admit(model("openai-codex", "luna"), [model("openai-codex", "sol")], now);

		expect(decision.outcome).toBe("reroute");
		expect(decision.routedModel?.modelId).toBe("sol");
	});


	it("blocks explicit override instead of silently rerouting", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5, hysteresisPercent: 0 });
		controller.observeReports([
			report("openai-codex", now, [limit({ id: "5h", remaining: 3, modelId: "luna", accountId: "a", resetAt: now + HOUR })]),
			report("anthropic", now, [
				{ ...limit({ id: "5h", remaining: 90, accountId: "b", resetAt: now + HOUR }), scope: { provider: "anthropic", accountId: "b" } },
			]),
		]);

		const explicitDecision = controller.admit(model("openai-codex", "luna"), [], now);

		expect(explicitDecision.outcome).toBe("block");
		expect(explicitDecision.routedModel).toBeUndefined();
	});

	it("uses reserve hysteresis and clears it after keyed healthy admission", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5, hysteresisPercent: 2 });
		const primary = model("openai-codex", "luna");
		controller.observeReports([
			report("openai-codex", now, [limit({ id: "5h", remaining: 4, accountId: "a", resetAt: now + 10 * HOUR })]),
		]);
		expect(controller.admit(primary, [], now).outcome).toBe("block");

		controller.observeReports([
			report("openai-codex", now + HOUR, [limit({ id: "5h", remaining: 6, accountId: "a", resetAt: now + 10 * HOUR })]),
		]);
		expect(controller.admit(primary, [], now + HOUR).outcome).toBe("block");

		controller.observeReports([
			report("openai-codex", now + 2 * HOUR, [limit({ id: "5h", remaining: 8, accountId: "a", resetAt: now + 10 * HOUR })]),
		]);
		expect(controller.admit(primary, [], now + 2 * HOUR).outcome).toBe("admit");

		controller.observeReports([
			report("openai-codex", now + 3 * HOUR, [limit({ id: "5h", remaining: 6, accountId: "a", resetAt: now + 4 * HOUR })]),
		]);
		expect(controller.admit(primary, [], now + 3 * HOUR).outcome).toBe("admit");
	});

	it("rebaselines EMA after reset and ignores duplicate cached observations", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5, emaAlpha: 0.5, hysteresisPercent: 0 });
		controller.observeReports([
			report("openai-codex", now, [limit({ id: "5h", remaining: 50, accountId: "a", resetAt: now + 5 * HOUR })]),
			report("openai-codex", now + HOUR, [limit({ id: "5h", remaining: 30, accountId: "a", resetAt: now + 5 * HOUR })]),
		]);
		const beforeReset = controller.admit(model("openai-codex", "luna"), [], now + HOUR);
		expect(beforeReset.outcome).toBe("block");
		expect(beforeReset.reason).toBe("projected-empty");

		controller.observeReports([
			report("openai-codex", now + 2 * HOUR, [limit({ id: "5h", remaining: 100, accountId: "a", resetAt: now + 7 * HOUR })]),
			report("openai-codex", now + 2 * HOUR, [limit({ id: "5h", remaining: 100, accountId: "a", resetAt: now + 7 * HOUR })]),
		]);
		const afterReset = controller.admit(model("openai-codex", "luna"), [], now + 2 * HOUR);
		expect(afterReset.outcome).toBe("admit");
		expect(controller.state.samples).toHaveLength(2);
	});

	it("does not mutate active decisions when recording a retry for future admissions", () => {
		const controller = new QuotaAdmissionController({ reservePercent: 5 });
		controller.observeReports([
			report("openai-codex", now, [limit({ id: "5h", remaining: 80, accountId: "a", resetAt: now + HOUR })]),
		]);
		const runningAdmission = controller.admit(model("openai-codex", "luna"), [], now);
		controller.recordRetry({ providerId: "openai-codex", modelId: "luna", retryAtMs: now + HOUR });
		const nextAdmission = controller.admit(model("openai-codex", "luna"), [], now + 1);

		expect(runningAdmission.outcome).toBe("admit");
		expect(nextAdmission.outcome).toBe("block");
		expect(controller.state.decisions[0]).toEqual(runningAdmission);
	});

	it("persists decision projection through quota admission custom state", () => {
		const state: QuotaAdmissionState = {
			samples: [],
			decisions: [
				{
					atMs: now,
					model: model("openai-codex", "luna"),
					outcome: "block",
					poolId: "openai-codex:pool:5h",
					windowId: "5h",
					reason: "reserve",
					ratePerHour: 12,
					projectedEmptyAt: now + HOUR,
					deficitPerHour: 4,
					resetAt: now + 2 * HOUR,
				},
			],
		};
		const restored = latestQuotaAdmissionState([
			{ id: "1", parentId: null, timestamp: new Date(now).toISOString(), type: "custom", customType: "quota_admission_state", data: createQuotaAdmissionStateRecord(state, now) },
		]);

		expect(restored?.decisions[0]?.poolId).toBe("openai-codex:pool:5h");
		expect(restored?.decisions[0]?.windowId).toBe("5h");
		expect(restored?.decisions[0]?.projectedEmptyAt).toBe(now + HOUR);
	});

	it("bounds persisted samples and decisions", () => {
		const samples = Array.from({ length: 6 }, (_, index) => ({
			poolId: "openai-codex:a",
			windowId: "5h",
			modelId: "*",
			observedAtMs: now + index,
			remainingPercent: 100 - index,
			emaBurnPerHour: index,
		}));
		const decisions = Array.from({ length: 140 }, (_, index) => ({
			atMs: now + index,
			model: model("openai-codex", "luna"),
			outcome: "admit" as const,
			poolId: "openai-codex:a",
			windowId: "5h",
		}));

		const controller = new QuotaAdmissionController({}, { samples, decisions });

		expect(controller.state.samples).toHaveLength(2);
		expect(controller.state.samples.map(sample => sample.observedAtMs)).toEqual([now + 4, now + 5]);
		expect(controller.state.decisions).toHaveLength(128);
		expect(controller.state.decisions[0]?.atMs).toBe(now + 12);
	});
	it("globally bounds retained samples across distinct quota keys", () => {
		const samples = Array.from({ length: MAX_QUOTA_SAMPLE_KEYS + 36 }, (_, index) => ({
			poolId: `openai-codex:account-${index}`,
			windowId: "5h",
			modelId: "*",
			observedAtMs: now + index,
			remainingPercent: 100,
			emaBurnPerHour: 0,
		}));

		const controller = new QuotaAdmissionController({}, { samples, decisions: [] });

		expect(controller.state.samples).toHaveLength(MAX_QUOTA_SAMPLE_KEYS);
		expect(controller.state.samples.map(sample => sample.poolId)).toEqual(
			Array.from({ length: MAX_QUOTA_SAMPLE_KEYS }, (_, index) => `openai-codex:account-${index + 36}`),
		);
	});

	it("drops aged samples before retaining quota-key groups", () => {
		const observedAtMs = Date.now();
		const controller = new QuotaAdmissionController(
			{},
			{
				samples: [
					{
						poolId: "openai-codex:expired-account",
						windowId: "5h",
						modelId: "*",
						observedAtMs: observedAtMs - QUOTA_SAMPLE_MAX_AGE_MS - 1,
						remainingPercent: 1,
						emaBurnPerHour: 0,
					},
					{
						poolId: "openai-codex:fresh-account",
						windowId: "5h",
						modelId: "*",
						observedAtMs,
						remainingPercent: 1,
						emaBurnPerHour: 0,
					},
				],
				decisions: [],
			},
		);

		expect(controller.state.samples.map(sample => sample.poolId)).toEqual(["openai-codex:fresh-account"]);
	});

	it("allows admission when stale retained quota state no longer applies", () => {
		const primary = model("openai-codex", "luna");
		const state: QuotaAdmissionState = {
			samples: [
				{
					poolId: "openai-codex:account-a",
					windowId: "5h",
					modelId: "*",
					observedAtMs: now,
					remainingPercent: 1,
					resetAtMs: now + QUOTA_SAMPLE_MAX_AGE_MS + HOUR,
					emaBurnPerHour: 0,
				},
			],
			decisions: [],
		};
		const entries = [
			{
				id: "1",
				parentId: null,
				timestamp: new Date(now).toISOString(),
				type: "custom" as const,
				customType: "quota_admission_state" as const,
				data: createQuotaAdmissionStateRecord(state, now),
			},
		];
		const atFreshnessBoundary = now + QUOTA_SAMPLE_MAX_AGE_MS;
		const restored = latestQuotaAdmissionState(entries, { nowMs: atFreshnessBoundary });
		const stale = latestQuotaAdmissionState(entries, { nowMs: atFreshnessBoundary + 1 });
		const boundaryController = new QuotaAdmissionController({}, restored ?? { samples: [], decisions: [] });
		const staleController = new QuotaAdmissionController({}, stale ?? { samples: [], decisions: [] });

		expect(boundaryController.admit(primary, [], atFreshnessBoundary).outcome).toBe("block");
		expect(staleController.admit(primary, [], atFreshnessBoundary + 1).outcome).toBe("admit");
	});
});
