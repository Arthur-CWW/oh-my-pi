#!/usr/bin/env bun

import { link, mkdir, readFile, rename, unlink } from "node:fs/promises";
import * as path from "node:path";

interface BuildArguments {
	entry: string;
	manifest: string;
}

function parseArguments(argv: string[]): BuildArguments {
	let entry: string | undefined;
	let manifest: string | undefined;

	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index]!;
		if (argument === "--entry") {
			entry = argv[++index];
		} else if (argument.startsWith("--entry=")) {
			entry = argument.slice("--entry=".length);
		} else if (argument === "--manifest") {
			manifest = argv[++index];
		} else if (argument.startsWith("--manifest=")) {
			manifest = argument.slice("--manifest=".length);
		} else {
			throw new Error(`Unknown argument: ${argument}`);
		}
	}

	if (!entry || !manifest) {
		throw new Error("Usage: bun run build:disposable-tui --entry <path> --manifest <path>");
	}
	return { entry: path.resolve(entry), manifest: path.resolve(manifest) };
}

async function removeIfPresent(filePath: string): Promise<void> {
	try {
		await unlink(filePath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
}

async function publishImmutableArtifact(filePath: string, contents: Uint8Array): Promise<void> {
	const temporaryPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
	try {
		await Bun.write(temporaryPath, contents);
		try {
			await link(temporaryPath, filePath);
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
			const existing = await readFile(filePath);
			if (!existing.equals(contents)) {
				throw new Error(`Hash collision for existing disposable TUI artifact: ${filePath}`);
			}
		}
	} finally {
		await removeIfPresent(temporaryPath);
	}
}

async function replaceManifestAtomically(manifestPath: string, contents: string): Promise<void> {
	const temporaryPath = `${manifestPath}.tmp-${process.pid}-${crypto.randomUUID()}`;
	try {
		await Bun.write(temporaryPath, contents);
		await rename(temporaryPath, manifestPath);
	} finally {
		await removeIfPresent(temporaryPath);
	}
}

async function main(): Promise<void> {
	const { entry, manifest } = parseArguments(Bun.argv.slice(2));
	const result = await Bun.build({
		entrypoints: [entry],
		format: "esm",
		target: "bun",
		external: ["*"],
	});
	if (!result.success) {
		for (const log of result.logs) console.error(log);
		throw new Error("Disposable TUI bundle failed");
	}
	if (result.outputs.length !== 1) {
		throw new Error(`Expected one disposable TUI bundle output, received ${result.outputs.length}`);
	}

	const contents = new Uint8Array(await result.outputs[0]!.arrayBuffer());
	const cacheKey = new Bun.CryptoHasher("sha256").update(contents).digest("hex");
	const outputDirectory = path.dirname(manifest);
	const artifactName = `view.${cacheKey}.js`;
	await mkdir(outputDirectory, { recursive: true });
	await publishImmutableArtifact(path.join(outputDirectory, artifactName), contents);
	await replaceManifestAtomically(
		manifest,
		`${JSON.stringify({ specifier: `./${artifactName}`, cacheKey }, null, "\t")}\n`,
	);
}

await main();
