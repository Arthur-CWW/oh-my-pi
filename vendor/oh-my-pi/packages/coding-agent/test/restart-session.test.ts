import { beforeEach, describe, expect, test } from "bun:test";
import {
	buildRestartLaunchArgs,
	buildRestartSpawnSpec,
	captureRestartLaunchArgs,
	getRestartLaunchArgsForTest,
} from "../src/cli/restart-session";

const SESSION = "live-session-abc";

describe("buildRestartLaunchArgs", () => {
	test("preserves --config and its value", () => {
		expect(buildRestartLaunchArgs(["--config", "/path/cfg.json"], SESSION)).toEqual([
			"--config",
			"/path/cfg.json",
			"--resume",
			SESSION,
		]);
	});

	test("preserves --model and its value", () => {
		expect(buildRestartLaunchArgs(["--model", "pi/large"], SESSION)).toEqual([
			"--model",
			"pi/large",
			"--resume",
			SESSION,
		]);
	});

	test("preserves --cwd and its value", () => {
		expect(buildRestartLaunchArgs(["--cwd", "/work/project"], SESSION)).toEqual([
			"--cwd",
			"/work/project",
			"--resume",
			SESSION,
		]);
	});

	test("preserves other string-valued flags", () => {
		const args = ["--mode", "text", "--provider", "anthropic", "--thinking", "high"];
		expect(buildRestartLaunchArgs(args, SESSION)).toEqual([...args, "--resume", SESSION]);
	});

	test("preserves -e extension flag and its value", () => {
		expect(buildRestartLaunchArgs(["-e", "my-ext"], SESSION)).toEqual(["-e", "my-ext", "--resume", SESSION]);
	});

	test("drops --resume and its value", () => {
		expect(buildRestartLaunchArgs(["--resume", "old-session"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops -r and its value", () => {
		expect(buildRestartLaunchArgs(["-r", "old-session"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --session and its value", () => {
		expect(buildRestartLaunchArgs(["--session", "old-session"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops bare --resume when next arg is another flag", () => {
		expect(buildRestartLaunchArgs(["--resume", "--model", "pi/large"], SESSION)).toEqual([
			"--model",
			"pi/large",
			"--resume",
			SESSION,
		]);
	});

	test("drops --continue boolean flag", () => {
		expect(buildRestartLaunchArgs(["--continue"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops -c boolean flag", () => {
		expect(buildRestartLaunchArgs(["-c"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --print boolean flag", () => {
		expect(buildRestartLaunchArgs(["--print"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops -p boolean flag", () => {
		expect(buildRestartLaunchArgs(["-p"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --fork and its value before string flag preservation", () => {
		expect(buildRestartLaunchArgs(["--fork", "fork-name"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --export and its value before string flag preservation", () => {
		expect(buildRestartLaunchArgs(["--export", "out.html"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --help and -h boolean flags", () => {
		expect(buildRestartLaunchArgs(["--help", "-h"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("drops --version and -v boolean flags", () => {
		expect(buildRestartLaunchArgs(["--version", "-v"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("preserves equals-form --config and --model", () => {
		expect(buildRestartLaunchArgs(["--config=/path/cfg.json", "--model=pi/large"], SESSION)).toEqual([
			"--config=/path/cfg.json",
			"--model=pi/large",
			"--resume",
			SESSION,
		]);
	});

	test("drops equals-form session and one-shot flags", () => {
		expect(
			buildRestartLaunchArgs(
				["--resume=old-session", "--fork=old-fork", "--export=old.html", "--continue=yes"],
				SESSION,
			),
		).toEqual(["--resume", SESSION]);
	});

	test("empty args produces only --resume", () => {
		expect(buildRestartLaunchArgs([], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("all-dropped args produces only --resume", () => {
		expect(buildRestartLaunchArgs(["--help", "--version", "--continue", "-c", "--print", "-p"], SESSION)).toEqual([
			"--resume",
			SESSION,
		]);
	});

	test("drops positional args", () => {
		expect(buildRestartLaunchArgs(["some-prompt", "another-arg"], SESSION)).toEqual(["--resume", SESSION]);
	});

	test("preserves end-of-options marker but drops following positional", () => {
		expect(buildRestartLaunchArgs(["--", "some-file.txt"], SESSION)).toEqual(["--", "--resume", SESSION]);
	});

	test("complex mix preserves reusable launch state and drops one-shot intent", () => {
		const args = [
			"--model",
			"pi/large",
			"--continue",
			"--config",
			"cfg.json",
			"--resume",
			"old-session",
			"-c",
			"--print",
			"--fork",
			"fork-x",
			"--export",
			"out.html",
			"positional-prompt",
			"--help",
			"--version",
			"--cwd",
			"/work",
		];

		expect(buildRestartLaunchArgs(args, SESSION)).toEqual([
			"--model",
			"pi/large",
			"--config",
			"cfg.json",
			"--cwd",
			"/work",
			"--resume",
			SESSION,
		]);
	});
});

describe("buildRestartSpawnSpec", () => {
	test("cwd is passed through", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/custom/cwd",
			executable: "omp",
			processArgv: ["omp"],
			launchArgs: [],
		});

		expect(spec.cwd).toBe("/custom/cwd");
	});

	test("keeps no prefix when launch args start at argv[1]", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "/usr/local/bin/omp",
			processArgv: ["/usr/local/bin/omp", "--model", "pi/large"],
			launchArgs: ["--model", "pi/large"],
		});

		expect(spec).toEqual({
			executable: "/usr/local/bin/omp",
			cwd: "/cwd",
			args: ["--model", "pi/large", "--resume", SESSION],
		});
	});

	test("keeps bun run script prefix", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "/usr/local/bin/bun",
			processArgv: ["/usr/local/bin/bun", "run", "src/cli.ts", "--model", "pi/large"],
			launchArgs: ["--model", "pi/large"],
		});

		expect(spec.args).toEqual(["run", "src/cli.ts", "--model", "pi/large", "--resume", SESSION]);
	});

	test("keeps script-only prefix when launch args are empty", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "/usr/local/bin/bun",
			processArgv: ["/usr/local/bin/bun", "src/cli.ts"],
			launchArgs: [],
		});

		expect(spec.args).toEqual(["src/cli.ts", "--resume", SESSION]);
	});

	test("uses only resume for binary-only no-arg invocation", () => {
		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "omp",
			processArgv: ["omp"],
			launchArgs: [],
		});

		expect(spec.args).toEqual(["--resume", SESSION]);
	});

	test("full integration preserves config, model, and cwd while dropping one-shot flags", () => {
		const launchArgs = [
			"--config",
			"/tmp/cfg.json",
			"--model",
			"pi/large",
			"--resume",
			"old-resume",
			"--session",
			"old-session",
			"-r",
			"old-short",
			"--continue",
			"-c",
			"--print",
			"-p",
			"--fork",
			"fork-name",
			"--export",
			"out.html",
			"--help",
			"--version",
		];

		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/work/tree",
			executable: "/usr/local/bin/bun",
			processArgv: ["/usr/local/bin/bun", "src/cli.ts", ...launchArgs],
			launchArgs,
		});

		expect(spec).toEqual({
			executable: "/usr/local/bin/bun",
			cwd: "/work/tree",
			args: ["src/cli.ts", "--config", "/tmp/cfg.json", "--model", "pi/large", "--resume", SESSION],
		});
	});
});

describe("captureRestartLaunchArgs / getRestartLaunchArgsForTest", () => {
	beforeEach(() => {
		captureRestartLaunchArgs([]);
	});

	test("round-trips captured args unchanged", () => {
		const args = ["--config", "/tmp/cfg.json", "--model", "pi/smol"];
		captureRestartLaunchArgs(args);

		expect(getRestartLaunchArgsForTest()).toEqual(args);
	});

	test("snapshot is immutable against external mutation", () => {
		const args = ["--config", "/tmp/original.json"];
		captureRestartLaunchArgs(args);
		args[1] = "/tmp/mutated.json";

		expect(getRestartLaunchArgsForTest()).toEqual(["--config", "/tmp/original.json"]);
	});

	test("captured snapshot drives default spawn reconstruction", () => {
		captureRestartLaunchArgs(["--config", "/tmp/cfg.json", "--model", "pi/smol"]);

		const spec = buildRestartSpawnSpec({
			sessionId: SESSION,
			cwd: "/cwd",
			executable: "bun",
			processArgv: ["bun", "src/cli.ts", "--config", "/tmp/cfg.json", "--model", "pi/smol"],
		});

		expect(spec.args).toEqual([
			"src/cli.ts",
			"--config",
			"/tmp/cfg.json",
			"--model",
			"pi/smol",
			"--resume",
			SESSION,
		]);
	});
});
