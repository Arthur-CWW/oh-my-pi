import { Data, Effect } from "effect";
import { getGoogleCookies, type CookieMap } from "../old/chrome-cookies.js";

export class ChromeCookiesError extends Data.TaggedError("ChromeCookiesError")<{
	readonly reason: string;
}> {}

export interface CookieReadResult {
	readonly cookies: CookieMap;
	readonly warnings: ReadonlyArray<string>;
}

export interface ChromeCookiesDeps {
	readonly getGoogleCookies: () => Promise<{ cookies: CookieMap; warnings: string[] } | null>;
}

const defaultDeps: ChromeCookiesDeps = {
	getGoogleCookies,
};

export function readChromeCookiesEffect(
	deps: ChromeCookiesDeps = defaultDeps,
): Effect.Effect<CookieReadResult, ChromeCookiesError> {
	return Effect.tryPromise({
		try: async () => {
			const result = await deps.getGoogleCookies();
			if (!result) {
				throw new Error("Chrome cookie extraction unavailable on this platform or profile");
			}
			return {
				cookies: result.cookies,
				warnings: result.warnings,
			};
		},
		catch: (cause) =>
			new ChromeCookiesError({
				reason: cause instanceof Error ? cause.message : String(cause),
			}),
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
