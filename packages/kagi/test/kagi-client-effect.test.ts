import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type {
	KagiAdvancedRedirectResult,
	KagiLensDiscoveryResult,
	KagiRuleMutationResult,
	KagiSessionState,
} from "../src/kagi-client.js";
import {
	discoverKagiLensesEffect,
	loadKagiSessionEffect,
	parseKagiVideoRuleTargetEffect,
	refreshAndSaveKagiSessionEffect,
	runKagiAdvancedSearchRedirectEffect,
	runKagiDomainRuleSetEffect,
} from "../src/kagi-client-effect.js";

function baseSession(): KagiSessionState {
	return {
		capturedAt: "2026-03-12T00:00:00.000Z",
		browserUrl: "http://localhost:9222",
		baseUrl: "https://kagi.com",
		userAgent: "UA",
		language: "en-US",
		languages: ["en-US", "en"],
		doNotTrack: null,
		secChUa: null,
		secChUaMobile: null,
		secChUaPlatform: null,
		kagiSessionCookie: "cookie-token",
		sessionApiId: "session-api-id",
		cookies: [],
	};
}

function baseDiscoveryResult(overrides: Partial<KagiLensDiscoveryResult>): KagiLensDiscoveryResult {
	return {
		capturedAt: "2026-03-12T00:00:00.000Z",
		status: 200,
		ok: true,
		requestUrl: "https://kagi.com/search?q=effect",
		responseHeaders: {},
		lenses: [],
		lensMap: {},
		...overrides,
	};
}

function baseAdvancedRedirectResult(overrides: Partial<KagiAdvancedRedirectResult>): KagiAdvancedRedirectResult {
	return {
		capturedAt: "2026-03-12T00:00:00.000Z",
		status: 302,
		location: "/search?q=effect",
		requestUrl: "https://kagi.com/search/advanced",
		redirectedSearchUrl: "https://kagi.com/search?q=effect",
		responseHeaders: {},
		postBody: "all_words=effect",
		...overrides,
	};
}

function baseRuleMutationResult(overrides: Partial<KagiRuleMutationResult>): KagiRuleMutationResult {
	return {
		capturedAt: "2026-03-12T00:00:00.000Z",
		status: 200,
		ok: true,
		requestUrl: "https://kagi.com/esr/user_rules",
		requestBody: "domain=github.com&kind=1",
		responseHeaders: {},
		...overrides,
	};
}

describe("kagi client effect interfaces", () => {
	it("refreshes and saves session data at the package boundary", async () => {
		const session = baseSession();
		const result = await Effect.runPromise(
			refreshAndSaveKagiSessionEffect(
				{
					browserUrl: "http://localhost:9333",
					sessionPath: "/tmp/kagi-session.json",
				},
				{
					captureSessionFromChrome: async (browserUrl) => {
						expect(browserUrl).toBe("http://localhost:9333");
						return session;
					},
					saveSession: (value, filePath) => {
						expect(value).toEqual(session);
						expect(filePath).toBe("/tmp/kagi-session.json");
						return filePath ?? "";
					},
				},
			),
		);

		expect(result.session).toEqual(session);
		expect(result.saved).toBe("/tmp/kagi-session.json");
	});

	it("classifies missing stored session as session-unavailable", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				loadKagiSessionEffect("/tmp/missing-session.json", {
					loadSession: () => {
						throw new Error("Kagi session file not found: /tmp/missing-session.json");
					},
				}),
			),
		);

		expect(error.code).toBe("session-unavailable");
		expect(error.operation).toBe("session:load");
		expect(error.reason).toContain("missing-session.json");
	});

	it("classifies lens discovery authorization failures inside the package boundary", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				discoverKagiLensesEffect(baseSession(), { query: "effect" }, {
					discoverLenses: async () =>
						baseDiscoveryResult({
							status: 403,
							ok: false,
							requestUrl: "https://kagi.com/search?q=effect",
						}),
				}),
			),
		);

		expect(error.code).toBe("forbidden");
		expect(error.operation).toBe("lenses:list");
		expect(error.status).toBe(403);
		expect(error.requestUrl).toBe("https://kagi.com/search?q=effect");
	});

	it("treats advanced redirect responses as successful package results", async () => {
		const result = await Effect.runPromise(
			runKagiAdvancedSearchRedirectEffect(baseSession(), { site: "gwern.net" }, {
				runAdvancedSearchRedirect: async () =>
					baseAdvancedRedirectResult({
						status: 302,
						location: "/search?q=gwern.net",
						redirectedSearchUrl: "https://kagi.com/search?q=gwern.net",
					}),
			}),
		);

		expect(result.status).toBe(302);
		expect(result.redirectedSearchUrl).toBe("https://kagi.com/search?q=gwern.net");
	});

	it("classifies domain rule transport failures as request-failed", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				runKagiDomainRuleSetEffect(baseSession(), "github.com", 1, {
					runDomainRuleSet: async () => {
						throw new Error("socket hang up");
					},
				}),
			),
		);

		expect(error.code).toBe("request-failed");
		expect(error.operation).toBe("rules:domain:set");
		expect(error.reason).toContain("socket hang up");
	});

	it("classifies unsupported video targets as invalid-target", async () => {
		const error = await Effect.runPromise(
			Effect.flip(
				parseKagiVideoRuleTargetEffect("vimeo.com/channels/staffpicks", undefined, {
					parseVideoRuleTargetFromDomain: () => {
						throw new Error("Unsupported video rule target: vimeo.com/channels/staffpicks");
					},
				}),
			),
		);

		expect(error.code).toBe("invalid-target");
		expect(error.operation).toBe("rules:video:target");
		expect(error.reason).toContain("Unsupported video rule target");
	});

	it("preserves successful rule mutation payloads", async () => {
		const result = await Effect.runPromise(
			runKagiDomainRuleSetEffect(baseSession(), "github.com", 1, {
				runDomainRuleSet: async () =>
					baseRuleMutationResult({
						status: 200,
						requestUrl: "https://kagi.com/esr/user_rules",
					}),
			}),
		);

		expect(result.ok).toBe(true);
		expect(result.requestUrl).toBe("https://kagi.com/esr/user_rules");
	});
});
