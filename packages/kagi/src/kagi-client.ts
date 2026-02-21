import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";

export type KagiLens = string;

export type KagiTermsAppearing = "any" | "url" | "title";

export interface KagiCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	expires: number;
	httpOnly: boolean;
	secure: boolean;
	sameSite: "Strict" | "Lax" | "None" | "Unknown";
}

export interface KagiSessionState {
	capturedAt: string;
	browserUrl: string;
	baseUrl: string;
	userAgent: string;
	language: string;
	languages: string[];
	doNotTrack: string | null;
	secChUa: string | null;
	secChUaMobile: string | null;
	secChUaPlatform: string | null;
	kagiSessionCookie: string | null;
	sessionApiId: string | null;
	cookies: KagiCookie[];
}

export interface KagiLensDefinition {
	key: string;
	label: string;
	value: string | undefined;
	source: "dynamic" | "fallback";
}

export interface KagiLensDiscoveryResult {
	capturedAt: string;
	status: number;
	ok: boolean;
	requestUrl: string;
	responseHeaders: Record<string, string>;
	lenses: KagiLensDefinition[];
	lensMap: Record<string, string | undefined>;
}

export interface KagiSearchOptions {
	query: string;
	region?: string;
	lens?: KagiLens;
	lensMap?: Record<string, string | undefined>;
	dateRange?: 1 | 2 | 3 | 4;
	fromDate?: string;
	toDate?: string;
	order?: 2 | 3 | 4;
	direction?: "asc" | "desc";
	personalized?: boolean;
	verbatim?: boolean;
	additionalParams?: Record<string, string>;
	nonce?: string;
	maxResponseBytes?: number;
	onSseChunk?: (chunk: string) => void;
}

export interface KagiAdvancedSearchOptions {
	allWords?: string;
	exactWords?: string;
	anyWords?: string;
	noneWords?: string;
	region?: string;
	lastUpdate?: 1 | 2 | 3 | 4;
	fromDate?: string;
	toDate?: string;
	site?: string;
	termsAppearing?: KagiTermsAppearing;
	fileType?: string;
}

export type KagiRuleKind = -2 | -1 | 0 | 1 | 2;

export interface KagiVideoRuleTarget {
	platformId: string;
	creatorId: string;
	creatorName: string;
}

export interface ParsedSseEvent {
	id: string | null;
	dataRaw: string;
	dataJson: unknown;
}

export interface KagiSearchResult {
	capturedAt: string;
	requestUrl: string;
	referer: string;
	status: number;
	ok: boolean;
	headersSent: Record<string, string>;
	responseHeaders: Record<string, string>;
	rawSse: string;
	parsedEvents: ParsedSseEvent[];
}

export interface KagiAdvancedRedirectResult {
	capturedAt: string;
	status: number;
	location: string | null;
	requestUrl: string;
	redirectedSearchUrl: string | null;
	responseHeaders: Record<string, string>;
	postBody: string;
}

export interface KagiRuleMutationResult {
	capturedAt: string;
	status: number;
	ok: boolean;
	requestUrl: string;
	requestBody: string;
	responseHeaders: Record<string, string>;
}

export interface RateLimiterOptions {
	minIntervalMs: number;
	jitterMs: number;
}

export class SimpleRateLimiter {
	private nextAllowedTs = 0;
	private readonly minIntervalMs: number;
	private readonly jitterMs: number;

	public constructor(options: RateLimiterOptions) {
		this.minIntervalMs = options.minIntervalMs;
		this.jitterMs = options.jitterMs;
	}

	public async waitTurn(): Promise<void> {
		const now = Date.now();
		const jitter = this.jitterMs > 0 ? Math.floor(Math.random() * this.jitterMs) : 0;
		const waitFor = Math.max(0, this.nextAllowedTs - now) + jitter;
		this.nextAllowedTs = Math.max(this.nextAllowedTs, now) + this.minIntervalMs;
		if (waitFor <= 0) {
			return;
		}
		await new Promise((resolvePromise) => setTimeout(resolvePromise, waitFor));
	}
}

