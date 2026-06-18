/**
 * Kagi Search Client
 *
 * Uses the signed-in Kagi browser account session first, then falls back to the
 * Kagi V1 Search API when no browser session is available and API auth exists.
 */
import { Database } from "bun:sqlite";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { type AuthStorage, type FetchImpl, withAuth } from "@oh-my-pi/pi-ai";
import { getAgentDir } from "@oh-my-pi/pi-utils";
import { parseHTML } from "linkedom";
import puppeteer, { type Browser } from "puppeteer-core";
import { withHardTimeout } from "./search/providers/utils";

const KAGI_API_SEARCH_URL = "https://kagi.com/api/v1/search";
const KAGI_SOCKET_SEARCH_URL = "https://kagi.com/socket/search";
const KAGI_BROWSER_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const NO_KAGI_BROWSER_SESSION_MESSAGE =
	"No Kagi browser session found. Sign into kagi.com in Chrome or Firefox.";

const FIREFOX_USER_AGENT =
	os.platform() === "darwin"
		? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:136.0) Gecko/20100101 Firefox/136.0"
		: "Mozilla/5.0 (X11; Linux x86_64; rv:136.0) Gecko/20100101 Firefox/136.0";

// ---------------------------------------------------------------------------
// Request / Response Types
// ---------------------------------------------------------------------------

/** V1 search request body. */
export interface KagiSearchRequest {
	query: string;
	/** Workflow mode: "search" | "research". */
	workflow?: string;
	/** Number of results (1-100). */
	limit?: number;
	/** Lens identifier (e.g. "news", "reddit"). */
	lens?: string;
	/** Time-based filters as ISO date strings (YYYY-MM-DD). */
	filters?: {
		after?: string;
		before?: string;
	};
}

/** Individual V1 result item. */
export interface KagiSearchResultItem {
	url: string;
	title: string;
	snippet?: string;
	/** ISO timestamp or relative string ("2h ago"). */
	time?: string;
	/** Thumbnail image. */
	image?: { url: string; height?: number; width?: number };
	/** Extra metadata key-value pairs. */
	props?: Record<string, unknown>;
}

/** V1 categorizes results into named buckets; only consumed buckets are typed. */
export interface KagiSearchData {
	search?: KagiSearchResultItem[];
	video?: KagiSearchResultItem[];
	news?: KagiSearchResultItem[];
	infobox?: KagiSearchResultItem[];
	adjacent_question?: KagiSearchResultItem[];
	related_search?: KagiSearchResultItem[];
	direct_answer?: KagiSearchResultItem[];
}

/** V1 error entry. */
export interface KagiErrorEntry {
	code?: number;
	url?: string;
	message?: string;
	msg?: string;
	location?: string;
}

/** V1 success response. */
export interface KagiSearchResponse {
	meta?: {
		trace?: string;
		id?: string;
		ms?: number;
	};
	data?: KagiSearchData;
	error?: KagiErrorEntry[];
}

/** V1 error response. */
export interface KagiErrorResponse {
	meta?: Record<string, unknown>;
	error?: string | KagiErrorEntry[];
	message?: string;
	detail?: string;
}

export interface KagiBrowserSession {
	token: string;
	headers: Record<string, string>;
	capturedAt: string;
}

interface FirefoxProfileCandidate {
	dir: string;
	rank: number;
}

interface KagiBrowserSessionLookupOptions {
	cachePath?: string;
	allowChrome?: boolean;
}

interface ChromeCookie {
	name: string;
	value: string;
	domain: string;
}

interface ChromeCookiesResponse {
	cookies: ChromeCookie[];
}

interface BrowserHeaderValues {
	"user-agent": string;
	"accept-language": string;
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

export class KagiApiError extends Error {
	readonly statusCode?: number;

