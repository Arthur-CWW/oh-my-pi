import { describe, expect, it } from "bun:test";
import {
	buildCatalogProposalDiff,
	type CatalogSnapshot,
	CLAUDE_ROUTE_POSTURE,
} from "./catalog-sync";

const before: CatalogSnapshot = {
	anthropic: {
		"claude-haiku-4": {
			contextWindow: 200_000,
			maxTokens: 8_192,
			name: "Claude Haiku 4",
			cost: { input: 1, output: 5 },
		},
	},
	openai: {
		"gpt-current": {
			contextWindow: 128_000,
			maxTokens: 32_000,
			name: "Old display name",
			cost: { input: 1, output: 2 },
		},
		"gpt-limit-change": {
			contextWindow: 272_000,
			maxTokens: 64_000,
		},
		"gpt-retired": {
			contextWindow: 64_000,
			maxTokens: 8_000,
		},
	},
};

const after: CatalogSnapshot = {
	anthropic: {
		"claude-haiku-4": {
			contextWindow: 200_000,
			maxTokens: 8_192,
			name: "Renamed without material drift",
			cost: { input: 99, output: 101 },
		},
		"claude-sonnet-5": {
			contextWindow: 1_000_000,
			maxTokens: 128_000,
			name: "Claude Sonnet 5",
		},
	},
	openai: {
		"gpt-current": {
			contextWindow: 128_000,
			maxTokens: 32_000,
			name: "New display name",
			cost: { input: 20, output: 40 },
			reasoning: true,
		},
		"gpt-limit-change": {
			contextWindow: 372_000,
			maxTokens: 128_000,
		},
	},
};

describe("catalog proposal material diff", () => {
	it("reports additions, removals, and limit changes while ignoring immaterial fields", () => {
		const diff = buildCatalogProposalDiff(before, after);

		expect(diff).toEqual({
			rows: [
				{
					kind: "addition",
					provider: "anthropic",
					modelId: "claude-sonnet-5",
					after: { contextWindow: 1_000_000, maxTokens: 128_000 },
				},
				{
					kind: "limit-change",
					provider: "openai",
					modelId: "gpt-limit-change",
					before: { contextWindow: 272_000, maxTokens: 64_000 },
					after: { contextWindow: 372_000, maxTokens: 128_000 },
				},
				{
					kind: "removal",
					provider: "openai",
					modelId: "gpt-retired",
					before: { contextWindow: 64_000, maxTokens: 8_000 },
				},
			],
			newClaudeRows: [
				{
					provider: "anthropic",
					modelId: "claude-sonnet-5",
					source: "bundled-models-dev-reference",
					routePosture: CLAUDE_ROUTE_POSTURE,
				},
			],
			counts: { additions: 1, removals: 1, limitChanges: 1 },
		});
		expect(
			diff.rows.some((row) => row.modelId === "gpt-current" || row.modelId === "claude-haiku-4"),
		).toBe(false);
	});

	it("reports Claude models discovered upstream before the bundled catalog catches up", () => {
		const diff = buildCatalogProposalDiff(before, before, {
			anthropicDiscoveryIds: new Set(["claude-haiku-4", "claude-opus-5", "not-claude"]),
		});

		expect(diff.rows).toEqual([]);
		expect(diff.newClaudeRows).toEqual([
			{
				provider: "anthropic",
				modelId: "claude-opus-5",
				source: "anthropic-discovery",
				routePosture: CLAUDE_ROUTE_POSTURE,
			},
		]);
	});
});
