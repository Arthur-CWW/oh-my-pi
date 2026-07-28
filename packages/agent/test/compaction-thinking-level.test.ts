import { afterEach, describe, expect, test, vi } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	type CompactionPreparation,
	compact,
	createFileOps,
	DEFAULT_COMPACTION_SETTINGS,
	generateHandoff,
} from "@oh-my-pi/pi-agent-core/compaction";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core/thinking";
import type { AssistantMessage, Model } from "@oh-my-pi/pi-ai";
import * as ai from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";

// Compaction must preserve the session's model-scoped provider effort on every
// LLM call. Local `off` and `inherit` selectors remain local and never become
// provider wire values.

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		timestamp: Date.now(),
		provider: "mock",
		model: "mock",
		api: "mock",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
	};
}

function getAnthropicModel(): Model {
	const model = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("Expected built-in anthropic/claude-sonnet-4-5 to exist");
	return model;
}

function getAdvertisedEffortModel(defaultLevel: string = "ultra"): Model {
	const model = getAnthropicModel();
	if (!model.thinking) throw new Error("Expected built-in anthropic model to expose thinking metadata");
	return {
		...model,
		thinking: {
			...model.thinking,
			efforts: [ThinkingLevel.Max, "ultra", "codex-preview"],
			defaultLevel,
		},
	};
}

const messages: AgentMessage[] = [
	{ role: "user", content: "start work", timestamp: 1 },
	createAssistantMessage([{ type: "text", text: "started" }]),
];

afterEach(() => {
	vi.restoreAllMocks();
});

describe("compaction thinking-level resolution (regression)", () => {
	test("undefined thinkingLevel uses the model-advertised default", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "handoff" }]));
		const model = getAdvertisedEffortModel("codex-preview");
		await generateHandoff(messages, model, "test-key", {
			systemPrompt: ["sp"],
			tools: [],
		});
		const call = spy.mock.calls[0];
		if (!call) throw new Error("expected completeSimple call");
		expect(call[2]?.reasoning).toBe("codex-preview");
	});

	test("ThinkingLevel.Off on Anthropic → reasoning=undefined (user intent honored)", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "handoff" }]));
		await generateHandoff(messages, getAnthropicModel(), "test-key", {
			systemPrompt: ["sp"],
			tools: [],
			thinkingLevel: ThinkingLevel.Off,
		});
		const call = spy.mock.calls[0];
		if (!call) throw new Error("expected completeSimple call");
		// Codex-caught defect: Off MUST NOT be silently coerced to High.
		expect(call[2]?.reasoning).toBeUndefined();
	});

	test("advertised ultra passes through unchanged", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "handoff" }]));
		await generateHandoff(messages, getAdvertisedEffortModel(), "test-key", {
			systemPrompt: ["sp"],
			tools: [],
			thinkingLevel: "ultra",
		});
		const call = spy.mock.calls[0];
		if (!call) throw new Error("expected completeSimple call");
		expect(call[2]?.reasoning).toBe("ultra");
	});

	test("known max passes through unchanged", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "handoff" }]));
		await generateHandoff(messages, getAdvertisedEffortModel(), "test-key", {
			systemPrompt: ["sp"],
			tools: [],
			thinkingLevel: ThinkingLevel.Max,
		});
		const call = spy.mock.calls[0];
		if (!call) throw new Error("expected completeSimple call");
		expect(call[2]?.reasoning).toBe(ThinkingLevel.Max);
	});

	test("custom advertised effort passes through unchanged", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "handoff" }]));
		await generateHandoff(messages, getAdvertisedEffortModel(), "test-key", {
			systemPrompt: ["sp"],
			tools: [],
			thinkingLevel: "codex-preview",
		});
		const call = spy.mock.calls[0];
		if (!call) throw new Error("expected completeSimple call");
		expect(call[2]?.reasoning).toBe("codex-preview");
	});

	test("ThinkingLevel.Inherit uses the model-advertised default", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "handoff" }]));
		const model = getAdvertisedEffortModel("codex-preview");
		await generateHandoff(messages, model, "test-key", {
			systemPrompt: ["sp"],
			tools: [],
			thinkingLevel: ThinkingLevel.Inherit,
		});
		const call = spy.mock.calls[0];
		if (!call) throw new Error("expected completeSimple call");
		expect(call[2]?.reasoning).toBe("codex-preview");
	});
});

// `compact()` fans one selected session effort into history, turn-prefix, and
// short-summary requests. These tests ensure no fan-out call aliases it.

function makeUserMessage(text: string, timestamp = Date.now()): AgentMessage {
	return { role: "user", content: text, timestamp };
}

function makePreparation(overrides: Partial<CompactionPreparation> = {}): CompactionPreparation {
	return {
		firstKeptEntryId: "kept-1",
		messagesToSummarize: [
			makeUserMessage("history msg"),
			createAssistantMessage([{ type: "text", text: "history reply" }]),
		],
		turnPrefixMessages: [makeUserMessage("turn prefix msg")],
		recentMessages: [makeUserMessage("recent msg")],
		isSplitTurn: true,
		tokensBefore: 12_345,
		fileOps: createFileOps(),
		settings: { ...DEFAULT_COMPACTION_SETTINGS, remoteEnabled: false },
		...overrides,
	};
}

describe("compact() propagates thinkingLevel to all three summarizers (regression)", () => {
	test("ThinkingLevel.Off → every fan-out call gets reasoning=undefined", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "summary" }]));

		await compact(makePreparation(), getAnthropicModel(), "test-key", undefined, undefined, {
			thinkingLevel: ThinkingLevel.Off,
		});

		// Split-turn preparation fans out into history + turn-prefix + short.
		expect(spy).toHaveBeenCalledTimes(3);
		for (const [, , opts] of spy.mock.calls) {
			expect(opts?.reasoning).toBeUndefined();
		}
	});

	test("custom effort reaches every fan-out call unchanged", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "summary" }]));

		await compact(makePreparation(), getAdvertisedEffortModel(), "test-key", undefined, undefined, {
			thinkingLevel: "codex-preview",
		});

		expect(spy).toHaveBeenCalledTimes(3);
		for (const [, , opts] of spy.mock.calls) {
			expect(opts?.reasoning).toBe("codex-preview");
		}
	});

	test("inherited effort reaches every fan-out call unchanged", async () => {
		const spy = vi
			.spyOn(ai, "completeSimple")
			.mockResolvedValue(createAssistantMessage([{ type: "text", text: "summary" }]));

		await compact(makePreparation(), getAdvertisedEffortModel("codex-preview"), "test-key", undefined, undefined);

		expect(spy).toHaveBeenCalledTimes(3);
		for (const [, , opts] of spy.mock.calls) {
			expect(opts?.reasoning).toBe("codex-preview");
		}
	});

});
