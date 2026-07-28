/**
 * Show what the read tool will return for a path, URL, or internal URI.
 */
import { Effect } from "effect";
import { Argument, Command } from "effect/unstable/cli";
import { type ReadCommandArgs, runReadCommand } from "../cli/read-cli";
import { initTheme } from "../modes/theme/theme";

export default Command.make(
	"read",
	{
		path: Argument.string("path").pipe(
			Argument.withDescription(
				"Path, URL, or internal URI to read (append :sel for line ranges or raw mode, e.g. src/foo.ts:50-100)",
			),
		),
	},
	config =>
		Effect.promise(async () => {
			const cmd: ReadCommandArgs = {
				path: config.path,
			};
			await initTheme();
			await runReadCommand(cmd);
		}),
).pipe(
	Command.withDescription("Show what the read tool will return for a path, URL, or internal URI"),
	Command.withExamples([
		{ command: "omp read src/foo.ts" },
		{ command: "omp read src/foo.ts:50-100" },
		{ command: "omp read src/foo.ts:raw" },
		{ command: "omp read https://example.com" },
		{ command: "omp read omp://" },
		{ command: "omp read issue://123" },
		{ command: "omp read path/to/archive.zip:dir/file.ts" },
		{ command: "omp read path/to/db.sqlite:users:42" },
	]),
);
