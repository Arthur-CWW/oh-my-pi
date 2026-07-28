import { describe, expect, it } from "bun:test";
import {
	PsExecutionError,
	readProcessGroupId,
	type SyncCommandExecutor,
} from "@oh-my-pi/pi-coding-agent/resource/ps-command";
import { Effect } from "effect";

describe("ps command boundary", () => {
	it("reads a process group id through the injected ps executor", () => {
		let invocation: { executable: string; args: readonly string[] } | undefined;
		const executor: SyncCommandExecutor = (executable, args) => {
			invocation = { executable, args };
			return Effect.succeed("  4321  ");
		};

		expect(readProcessGroupId(123, executor)).toBe(4321);
		expect(invocation).toEqual({ executable: "ps", args: ["-o", "pgid=", "-p", "123"] });
	});

	it("rejects invalid or unsafe process group ids", () => {
		let invocations = 0;
		const executor: SyncCommandExecutor = () => {
			invocations += 1;
			return Effect.succeed("1");
		};

		expect(readProcessGroupId(0, executor)).toBeUndefined();
		expect(readProcessGroupId(Number.MAX_SAFE_INTEGER + 1, executor)).toBeUndefined();
		expect(invocations).toBe(0);
		expect(readProcessGroupId(123, executor)).toBeUndefined();
	});

	it("returns undefined when ps fails or emits a malformed process group id", () => {
		const failed: SyncCommandExecutor = () =>
			Effect.fail(new PsExecutionError({ message: "ps failed", reason: "nonzero-exit" }));
		const malformed: SyncCommandExecutor = () => Effect.succeed("not-a-pgid");

		expect(readProcessGroupId(123, failed)).toBeUndefined();
		expect(readProcessGroupId(123, malformed)).toBeUndefined();
	});
});
