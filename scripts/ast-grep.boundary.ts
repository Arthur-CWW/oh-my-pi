#!/usr/bin/env bun
import { spawnSync } from "node:child_process";

type CommandError = Error & { code?: string };

const astGrepPackage = "@ast-grep/cli@0.42.2";
const args = process.argv.slice(2);

const direct = spawnSync("ast-grep", args, {
	cwd: process.cwd(),
	stdio: "inherit",
});

if (!isMissingCommand(direct.error)) {
	process.exit(direct.status ?? 1);
}

const viaBunx = spawnSync("bunx", ["--bun", astGrepPackage, ...args], {
	cwd: process.cwd(),
	stdio: "inherit",
});

if (!isMissingCommand(viaBunx.error)) {
	process.exit(viaBunx.status ?? 1);
}

const viaBun = spawnSync("bun", ["x", "--bun", astGrepPackage, ...args], {
	cwd: process.cwd(),
	stdio: "inherit",
});

if (viaBun.error) {
	console.error("Failed to run ast-grep. Install Bun or add @ast-grep/cli to this workspace.");
	console.error(viaBun.error.message);
	process.exit(127);
}

process.exit(viaBun.status ?? 1);

function isMissingCommand(error: CommandError | undefined): boolean {
	return error?.code === "ENOENT";
}
