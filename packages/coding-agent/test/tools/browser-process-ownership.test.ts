import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { describe, expect, test } from "bun:test";
import { getActiveProfile, getProfileRootDir, setProfile } from "@oh-my-pi/pi-utils";
import { BrowserTabBudgetError } from "../../src/tools/browser/tab-budget";
import {
	listOwnedBrowserTabLeases,
	releaseOwnedBrowserTabLease,
	reserveOwnedBrowserTabLease,
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

describe("owned browser tab lease budgets", () => {
	test("serializes persisted per-session and global admission with attributed refusals", async () => {
		const previousProfile = getActiveProfile();
		const profile = `browser-tab-budget-test-${randomUUID()}`;
		const leases: string[] = [];
		setProfile(profile);
		try {
			for (const [sessionId, tabName] of [
				["session-a", "a1"],
				["session-a", "a2"],
				["session-b", "b1"],
			] as const) {
				const lease = await reserveOwnedBrowserTabLease({
					sessionId,
					tabName,
					maxTabsPerSession: 4,
					maxGlobalTabs: 3,
				});
				leases.push(lease.leaseId);
			}

			const error = await reserveOwnedBrowserTabLease({
				sessionId: "session-c",
				tabName: "c1",
				maxTabsPerSession: 4,
				maxGlobalTabs: 3,
			}).then(
				() => undefined,
				reason => reason,
			);

			expect(error).toBeInstanceOf(BrowserTabBudgetError);
			expect(error).toMatchObject({
				scope: "global",
				limit: 3,
				sessionId: "session-c",
				consumers: [
					{ sessionId: "session-a", count: 2 },
					{ sessionId: "session-b", count: 1 },
				],
			});
			expect((error as BrowserTabBudgetError).message).toContain("Top tab consumers");
			expect(await listOwnedBrowserTabLeases()).toHaveLength(3);

			for (const leaseId of leases) await releaseOwnedBrowserTabLease(leaseId);
			leases.length = 0;
			const first = await reserveOwnedBrowserTabLease({
				sessionId: "remote-session",
				tabName: "remote-1",
				maxTabsPerSession: 1,
				maxGlobalTabs: 3,
			});
			leases.push(first.leaseId);
			const sessionError = await reserveOwnedBrowserTabLease({
				sessionId: "remote-session",
				tabName: "local-2",
				maxTabsPerSession: 1,
				maxGlobalTabs: 3,
			}).then(
				() => undefined,
				reason => reason,
			);
			expect(sessionError).toMatchObject({
				scope: "session",
				limit: 1,
				sessionId: "remote-session",
				consumers: [{ sessionId: "remote-session", count: 1 }],
			});
		} finally {
			for (const leaseId of leases) await releaseOwnedBrowserTabLease(leaseId);
			setProfile(previousProfile);
			await fs.rm(getProfileRootDir(profile), { recursive: true, force: true });
		}
	});

	test("counts a live lease owned by another process for both refusal scopes", async () => {
		const previousProfile = getActiveProfile();
		const profile = `browser-xproc-${randomUUID()}`;
		setProfile(profile);
		const childCode = `
			const { setProfile } = await import("@oh-my-pi/pi-utils");
			const { reserveOwnedBrowserTabLease } = await import("./src/tools/browser/process-ownership.ts");
			setProfile(${JSON.stringify(profile)});
			const lease = await reserveOwnedBrowserTabLease({
				sessionId: "remote-session",
				tabName: "remote-tab",
				maxTabsPerSession: 4,
				maxGlobalTabs: 12,
			});
			console.log("READY " + lease.leaseId);
			await Bun.sleep(30_000);
		`;
		const child = Bun.spawn([process.execPath, "-e", childCode], {
			cwd: process.cwd(),
			stdout: "pipe",
			stderr: "inherit",
		});
		try {
			const reader = child.stdout.getReader();
			const first = await reader.read();
			reader.releaseLock();
			expect(first.done).toBeFalse();
			expect(new TextDecoder().decode(first.value)).toContain("READY ");

			const sessionError = await reserveOwnedBrowserTabLease({
				sessionId: "remote-session",
				tabName: "local-session-tab",
				maxTabsPerSession: 1,
				maxGlobalTabs: 12,
			}).then(
				() => undefined,
				reason => reason,
			);
			expect(sessionError).toMatchObject({
				scope: "session",
				consumers: [{ sessionId: "remote-session", count: 1 }],
			});

			const globalError = await reserveOwnedBrowserTabLease({
				sessionId: "local-session",
				tabName: "local-global-tab",
				maxTabsPerSession: 4,
				maxGlobalTabs: 1,
			}).then(
				() => undefined,
				reason => reason,
			);
			expect(globalError).toMatchObject({
				scope: "global",
				consumers: [{ sessionId: "remote-session", count: 1 }],
			});
		} finally {
			child.kill();
			await child.exited;
			setProfile(previousProfile);
			await fs.rm(getProfileRootDir(profile), { recursive: true, force: true });
		}
	});
});
