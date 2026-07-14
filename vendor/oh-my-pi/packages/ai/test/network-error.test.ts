import { describe, expect, it } from "bun:test";
import {
	classifyAbortReason,
	classifyRequestFailure,
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
		expect(classifyRequestFailure("Request was aborted")).toBe("parent-cancel");
		expect(classifyRequestFailure("HTTP 429 too many requests")).toBe("rate-limit");
		expect(classifyRequestFailure("fetch failed")).toBe("network");
	});

	it("distinguishes user interrupt, parent cancellation, and timeout abort reasons", () => {
		expect(classifyAbortReason("Interrupted by user")).toBe("user-interrupt");
		expect(classifyAbortReason(undefined)).toBe("parent-cancel");
		expect(classifyAbortReason(new Error("Request timed out"))).toBe("timeout");
	});
});
