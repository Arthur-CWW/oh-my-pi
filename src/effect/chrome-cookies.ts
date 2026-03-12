import { NodeServices } from "@effect/platform-node";
import { Cause, Data, Effect, Exit, Option, Result } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { platform } from "node:os";
import puppeteer from "puppeteer-core";
import { readLegacyGoogleCookies, type CookieMap } from "./chrome-cookies-legacy.js";

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

export class ChromeCookiesError extends Data.TaggedError("ChromeCookiesError")<{
	readonly reason: string;
}> {}

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

		const legacyAttempt = yield* Effect.result(
			Effect.tryPromise({
				try: () => deps.readLegacyGoogleCookies(),
				catch: (cause) =>
					new ChromeCookiesError({
						reason: toErrorMessage(cause),
					}),
			}),
		);
		if (Result.isSuccess(legacyAttempt) && legacyAttempt.success) {
			legacyCookies = legacyAttempt.success.cookies;
			warnings.push(...legacyAttempt.success.warnings);
		}
		if (Result.isFailure(legacyAttempt)) {
			warnings.push(`Legacy cookie extraction failed: ${legacyAttempt.failure.reason}`);
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

		const devToolsAttempt = yield* Effect.result(
			Effect.tryPromise({
				try: () => deps.readGoogleCookiesFromDevTools(debugUrl),
				catch: (cause) =>
					new ChromeCookiesError({
						reason: toErrorMessage(cause),
					}),
			}),
		);

		if (Result.isSuccess(devToolsAttempt)) {
			warnings.push(...devToolsAttempt.success.warnings);
			if (Object.keys(devToolsAttempt.success.cookies).length > 0) {
				return {
					cookies: devToolsAttempt.success.cookies,
					warnings,
					source: "devtools" as const,
				};
			}
		} else {
			warnings.push(`DevTools cookie extraction failed: ${devToolsAttempt.failure.reason}`);
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
}

class CookiesCliParseError extends Data.TaggedError("CookiesCliParseError")<{
	readonly reason: string;
}> {}

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

function normalizeCookieNames(rawNames: ReadonlyArray<string>): ReadonlyArray<string> {
	return rawNames
		.flatMap((entry) => entry.split(","))
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function makeCookiesCliParserCommand() {
	let parsed: CookiesCliArgs | null = null;

	const namesOption = Flag.optional(Flag.string("names"));
	const nameArgs = Argument.string("name").pipe(Argument.variadic());
	const json = Flag.boolean("json");

	const command = Command.make(
		"chrome-cookies",
		{ namesOption, nameArgs, json },
		Effect.fn(function* (input) {
			const names = normalizeCookieNames([
				...(Option.isSome(input.namesOption) ? [input.namesOption.value] : []),
				...input.nameArgs,
			]);
			parsed = {
				names: names.length > 0 ? names : [...DEFAULT_COOKIE_NAMES],
				json: input.json,
			};
		}),
	);

	return {
		command,
		readParsed: () => parsed,
	};
}

export async function runCookiesCli(
	argv: readonly string[],
	deps: CookiesCliDeps = {},
): Promise<number> {
	const stdout = deps.stdout ?? ((text: string) => console.log(text));
	const stderr = deps.stderr ?? ((text: string) => console.error(text));
	if (argv.includes("--help") || argv.includes("-h")) {
		stdout(COOKIES_CLI_USAGE.trimEnd());
		return 0;
	}

	const parser = makeCookiesCliParserCommand();
	const runCommand = Command.runWith(parser.command, {
		version: "0.0.0",
	});
	const parseExit = await Effect.runPromiseExit(
		runCommand(argv).pipe(Effect.provide(NodeServices.layer)),
	);
	if (Exit.isFailure(parseExit)) {
		const squashed = Cause.squash(parseExit.cause);
		const reason = squashed instanceof CookiesCliParseError ? squashed.reason : String(squashed);
		stderr(`Error: ${reason}`);
		stderr(COOKIES_CLI_USAGE.trimEnd());
		return 1;
	}

	const parsed = parser.readParsed();
	if (!parsed) {
		stderr("Error: Cookie command failed");
		return 1;
	}

	const readCookies = deps.readCookies ?? (() => Effect.runPromise(readChromeCookiesEffect()));

	try {
		const result = await readCookies();
		const present = parsed.names.filter((name) => Boolean(result.cookies[name]));
		const missing = parsed.names.filter((name) => !result.cookies[name]);
		if (parsed.json) {
			stdout(
				JSON.stringify(
					{
						requested: parsed.names,
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
			`Requested present: ${present.length}/${parsed.names.length}`,
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
		stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
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
