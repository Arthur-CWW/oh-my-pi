import { describe, expect, mock, test } from "bun:test";
import { lookupBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";
import type { ParsedSlashCommand, SlashCommandResult, TuiSlashCommandRuntime } from "../../src/slash-commands/types";

describe("/errors slash command", () => {
	test("lookup exposes an errors command that accepts args", () => {
		const cmd = lookupBuiltinSlashCommand("errors");
		expect(cmd).toBeDefined();
		expect(cmd!.allowArgs).toBe(true);
		expect(cmd!.handleTui).toBeDefined();
	});

	test("dispatches to handleErrorsCommand with forwarded args", async () => {
		const handleErrorsCommand = mock();
		const runtime = { ctx: { handleErrorsCommand } } as unknown as TuiSlashCommandRuntime;
		const cmd = lookupBuiltinSlashCommand("errors");
		expect(cmd).toBeDefined();

		const command = {
			name: "errors",
			args: "clear",
			text: "/errors clear",
		} as unknown as ParsedSlashCommand;

		const result = (await cmd!.handleTui!(command, runtime)) as SlashCommandResult;
		expect(handleErrorsCommand).toHaveBeenCalledTimes(1);
		expect(handleErrorsCommand.mock.calls[0][0]).toBe("clear");
		expect(result).toBeUndefined();
	});

	test("dispatches 'resolve' args to handleErrorsCommand", async () => {
		const handleErrorsCommand = mock();
		const runtime = { ctx: { handleErrorsCommand } } as unknown as TuiSlashCommandRuntime;
		const cmd = lookupBuiltinSlashCommand("errors");

		const command = {
			name: "errors",
			args: "resolve",
			text: "/errors resolve",
		} as unknown as ParsedSlashCommand;

		await cmd!.handleTui!(command, runtime);
		expect(handleErrorsCommand.mock.calls[0][0]).toBe("resolve");
	});
});