	constructor(message: string, statusCode?: number) {
		super(message);
		this.name = "KagiApiError";
		this.statusCode = statusCode;
	}
}

function extractKagiErrorMessage(payload: unknown): string | null {
	if (!payload || typeof payload !== "object") return null;
	const record = payload as Record<string, unknown>;

	for (const value of [record.message, record.detail]) {
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}

	if (typeof record.error === "string" && record.error.trim().length > 0) {
		return record.error.trim();
	}

	if (Array.isArray(record.error)) {
		for (const entry of record.error) {
			if (!entry || typeof entry !== "object") continue;
			const e = entry as Record<string, unknown>;
			for (const value of [e.message, e.msg]) {
				if (typeof value === "string" && value.trim().length > 0) {
					return value.trim();
				}
			}
		}
	}

	return null;
}

function createKagiApiError(statusCode: number, detail?: string): KagiApiError {
	return new KagiApiError(
		detail ? `Kagi API error (${statusCode}): ${detail}` : `Kagi API error (${statusCode})`,
		statusCode,
	);
}

function parseKagiErrorResponse(statusCode: number, responseText: string): KagiApiError {
	const trimmed = responseText.trim();
	if (trimmed.length === 0) {
		return createKagiApiError(statusCode);
	}

	try {
		const payload = JSON.parse(trimmed) as KagiErrorResponse;
		return createKagiApiError(statusCode, extractKagiErrorMessage(payload) ?? trimmed);
	} catch {
		return createKagiApiError(statusCode, trimmed);
	}
}

function createKagiBrowserSearchError(response: Response, responseText: string): KagiApiError {
	const detail = responseText.trim();
	const message = detail
		? `Kagi browser search failed (${response.status}): ${detail}`
		: `Kagi browser search failed (${response.status} ${response.statusText})`;
	return new KagiApiError(message, response.status);
}

// ---------------------------------------------------------------------------
// Browser Session Discovery
// ---------------------------------------------------------------------------

export function getKagiBrowserSessionPath(): string {
	return path.join(getAgentDir(), "web", "kagi-session.json");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function asStringRecord(value: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!isRecord(value)) return out;
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") out[key] = entry;
	}
	return out;
}

function isFreshBrowserSession(session: KagiBrowserSession): boolean {
	const capturedAt = session.capturedAt.trim();
	if (capturedAt.length === 0) return false;
	const capturedMs = Date.parse(capturedAt);
	return Number.isFinite(capturedMs) && Date.now() - capturedMs <= KAGI_BROWSER_SESSION_MAX_AGE_MS;
}

function normalizeBrowserSession(value: unknown): KagiBrowserSession | null {
	if (!isRecord(value) || typeof value.token !== "string" || value.token.trim().length === 0) return null;
	const capturedAt = typeof value.capturedAt === "string" ? value.capturedAt : "";
	const session = {
		token: value.token.trim(),
		headers: asStringRecord(value.headers),
		capturedAt,
	} satisfies KagiBrowserSession;
	return isFreshBrowserSession(session) ? session : null;
}

function loadCachedKagiBrowserSession(cachePath = getKagiBrowserSessionPath()): KagiBrowserSession | null {
	try {
		const parsed = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as unknown;
		return normalizeBrowserSession(parsed);
	} catch {
		return null;
	}
}

export function hasCachedKagiBrowserSession(cachePath = getKagiBrowserSessionPath()): boolean {
	return loadCachedKagiBrowserSession(cachePath) !== null;
}

function firefoxAppDirs(): string[] {
	return os.platform() === "darwin"
		? [path.join(os.homedir(), "Library/Application Support/Firefox")]
		: [path.join(os.homedir(), ".mozilla/firefox"), path.join(os.homedir(), "snap/firefox/common/.mozilla/firefox")];
}

function parseIniBlocks(text: string): Array<{ section: string; values: Record<string, string> }> {
	const blocks: Array<{ section: string; values: Record<string, string> }> = [];
	for (const block of text.split(/\r?\n(?=\[)/)) {
		const header = block.match(/^\[([^\]]+)\]/);
		if (!header?.[1]) continue;
		const values: Record<string, string> = {};
		for (const line of block.split(/\r?\n/)) {
			const match = line.match(/^([^=]+)=(.*)$/);
			if (match?.[1]) values[match[1].trim()] = (match[2] ?? "").trim();
		}
		blocks.push({ section: header[1], values });
	}
	return blocks;
}

