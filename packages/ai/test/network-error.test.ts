import { describe, expect, it } from "bun:test";
import {
	classifyAbortReason,
	classifyRequestFailure,
	getProviderClassifierRefusalCategory,
	isTransientNetworkError,
	ProviderRequestError,
} from "@oh-my-pi/pi-ai";

const NETWORK_CODES = [
	"ENOTFOUND",
	"EAI_AGAIN",
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"EHOSTUNREACH",
	"ENETUNREACH",
] as const;

describe("isTransientNetworkError", () => {
	it("classifies supported system codes through fetch cause chains", () => {
		for (const code of NETWORK_CODES) {
			const cause = new Error(`socket failed: ${code}`) as Error & { code: string };
			cause.code = code;
			expect(isTransientNetworkError(new TypeError("fetch failed", { cause }))).toBe(true);
		}
	});

	it("classifies provider string surfaces without treating HTTP failures as network outages", () => {
		expect(isTransientNetworkError("fetch failed")).toBe(true);
		expect(isTransientNetworkError("socket hang up")).toBe(true);
		expect(isTransientNetworkError("socket hangup")).toBe(true);
		expect(isTransientNetworkError("HTTP 429 too many requests")).toBe(false);
		expect(isTransientNetworkError("provider returned HTTP 503 service unavailable")).toBe(false);
		expect(isTransientNetworkError("HTTP 401 unauthorized")).toBe(false);
	});
});

describe("request failure taxonomy", () => {
	it("prefers structured provider causes and classifies legacy opaque surfaces", () => {
		const stall = new ProviderRequestError("Anthropic stream stalled while waiting for the next event", {
			failureCause: "provider-stream-abort",
		});
		expect(classifyRequestFailure(stall)).toBe("provider-stream-abort");
		expect(classifyRequestFailure("Request was aborted")).toBe("network");
		expect(classifyRequestFailure("HTTP 429 too many requests")).toBe("rate-limit");
		expect(classifyRequestFailure("fetch failed")).toBe("network");
	});

	it("recognizes only structured refusals carrying a classifier category", () => {
		expect(
			getProviderClassifierRefusalCategory({
				stopReason: "error",
				stopDetails: { type: "refusal", category: " policy " },
			}),
		).toBe("policy");
		expect(
			getProviderClassifierRefusalCategory({
				stopReason: "error",
				stopDetails: { type: "refusal" },
			}),
		).toBeUndefined();
		expect(
			getProviderClassifierRefusalCategory({
				stopReason: "error",
				stopDetails: { type: "pause_turn", category: "policy" },
			}),
		).toBeUndefined();
	});

	it("requires a fired caller signal to classify an abort-shaped SDK error as cancellation", () => {
		const active = new AbortController();
		expect(classifyRequestFailure("Request was aborted", active.signal)).toBe("network");

		const parentCancelled = new AbortController();
		parentCancelled.abort();
		expect(classifyRequestFailure("Request was aborted", parentCancelled.signal)).toBe("parent-cancel");

		const userInterrupted = new AbortController();
		userInterrupted.abort("Interrupted by user");
		expect(classifyRequestFailure("Operation aborted", userInterrupted.signal)).toBe("user-interrupt");

		const timedOut = new AbortController();
		timedOut.abort(new Error("Request timed out"));
		expect(classifyRequestFailure("Request was aborted", timedOut.signal)).toBe("timeout");
	});

	it("distinguishes user interrupt, parent cancellation, and timeout abort reasons", () => {
		expect(classifyAbortReason("Interrupted by user")).toBe("user-interrupt");
		expect(classifyAbortReason(undefined)).toBe("parent-cancel");
		expect(classifyAbortReason(new Error("Request timed out"))).toBe("timeout");
	});
});
