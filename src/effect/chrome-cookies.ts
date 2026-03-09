import { Effect, Either, Schema } from "effect";
import { platform } from "node:os";
import puppeteer from "puppeteer-core";
import { getGoogleCookies as readLegacyGoogleCookies, type CookieMap } from "../old/chrome-cookies.js";

const DEFAULT_CHROME_DEBUG_URL = "http://localhost:9222";

const GOOGLE_ORIGINS = [
	"https://gemini.google.com",
	"https://accounts.google.com",
	"https://www.google.com",
] as const;

const GOOGLE_COOKIE_NAMES = new Set([
	"__Secure-1PSID",
	"__Secure-1PSIDTS",
	"__Secure-1PSIDCC",
	"__Secure-1PAPISID",
	"NID",
	"AEC",
	"SOCS",
	"__Secure-BUCKET",
	"__Secure-ENID",
	"SID",
	"HSID",
	"SSID",
	"APISID",
	"SAPISID",
	"__Secure-3PSID",
	"__Secure-3PSIDTS",
	"__Secure-3PAPISID",
	"SIDCC",
]);

interface BrowserCookieRecord {
	readonly name: string;
	readonly value: string;
	readonly domain: string;
	readonly expires: number;
}

export class ChromeCookiesError extends Schema.TaggedError<ChromeCookiesError>()(
	"ChromeCookiesError",
	{
		reason: Schema.String,
	},
) {}

export interface CookieReadResult {
	readonly cookies: CookieMap;
	readonly warnings: ReadonlyArray<string>;
	readonly source: "legacy" | "devtools" | "none";
}

export interface ChromeCookiesDeps {
	readonly readLegacyGoogleCookies: () => Promise<{ cookies: CookieMap; warnings: string[] } | null>;
	readonly readGoogleCookiesFromDevTools: (
		browserUrl: string,
	) => Promise<{ cookies: CookieMap; warnings: string[] }>;
	readonly getChromeDebugUrl: () => string;
	readonly getPlatform: () => NodeJS.Platform;
}

const defaultDeps: ChromeCookiesDeps = {
	readLegacyGoogleCookies,
	readGoogleCookiesFromDevTools,
	getChromeDebugUrl: () => process.env.CHROME_DEBUG_URL ?? DEFAULT_CHROME_DEBUG_URL,
	getPlatform: platform,
};

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function normalizeChromeDebugUrl(value: string): string {
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : DEFAULT_CHROME_DEBUG_URL;
}

function isGoogleCookieDomain(domain: string, googleHosts: ReadonlyArray<string>): boolean {
	const normalized = domain.replace(/^\.+/, "").toLowerCase();
	if (normalized.length === 0) {
		return false;
	}
	for (const host of googleHosts) {
		const normalizedHost = host.toLowerCase();
		if (normalized === normalizedHost || normalized.endsWith(`.${normalizedHost}`)) {
			return true;
		}
	}
	return false;
}

function isCookieNotExpired(expires: number, nowEpochSeconds: number): boolean {
	if (!Number.isFinite(expires) || expires <= 0) {
		return true;
	}
	return expires > nowEpochSeconds;
}

function expandHostCandidates(host: string): ReadonlyArray<string> {
	const parts = host.split(".").filter(Boolean);
	if (parts.length <= 1) {
		return [host];
	}
	const candidates = new Set<string>();
	candidates.add(host);
	for (let index = 1; index <= parts.length - 2; index++) {
		const suffix = parts.slice(index).join(".");
		if (suffix.length > 0) {
			candidates.add(suffix);
		}
	}
	return [...candidates];
}

function buildGoogleHostCandidates(): ReadonlyArray<string> {
	const hosts = new Set<string>();
	for (const origin of GOOGLE_ORIGINS) {
		const hostname = new URL(origin).hostname;
		for (const candidate of expandHostCandidates(hostname)) {
			hosts.add(candidate);
		}
	}
	return [...hosts];
}