function parseFirefoxInstallDefaults(appDir: string): FirefoxProfileCandidate[] {
	const out: FirefoxProfileCandidate[] = [];
	for (const file of ["installs.ini", "profiles.ini"]) {
		let text: string;
		try {
			text = fs.readFileSync(path.join(appDir, file), "utf-8");
		} catch {
			continue;
		}
		for (const block of parseIniBlocks(text)) {
			if (!block.section.startsWith("Install") || !block.values.Default) continue;
			out.push({ dir: path.join(appDir, block.values.Default), rank: -100 + out.length });
		}
	}
	return out;
}

function parseFirefoxProfilesIni(appDir: string): FirefoxProfileCandidate[] {
	let text: string;
	try {
		text = fs.readFileSync(path.join(appDir, "profiles.ini"), "utf-8");
	} catch {
		return [];
	}

	const profiles: Array<FirefoxProfileCandidate & { isDefault: boolean; index: number }> = [];
	let index = 0;
	for (const block of parseIniBlocks(text)) {
		if (!/^Profile\d+$/.test(block.section)) continue;
		if (!block.values.Path) continue;
		profiles.push({
			dir: block.values.IsRelative !== "0" ? path.join(appDir, block.values.Path) : path.resolve(block.values.Path),
			isDefault: block.values.Default === "1",
			rank: 0,
			index,
		});
		index += 1;
	}

	profiles.sort((a, b) => {
		if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
		return a.index - b.index;
	});
	return profiles.map((profile, i) => ({
		dir: profile.dir,
		rank: profile.isDefault ? i : 100 + i,
	}));
}

function addFirefoxProfileDb(
	candidates: Array<{ path: string; rank: number; mtimeMs: number }>,
	seen: Set<string>,
	profileDir: string,
	rank: number,
): void {
	const dbPath = path.join(profileDir, "cookies.sqlite");
	if (seen.has(dbPath) || !fs.existsSync(dbPath)) return;
	let mtimeMs = 0;
	try {
		mtimeMs = fs.statSync(dbPath).mtimeMs;
	} catch {
		mtimeMs = 0;
	}
	seen.add(dbPath);
	candidates.push({ path: dbPath, rank, mtimeMs });
}

function findFirefoxCookiesDbs(): string[] {
	const candidates: Array<{ path: string; rank: number; mtimeMs: number }> = [];
	const seen = new Set<string>();

	for (const appDir of firefoxAppDirs()) {
		for (const profile of [...parseFirefoxInstallDefaults(appDir), ...parseFirefoxProfilesIni(appDir)]) {
			addFirefoxProfileDb(candidates, seen, profile.dir, profile.rank);
		}

		for (const container of [path.join(appDir, "Profiles"), appDir]) {
			try {
				for (const dirent of fs.readdirSync(container, { withFileTypes: true })) {
					if (!dirent.isDirectory()) continue;
					addFirefoxProfileDb(candidates, seen, path.join(container, dirent.name), 1000);
				}
			} catch {}
		}
	}

	return candidates.sort((a, b) => a.rank - b.rank || b.mtimeMs - a.mtimeMs).map(candidate => candidate.path);
}

