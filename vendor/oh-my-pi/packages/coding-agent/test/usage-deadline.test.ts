import { describe, expect, it } from "bun:test";
import type { UsageReport } from "../../ai/src/usage";
import { createUsageDeadlineFormatter } from "../src/slash-commands/helpers/usage-deadline";
import { renderUsageReports } from "../src/slash-commands/helpers/usage-report";

const PACIFIC = "America/Los_Angeles";

describe("createUsageDeadlineFormatter", () => {
	it("shows same-day and next-day local deadlines with timezone and relative duration", () => {
		const nowMs = Date.parse("2026-07-26T17:00:00Z");
		const formatDeadline = createUsageDeadlineFormatter(nowMs, PACIFIC);

		expect(formatDeadline(Date.parse("2026-07-26T20:00:00Z"))).toBe("Jul 26, 2026 at 1:00 PM PDT (in 3h)");
		expect(formatDeadline(Date.parse("2026-07-27T17:00:00Z"))).toBe("Jul 27, 2026 at 10:00 AM PDT (in 24h)");
	});

	it("uses the deadline's DST offset in the injected timezone", () => {
		const nowMs = Date.parse("2026-03-08T09:30:00Z");
		const formatDeadline = createUsageDeadlineFormatter(nowMs, PACIFIC);

		expect(formatDeadline(Date.parse("2026-03-08T09:30:00Z"))).toBe("Mar 8, 2026 at 1:30 AM PST (due now)");
		expect(formatDeadline(Date.parse("2026-03-08T10:30:00Z"))).toBe("Mar 8, 2026 at 3:30 AM PDT (in 1h)");
	});

	it("distinguishes overdue, unknown, and absent deadlines", () => {
		const nowMs = Date.parse("2026-07-26T17:00:00Z");
		const formatDeadline = createUsageDeadlineFormatter(nowMs, PACIFIC);

		expect(formatDeadline(nowMs - 2 * 60 * 60 * 1000)).toBe("Jul 26, 2026 at 8:00 AM PDT (overdue by 2h)");
		expect(formatDeadline(Number.NaN)).toBe("unknown time");
		expect(formatDeadline(undefined)).toBeUndefined();
	});
});

describe("compact usage deadline projection", () => {
	it("renders limit resets and provider-reported saved-reset expiry with the same formatter", () => {
		const nowMs = Date.parse("2026-07-26T17:00:00Z");
		const resetsAt = Date.parse("2026-07-26T20:00:00Z");
		const expiresAt = Date.parse("2026-07-27T17:00:00Z");
		const report: UsageReport = {
			provider: "openai-codex",
			fetchedAt: nowMs,
			limits: [
				{
					id: "codex-5h",
					label: "5 hours",
					scope: { provider: "openai-codex", accountId: "account-1" },
					window: { id: "5h", label: "5 hours", resetsAt },
					amount: { usedFraction: 0.24, unit: "percent" },
				},
			],
			resetCredits: { availableCount: 1, expiresAt },
			metadata: { email: "user@example.com" },
		};

		const text = renderUsageReports([report], nowMs, PACIFIC);

		expect(text).toContain("resets Jul 26, 2026 at 1:00 PM PDT (in 3h)");
		expect(text).toContain("1 saved rate-limit reset available · expires Jul 27, 2026 at 10:00 AM PDT (in 24h)");
	});

	it("omits the reset row when the provider reports no reset time", () => {
		const nowMs = Date.parse("2026-07-26T17:00:00Z");
		const report: UsageReport = {
			provider: "anthropic",
			fetchedAt: nowMs,
			limits: [
				{
					id: "claude-5h",
					label: "5 hours",
					scope: { provider: "anthropic" },
					window: { id: "5h", label: "5 hours" },
					amount: { usedFraction: 0.2, unit: "percent" },
				},
			],
		};

		const text = renderUsageReports([report], nowMs, PACIFIC);

		expect(text).not.toContain("  resets ");
	});
});