const DEFAULT_BASE_URL = "https://kagi.com";
const DEFAULT_BROWSER_URL = "http://localhost:9222";
const DEFAULT_SESSION_PATH = "packages/kagi/storage/session.json";

const BUILTIN_LENS_MAP: Record<string, string | undefined> = {
	all: undefined,
	academic: "0",
	forums: "1",
	programming: "2",
	pdfs: "3",
	news_360: "4",
	small_web: "5",
};

const LENS_KEY_ALIASES: Record<string, string> = {
	forum: "forums",
	news: "news_360",
	news360: "news_360",
	smallweb: "small_web",
	small: "small_web",
};

const SAME_SITE_MAP: Record<string, KagiCookie["sameSite"]> = {
	Strict: "Strict",
	Lax: "Lax",
	None: "None",
};

interface NavigatorWithUaData extends Navigator {
	userAgentData?: {
		brands?: Array<{ brand: string; version: string }>;
		mobile?: boolean;
		platform?: string;
	};
}

export async function captureSessionFromChrome(browserUrl = DEFAULT_BROWSER_URL): Promise<KagiSessionState> {
	const browser = await puppeteer.connect({
		browserURL: browserUrl,
		defaultViewport: null,
	});

	try {
		const pages = await browser.pages();
		const existingKagiPage = pages.find((page) => page.url().includes("kagi.com"));
		const page = existingKagiPage ?? pages.at(-1) ?? (await browser.newPage());

		if (!page.url().includes("kagi.com")) {
			await page.goto("https://kagi.com/search?q=session+refresh", {
				waitUntil: "domcontentloaded",
				timeout: 30_000,
			});
		}

		const cdp = await page.target().createCDPSession();
		await cdp.send("Network.enable");
		const allCookies = await cdp.send("Network.getAllCookies");

		const cookies: KagiCookie[] = allCookies.cookies
			.filter((cookie) => cookie.domain.includes("kagi.com"))
			.map((cookie) => ({
				name: cookie.name,
				value: cookie.value,
				domain: cookie.domain,
				path: cookie.path,
				expires: cookie.expires,
				httpOnly: cookie.httpOnly,
				secure: cookie.secure,
				sameSite: SAME_SITE_MAP[cookie.sameSite] ?? "Unknown",
			}));

		const navigatorDetails = await page.evaluate(() => {
			const nav = navigator as NavigatorWithUaData;
			const brands = nav.userAgentData?.brands
				? nav.userAgentData.brands.map((entry) => `${entry.brand};v=\"${entry.version}\"`).join(", ")
				: null;
			return {
				userAgent: navigator.userAgent,
				language: navigator.language,
				languages: [...navigator.languages],
				doNotTrack: navigator.doNotTrack,
				secChUa: brands,
				secChUaMobile:
					typeof nav.userAgentData?.mobile === "boolean" ? (nav.userAgentData.mobile ? "?1" : "?0") : null,
				secChUaPlatform: nav.userAgentData?.platform ?? null,
			};
		});

		const sessionApiId = await page.evaluate(async () => {
			try {
				const response = await fetch("https://kagi.com/user/session", {
					credentials: "include",
				});
				if (!response.ok) {
					return null;
				}
				const json = (await response.json()) as { id?: unknown };
				return typeof json.id === "string" ? json.id : null;
			} catch {
				return null;
			}
		});

		const kagiSessionCookie = cookies.find((cookie) => cookie.name === "kagi_session")?.value ?? null;

		return {
			capturedAt: new Date().toISOString(),
			browserUrl,
			baseUrl: DEFAULT_BASE_URL,
			userAgent: navigatorDetails.userAgent,
			language: navigatorDetails.language,
			languages: navigatorDetails.languages,
			doNotTrack: navigatorDetails.doNotTrack,
			secChUa: navigatorDetails.secChUa,
			secChUaMobile: navigatorDetails.secChUaMobile,
			secChUaPlatform: navigatorDetails.secChUaPlatform,
			kagiSessionCookie,
			sessionApiId,
			cookies,
		};
	} finally {
		await browser.disconnect();
	}
}

