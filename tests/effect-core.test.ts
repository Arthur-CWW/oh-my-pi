import { describe, expect, it } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import {
	decodeWebSearchConfig,
	requireEnv,
} from "../src/effect/core/Config.ts";

describe("effect config", () => {
	it("decodes web-search config with old and new provider keys", async () => {
		const config = await Effect.runPromise(
			decodeWebSearchConfig({
				searchProvider: "gemini",
				curateWindow: 12.9,
				autoFilter: { enabled: true, model: "gemini-2.5-flash" },
				shortcuts: { curate: "ctrl+shift+s" },
			}),
		);

		expect(config.provider).toBe("gemini");
		expect(config.curateWindow).toBe(12);
		expect(config.autoFilter?.enabled).toBe(true);
		expect(config.shortcuts?.curate).toBe("ctrl+shift+s");
		expect(config.shortcuts?.activity).toBe("ctrl+shift+w");
	});

	it("decodes kagi provider and defaults unknown providers to auto", async () => {
		const kagiConfig = await Effect.runPromise(
			decodeWebSearchConfig({
				provider: "kagi",
			}),
		);
		const unknownConfig = await Effect.runPromise(
			decodeWebSearchConfig({
				provider: "not-a-provider",
			}),
		);

		expect(kagiConfig.provider).toBe("kagi");
		expect(unknownConfig.provider).toBe("auto");
	});

	it("returns typed missing env errors", async () => {
		const key = "PI_WEB_ACCESS_TEST_MISSING_ENV";
		delete process.env[key];
		const result = await Effect.runPromiseExit(requireEnv(key));

		expect(Exit.isFailure(result)).toBe(true);
		if (Exit.isFailure(result)) {
			const failure = Cause.findErrorOption(result.cause);
			expect(failure._tag).toBe("Some");
		}
	});
});
