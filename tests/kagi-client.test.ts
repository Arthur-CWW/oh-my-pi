import { describe, expect, it } from "bun:test";
import {
	buildAdvancedSearchPostBody,
	buildMimicHeaders,
	buildSearchParams,
	extractLensesFromHtml,
	parseSse,
	parseVideoRuleTargetFromDomain,
	type KagiSessionState,
} from "../packages/kagi/src/kagi-client.js";

describe("kagi client helpers", () => {
	it("builds search params with built-in lens mapping and filters", () => {
		const params = buildSearchParams(
			{
				query: "strict aliasing c++",
				lens: "programming",
				region: "us",
				dateRange: 3,
				order: 4,
				direction: "desc",
				verbatim: true,
				personalized: false,
				additionalParams: { custom: "1" },
			},
			"nonce-1",
		);

		expect(params.get("q")).toBe("strict aliasing c++");
		expect(params.get("l")).toBe("2");
		expect(params.get("r")).toBe("us");
		expect(params.get("dr")).toBe("3");
		expect(params.get("order")).toBe("4");
		expect(params.get("dir")).toBe("desc");
		expect(params.get("verbatim")).toBe("1");
		expect(params.get("personalized")).toBe("0");
		expect(params.get("custom")).toBe("1");
		expect(params.get("nonce")).toBe("nonce-1");
	});

	it("prefers discovered lens map for custom account lenses", () => {
		const params = buildSearchParams(
			{
				query: "effector guide",
				lens: "ai labs",
				lensMap: {
					ai_labs: "42",
				},
			},
			"nonce-2",
		);

		expect(params.get("l")).toBe("42");
	});

	it("maps advanced search body fields across the full payload", () => {
		const params = buildAdvancedSearchPostBody({
			allWords: "alpha beta",
			exactWords: "quoted phrase",
			anyWords: "x y",
			noneWords: "z",
			region: "us",
			lastUpdate: 3,
			fromDate: "2024-01-01",
			toDate: "2026-01-31",
			site: "myanimelist.net",
			termsAppearing: "title",
			fileType: "pdf",
		});

		expect(params.get("all_words")).toBe("alpha beta");
		expect(params.get("exact_words")).toBe("quoted phrase");
		expect(params.get("any_words")).toBe("x y");
		expect(params.get("none_words")).toBe("z");
		expect(params.get("region")).toBe("us");
		expect(params.get("last_update")).toBe("3");
		expect(params.get("from_date")).toBe("2024-01-01");
		expect(params.get("to_date")).toBe("2026-01-31");
		expect(params.get("site")).toBe("myanimelist.net");
		expect(params.get("terms_appearing")).toBe("title");
		expect(params.get("file_type")).toBe("pdf");
	});

	it("normalizes advanced search defaults for omitted and any-terms modes", () => {
		const params = buildAdvancedSearchPostBody({
			termsAppearing: "any",
		});

		expect(params.get("all_words")).toBe("");
		expect(params.get("exact_words")).toBe("");
		expect(params.get("any_words")).toBe("");
		expect(params.get("none_words")).toBe("");
		expect(params.get("region")).toBe("");
		expect(params.get("last_update")).toBe("");
		expect(params.get("from_date")).toBe("");
		expect(params.get("to_date")).toBe("");
		expect(params.get("site")).toBe("");
		expect(params.get("terms_appearing")).toBe("");
		expect(params.get("file_type")).toBe("");
	});

	it("extracts dynamic lenses from search HTML anchors", () => {
		const html = `
			<div>
				<a href="/search?q=test">All</a>
				<a data-lens="programming" href="/search?q=test&l=2">Programming</a>
				<a data-lens="small web" href="/search?q=test&l=17">Small Web+</a>
			</div>
		`;
		const lenses = extractLensesFromHtml(html);

		expect(lenses.map((lens) => lens.key)).toContain("programming");
		expect(lenses.find((lens) => lens.key === "programming")?.value).toBe("2");
		expect(lenses.find((lens) => lens.key === "small_web")?.value).toBe("17");
		expect(lenses.find((lens) => lens.key === "all")?.value).toBeUndefined();
	});

	it("extracts dynamic lenses from embedded JSON lens descriptors", () => {
		const html = `
			<script>
				window.__DATA__ = {"lenses":[{"slug":"forums","id":1},{"id":5,"slug":"small_web"}]};
			</script>
		`;
		const lenses = extractLensesFromHtml(html);

		expect(lenses.find((lens) => lens.key === "forums")?.value).toBe("1");
		expect(lenses.find((lens) => lens.key === "small_web")?.value).toBe("5");
	});

	it("parses video domain targets", () => {
		const yt = parseVideoRuleTargetFromDomain("youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow", "Lofi Girl");
		expect(yt.platformId).toBe("you_tube");
		expect(yt.creatorId).toBe("UCSJ4gkVC6NrvII8umztf0Ow");
		expect(yt.creatorName).toBe("Lofi Girl");

		const tt = parseVideoRuleTargetFromDomain("tiktok.com/@somecreator");
		expect(tt.platformId).toBe("tiktok");
		expect(tt.creatorId).toBe("@somecreator");
	});

	it("throws for unsupported video targets", () => {
		expect(() => parseVideoRuleTargetFromDomain("vimeo.com/channels/staffpicks")).toThrow();
	});

	it("parses SSE blocks", () => {
		const raw = `hi\n\nid: 0\ndata: [{\"tag\":\"search.info\",\"payload\":{\"next_batch\":2}}]\n\nid: 1\ndata: plain text\n`;
		const parsed = parseSse(raw);
		expect(parsed.length).toBe(2);
		expect(parsed[0]?.id).toBe("0");
		expect(Array.isArray(parsed[0]?.dataJson)).toBe(true);
		expect(parsed[1]?.id).toBe("1");
		expect(parsed[1]?.dataJson).toBe("plain text");
	});

	it("builds mimic headers with cookie and x-kagi authorization", () => {
		const session: KagiSessionState = {
			capturedAt: "2026-01-01T00:00:00.000Z",
			browserUrl: "http://localhost:9222",
			baseUrl: "https://kagi.com",
			userAgent: "UA",
			language: "en-US",
			languages: ["en-US", "en"],
			doNotTrack: "1",
			secChUa: "\"Chromium\";v=\"145\"",
			secChUaMobile: "?0",
			secChUaPlatform: "macOS",
			kagiSessionCookie: "cookie-token",
			sessionApiId: "session-api-id",
			cookies: [
				{
					name: "kagi_session",
					value: "cookie-token",
					domain: "kagi.com",
					path: "/",
					expires: Date.now() / 1000 + 3600,
					httpOnly: true,
					secure: true,
					sameSite: "Lax",
				},
			],
		};

		const headers = buildMimicHeaders(session, new URL("https://kagi.com/search?q=test"));
		expect(headers.cookie).toContain("kagi_session=cookie-token");
		expect(headers["x-kagi-authorization"]).toBe("session-api-id");
		expect(headers["sec-ch-ua-platform"]).toBe("\"macOS\"");
	});
});
