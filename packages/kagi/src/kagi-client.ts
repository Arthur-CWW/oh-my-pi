import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";

export type KagiLens = "all" | "academic" | "forums" | "programming" | "pdfs" | "news_360" | "small_web";

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

export interface KagiSearchOptions {
	query: string;
	region?: string;
	lens?: KagiLens;
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

const LENS_VALUE: Record<KagiLens, string | undefined> = {
	all: undefined,
	academic: "0",
	forums: "1",
	programming: "2",
	pdfs: "3",
	news_360: "4",
	small_web: "5",
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

	if (options.lens && LENS_VALUE[options.lens]) {
		params.set("l", LENS_VALUE[options.lens] as string);
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
	},
): Promise<KagiSearchResult> {
	const sessionPath = config?.sessionPath ?? DEFAULT_SESSION_PATH;
	const rateLimiter = config?.rateLimiter;
	if (rateLimiter) {
		await rateLimiter.waitTurn();
	}

	let session = loadSession(sessionPath);
	let result = await runSocketSearch(session, options);
	if (result.status === 401 || result.status === 403) {
		session = await captureSessionFromChrome(config?.browserUrl ?? DEFAULT_BROWSER_URL);
		saveSession(session, sessionPath);
		if (rateLimiter) {
			await rateLimiter.waitTurn();
		}
		result = await runSocketSearch(session, options);
	}

	return result;
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
