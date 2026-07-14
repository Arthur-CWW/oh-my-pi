import { describe, expect, test } from "bun:test";
import {
	shouldReapOwnedProfile,
	type OwnedBrowserMarker,
} from "../../src/tools/browser/process-ownership";

const marker: OwnedBrowserMarker = {
	version: 1,
	sessionId: "session-1",
	ownerPid: 100,
	browserPid: 200,
	profileDir: "/tmp/omp/browser-sessions/session-1/run/profile",
	createdAt: "2026-07-14T00:00:00.000Z",
};

describe("owned browser profile reaping", () => {
	test("never reaps while the owning session process is alive", () => {
		expect(shouldReapOwnedProfile(marker, true, [`--user-data-dir=${marker.profileDir}`])).toBeFalse();
	});

	test("reaps a crashed session's missing browser and unlaunched profile", () => {
		expect(shouldReapOwnedProfile(marker, false, null)).toBeTrue();
		expect(shouldReapOwnedProfile({ ...marker, browserPid: null }, false, null)).toBeTrue();
	});

	test("reaps a live PID only when its arguments prove profile ownership", () => {
		expect(shouldReapOwnedProfile(marker, false, [`--user-data-dir=${marker.profileDir}`])).toBeTrue();
		expect(shouldReapOwnedProfile(marker, false, [marker.profileDir])).toBeTrue();
		expect(shouldReapOwnedProfile(marker, false, ["--user-data-dir=/Users/arthur/Library/Application Support/Google/Chrome"])).toBeFalse();
	});
});
