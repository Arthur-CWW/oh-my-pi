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