export function saveSession(session: KagiSessionState, filePath = DEFAULT_SESSION_PATH): string {
	const outputPath = resolve(filePath);
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
	chmodSync(outputPath, 0o600);
	return outputPath;
}

export function loadSession(filePath = DEFAULT_SESSION_PATH): KagiSessionState {
	const inputPath = resolve(filePath);
	if (!existsSync(inputPath)) {
		throw new Error(`Kagi session file not found: ${inputPath}`);
	}
	const raw = readFileSync(inputPath, "utf8");
	return JSON.parse(raw) as KagiSessionState;
}

export async function discoverLenses(
	session: KagiSessionState,
	options?: {
		query?: string;
		includeFallback?: boolean;
	},
): Promise<KagiLensDiscoveryResult> {
	const baseUrl = session.baseUrl || DEFAULT_BASE_URL;
	const requestUrl = new URL("/search", baseUrl);
	if (options?.query) {
		requestUrl.searchParams.set("q", options.query);
	}
	const refererUrl = new URL("/search", baseUrl);
	const headers = buildMimicHeaders(session, refererUrl);
	headers.accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

	const response = await fetch(requestUrl, {
		method: "GET",
		headers,
	});
	const html = await response.text();
	const discovered = extractLensesFromHtml(html);
	const includeFallback = options?.includeFallback ?? true;
	const lenses = includeFallback ? mergeLensDefinitionsWithFallback(discovered) : discovered;

	return {
		capturedAt: new Date().toISOString(),
		status: response.status,
		ok: response.ok,
		requestUrl: requestUrl.toString(),
		responseHeaders: headersToRecord(response.headers),
		lenses,
		lensMap: lensMapFromDefinitions(lenses),
	};
}

export function extractLensesFromHtml(html: string): KagiLensDefinition[] {
	const byKey = new Map<string, KagiLensDefinition>();

	const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
	for (const match of html.matchAll(anchorRegex)) {
		const attributes = match[1] ?? "";
		const innerHtml = match[2] ?? "";
		const href = findAttributeValue(attributes, "href");
		if (!href) {
			continue;
		}
		const parsedHref = safeUrl(href.replace(/&amp;/gi, "&"), "https://kagi.com");
		if (!parsedHref || parsedHref.pathname !== "/search") {
			continue;
		}
		const lensValue = parsedHref.searchParams.get("l") ?? undefined;
		const label = normalizeLensLabel(cleanHtmlText(innerHtml));
		if (!lensValue && !isAllLabel(label)) {
			continue;
		}
		const keyAttr =
			findAttributeValue(attributes, "data-lens") ??
			findAttributeValue(attributes, "data-key") ??
			findAttributeValue(attributes, "data-slug") ??
			label;
		const key = normalizeLensKey(keyAttr);
		if (!key) {
			continue;
		}
		upsertLensDefinition(byKey, {
			key,
			label,
			value: lensValue,
			source: "dynamic",
		});
	}

	const slugThenIdRegex = /"slug"\s*:\s*"([^"]+)"[^{}]{0,240}?"(?:id|value|l)"\s*:\s*"?(\d+)"?/g;
	for (const match of html.matchAll(slugThenIdRegex)) {
		const key = normalizeLensKey(match[1] ?? "");
		const value = match[2] ?? "";
		if (!key || value.length === 0) {
			continue;
		}
		upsertLensDefinition(byKey, {
			key,
			label: prettifyLensLabel(key),
			value,
			source: "dynamic",
		});
	}

	const idThenSlugRegex = /"(?:id|value|l)"\s*:\s*"?(\d+)"?[^{}]{0,240}?"slug"\s*:\s*"([^"]+)"/g;
	for (const match of html.matchAll(idThenSlugRegex)) {
		const value = match[1] ?? "";
		const key = normalizeLensKey(match[2] ?? "");
		if (!key || value.length === 0) {
			continue;
		}
		upsertLensDefinition(byKey, {
			key,
			label: prettifyLensLabel(key),
			value,
			source: "dynamic",
		});
	}

	return [...byKey.values()].sort(compareLensDefinitions);
}

