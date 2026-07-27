import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { RefusalCorpus } from "@oh-my-pi/pi-coding-agent/session/refusal-corpus";

const tempRoots: string[] = [];

afterEach(async () => {
	await Promise.all(tempRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function runCli(file: string, ...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const processHandle = Bun.spawn([process.execPath, "src/cli.ts", "refusals", ...args], {
		cwd: path.resolve(import.meta.dir, ".."),
		env: { ...Bun.env, OMP_REFUSALS_PATH: file },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(processHandle.stdout).text(),
		new Response(processHandle.stderr).text(),
		processHandle.exited,
	]);
	return { code, stdout, stderr };
}

describe("omp refusals", () => {
	it("lists/stats and marks a persisted case through the real CLI", async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-refusals-cli-"));
		tempRoots.push(root);
		const file = path.join(root, "refusals.jsonl");
		const corpus = new RefusalCorpus({ path: file });
		const refusalCase = corpus.appendCase({
			prompt: "Update the local test fixture.",
			model: "fable-test",
			modelVersion: "2026.07",
			category: "coding",
			action: "edit",
		});

		const stats = await runCli(file, "stats", "--json");
		expect(stats.code).toBe(0);
		expect(JSON.parse(stats.stdout)).toEqual(expect.objectContaining({ total: 1 }));

		const marked = await runCli(
			file,
			"mark",
			refusalCase.id,
			"--verdict",
			"false-positive",
			"--note",
			"safe local fixture",
		);
		expect(marked.code).toBe(0);
		const reopened = new RefusalCorpus({ path: file });
		expect(reopened.get(refusalCase.id)).toEqual(
			expect.objectContaining({ verdict: "false-positive", note: "safe local fixture" }),
		);
	});
});
