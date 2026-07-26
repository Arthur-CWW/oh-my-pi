import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { ErrorInbox } from "../../../src/modes/utils/error-inbox";
import {
	buildRequestFailureDiagnostic,
	REQUEST_FAILURE_DETAIL_MAX_BYTES,
	shouldAwaitRetryDisposition,
} from "../../../src/modes/utils/request-failure-presentation";

function providerFailure(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-responses",
		provider: "openai",
		model: "synthetic-provider-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		timestamp: 1,
		...overrides,
	} as AssistantMessage;
}

const owner = { agent: "Main", session: "provider-failure-test" };
const gaveUp = { kind: "gave-up", attempt: 3 } as const;

describe("provider request failure notices", () => {
	test("journals the endpoint message at a UTF-8 bound without authorization material", () => {
		const authorization = "sk-live-authorization-material-1234567890";
		const apiKey = "key-provider-api-material-0987654321";
		const endpointMessage = "endpoint rejected unsupported dimension=3073";
		const message = providerFailure({
			errorStatus: 400,
			errorMessage:
				`HTTP 400 Authorization: Bearer ${authorization}\n` +
				`{"error":{"message":"${endpointMessage}${"x".repeat(3_000)}","x-api-key":"${apiKey}"}}`,
		});
		const diagnostic = buildRequestFailureDiagnostic(message, owner, gaveUp);

		expect(diagnostic.message).toContain(endpointMessage);
		expect(diagnostic.detail).toContain(endpointMessage);
		expect(diagnostic.detail).toContain("[REDACTED]");
		expect(diagnostic.message).not.toContain(authorization);
		expect(diagnostic.detail).not.toContain(authorization);
		expect(diagnostic.message).not.toContain(apiKey);
		expect(diagnostic.detail).not.toContain(apiKey);
		expect(new TextEncoder().encode(diagnostic.detail).byteLength).toBeLessThanOrEqual(
			REQUEST_FAILURE_DETAIL_MAX_BYTES,
		);
		expect(diagnostic.detail).toEndWith("…");

		const writes: Array<{ type: string; data: unknown }> = [];
		const inbox = new ErrorInbox({
			appendCustomEntry(type: string, data?: unknown) {
				writes.push({ type, data });
				return "notice-1";
			},
		});
		inbox.recordError(diagnostic, undefined, { nowMs: 1 });

		expect(writes).toHaveLength(1);
		expect(writes[0]?.type).toBe("ui_error");
		const durableNotice = writes[0]?.data as { message?: string; detail?: string; version?: number };
		expect(durableNotice.version).toBe(2);
		expect(durableNotice.message).toContain(endpointMessage);
		expect(durableNotice.detail).toBe(diagnostic.detail);
		expect(JSON.stringify(durableNotice)).not.toContain(authorization);
		expect(JSON.stringify(durableNotice)).not.toContain(apiKey);
	});

	test("surfaces an SDK error message in the notice headline and detail", () => {
		const endpointMessage = "deployment synthetic-blue is disabled by the endpoint";
		const diagnostic = buildRequestFailureDiagnostic(
			providerFailure({ errorMessage: `ProviderSDKError: ${endpointMessage}` }),
			owner,
			gaveUp,
		);

		expect(diagnostic.message).toContain(endpointMessage);
		expect(diagnostic.detail).toBe(`ProviderSDKError: ${endpointMessage}`);
	});

	test("uses structured refusal stop details when the SDK supplies no error message", () => {
		const endpointMessage = "classifier declined this request under policy safe-completion";
		const message = providerFailure({
			errorMessage: undefined,
			stopDetails: { type: "refusal", category: "policy", explanation: endpointMessage },
		});
		const diagnostic = buildRequestFailureDiagnostic(message, owner, gaveUp);

		expect(diagnostic.code).toBe("refusal");
		expect(diagnostic.detail).toContain("Provider stop reason: refusal category=policy");
		expect(diagnostic.detail).toContain(endpointMessage);
		expect(diagnostic.message).toContain(endpointMessage);
		expect(shouldAwaitRetryDisposition(message)).toBe(false);
	});
});