export function buildSearchUrls(session: KagiSessionState, options: KagiSearchOptions): {
	requestUrl: URL;
	refererUrl: URL;
} {
	const baseUrl = session.baseUrl || DEFAULT_BASE_URL;
	const nonce = options.nonce ?? randomNonce();
	const requestUrl = new URL("/socket/search", baseUrl);
	const refererUrl = new URL("/search", baseUrl);
	const searchParams = buildSearchParams(options, nonce);
	for (const [key, value] of searchParams.entries()) {
		requestUrl.searchParams.set(key, value);
		if (key !== "nonce") {
			refererUrl.searchParams.set(key, value);
		}
	}
	return { requestUrl, refererUrl };
}

export function buildSearchParams(options: KagiSearchOptions, nonce: string): URLSearchParams {
	const params = new URLSearchParams();
	params.set("q", options.query);
	params.set("nonce", nonce);

	if (options.region) {
		params.set("r", options.region);
	}

	const lensValue = resolveLensValue(options.lens, options.lensMap);
	if (typeof lensValue === "string" && lensValue.length > 0) {
		params.set("l", lensValue);
	}

	if (options.dateRange) {
		params.set("dr", String(options.dateRange));
	}

	if (options.fromDate) {
		params.set("from_date", options.fromDate);
	}

	if (options.toDate) {
		params.set("to_date", options.toDate);
	}

	if (options.order) {
		params.set("order", String(options.order));
	}

	if (options.direction) {
		params.set("dir", options.direction);
	}

	if (options.verbatim === true) {
		params.set("verbatim", "1");
	}

	if (options.personalized === false) {
		params.set("personalized", "0");
	}

	if (options.additionalParams) {
		for (const [key, value] of Object.entries(options.additionalParams)) {
			params.set(key, value);
		}
	}

	return params;
}

export function buildAdvancedSearchPostBody(options: KagiAdvancedSearchOptions): URLSearchParams {
	const params = new URLSearchParams();
	params.set("all_words", options.allWords ?? "");
	params.set("exact_words", options.exactWords ?? "");
	params.set("any_words", options.anyWords ?? "");
	params.set("none_words", options.noneWords ?? "");
	params.set("region", options.region ?? "");
	params.set("last_update", options.lastUpdate ? String(options.lastUpdate) : "");
	params.set("from_date", options.fromDate ?? "");
	params.set("to_date", options.toDate ?? "");
	params.set("site", options.site ?? "");
	params.set("terms_appearing", options.termsAppearing && options.termsAppearing !== "any" ? options.termsAppearing : "");
	params.set("file_type", options.fileType ?? "");
	return params;
}

export async function runAdvancedSearchRedirect(
	session: KagiSessionState,
	options: KagiAdvancedSearchOptions,
): Promise<KagiAdvancedRedirectResult> {
	const baseUrl = session.baseUrl || DEFAULT_BASE_URL;
	const requestUrl = new URL("/search/advanced", baseUrl);
	const refererUrl = new URL("/search", baseUrl);
	const postBody = buildAdvancedSearchPostBody(options).toString();
	const headers = buildMimicHeaders(session, refererUrl);
	headers["content-type"] = "application/x-www-form-urlencoded";
	headers.origin = `${requestUrl.protocol}//${requestUrl.host}`;
	headers.accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

	const response = await fetch(requestUrl, {
		method: "POST",
		headers,
		body: postBody,
		redirect: "manual",
	});

	const location = response.headers.get("location");
	const redirectedSearchUrl = location ? new URL(location, baseUrl).toString() : null;

	return {
		capturedAt: new Date().toISOString(),
		status: response.status,
		location,
		requestUrl: requestUrl.toString(),
		redirectedSearchUrl,
		responseHeaders: headersToRecord(response.headers),
		postBody,
	};
}