function readKagiSessionTokenFromFirefoxDb(dbPath: string): string | null {
	const tempDir = path.join(
		os.tmpdir(),
		`omp-kagi-ff-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	const tmpDb = path.join(tempDir, "cookies.sqlite");
	let db: Database | null = null;
	try {
		fs.mkdirSync(tempDir, { recursive: true });
		fs.copyFileSync(dbPath, tmpDb);
		for (const suffix of ["-wal", "-shm"]) {
			const source = `${dbPath}${suffix}`;
			if (fs.existsSync(source)) fs.copyFileSync(source, `${tmpDb}${suffix}`);
		}

		db = new Database(tmpDb, { readonly: true });
		const row = db
			.query(
				"SELECT value FROM moz_cookies WHERE (host = 'kagi.com' OR host LIKE '%.kagi.com') AND name = 'kagi_session' AND (expiry > unixepoch() OR expiry = 0) ORDER BY expiry DESC LIMIT 1",
			)
			.get() as { value?: unknown } | null;
		return typeof row?.value === "string" && row.value.trim().length > 0 ? row.value.trim() : null;
	} catch {
		return null;
	} finally {
		db?.close();
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {
			// Best-effort cleanup.
		}
	}
}

function captureKagiBrowserSessionFromFirefox(): KagiBrowserSession | null {
	for (const dbPath of findFirefoxCookiesDbs()) {
		const token = readKagiSessionTokenFromFirefoxDb(dbPath);
		if (!token) continue;
		return {
			token,
			headers: {
				"user-agent": FIREFOX_USER_AGENT,
				"accept-language": "en-US,en;q=0.9",
				accept: "application/json",
			},
			capturedAt: new Date().toISOString(),
		};
	}
	return null;
}

function isChromeCookiesResponse(value: unknown): value is ChromeCookiesResponse {
	if (!isRecord(value) || !Array.isArray(value.cookies)) return false;
	return value.cookies.every(
		cookie =>
			isRecord(cookie) &&
			typeof cookie.name === "string" &&
			typeof cookie.value === "string" &&
			typeof cookie.domain === "string",
	);
}

function isBrowserHeaderValues(value: unknown): value is BrowserHeaderValues {
	return (
		isRecord(value) &&
		typeof value["user-agent"] === "string" &&
		typeof value["accept-language"] === "string" &&
		value["user-agent"].length > 0 &&
		value["accept-language"].length > 0
	);
}

async function captureKagiBrowserSessionFromChromeCdp(
	browserUrl = "http://localhost:9222",
): Promise<KagiBrowserSession | null> {
	let browser: Browser | null = null;
	try {
		browser = await puppeteer.connect({ browserURL: browserUrl, defaultViewport: null, protocolTimeout: 5000 });
		const pages = await browser.pages();
		const page = pages.find(candidate => candidate.url().startsWith("https://kagi.com")) ?? (await browser.newPage());
		if (!page.url().startsWith("https://kagi.com")) {
			await page.goto("https://kagi.com", { waitUntil: "domcontentloaded", timeout: 15000 });
		}
		const cdp = await page.target().createCDPSession();
		const cookiesPayload = (await cdp.send("Network.getAllCookies")) as unknown;
		if (!isChromeCookiesResponse(cookiesPayload)) return null;
		const kagiSession = cookiesPayload.cookies.find(
			cookie =>
				(cookie.domain === "kagi.com" || cookie.domain.endsWith(".kagi.com")) && cookie.name === "kagi_session",
		);
		if (!kagiSession?.value) return null;
		const headerValues = (await page.evaluate(() => ({
			"accept-language": navigator.language || "en-US,en;q=0.9",
			"user-agent": navigator.userAgent,
		}))) as unknown;
		const headers = isBrowserHeaderValues(headerValues)
			? headerValues
			: { "accept-language": "en-US,en;q=0.9", "user-agent": FIREFOX_USER_AGENT };
		return {
			token: kagiSession.value,
			headers: { ...headers, accept: "application/json" },
			capturedAt: new Date().toISOString(),
		};
	} catch {
		return null;
	} finally {
		if (browser) {
			try {
				await browser.disconnect();
			} catch {
				// Best-effort cleanup.
			}
		}
	}
}

function saveKagiBrowserSession(session: KagiBrowserSession, cachePath = getKagiBrowserSessionPath()): void {
	try {
		fs.mkdirSync(path.dirname(cachePath), { recursive: true });
		fs.writeFileSync(cachePath, JSON.stringify(session, null, 2), "utf-8");
	} catch {
		// Session caching is opportunistic.
	}
}

async function captureFreshKagiBrowserSession(
	options: KagiBrowserSessionLookupOptions = {},
): Promise<KagiBrowserSession | null> {
	const firefox = captureKagiBrowserSessionFromFirefox();
	if (firefox) return firefox;
	return options.allowChrome === false ? null : await captureKagiBrowserSessionFromChromeCdp();
}

async function getOrCaptureKagiBrowserSession(
	options: KagiBrowserSessionLookupOptions = {},
): Promise<KagiBrowserSession | null> {
	const cachePath = options.cachePath ?? getKagiBrowserSessionPath();
	const cached = loadCachedKagiBrowserSession(cachePath);
	if (cached) return cached;

	const session = await captureFreshKagiBrowserSession(options);
	if (session) saveKagiBrowserSession(session, cachePath);
	return session;
}

export async function refreshKagiBrowserSession(cachePath = getKagiBrowserSessionPath()): Promise<string> {
	const session = await captureFreshKagiBrowserSession();
	if (!session) throw new Error(NO_KAGI_BROWSER_SESSION_MESSAGE);
	saveKagiBrowserSession(session, cachePath);
	return cachePath;
}

export async function hasAvailableKagiBrowserSession(cachePath = getKagiBrowserSessionPath()): Promise<boolean> {
	return (await getOrCaptureKagiBrowserSession({ cachePath })) !== null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface KagiSearchOptions {
	limit?: number;
	recency?: "day" | "week" | "month" | "year";
	sessionId?: string;
	signal?: AbortSignal;
	fetch?: FetchImpl;
	/** Set false to force the API-key route instead of the browser account-session route. */
	browserSession?: boolean;
	browserSessionCachePath?: string;
}

export interface KagiSearchSource {
	title: string;
	url: string;
	snippet?: string;
	publishedDate?: string;
}

export interface KagiSearchResult {
	requestId: string;
	sources: KagiSearchSource[];
	relatedQuestions: string[];
	answer?: string;
}

/**
 * Compute a YYYY-MM-DD date string `recency` units before now, in UTC.
 * UTC keeps the recency window deterministic regardless of host timezone and
 * matches Kagi's date-formatted `filters.after`. Date setters handle month
 * drift (Mar 31 −1mo → Feb 28/29) and leap years correctly.
 */
function recencyToDate(recency: "day" | "week" | "month" | "year"): string {
	const d = new Date();
	switch (recency) {
		case "day":
			d.setUTCDate(d.getUTCDate() - 1);
			break;
		case "week":
			d.setUTCDate(d.getUTCDate() - 7);
			break;
		case "month":
			d.setUTCMonth(d.getUTCMonth() - 1);
			break;
		case "year":
			d.setUTCFullYear(d.getUTCFullYear() - 1);
			break;
	}
	const yyyy = d.getUTCFullYear();
	const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(d.getUTCDate()).padStart(2, "0");
	return `${yyyy}-${mm}-${dd}`;
}

function buildRequestBody(query: string, options: KagiSearchOptions): KagiSearchRequest {
	const req: KagiSearchRequest = {
		query,
		workflow: "search",
		limit: options.limit,
	};

	if (options.recency) {
		req.filters = { after: recencyToDate(options.recency) };
	}

	return req;
}

/** Push every item in a result bucket as a source, with an optional title tag. */
function collectSources(sources: KagiSearchSource[], items: KagiSearchResultItem[] | undefined, tag?: string): void {
	if (!items) return;
	for (const item of items) {
		sources.push({
			title: tag ? `${tag} ${item.title}` : item.title,
			url: item.url,
			snippet: item.snippet,
			publishedDate: item.time,
		});
	}
}

/** Pull a related/adjacent question from an item's props or fall back to title. */
function questionOf(item: KagiSearchResultItem): string | undefined {
	const q = item.props?.question ?? item.props?.query ?? item.title;
	return typeof q === "string" && q.length > 0 ? q : undefined;
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const exact = headers[name];
	if (exact) return exact;
	const lowerName = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowerName && value.length > 0) return value;
	}
	return undefined;
}

function buildBrowserSearchHeaders(query: string, session: KagiBrowserSession): Record<string, string> {
	return {
		Accept: "text/event-stream, application/json;q=0.9, */*;q=0.8",
		"Accept-Language": headerValue(session.headers, "accept-language") ?? "en-US,en;q=0.9",
		"Cache-Control": "no-cache",
		Referer: `https://kagi.com/search?q=${encodeURIComponent(query)}`,
		"Sec-Fetch-Dest": "empty",
		"Sec-Fetch-Mode": "cors",
		"Sec-Fetch-Site": "same-origin",
		"User-Agent": headerValue(session.headers, "user-agent") ?? FIREFOX_USER_AGENT,
		"X-Kagi-Authorization": session.token,
	};
}

