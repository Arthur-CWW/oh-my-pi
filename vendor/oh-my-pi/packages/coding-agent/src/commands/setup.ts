/**
 * Run onboarding setup or install dependencies for optional features.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { parseArgs } from "../cli/args";
import { printSetupHelp, runSetupCommand } from "../cli/setup-cli";
import { runRootCommand } from "../main";
import { initTheme } from "../modes/theme/theme";

export interface OnboardingSetupDependencies {
	runRoot?: typeof runRootCommand;
	stdinIsTTY?: boolean;
	stdoutIsTTY?: boolean;
	writeStderr?: (text: string) => void;
	exit?: (code: number) => never;
}

export async function runOnboardingSetup(deps: OnboardingSetupDependencies = {}): Promise<void> {
	const stdinIsTTY = deps.stdinIsTTY ?? process.stdin.isTTY;
	const stdoutIsTTY = deps.stdoutIsTTY ?? process.stdout.isTTY;
	if (!stdinIsTTY || !stdoutIsTTY) {
		(deps.writeStderr ?? (text => process.stderr.write(text)))("omp setup requires an interactive TTY.\n");
		(deps.exit ?? process.exit)(1);
		return;
	}
	await (deps.runRoot ?? runRootCommand)(parseArgs([]), [], { forceSetupWizard: true });
}

export default Command.make(
	"setup",
	{
		component: Argument.choice("component", ["python", "speech"]).pipe(
			Argument.withDescription("Optional component to install"),
			Argument.optional,
		),
		check: Flag.boolean("check").pipe(
			Flag.withAlias("c"),
			Flag.withDescription("Check if dependencies are installed"),
			Flag.withDefault(false),
		),
		json: Flag.boolean("json").pipe(Flag.withDescription("Output status as JSON"), Flag.withDefault(false)),
	},
	(config) =>
		Effect.gen(function* () {
			const component = Option.getOrUndefined(config.component);
			if (!component) {
				if (config.check || config.json) {
					yield* Effect.sync(() => printSetupHelp());
					return;
				}
				yield* Effect.promise(() => runOnboardingSetup());
				return;
			}
			yield* Effect.promise(() => initTheme());
			yield* Effect.promise(() => runSetupCommand({ component, flags: { json: config.json, check: config.check } }));
		}),
).pipe(Command.withDescription("Run onboarding setup or install dependencies for optional features"));