export function parseVideoRuleTargetFromDomain(domainOrUrl: string, creatorName?: string): KagiVideoRuleTarget {
	const normalized = domainOrUrl
		.replace(/^https?:\/\//, "")
		.replace(/^www\./, "")
		.replace(/\/?$/, "");

	if (normalized.startsWith("youtube.com/channel/")) {
		const creatorId = normalized.split("/")[2] ?? "";
		if (!creatorId) {
			throw new Error(`Invalid YouTube channel domain: ${domainOrUrl}`);
		}
		return {
			platformId: "you_tube",
			creatorId,
			creatorName: creatorName ?? creatorId,
		};
	}

	if (normalized.startsWith("tiktok.com/")) {
		const creatorId = normalized.split("/")[1] ?? "";
		if (!creatorId) {
			throw new Error(`Invalid TikTok creator domain: ${domainOrUrl}`);
		}
		return {
			platformId: "tiktok",
			creatorId,
			creatorName: creatorName ?? creatorId,
		};
	}

	throw new Error(`Unsupported video rule target: ${domainOrUrl}`);
}

export async function runDomainRuleSet(
	session: KagiSessionState,
	domain: string,
	kind: KagiRuleKind,
): Promise<KagiRuleMutationResult> {
	const form = new URLSearchParams({ kind: String(kind), domain });
	return runRulePost(session, "/esr/user_rules", form, "/settings/user_ranked");
}

export async function runDomainRuleDelete(
	session: KagiSessionState,
	domain: string,
): Promise<KagiRuleMutationResult> {
	const form = new URLSearchParams({ domain });
	return runRulePost(session, "/esr/user_rules/delete", form, "/settings/user_ranked");
}

export async function runDomainRuleBulk(
	session: KagiSessionState,
	domains: string[],
	kind: KagiRuleKind,
	redirectPath = "/settings/user_ranked",
): Promise<KagiRuleMutationResult> {
	const form = new URLSearchParams({
		redirect: redirectPath,
		domain_list: domains.join("\n"),
		k: String(kind),
	});
	return runRulePost(session, "/esr/user_rules/bulk", form, redirectPath);
}

export async function runVideoRuleSet(
	session: KagiSessionState,
	target: KagiVideoRuleTarget,
	kind: KagiRuleKind,
): Promise<KagiRuleMutationResult> {
	const form = new URLSearchParams({
		kind: String(kind),
		platform_id: target.platformId,
		creator_id: target.creatorId,
		creator_name: target.creatorName,
	});
	return runRulePost(session, "/esr/video_rules", form, "/settings/user_ranked?t=video");
}

export async function runVideoRuleDelete(
	session: KagiSessionState,
	target: Pick<KagiVideoRuleTarget, "platformId" | "creatorId">,
): Promise<KagiRuleMutationResult> {
	const form = new URLSearchParams({
		platform_id: target.platformId,
		creator_id: target.creatorId,
	});
	return runRulePost(session, "/esr/video_rules/delete", form, "/settings/user_ranked?t=video");
}

export function parseSse(raw: string): ParsedSseEvent[] {
	const blocks = raw
		.split("\n\n")
		.map((item) => item.trim())
		.filter((item) => item.length > 0 && item !== "hi");

	const events: ParsedSseEvent[] = [];
	for (const block of blocks) {
		const lines = block.split("\n");
		let id: string | null = null;
		const dataParts: string[] = [];
		for (const line of lines) {
			if (line.startsWith("id:")) {
				id = line.slice(3).trim();
				continue;
			}
			if (line.startsWith("data:")) {
				dataParts.push(line.slice(5).trimStart());
			}
		}
		const dataRaw = dataParts.join("\n");
		let dataJson: unknown = dataRaw;
		if (dataRaw.length > 0) {
			try {
				dataJson = JSON.parse(dataRaw) as unknown;
			} catch {
				dataJson = dataRaw;
			}
		}
		events.push({ id, dataRaw, dataJson });
	}
	return events;
}

export function buildCookieHeader(session: KagiSessionState, nowEpochSeconds = Date.now() / 1000): string {
	const pairs = session.cookies
		.filter((cookie) => cookie.domain.includes("kagi.com"))
		.filter((cookie) => cookie.expires <= 0 || cookie.expires > nowEpochSeconds)
		.map((cookie) => `${cookie.name}=${cookie.value}`);
	return pairs.join("; ");
}

export function buildMimicHeaders(session: KagiSessionState, refererUrl: URL): Record<string, string> {
	const headers: Record<string, string> = {
		accept: "text/event-stream",
		"cache-control": "no-cache",
		referer: refererUrl.toString(),
		"user-agent": session.userAgent,
		"accept-language": session.languages.join(","),
	};

	if (session.doNotTrack) {
		headers.dnt = session.doNotTrack;
	}

	if (session.secChUa) {
		headers["sec-ch-ua"] = session.secChUa;
	}
	if (session.secChUaMobile) {
		headers["sec-ch-ua-mobile"] = session.secChUaMobile;
	}
	if (session.secChUaPlatform) {
		headers["sec-ch-ua-platform"] = `\"${session.secChUaPlatform}\"`;
	}

	const cookieHeader = buildCookieHeader(session);
	if (cookieHeader) {
		headers.cookie = cookieHeader;
	}

	const authorization = session.sessionApiId ?? session.kagiSessionCookie;
	if (authorization) {
		headers["x-kagi-authorization"] = authorization;
	}

	return headers;
}

export async function runSocketSearch(
	session: KagiSessionState,
	options: KagiSearchOptions,
): Promise<KagiSearchResult> {
	const { requestUrl, refererUrl } = buildSearchUrls(session, options);
	const headers = buildMimicHeaders(session, refererUrl);
	const response = await fetch(requestUrl, {
		method: "GET",
		headers,
	});

	const maxBytes = options.maxResponseBytes ?? 2_000_000;
	const rawSse = await readResponseBody(response, maxBytes, options.onSseChunk);
	const parsedEvents = parseSse(rawSse);

	return {
		capturedAt: new Date().toISOString(),
		requestUrl: requestUrl.toString(),
		referer: refererUrl.toString(),
		status: response.status,
		ok: response.ok,
		headersSent: redactHeaders(headers),
		responseHeaders: headersToRecord(response.headers),
		rawSse,
		parsedEvents,
	};
}

export async function runSocketSearchWithAutoRefresh(
	options: KagiSearchOptions,
	config?: {
		sessionPath?: string;
		browserUrl?: string;
		rateLimiter?: SimpleRateLimiter;
		discoverLenses?: boolean;
	},
): Promise<KagiSearchResult> {
	const sessionPath = config?.sessionPath ?? DEFAULT_SESSION_PATH;
	const rateLimiter = config?.rateLimiter;
	const shouldDiscoverLenses = config?.discoverLenses ?? true;
	if (rateLimiter) {
		await rateLimiter.waitTurn();
	}

	let session = loadSession(sessionPath);
	let preparedOptions = await withDiscoveredLensMap(session, options, shouldDiscoverLenses);
	let result = await runSocketSearch(session, preparedOptions);
	if (result.status === 401 || result.status === 403) {
		session = await captureSessionFromChrome(config?.browserUrl ?? DEFAULT_BROWSER_URL);
		saveSession(session, sessionPath);
		if (rateLimiter) {
			await rateLimiter.waitTurn();
		}
		preparedOptions = await withDiscoveredLensMap(session, options, shouldDiscoverLenses);
		result = await runSocketSearch(session, preparedOptions);
	}

	return result;
}

async function withDiscoveredLensMap(
	session: KagiSessionState,
	options: KagiSearchOptions,
	shouldDiscoverLenses: boolean,
): Promise<KagiSearchOptions> {
	if (!shouldDiscoverLenses || !options.lens || isNumericLens(options.lens) || isAllLens(options.lens)) {
		return options;
	}

	try {
		const discovery = await discoverLenses(session, { query: options.query, includeFallback: true });
		return {
			...options,
			lensMap: discovery.lensMap,
		};
	} catch {
		return options;
	}
}

async function runRulePost(
	session: KagiSessionState,
	path: string,
	form: URLSearchParams,
	refererPath: string,
): Promise<KagiRuleMutationResult> {
	const baseUrl = session.baseUrl || DEFAULT_BASE_URL;
	const requestUrl = new URL(path, baseUrl);
	const refererUrl = new URL(refererPath, baseUrl);
	const headers = buildMimicHeaders(session, refererUrl);
	headers["content-type"] = "application/x-www-form-urlencoded;charset=UTF-8";
	headers.accept = "*/*";

	const requestBody = form.toString();
	const response = await fetch(requestUrl, {
		method: "POST",
		headers,
		body: requestBody,
	});

	return {
		capturedAt: new Date().toISOString(),
		status: response.status,
		ok: response.ok,
		requestUrl: requestUrl.toString(),
		requestBody,
		responseHeaders: headersToRecord(response.headers),
	};
}

async function readResponseBody(
	response: Response,
	maxBytes: number,
	onChunk?: (chunk: string) => void,
): Promise<string> {
	if (!response.body) {
		return "";
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let content = "";
	let totalBytes = 0;

	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		totalBytes += chunk.value.byteLength;
		const decoded = decoder.decode(chunk.value, { stream: true });
		content += decoded;
		if (onChunk) {
			onChunk(decoded);
		}
		if (totalBytes >= maxBytes) {
			break;
		}
	}

	const finalChunk = decoder.decode();
	if (finalChunk) {
		content += finalChunk;
		if (onChunk) {
			onChunk(finalChunk);
		}
	}
	reader.releaseLock();
	return content;
}

function resolveLensValue(
	lens: string | undefined,
	discoveredMap: Record<string, string | undefined> | undefined,
): string | undefined {
	if (!lens) {
		return undefined;
	}
	const trimmed = lens.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	if (isNumericLens(trimmed)) {
		return trimmed;
	}

	const normalized = normalizeLensKey(trimmed);
	if (normalized === "all") {
		return undefined;
	}

	const discoveredValue = getLensMapValue(discoveredMap, normalized);
	if (typeof discoveredValue !== "undefined") {
		return discoveredValue;
	}

	return getLensMapValue(BUILTIN_LENS_MAP, normalized);
}

function getLensMapValue(
	lensMap: Record<string, string | undefined> | undefined,
	normalizedLensKey: string,
): string | undefined {
	if (!lensMap) {
		return undefined;
	}
	if (hasOwn(lensMap, normalizedLensKey)) {
		return lensMap[normalizedLensKey];
	}
	const alias = LENS_KEY_ALIASES[normalizedLensKey];
	if (alias && hasOwn(lensMap, alias)) {
		return lensMap[alias];
	}
	return undefined;
}

function mergeLensDefinitionsWithFallback(dynamicLenses: KagiLensDefinition[]): KagiLensDefinition[] {
	const byKey = new Map<string, KagiLensDefinition>();
	for (const lens of dynamicLenses) {
		upsertLensDefinition(byKey, lens);
	}
	for (const [key, value] of Object.entries(BUILTIN_LENS_MAP)) {
		upsertLensDefinition(byKey, {
			key,
			label: prettifyLensLabel(key),
			value,
			source: "fallback",
		});
	}
	return [...byKey.values()].sort(compareLensDefinitions);
}

function lensMapFromDefinitions(definitions: KagiLensDefinition[]): Record<string, string | undefined> {
	const map: Record<string, string | undefined> = {};
	for (const definition of definitions) {
		map[definition.key] = definition.value;
	}
	return map;
}

function upsertLensDefinition(map: Map<string, KagiLensDefinition>, entry: KagiLensDefinition): void {
	const normalizedKey = normalizeLensKey(entry.key);
	if (!normalizedKey) {
		return;
	}
	const current = map.get(normalizedKey);
	if (!current) {
		map.set(normalizedKey, {
			key: normalizedKey,
			label: normalizeLensLabel(entry.label || prettifyLensLabel(normalizedKey)),
			value: entry.value,
			source: entry.source,
		});
		return;
	}

	const nextValue = typeof current.value === "string" && current.value.length > 0 ? current.value : entry.value;
	const nextLabel = current.label.length > 0 ? current.label : normalizeLensLabel(entry.label);
	const nextSource = current.source === "dynamic" || entry.source === "dynamic" ? "dynamic" : "fallback";
	map.set(normalizedKey, {
		key: normalizedKey,
		label: nextLabel.length > 0 ? nextLabel : prettifyLensLabel(normalizedKey),
		value: nextValue,
		source: nextSource,
	});
}

function normalizeLensKey(raw: string): string {
	const sanitized = raw
		.trim()
		.toLowerCase()
		.replace(/&amp;/g, "and")
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (sanitized.length === 0) {
		return "";
	}
	return LENS_KEY_ALIASES[sanitized] ?? sanitized;
}

function normalizeLensLabel(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return trimmed;
	}
	return trimmed.replace(/\s+/g, " ");
}