export function stripKagiHtml(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<\/?[a-z][^>]*>/gi, " ")
		.replace(/<![^>]*>/g, " ")
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\s+/g, " ")
		.replace(/\s+([.,;:!?])/g, "$1")
		.trim();
}

export type KagiSocketEventItem = { tag: string; payload: string | { content?: string } };

function isKagiSocketEventItem(value: unknown): value is KagiSocketEventItem {
	if (!isRecord(value) || typeof value.tag !== "string") return false;
	if (typeof value.payload === "string") return true;
	return isRecord(value.payload) && (value.payload.content === undefined || typeof value.payload.content === "string");
}

export function getKagiPayloadHtml(item: KagiSocketEventItem): string {
	if (typeof item.payload === "string") return item.payload;
	return item.payload.content ?? "";
}

type KagiSocketAnchor = {
	getAttribute(name: string): string | null;
	innerHTML: string;
	textContent: string | null;
	closest(selector: string): {
		querySelector(selector: string): { innerHTML: string; textContent: string | null } | null;
	} | null;
	parentElement: {
		querySelector(selector: string): { innerHTML: string; textContent: string | null } | null;
	} | null;
};

function extractSocketSnippet(anchor: KagiSocketAnchor): string | undefined {
	const container = anchor.closest("._0_SRI") ?? anchor.closest(".search-result") ?? anchor.parentElement;
	const desc = container?.querySelector(".__sri-desc");
	const snippet = stripKagiHtml(desc?.innerHTML ?? desc?.textContent ?? "");
	return snippet.length > 0 ? snippet : undefined;
}

