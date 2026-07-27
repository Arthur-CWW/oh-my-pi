import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { notifyCmuxAsk } from "@oh-my-pi/pi-coding-agent/tools/cmux-ask-bridge";

async function createCmuxFixture(activeSurface: string): Promise<{
	readonly root: string;
	readonly logPath: string;
	readonly env: Record<string, string>;
}> {
	const root = await mkdtemp(join(tmpdir(), "omp-cmux-ask-"));
	const logPath = join(root, "argv.log");
	const cmuxPath = join(root, "cmux");
	await Bun.write(
		cmuxPath,
		`#!/bin/sh
printf '%s\\n' "$*" >> "$CMUX_FIXTURE_LOG"
case "$*" in
  "list-panels --workspace workspace:1 --json") printf '%s\\n' '{"surfaces":[{"id":"surface-focused-id","ref":"${activeSurface}","focused":true}]}' ;;
  notify*) printf '%s\\n' 'notification receipt' ;;
esac
`,
	);
	await chmod(cmuxPath, 0o755);
	return {
		root,
		logPath,
		env: {
			...process.env,
			HOME: root,
			PATH: `${root}:${process.env.PATH ?? ""}`,
			OMP_SESSION_CONTROL_DB: join(root, "session-control.sqlite"),
			CMUX_FIXTURE_LOG: logPath,
			CMUX_WORKSPACE_ID: "workspace:1",
			CMUX_SURFACE_ID: "surface:target",
		},
	};
}

describe("cmux ask bridge", () => {
	it("queries focus and emits exactly one targeted notification for an unfocused surface", async () => {
		const fixture = await createCmuxFixture("surface:focused");
		try {
			const receipt = await notifyCmuxAsk("Approve the migration?", fixture.env);
			expect(receipt.status).toBe("notified");
			if (receipt.status !== "notified") throw new Error("expected notification receipt");
			expect(receipt.commands.map((command) => command.argv)).toEqual([
				["cmux", "list-panels", "--workspace", "workspace:1", "--json"],
				["cmux", "notify", "--surface", "surface:target", "--title", "Oh My Pi", "--body", "Approve the migration?"],
			]);
			expect(receipt.commands[1]?.stdout).toContain("notification receipt");
			expect((await readFile(fixture.logPath, "utf8")).trim().split("\n")).toEqual([
				"list-panels --workspace workspace:1 --json",
				"notify --surface surface:target --title Oh My Pi --body Approve the migration?",
			]);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it("does not notify when the session surface is focused", async () => {
		const fixture = await createCmuxFixture("surface:target");
		try {
			const receipt = await notifyCmuxAsk("Approve the migration?", fixture.env);
			expect(receipt.status).toBe("focused");
			if (receipt.status !== "focused") throw new Error("expected focused receipt");
			expect(receipt.commands.map((command) => command.argv)).toEqual([
				["cmux", "list-panels", "--workspace", "workspace:1", "--json"],
			]);
			expect((await readFile(fixture.logPath, "utf8")).trim()).toBe("list-panels --workspace workspace:1 --json");
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
});