function cleanHtmlText(raw: string): string {
	return raw
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/\s+/g, " ")
		.trim();
}

function prettifyLensLabel(key: string): string {
	const normalized = normalizeLensKey(key);
	if (normalized === "news_360") {
		return "News 360";
	}
	if (normalized === "small_web") {
		return "Small Web";
	}
	return normalized
		.split("_")
		.filter((chunk) => chunk.length > 0)
		.map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
		.join(" ");
}

function compareLensDefinitions(left: KagiLensDefinition, right: KagiLensDefinition): number {
	const leftValue = typeof left.value === "string" ? Number(left.value) : Number.NaN;
	const rightValue = typeof right.value === "string" ? Number(right.value) : Number.NaN;
	const leftRank = Number.isFinite(leftValue) ? leftValue : Number.POSITIVE_INFINITY;
	const rightRank = Number.isFinite(rightValue) ? rightValue : Number.POSITIVE_INFINITY;
	if (leftRank !== rightRank) {
		return leftRank - rightRank;
	}
	return left.key.localeCompare(right.key);
}

function isAllLabel(label: string): boolean {
	const normalized = normalizeLensKey(label);
	return normalized === "all";
}

function isAllLens(lens: string): boolean {
	return normalizeLensKey(lens) === "all";
}

function isNumericLens(lens: string): boolean {
	return /^\d+$/.test(lens.trim());
}

function findAttributeValue(attributes: string, key: string): string | null {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const quotedRegex = new RegExp(`${escapedKey}\\s*=\\s*([\"'])(.*?)\\1`, "i");
	const quotedMatch = attributes.match(quotedRegex);
	if (quotedMatch?.[2]) {
		return quotedMatch[2];
	}
	const bareRegex = new RegExp(`${escapedKey}\\s*=\\s*([^\\s>]+)`, "i");
	const bareMatch = attributes.match(bareRegex);
	return bareMatch?.[1] ?? null;
}

function safeUrl(raw: string, base: string): URL | null {
	try {
		return new URL(raw, base);
	} catch {
		return null;
	}
}

function hasOwn(record: Record<string, string | undefined>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function headersToRecord(headers: Headers): Record<string, string> {
	const record: Record<string, string> = {};
	headers.forEach((value, key) => {
		record[key] = value;
	});
	return record;
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const clone: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === "cookie") {
			clone[key] = "<redacted-cookie-header>";
			continue;
		}
		if (key.toLowerCase() === "x-kagi-authorization") {
			clone[key] = "<redacted-session-token>";
			continue;
		}
		clone[key] = value;
	}
	return clone;
}

function randomNonce(): string {
	return `${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}
