import { afterEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	overrideRestartExecutable,
	resolveDisposableTuiManifest,
} from "../../src/modes/run-disposable-interactive-mode";

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-disposable-tui-manifest-"));
	tempDirectories.push(directory);
	return directory;
}

async function writeManifest(directory: string, value: unknown): Promise<string> {
	const manifestPath = path.join(directory, "manifest.json");
	await fs.writeFile(manifestPath, JSON.stringify(value));
	return manifestPath;
}

afterEach(async () => {
	await Promise.all(tempDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});

describe("overrideRestartExecutable", () => {
	it("preserves the receipt's resume identity and cwd while replacing only the executable", () => {
		const sessionId = "session-from-runner-receipt";
		const args = ["--resume", sessionId];
		const env = { OMP_TEST_RESTART: "receipt-env" };
		const restartSpawn = {
			executable: "/previous/omp",
			args,
			cwd: "/receipt/session/cwd",
			env,
		};

		const selected = overrideRestartExecutable(restartSpawn, "/rollout/omp");

		expect(selected).toEqual({
			executable: "/rollout/omp",
			args: ["--resume", sessionId],
			cwd: "/receipt/session/cwd",
			env,
		});
		expect(selected.args).toBe(args);
		expect(selected.env).toBe(env);
		expect(restartSpawn.executable).toBe("/previous/omp");
	});
});

describe("resolveDisposableTuiManifest", () => {
	it("resolves relative specifiers from the manifest directory and preserves cacheKey", async () => {
		const directory = await createTempDirectory();
		const manifestDirectory = path.join(directory, "revisions");
		await fs.mkdir(manifestDirectory);
		const manifestPath = await writeManifest(manifestDirectory, {
			specifier: "../bundles/disposable-view.js",
			cacheKey: "sha256:revision-17",
		});

		await expect(resolveDisposableTuiManifest(manifestPath)).resolves.toEqual({
			specifier: path.join(directory, "bundles", "disposable-view.js"),
			cacheKey: "sha256:revision-17",
		});
	});

	it("retains absolute specifiers unchanged", async () => {
		const directory = await createTempDirectory();
		const absoluteSpecifier = path.join(directory, "immutable", "disposable-view.js");
		const manifestPath = await writeManifest(directory, {
			specifier: absoluteSpecifier,
			cacheKey: "absolute-revision",
		});

		await expect(resolveDisposableTuiManifest(manifestPath)).resolves.toEqual({
			specifier: absoluteSpecifier,
			cacheKey: "absolute-revision",
		});
	});

	it("treats colons in relative and absolute filesystem paths as path characters", async () => {
		const directory = await createTempDirectory();
		const relativeManifest = await writeManifest(directory, {
			specifier: "revision:1.js",
			cacheKey: "relative-colon",
		});
		await expect(resolveDisposableTuiManifest(relativeManifest)).resolves.toEqual({
			specifier: path.join(directory, "revision:1.js"),
			cacheKey: "relative-colon",
		});

		const absoluteSpecifier = path.join(directory, "bundle:2.js");
		const absoluteManifest = path.join(directory, "absolute.json");
		await fs.writeFile(
			absoluteManifest,
			JSON.stringify({ specifier: absoluteSpecifier, cacheKey: "absolute-colon" }),
		);
		await expect(resolveDisposableTuiManifest(absoluteManifest)).resolves.toEqual({
			specifier: absoluteSpecifier,
			cacheKey: "absolute-colon",
		});
	});

	it("rejects malformed manifests", async () => {
		const directory = await createTempDirectory();
		const malformedJsonPath = path.join(directory, "malformed.json");
		await fs.writeFile(malformedJsonPath, "{not-json");
		const missingSpecifierPath = await writeManifest(directory, { cacheKey: "revision" });

		await expect(resolveDisposableTuiManifest(malformedJsonPath)).rejects.toThrow(
			`Cannot read disposable TUI manifest ${malformedJsonPath}`,
		);
		await expect(resolveDisposableTuiManifest(missingSpecifierPath)).rejects.toThrow(
			"must contain a non-empty string specifier",
		);
	});

	it("rejects a missing manifest", async () => {
		const directory = await createTempDirectory();
		const missingPath = path.join(directory, "missing.json");

		await expect(resolveDisposableTuiManifest(missingPath)).rejects.toThrow(
			`Cannot read disposable TUI manifest ${missingPath}`,
		);
	});
});
