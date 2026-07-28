import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import codexBundleJson from "../../../../openai/codex/codex-rs/models-manager/models.json" with { type: "json" };
import generatedModels from "../src/models.json" with { type: "json" };
import {
	applyCodexBundle,
	decodeCodexBundlePayload,
	findCodexBundleDrift,
} from "../scripts/codex-bundle";
import type { ModelSpec } from "../src/types";

const codexRoot = path.join(import.meta.dir, "..", "..", "..", "..", "openai", "codex");
const codexBundle = decodeCodexBundlePayload(codexBundleJson);

async function vendoredCommit(): Promise<string> {
	const child = Bun.spawn(["git", "-C", codexRoot, "rev-parse", "HEAD"], { stdout: "pipe" });
	const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
	expect(exitCode).toBe(0);
	return stdout.trim();
}

describe("vendored Codex generated catalog", () => {
	test("matches every bundled model and the vendored commit", async () => {
		const drift = findCodexBundleDrift(
			generatedModels as unknown as Record<string, Record<string, ModelSpec>>,
			codexBundle,
			await vendoredCommit(),
		);
		expect(drift).toEqual([]);
	});

	test("derives official effective and compact windows while labeling OMP policy", async () => {
		const commit = await vendoredCommit();
		const models: ModelSpec[] = [];
		applyCodexBundle(models, codexBundle, commit, []);
		for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
			const model = models.find(candidate => candidate.id === id);
			expect(model).toMatchObject({
				contextWindow: 372_000,
				maxTokens: 128_000,
				omitMaxOutputTokens: true,
				codexCatalog: {
					codexBundled: {
						commit,
						rawContextWindow: 372_000,
						effectiveContextWindowPercent: 95,
						effectiveInputTokens: 353_400,
						autoCompactTokenLimit: 334_800,
					},
					liveAccountEligibility: {
						status: "not-listed",
						officialPickerParity: false,
					},
					ompPolicy: {
						visibility: "bundled/direct-only",
						maxOutput: { value: 128_000, source: "omp-fallback", sentToEndpoint: false },
					},
				},
			});
		}
		const gpt55 = models.find(candidate => candidate.id === "gpt-5.5");
		expect(gpt55?.codexCatalog?.codexBundled).toMatchObject({
			rawContextWindow: 272_000,
			effectiveInputTokens: 258_400,
			autoCompactTokenLimit: 244_800,
		});
	});

	test("detects perturbed vendored metadata", async () => {
		const perturbed = structuredClone(codexBundle);
		const sol = perturbed.models.find(model => model.slug === "gpt-5.6-sol");
		expect(sol).toBeDefined();
		if (!sol) throw new Error("Expected gpt-5.6-sol in vendored Codex bundle");
		sol.context_window = 371_999;
		const drift = findCodexBundleDrift(
			generatedModels as unknown as Record<string, Record<string, ModelSpec>>,
			perturbed,
			await vendoredCommit(),
		);
		expect(drift.some(message => message.startsWith("gpt-5.6-sol:"))).toBe(true);
	});
});
