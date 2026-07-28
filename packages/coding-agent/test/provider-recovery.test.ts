import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import {
	appendProviderRecoveryRecord,
	createProviderRecoveryRecord,
	PROVIDER_RECOVERY_CUSTOM_TYPE,
	transitionProviderRecoveryRecord,
	waitForProviderRecovery,
} from "@oh-my-pi/pi-coding-agent/session/provider-recovery";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

let root: string;
let previousHome: string | undefined;
let previousControlDb: string | undefined;
let authStorage: AuthStorage;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "provider-recovery-"));
	previousHome = process.env.HOME;
	previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.HOME = root;
	process.env.OMP_SESSION_CONTROL_DB = path.join(root, "session-control.sqlite");
	authStorage = await AuthStorage.create(path.join(root, "auth.sqlite"));
});

afterEach(async () => {
	authStorage.close();
	if (previousHome === undefined) delete process.env.HOME;
	else process.env.HOME = previousHome;
	if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
	else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	await fs.rm(root, { recursive: true, force: true });
});

function record(kind: "auth-invalid" | "rate-limit", now = 1_000) {
	return createProviderRecoveryRecord({
		agentId: "Child",
		provider: "openai-codex",
		model: "gpt-test",
		route: "openai-codex/gpt-test",
		kind,
		attempt: 1,
		maxAttempts: 3,
		now,
		...(kind === "rate-limit" ? { retryAt: now + 500 } : {}),
	});
}

describe("provider recovery", () => {
	it("resumes the same auth wait when the real credential store generation changes", async () => {
		const controller = new AbortController();
		const waiting = waitForProviderRecovery({
			record: record("auth-invalid", Date.now()),
			authStorage,
			signal: controller.signal,
			wait: (_delay, signal) =>
				new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
		});
		await authStorage.set("openai-codex", {
			type: "oauth",
			access: "replacement-secret-token",
			refresh: "replacement-refresh-token",
			expires: Date.now() + 120_000,
		});
		expect(await waiting).toBe("ready");
	});

	it("uses the authoritative reset deadline with an injected clock", async () => {
		let now = 1_000;
		const outcome = await waitForProviderRecovery({
			record: record("rate-limit", now),
			authStorage,
			signal: new AbortController().signal,
			now: () => now,
			random: () => 0,
			wait: async delay => {
				now += delay;
			},
		});
		expect(outcome).toBe("ready");
		expect(now).toBe(1_500);
	});

	it("persists one idempotent waiting record without credential material", () => {
		const manager = SessionManager.create(root, root);
		const recovery = { ...record("auth-invalid"), credentialSlotId: "opaque-slot-digest" };
		appendProviderRecoveryRecord(manager, recovery);
		transitionProviderRecoveryRecord(manager, "waiting");
		const entries = manager.getEntries().filter(
			entry => entry.type === "custom" && entry.customType === PROVIDER_RECOVERY_CUSTOM_TYPE,
		);
		expect(entries).toHaveLength(1);
		const serialized = JSON.stringify(entries);
		expect(serialized).not.toContain("replacement-secret-token");
		expect(serialized).not.toContain("replacement-refresh-token");
	});

	it("honors cancellation before scheduling a wake", async () => {
		const controller = new AbortController();
		controller.abort();
		expect(await waitForProviderRecovery({ record: record("rate-limit"), authStorage, signal: controller.signal })).toBe(
			"cancelled",
		);
	});
});