export function parseKagiSocketEvents(raw: string): Array<{ data: unknown }> {
	const events: Array<{ data: unknown }> = [];
	for (const block of raw.split(/\r?\n\r?\n/)) {
		const data = block
			.split(/\r?\n/)
			.filter(line => line.startsWith("data:"))
			.map(line => line.slice(5).trimStart())
			.join("\n")
			.trim();
		if (data.length === 0) continue;
		try {
			events.push({ data: JSON.parse(data) as unknown });
		} catch {}
	}
	return events;
}

export function parseKagiSocketResults(events: Array<{ data: unknown }>): KagiSearchSource[] {
	const out: KagiSearchSource[] = [];
	const seen = new Set<string>();
	for (const event of events) {
		if (!Array.isArray(event.data)) continue;
		for (const value of event.data) {
			if (!isKagiSocketEventItem(value) || value.tag !== "search") continue;
			const html = getKagiPayloadHtml(value);
			if (!html) continue;
			const { document } = parseHTML(html);
			for (const anchor of Array.from(
				document.querySelectorAll("a.__sri_title_link") as Iterable<KagiSocketAnchor>,
			)) {
				const url = anchor.getAttribute("href")?.trim() ?? "";
				const title = stripKagiHtml(anchor.innerHTML || anchor.textContent || "");
				if (!/^https?:\/\//i.test(url) || !title || seen.has(url)) continue;
				seen.add(url);
				out.push({ title, url, snippet: extractSocketSnippet(anchor) });
			}
		}
	}
	return out;
}

export function parseKagiSocketAnswer(events: Array<{ data: unknown }>): string | undefined {
	for (const event of events) {
		if (!Array.isArray(event.data)) continue;
		for (const value of event.data) {
			if (!isKagiSocketEventItem(value)) continue;
			if (value.tag !== "top-content-unique" && value.tag !== "answer") continue;
			const answer = stripKagiHtml(getKagiPayloadHtml(value));
			if (answer.length > 0) return answer;
		}
	}
	return undefined;
}

export function parseKagiSocketResponse(raw: string): KagiSearchResult {
	const events = parseKagiSocketEvents(raw);
	return {
		requestId: "",
		sources: parseKagiSocketResults(events),
		relatedQuestions: [],
		answer: parseKagiSocketAnswer(events),
	};
}

async function searchWithKagiBrowserSession(
	query: string,
	options: KagiSearchOptions,
	session: KagiBrowserSession,
): Promise<KagiSearchResult> {
	const fetchImpl = options.fetch ?? fetch;
	const request = async (activeSession: KagiBrowserSession): Promise<Response> => {
		const url = new URL(KAGI_SOCKET_SEARCH_URL);
		url.searchParams.set("q", query);
		try {
			return await fetchImpl(url.toString(), {
				headers: buildBrowserSearchHeaders(query, activeSession),
				signal: withHardTimeout(options.signal),
			});
		} catch (err) {
			throw new KagiApiError(
				`Kagi browser search request failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	let activeSession = session;
	let response = await request(activeSession);
	if (response.status === 401 || response.status === 403) {
		const refreshed = await captureFreshKagiBrowserSession();
		if (refreshed) {
			activeSession = refreshed;
			saveKagiBrowserSession(activeSession, options.browserSessionCachePath);
			response = await request(activeSession);
		}
	}

	const responseText = await response.text();
	if (!response.ok) {
		throw createKagiBrowserSearchError(response, responseText);
	}
	return parseKagiSocketResponse(responseText);
}

async function searchWithKagiApi(
	query: string,
	options: KagiSearchOptions,
	authStorage: AuthStorage,
): Promise<KagiSearchResult> {
	const fetchImpl = options.fetch ?? fetch;
	const body = JSON.stringify(buildRequestBody(query, options));

	const response = await withAuth(
		authStorage.resolver("kagi", { sessionId: options.sessionId }),
		async apiKey => {
			const res = await fetchImpl(KAGI_API_SEARCH_URL, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body,
				signal: withHardTimeout(options.signal),
			});

			if (!res.ok) {
				throw parseKagiErrorResponse(res.status, await res.text());
			}

			return res;
		},
		{
			signal: options.signal,
			missingKeyMessage: "Kagi credentials not found. Set KAGI_API_KEY or login with 'omp /login kagi'.",
		},
	);

	const payload = (await response.json()) as KagiSearchResponse;
	if (payload.error && payload.error.length > 0) {
		const first = payload.error[0];
		throw createKagiApiError(first.code ?? response.status, extractKagiErrorMessage(payload) ?? first.message);
	}

	const data = payload.data;
	const sources: KagiSearchSource[] = [];
	const relatedQuestions: string[] = [];

	collectSources(sources, data?.search);
	collectSources(sources, data?.video, "[Video]");
	collectSources(sources, data?.news, "[News]");
	collectSources(sources, data?.infobox, "[Info]");

	for (const item of data?.adjacent_question ?? []) {
		const q = questionOf(item);
		if (q) relatedQuestions.push(q);
	}
	for (const item of data?.related_search ?? []) {
		const q = questionOf(item);
		if (q) relatedQuestions.push(q);
	}

	const directAnswer = data?.direct_answer?.[0];
	const answer = directAnswer ? (directAnswer.snippet ?? directAnswer.title) : undefined;

	return {
		requestId: payload.meta?.trace ?? payload.meta?.id ?? "",
		sources,
		relatedQuestions,
		answer,
	};
}

export async function searchWithKagi(
	query: string,
	options: KagiSearchOptions = {},
	authStorage: AuthStorage,
): Promise<KagiSearchResult> {
	if (options.browserSession !== false) {
		const session = await getOrCaptureKagiBrowserSession({ cachePath: options.browserSessionCachePath });
		if (session) {
			try {
				return await searchWithKagiBrowserSession(query, options, session);
			} catch (err) {
				const canUseApiFallback =
					err instanceof KagiApiError &&
					(err.statusCode === 401 || err.statusCode === 403) &&
					authStorage.hasAuth("kagi");
				if (!canUseApiFallback) throw err;
			}
		}
	}

	if (options.browserSession === false || authStorage.hasAuth("kagi")) {
		return await searchWithKagiApi(query, options, authStorage);
	}

	throw new KagiApiError(NO_KAGI_BROWSER_SESSION_MESSAGE);
}