export function selectGoogleCookies(
	rows: ReadonlyArray<BrowserCookieRecord>,
	nowEpochSeconds = Date.now() / 1000,
): CookieMap {
	const googleHosts = buildGoogleHostCandidates();
	const selected: CookieMap = {};
	for (const row of rows) {
		if (!GOOGLE_COOKIE_NAMES.has(row.name)) {
			continue;
		}
		if (selected[row.name]) {
			continue;
		}
		if (!isGoogleCookieDomain(row.domain, googleHosts)) {
			continue;
		}
		if (!isCookieNotExpired(row.expires, nowEpochSeconds)) {
			continue;
		}
		if (!row.value || row.value.length === 0) {
			continue;
		}
		selected[row.name] = row.value;
	}
	return selected;
}

export async function readGoogleCookiesFromDevTools(
	browserUrl: string,
): Promise<{ cookies: CookieMap; warnings: string[] }> {
	const normalizedUrl = normalizeChromeDebugUrl(browserUrl);
	try {
		const browser = await puppeteer.connect({ browserURL: normalizedUrl, defaultViewport: null });
		try {
			const pages = await browser.pages();
			const page = pages.at(-1) ?? (await browser.newPage());
			const cdp = await page.target().createCDPSession();
			await cdp.send("Network.enable");
			const payload = (await cdp.send("Network.getAllCookies")) as {
				readonly cookies: ReadonlyArray<BrowserCookieRecord>;
			};
			const cookies = selectGoogleCookies(payload.cookies);
			const warnings =
				Object.keys(cookies).length > 0
					? []
					: [
							"Chrome DevTools is reachable, but no Google auth cookies were found.",
							"Sign into gemini.google.com in Chrome and retry.",
						];
			return { cookies, warnings };
		} finally {
			await browser.disconnect();
		}
	} catch (error) {
		return {
			cookies: {},
			warnings: [
				`Chrome DevTools cookie extraction failed at ${normalizedUrl}: ${toErrorMessage(error)}`,
				"Start Chrome with --remote-debugging-port=9222, or set CHROME_DEBUG_URL to your DevTools endpoint.",
			],
		};
	}
}

export function readChromeCookiesEffect(
	deps: ChromeCookiesDeps = defaultDeps,
): Effect.Effect<CookieReadResult, ChromeCookiesError> {
	return Effect.gen(function* () {
		const platformName = deps.getPlatform();
		const debugUrl = normalizeChromeDebugUrl(deps.getChromeDebugUrl());

		const warnings: string[] = [];
		let legacyCookies: CookieMap = {};

		const legacyAttempt = yield* Effect.either(
			Effect.tryPromise({
				try: () => deps.readLegacyGoogleCookies(),
				catch: (cause) =>
					ChromeCookiesError.make({
						reason: toErrorMessage(cause),
					}),
			}),
		);
		if (Either.isRight(legacyAttempt) && legacyAttempt.right) {
			legacyCookies = legacyAttempt.right.cookies;
			warnings.push(...legacyAttempt.right.warnings);
		}
		if (Either.isLeft(legacyAttempt)) {
			warnings.push(`Legacy cookie extraction failed: ${legacyAttempt.left.reason}`);
		}

		if (Object.keys(legacyCookies).length > 0) {
			return {
				cookies: legacyCookies,
				warnings,
				source: "legacy" as const,
			};
		}

		if (platformName !== "darwin") {
			warnings.push("Non-macOS platform detected; using Chrome DevTools cookie extraction fallback.");
		}

		const devToolsAttempt = yield* Effect.either(
			Effect.tryPromise({
				try: () => deps.readGoogleCookiesFromDevTools(debugUrl),
				catch: (cause) =>
					ChromeCookiesError.make({
						reason: toErrorMessage(cause),
					}),
			}),
		);

		if (Either.isRight(devToolsAttempt)) {
			warnings.push(...devToolsAttempt.right.warnings);
			if (Object.keys(devToolsAttempt.right.cookies).length > 0) {
				return {
					cookies: devToolsAttempt.right.cookies,
					warnings,
					source: "devtools" as const,
				};
			}
		} else {
			warnings.push(`DevTools cookie extraction failed: ${devToolsAttempt.left.reason}`);
		}

		warnings.push("No Google auth cookies are currently available.");
		return {
			cookies: {},
			warnings,
			source: "none" as const,
		};
	});
}

interface CookiesCliArgs {
	readonly names: ReadonlyArray<string>;
	readonly json: boolean;
	readonly help: boolean;
}

type CookiesCliParseResult =
	| { readonly kind: "ok"; readonly value: CookiesCliArgs }
	| { readonly kind: "error"; readonly message: string };

