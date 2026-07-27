import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawnObsidian } from "../../src/internal-urls/vault-protocol";
import { BiomeClient } from "../../src/lsp/clients/biome-client";
import { SwiftLintClient } from "../../src/lsp/clients/swiftlint-client";
import type { ServerConfig } from "../../src/lsp/types";
import { notifyCmuxAsk } from "../../src/tools/cmux-ask-bridge";
import { diff } from "../../src/utils/jj";

const CAP = 8 * 1024 * 1024;
const TOTAL_BYTES = CAP + 4096;

let root: string;

async function executable(name: string, body: string): Promise<string> {
	const file = path.join(root, name);
	await Bun.write(file, `#!/bin/sh\nset -eu\n${body}\n`);
	await fs.chmod(file, 0o755);
	return file;
}

function linterConfig(command: string): ServerConfig {
	return { command, resolvedCommand: command, fileTypes: ["test"], rootMarkers: [] };
}

beforeAll(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "coordinator-capped-output-"));
});

afterAll(async () => {
	await fs.rm(root, { recursive: true, force: true });
});

describe("public coordinator subprocess boundaries", () => {
	test("vault subprocess output is capped with a visible marker", async () => {
		const command = await executable("obsidian-shim", `head -c ${TOTAL_BYTES} /dev/zero | tr '\\0' 'v'`);
		const result = await spawnObsidian(command, []);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.startsWith("v".repeat(1024))).toBe(true);
		expect(result.stdout.endsWith(`[stdout truncated: kept ${CAP} of ${TOTAL_BYTES} bytes]`)).toBe(true);
		expect(
			Buffer.byteLength(result.stdout.slice(0, result.stdout.indexOf("\n[stdout truncated:"))),
		).toBeLessThanOrEqual(CAP);
	});

	test("jj diff caps stdout at its public interface", async () => {
		const command = await executable("jj-shim", `head -c ${TOTAL_BYTES} /dev/zero | tr '\\0' 'j'`);
		const output = await diff(root, { command });
		expect(output.startsWith("j".repeat(1024))).toBe(true);
		expect(output.endsWith(`[stdout truncated: kept ${CAP} of ${TOTAL_BYTES} bytes]`)).toBe(true);
	});

	test("jj changedFiles rejects a truncated path list before splitting it", async () => {
		const command = await executable("jj-name-only-shim", `head -c ${TOTAL_BYTES} /dev/zero | tr '\\0' 'p'`);
		await expect(diff.changedFiles(root, { command })).rejects.toEqual(
			expect.objectContaining({
				name: "JjOutputOverflowError",
				result: expect.objectContaining({
					stdoutTruncated: true,
					stdoutKeptBytes: CAP,
					stdoutBytes: TOTAL_BYTES,
				}),
			}),
		);
	});

	test("Biome reports an explicit overflow diagnostic for an otherwise-valid report beyond the cap", async () => {
		const target = path.join(root, "biome-target.test");
		await Bun.write(target, "x");
		const prefix = `{"diagnostics":[{"category":"test","severity":"error","description":"`;
		const suffix = `","location":{"path":{"file":${JSON.stringify(target)}}}}]}`;
		const command = await executable(
			"biome-shim",
			`printf '%s' ${JSON.stringify(prefix)}; head -c ${CAP} /dev/zero | tr '\\0' 'b'; printf '%s' ${JSON.stringify(suffix)}`,
		);
		const client = BiomeClient.create(linterConfig(command), root);
		const diagnostics = await client.lint(target);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toEqual(
			expect.objectContaining({
				code: "output-overflow",
				severity: 1,
				source: "biome",
			}),
		);
		expect(diagnostics[0]?.message).toContain(
			`Biome emitted ${Buffer.byteLength(prefix) + CAP + Buffer.byteLength(suffix)} bytes`,
		);
	});

	test("SwiftLint reports an explicit overflow diagnostic for an otherwise-valid report beyond the cap", async () => {
		const target = path.join(root, "swift-target.test");
		await Bun.write(target, "x");
		const prefix = `[{"character":1,"file":${JSON.stringify(target)},"line":1,"reason":"`;
		const suffix = `","rule_id":"test","severity":"Error","type":"test"}]`;
		const command = await executable(
			"swiftlint-shim",
			`printf '%s' ${JSON.stringify(prefix)}; head -c ${CAP} /dev/zero | tr '\\0' 's'; printf '%s' ${JSON.stringify(suffix)}`,
		);
		const client = SwiftLintClient.create(linterConfig(command), root);
		const diagnostics = await client.lint(target);
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toEqual(
			expect.objectContaining({
				code: "output-overflow",
				severity: 1,
				source: "swiftlint",
			}),
		);
		expect(diagnostics[0]?.message).toContain(
			`SwiftLint emitted ${Buffer.byteLength(prefix) + CAP + Buffer.byteLength(suffix)} bytes`,
		);
	});

	test("cmux bridge caps query output before parsing", async () => {
		const binDir = path.join(root, "cmux-bin");
		await fs.mkdir(binDir, { recursive: true });
		const command = path.join(binDir, "cmux");
		await Bun.write(
			command,
			`#!/bin/sh\nset -eu\nif [ "$1" = list-panels ]; then\n  printf '{"surfaces":[{"id":"surface","focused":true,"padding":"'\n  head -c ${CAP} /dev/zero | tr '\\0' 'c'\n  printf '"}]}'\nfi\n`,
		);
		await fs.chmod(command, 0o755);
		const result = await notifyCmuxAsk("question", {
			PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
			CMUX_WORKSPACE_ID: "workspace",
			CMUX_SURFACE_ID: "surface",
		});
		expect(result.status).toBe("failed");
		if (result.status !== "failed") throw new Error("expected capped cmux query to fail JSON decoding");
		expect(result.reason).toContain("invalid JSON");
		expect(result.commands[0]?.stdout).toContain(`[stdout truncated: kept ${CAP} of`);
	});
});
