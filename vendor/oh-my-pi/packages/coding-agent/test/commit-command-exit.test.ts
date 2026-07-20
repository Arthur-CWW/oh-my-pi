import { afterEach, describe, expect, it, vi } from "bun:test";
import { NodeServices } from "@effect/platform-node";
import CommitCommand from "@oh-my-pi/pi-coding-agent/commands/commit";
import * as commitModule from "@oh-my-pi/pi-coding-agent/commit";
import * as themeModule from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { postmortem } from "@oh-my-pi/pi-utils";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

describe("omp commit command lifecycle (issue #1041)", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forces process exit after the commit pipeline resolves", async () => {
		const initThemeSpy = vi.spyOn(themeModule, "initTheme").mockResolvedValue(undefined);
		const runCommitSpy = vi.spyOn(commitModule, "runCommitCommand").mockResolvedValue(undefined);
		// Stub postmortem.quit so it records the exit code without actually
		// terminating the test runner. Resolves immediately — the production
		// implementation never returns, but the contract under test is that
		// the call happens at all.
		const quitSpy = vi.spyOn(postmortem, "quit").mockResolvedValue(undefined);

		await Effect.runPromise(
			Command.runWith(CommitCommand, { version: "0.0.0-test" })([]).pipe(Effect.provide(NodeServices.layer)),
		);

		expect(initThemeSpy).toHaveBeenCalledTimes(1);
		expect(runCommitSpy).toHaveBeenCalledTimes(1);
		// Quit must come after the pipeline so we cannot regress the order.
		expect(runCommitSpy.mock.invocationCallOrder[0]).toBeLessThan(quitSpy.mock.invocationCallOrder[0]);
		expect(quitSpy).toHaveBeenCalledWith(0);
	});
});