export interface CookiesCliDeps {
	readonly readCookies?: () => Promise<CookieReadResult>;
	readonly stdout?: (text: string) => void;
	readonly stderr?: (text: string) => void;
}

const DEFAULT_COOKIE_NAMES = ["__Secure-1PSID", "__Secure-1PSIDTS", "NID"] as const;

const COOKIES_CLI_USAGE = `Usage: bun src/effect/chrome-cookies.ts [options]

Options:
  --names <cookieA,cookieB>    Comma-separated cookie names to check
  --json                       Print JSON output
  -h, --help                   Show this help
`;

function parseCliValue(argv: readonly string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (!value) {
		throw new Error(`Missing value for ${flag}`);
	}
	return value;
}

export function parseCookiesCliArgs(argv: readonly string[]): CookiesCliParseResult {
	const names: string[] = [];
	let json = false;
	let help = false;

	try {
		for (let index = 0; index < argv.length; index++) {
			const arg = argv[index];
			switch (arg) {
				case "-h":
				case "--help":
					help = true;
					break;
				case "--json":
					json = true;
					break;
				case "--names": {
					const value = parseCliValue(argv, index, arg);
					names.push(...value.split(",").map((name) => name.trim()).filter(Boolean));
					index += 1;
					break;
				}
				default:
					if (arg.startsWith("-")) {
						return { kind: "error", message: `Unknown flag ${arg}` };
					}
					names.push(arg);
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { kind: "error", message };
	}

	return {
		kind: "ok",
		value: {
			names: names.length > 0 ? names : [...DEFAULT_COOKIE_NAMES],
			json,
			help,
		},
	};
}

export async function runCookiesCli(
	argv: readonly string[],
	deps: CookiesCliDeps = {},
): Promise<number> {
	const parsed = parseCookiesCliArgs(argv);
	const stdout = deps.stdout ?? ((text: string) => console.log(text));
	const stderr = deps.stderr ?? ((text: string) => console.error(text));

	if (parsed.kind === "error") {
		stderr(`Error: ${parsed.message}`);
		stderr(COOKIES_CLI_USAGE.trimEnd());
		return 1;
	}

	if (parsed.value.help) {
		stdout(COOKIES_CLI_USAGE.trimEnd());
		return 0;
	}

	const readCookies = deps.readCookies ?? (() => Effect.runPromise(readChromeCookiesEffect()));

	try {
		const result = await readCookies();
		const present = parsed.value.names.filter((name) => Boolean(result.cookies[name]));
		const missing = parsed.value.names.filter((name) => !result.cookies[name]);
		if (parsed.value.json) {
			stdout(
				JSON.stringify(
					{
						requested: parsed.value.names,
						present,
						missing,
						warnings: result.warnings,
						source: result.source,
						cookies: result.cookies,
					},
					null,
					2,
				),
			);
			return 0;
		}

		const lines = [
			`Found ${Object.keys(result.cookies).length} Google cookie(s).`,
			`Requested present: ${present.length}/${parsed.value.names.length}`,
			`Source: ${result.source}`,
		];
		if (present.length > 0) {
			lines.push("", "Present:", ...present.map((name) => `- ${name}`));
		}
		if (missing.length > 0) {
			lines.push("", "Missing:", ...missing.map((name) => `- ${name}`));
		}
		if (result.warnings.length > 0) {
			lines.push("", "Warnings:", ...result.warnings.map((warning) => `- ${warning}`));
		}
		stdout(lines.join("\n"));
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		stderr(`Error: ${message}`);
		return 1;
	}
}

function isBunDirectRun(fileStem: string): boolean {
	if (typeof Bun === "undefined") return false;
	const scriptPath = Bun.argv[1];
	if (!scriptPath) return false;
	return (
		scriptPath.endsWith(`/${fileStem}.ts`) ||
		scriptPath.endsWith(`\\${fileStem}.ts`) ||
		scriptPath.endsWith(`/${fileStem}.js`) ||
		scriptPath.endsWith(`\\${fileStem}.js`)
	);
}

if (isBunDirectRun("chrome-cookies")) {
	void runCookiesCli(process.argv.slice(2)).then((exitCode) => {
		process.exitCode = exitCode;
	});
}
