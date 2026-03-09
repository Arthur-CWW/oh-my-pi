import { platform } from "node:os";
import { describe, expect, it } from "bun:test";
import { readLegacyGoogleCookies } from "../src/effect/chrome-cookies-legacy.js";

describe("effect chrome-cookies legacy reader", () => {
	it("returns null on non-macOS platforms", async () => {
		if (platform() === "darwin") {
			// On macOS this path depends on local Chrome/Keychain state; just assert it does not throw.
			const result = await readLegacyGoogleCookies();
			expect(result === null || typeof result === "object").toBe(true);
			return;
		}

		const result = await readLegacyGoogleCookies();
		expect(result).toBeNull();
	});
});
