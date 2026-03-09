import { Effect } from "effect";
import { readChromeCookiesEffect } from "../src/effect/chrome-cookies.ts";
import { queryWithCookies } from "../src/old/gemini-web.ts";

function fail(message: string): never {
	console.error(`❌ ${message}`);
	process.exit(1);
}

function ok(message: string): void {
	console.log(`✅ ${message}`);
}

function skip(message: string): void {
	console.log(`⚠️  ${message}`);
}

async function main() {
	console.log("\npi-web-access Chrome cookies e2e smoke test\n");

	const exit = await Effect.runPromiseExit(readChromeCookiesEffect());
	if (exit._tag === "Failure") {
		fail("Cookie extraction failed");
	}

	if (exit.value.warnings.length > 0) {
		console.log("Warnings:");
		for (const warning of exit.value.warnings) {
			console.log(`   - ${warning}`);
		}
	}

	const cookieNames = Object.keys(exit.value.cookies);
	const required = ["__Secure-1PSID", "__Secure-1PSIDTS"];
	const missing = required.filter((name) => !exit.value.cookies[name]);

	if (missing.length > 0) {
		skip(
			`Required Gemini cookies are missing (${missing.join(", ")}). Sign into gemini.google.com in Chrome and retry.`,
		);
		return;
	}

	ok(
		`Extracted ${cookieNames.length} Google cookies from ${exit.value.source} (required Gemini cookies present)`,
	);

	const pong = await queryWithCookies("Reply with exactly: PONG", exit.value.cookies, {
		model: "gemini-2.5-flash",
		timeoutMs: 60000,
	});

	if (!pong || !pong.toUpperCase().includes("PONG")) {
		fail(`Gemini Web call succeeded but unexpected response: ${JSON.stringify(pong)}`);
	}
	ok("Gemini Web cookie-auth request returned expected response");

	console.log("\n🎉 E2E passed: Chrome cookies -> Gemini Web cookie-auth path works\n");
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err);
	fail(`Unhandled error: ${message}`);
});
