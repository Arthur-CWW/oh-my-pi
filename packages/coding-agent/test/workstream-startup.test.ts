import { describe, expect, it } from "bun:test";
import { parseArgs } from "@oh-my-pi/pi-coding-agent/cli/args";
import {
	resolveStartupWorkstream,
	WorkstreamResolutionError,
} from "@oh-my-pi/pi-coding-agent/cli/workstream";
import { applyStartupWorkstream } from "@oh-my-pi/pi-coding-agent/main";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import {
	executeSessionClassificationCommand,
	resolveSessionCommandAction,
} from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

describe("workstream startup classification", () => {
	it("parses the launch flag and gives it precedence over environment and cwd", () => {
		const parsed = parseArgs(["--workstream", "cli-stream"]);
		expect(parsed.workstream).toBe("cli-stream");
		expect(resolveStartupWorkstream(parsed.workstream, "/repo/streams/cwd-stream", { OMP_WORKSTREAM: "env-stream" })).toEqual({
			workstream: { kind: "workstream", id: "cli-stream" },
			explicit: true,
		});
	});

	it("uses a nonempty environment value before exact cwd inference", () => {
		expect(resolveStartupWorkstream(undefined, "/repo/streams/cwd-stream", { OMP_WORKSTREAM: "  env-stream  " })).toEqual({
			workstream: { kind: "workstream", id: "env-stream" },
			explicit: false,
		});
		expect(resolveStartupWorkstream(undefined, "/repo/streams/cwd-stream", {})).toEqual({
			workstream: { kind: "workstream", id: "cwd-stream" },
			explicit: false,
		});
	});

	it("does not infer from descendants, similarly named parents, or invalid stream directories", () => {
		expect(resolveStartupWorkstream(undefined, "/repo/streams/valid-stream/child", {})).toEqual({ explicit: false });
		expect(resolveStartupWorkstream(undefined, "/repo/not-streams/valid-stream", {})).toEqual({ explicit: false });
		expect(resolveStartupWorkstream(undefined, "/repo/streams/Invalid_Stream", {})).toEqual({ explicit: false });
	});

	it("accepts adhoc and rejects invalid explicit values actionably", () => {
		expect(resolveStartupWorkstream("adhoc", "/repo", {})).toEqual({
			workstream: { kind: "adhoc" },
			explicit: true,
		});
		expect(() => resolveStartupWorkstream("Invalid_Stream", "/repo", {})).toThrow(WorkstreamResolutionError);
		expect(() => resolveStartupWorkstream(undefined, "/repo", { OMP_WORKSTREAM: "bad slug" })).toThrow(
			/lowercase letters, numbers, and single hyphens/,
		);
	});

	it("ignores environment and cwd inference on resume but honors explicit CLI", () => {
		expect(resolveStartupWorkstream(undefined, "/repo/streams/cwd-stream", { OMP_WORKSTREAM: "bad slug" }, true)).toEqual({
			explicit: false,
		});
		expect(resolveStartupWorkstream("explicit-stream", "/repo", { OMP_WORKSTREAM: "bad slug" }, true)).toEqual({
			workstream: { kind: "workstream", id: "explicit-stream" },
			explicit: true,
		});
	});

	it("preserves resumed metadata unless the CLI classification is explicit", async () => {
		const manager = SessionManager.inMemory("/repo");
		await manager.setWorkstream({ kind: "adhoc" });
		await applyStartupWorkstream(
			manager,
			{ workstream: { kind: "workstream", id: "inferred-stream" }, explicit: false },
			false,
		);
		expect(manager.getWorkstream()).toEqual({ kind: "adhoc" });
		await applyStartupWorkstream(
			manager,
			{ workstream: { kind: "workstream", id: "explicit-stream" }, explicit: true },
			false,
		);
		expect(manager.getWorkstream()).toEqual({ kind: "workstream", id: "explicit-stream" });
	});
});

describe("session classification commands", () => {
	it("sets, reports, changes, and removes classification through SessionManager", async () => {
		const manager = SessionManager.inMemory("/repo");
		const output: string[] = [];
		const emit = (text: string): void => {
			output.push(text);
		};

		expect(await executeSessionClassificationCommand("workstream harness-runtime", manager, emit)).toBe(true);
		expect(manager.getWorkstream()).toEqual({ kind: "workstream", id: "harness-runtime" });
		expect(await executeSessionClassificationCommand("workstream", manager, emit)).toBe(true);
		expect(output.at(-1)).toBe("Session workstream: harness-runtime");

		await executeSessionClassificationCommand("adhoc", manager, emit);
		expect(manager.getWorkstream()).toEqual({ kind: "adhoc" });
		await executeSessionClassificationCommand("unclassify", manager, emit);
		expect(manager.getWorkstream()).toBeUndefined();
		expect(output.at(-1)).toBe("Session classification: unclassified");
	});

	it("requires exact delete syntax before entering the destructive handler", () => {
		expect(resolveSessionCommandAction("delete")).toBe("delete");
		expect(resolveSessionCommandAction("delete typo")).toBe("invalid");
	});

	it("rejects invalid slugs without changing classification", async () => {
		const manager = SessionManager.inMemory("/repo");
		const output: string[] = [];
		await manager.setWorkstream({ kind: "adhoc" });

		expect(
			await executeSessionClassificationCommand("workstream Bad_Slug", manager, text => {
				output.push(text);
			}),
		).toBe(true);
		expect(manager.getWorkstream()).toEqual({ kind: "adhoc" });
		expect(output[0]).toContain("Invalid workstream slug");
	});
});
