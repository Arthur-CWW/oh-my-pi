import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { getGoogleCookies } from "../src/old/chrome-cookies.ts";
import { queryWithCookies } from "../src/old/gemini-web.ts";

const CHROME_COOKIES_PATH = join(
	homedir(),
	"Library/Application Support/Google/Chrome/Default/Cookies",
);

function fail(message: string): never {
	console.error(`❌ ${message}`);
	process.exit(1);
}

function ok(message: string): void {
	console.log(`✅ ${message}`);
}

async function main() {
	console.log("\npi-web-access Chrome cookies e2e smoke test\n");

	if (platform() !== "darwin") {
		fail("This test currently targets macOS Chrome cookie extraction only.");
	}

	if (!existsSync(CHROME_COOKIES_PATH)) {
		fail(`Chrome cookie DB not found at: ${CHROME_COOKIES_PATH}`);
	}
	ok("Found Chrome cookie database");

	const cookieResult = await getGoogleCookies();
	if (!cookieResult) {
		fail("Cookie extraction returned null");
	}

	if (cookieResult.warnings.length > 0) {
		console.log("⚠️  Warnings:");
		for (const warning of cookieResult.warnings) {
			console.log(`   - ${warning}`);
		}
	}

	const cookieNames = Object.keys(cookieResult.cookies);
	const required = ["__Secure-1PSID", "__Secure-1PSIDTS"];
	const missing = required.filter((name) => !cookieResult.cookies[name]);

	if (missing.length > 0) {
		fail(
			`Missing required Gemini cookies: ${missing.join(", ")}. Sign into gemini.google.com in Chrome first.`,
		);
	}
	ok(`Extracted ${cookieNames.length} Google cookies (required Gemini cookies present)`);

	const pong = await queryWithCookies("Reply with exactly: PONG", cookieResult.cookies, {
		model: "gemini-2.5-flash",
		timeoutMs: 60000,
	});

	if (!pong || !pong.toUpperCase().includes("PONG")) {
		fail(`Gemini Web call succeeded but unexpected response: ${JSON.stringify(pong)}`);
	}
	ok("Gemini Web cookie-auth request returned expected response");

	console.log("\n🎉 E2E passed: local Chrome cookies -> Gemini Web cookie-auth path works\n");
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err);
	fail(`Unhandled error: ${message}`);
});
