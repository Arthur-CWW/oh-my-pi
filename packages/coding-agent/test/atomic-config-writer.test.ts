import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { writeConfigAtomically } from "@oh-my-pi/pi-coding-agent/config/atomic-config-writer";
import { YAML } from "bun";

function filesystemError(code: string): NodeJS.ErrnoException {
	const error = new Error(`injected ${code}`) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

describe("atomic config writer", () => {
	let directory = "";
	let configPath = "";
	const original = "display:\n  tabWidth: 2\n";
	const replacement = "display:\n  tabWidth: 8\n";

	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), "omp-atomic-config-"));
		configPath = path.join(directory, "config.yml");
		await fs.writeFile(configPath, original, { mode: 0o640 });
		await fs.chmod(configPath, 0o640);
	});

	afterEach(async () => {
		if (directory) await fs.rm(directory, { recursive: true, force: true });
		directory = "";
	});

	async function expectOriginalWithoutTemporaryFiles(): Promise<void> {
		expect(await fs.readFile(configPath, "utf8")).toBe(original);
		expect((await fs.stat(configPath)).mode & 0o777).toBe(0o640);
		expect((await fs.readdir(directory)).sort()).toEqual(["config.yml"]);
	}

	it("keeps the old bytes when a partial write runs out of space", async () => {
		await expect(
			writeConfigAtomically(configPath, replacement, {
				operations: {
					writeFile: async handle => {
						await handle.writeFile("display:\n");
						throw filesystemError("ENOSPC");
					},
				},
			}),
		).rejects.toMatchObject({ code: "ENOSPC" });
		await expectOriginalWithoutTemporaryFiles();
	});

	it("keeps the old bytes when syncing the replacement fails", async () => {
		await expect(
			writeConfigAtomically(configPath, replacement, {
				operations: {
					fsync: async () => {
						throw filesystemError("EIO");
					},
				},
			}),
		).rejects.toMatchObject({ code: "EIO" });
		await expectOriginalWithoutTemporaryFiles();
	});

	it("keeps the old bytes when the atomic rename fails", async () => {
		await expect(
			writeConfigAtomically(configPath, replacement, {
				operations: {
					rename: async () => {
						throw filesystemError("EIO");
					},
				},
			}),
		).rejects.toMatchObject({ code: "EIO" });
		await expectOriginalWithoutTemporaryFiles();
	});

	it("publishes with one rename and preserves the destination mode", async () => {
		let renameCount = 0;
		await writeConfigAtomically(configPath, replacement, {
			operations: {
				rename: async (from, to) => {
					renameCount++;
					expect(await fs.readFile(to, "utf8")).toBe(original);
					expect(await fs.readFile(from, "utf8")).toBe(replacement);
					await fs.rename(from, to);
				},
			},
		});

		expect(renameCount).toBe(1);
		expect(await fs.readFile(configPath, "utf8")).toBe(replacement);
		expect((await fs.stat(configPath)).mode & 0o777).toBe(0o640);
		expect((await fs.readdir(directory)).sort()).toEqual(["config.yml"]);
	});

	it("serializes concurrent writers into one complete document", async () => {
		const documents = Array.from({ length: 16 }, (_, writer) =>
			YAML.stringify({ writer, payload: `${writer}:`.repeat(4_096) }, null, 2),
		);

		await Promise.all(documents.map(document => writeConfigAtomically(configPath, document)));

		const content = await fs.readFile(configPath, "utf8");
		expect(documents).toContain(content);
		const parsed = YAML.parse(content) as { writer: number; payload: string };
		expect(parsed.payload).toBe(`${parsed.writer}:`.repeat(4_096));
		expect((await fs.readdir(directory)).sort()).toEqual(["config.yml"]);
	});
});
