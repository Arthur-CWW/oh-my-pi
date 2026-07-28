#!/usr/bin/env bun

import * as path from "node:path";
import { findCodexBundleDrift, type CodexBundlePayload } from "./codex-bundle";
import type { ModelSpec } from "../src/types";

const packageRoot = path.join(import.meta.dir, "..");
const vendorRoot = path.join(packageRoot, "..", "..", "..");
const codexRoot = path.join(vendorRoot, "openai", "codex");
const defaultBundlePath = path.join(codexRoot, "codex-rs", "models-manager", "models.json");
const generatedPath = path.join(packageRoot, "src", "models.json");

function readOption(name: string): string | undefined {
	const index = Bun.argv.indexOf(name);
	return index === -1 ? undefined : Bun.argv[index + 1];
}

async function readCommit(): Promise<string> {
	const child = Bun.spawn(["git", "-C", codexRoot, "rev-parse", "HEAD"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (exitCode !== 0) throw new Error(`Unable to resolve vendored Codex commit: ${stderr.trim()}`);
	return stdout.trim();
}

const bundlePath = readOption("--models-json") ?? defaultBundlePath;
const [bundle, generated, commit] = await Promise.all([
	Bun.file(bundlePath).json() as Promise<CodexBundlePayload>,
	Bun.file(generatedPath).json() as Promise<Record<string, Record<string, ModelSpec>>>,
	readCommit(),
]);
const drift = findCodexBundleDrift(generated, bundle, commit);
if (drift.length > 0) {
	for (const message of drift) console.error(message);
	process.exitCode = 1;
} else {
	console.log(`Codex bundle metadata matches generated catalog at ${commit}`);
}
