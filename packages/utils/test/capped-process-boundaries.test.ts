import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ChildProcessOutputOverflowError as PublicChildProcessOutputOverflowError } from "@oh-my-pi/pi-utils";
import { ChildProcessOutputOverflowError, exec, spawn } from "../src/ptree";
import { ensureRuntimeInstalled } from "../src/runtime-install";
import { DEFAULT_STREAM_CAP_BYTES } from "../src/stream";
let root: string;
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "capped-process-boundaries-")); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
describe("public subprocess boundaries", () => {
	test("exec applies the default cap", async () => {
		const total = DEFAULT_STREAM_CAP_BYTES + 4096;
		const result = await exec([process.execPath, "-e", `process.stdout.write("x".repeat(${total}))`]);
		expect(result.stdoutTruncated).toBe(true);
		expect(result.stdout.endsWith(`[output truncated: kept ${DEFAULT_STREAM_CAP_BYTES} of ${total} bytes]`)).toBe(true);
	});
	test("ChildProcess.text applies the default cap", async () => {
		const total = DEFAULT_STREAM_CAP_BYTES + 4096;
		using child = spawn([process.execPath, "-e", `process.stdout.write("t".repeat(${total}))`]);
		const output = await child.text();
		expect(output.endsWith(`[output truncated: kept ${DEFAULT_STREAM_CAP_BYTES} of ${total} bytes]`)).toBe(true);
	});
	test("ChildProcess.json never parses beyond the cap", async () => {
		const total = DEFAULT_STREAM_CAP_BYTES + 4096;
		using child = spawn([process.execPath, "-e", `process.stdout.write(JSON.stringify("j".repeat(${total})))`]);
		await expect(child.json()).rejects.toBeInstanceOf(SyntaxError);
	});
	test("ChildProcess.blob rejects an incomplete binary body", async () => {
		const total = 8192;
		using child = spawn([process.execPath, "-e", `process.stdout.write("b".repeat(${total}))`], {
			maxOutputBytes: 1024,
		});
		await expect(child.blob()).rejects.toEqual(
			expect.objectContaining({
				name: "ChildProcessOutputOverflowError",
				maxBytes: 1024,
				totalBytes: total,
			}),
		);
	});
	test("ChildProcess.arrayBuffer rejects an incomplete binary body", async () => {
		const total = 8192;
		using child = spawn([process.execPath, "-e", `process.stdout.write("a".repeat(${total}))`], {
			maxOutputBytes: 1024,
		});
		await expect(child.arrayBuffer()).rejects.toEqual(
			expect.objectContaining({
				name: "ChildProcessOutputOverflowError",
				maxBytes: 1024,
				totalBytes: total,
			}),
		);
	});
	test("ChildProcess.bytes rejects an incomplete binary body with the public overflow error", async () => {
		expect(PublicChildProcessOutputOverflowError).toBe(ChildProcessOutputOverflowError);
		const total = 8192;
		using child = spawn([process.execPath, "-e", `process.stdout.write("y".repeat(${total}))`], {
			maxOutputBytes: 1024,
		});
		const output = child.bytes();
		await expect(output).rejects.toBeInstanceOf(PublicChildProcessOutputOverflowError);
		await expect(output).rejects.toEqual(
			expect.objectContaining({
				name: "ChildProcessOutputOverflowError",
				maxBytes: 1024,
				totalBytes: total,
			}),
		);
	});
	test("ChildProcess.spillToFile preserves an intentional large body", async () => {
		const total = DEFAULT_STREAM_CAP_BYTES + 4096;
		const outputPath = path.join(root, "large-child-output.bin");
		using child = spawn([process.execPath, "-e", `process.stdout.write("s".repeat(${total}))`]);
		const spill = await child.spillToFile(outputPath);
		expect(spill).toEqual({ path: outputPath, bytes: total });
		expect((await fs.stat(outputPath)).size).toBe(total);
	});
	test("runtime install diagnostics are capped", async () => {
		const fixture = path.join(root, "runtime-fixture");
		const runtimeDir = path.join(root, "runtime");
		await fs.mkdir(fixture, { recursive: true });
		await Bun.write(path.join(fixture, "postinstall.ts"), `process.stderr.write("r".repeat(70000)); process.exit(1);`);
		await Bun.write(path.join(fixture, "package.json"), JSON.stringify({ name: "capped-runtime-fixture", version: "1.0.0", scripts: { postinstall: "bun postinstall.ts" } }));
		await expect(ensureRuntimeInstalled({ runtimeDir, install: { dependencies: { "capped-runtime-fixture": `file:${fixture}` }, trustedDependencies: ["capped-runtime-fixture"] } })).rejects.toThrow(/\[(?:stdout|stderr) truncated: kept 65536 of/);
	});
});
