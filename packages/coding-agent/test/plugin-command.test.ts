import { describe, expect, it } from "bun:test";
import { NodeServices } from "@effect/platform-node";
import plugin from "@oh-my-pi/pi-coding-agent/commands/plugin";
import { Effect } from "effect";
import { Command } from "effect/unstable/cli";

describe("Plugin command scope parsing", () => {
	it("rejects invalid scope values", async () => {
		await expect(
			Effect.runPromise(
				Command.runWith(plugin, { version: "0.0.0-test" })(["install", "--scope", "porject"]).pipe(
					Effect.provide(NodeServices.layer),
				),
			),
		).rejects.toThrow();
	});
});
