import { beforeEach, describe, expect, it } from "bun:test";
import {
	canRequestFallbackApproval,
	FallbackApprovalGate,
	formatFallbackApprovalNotice,
	type FallbackApprovalAction,
	type FallbackApprovalProposal,
} from "@oh-my-pi/pi-coding-agent/session/fallback-approval";

const proposal: FallbackApprovalProposal = {
	agentId: "ChildOne",
	parentAgentId: "Main",
	sourceModel: "openai-codex/gpt-5.6-sol:high",
	proposedModel: "kimi-code/kimi-for-coding",
	cause: "rate-limit",
	taskContext: "Implement the retry state machine",
	requestedAt: 1,
};

describe("fallback approval gate", () => {
	beforeEach(() => FallbackApprovalGate.resetGlobalForTests());

	it("does not create pre-approval or main-thread fallback requests", () => {
		expect(FallbackApprovalGate.global().get("Main")).toBeUndefined();
		expect(FallbackApprovalGate.global().listForParent("Main")).toEqual([]);
		expect(canRequestFallbackApproval("main", true)).toBeFalse();
		expect(canRequestFallbackApproval("sub", false)).toBeFalse();
	});

	it("approves a child proposal while preserving the same child id", async () => {
		let resolved: FallbackApprovalAction | undefined;
		FallbackApprovalGate.global().request(proposal, async action => {
			resolved = action;
		});
		const result = await FallbackApprovalGate.global().act("Main", "ChildOne", { kind: "approve" });
		expect(result.proposal.agentId).toBe("ChildOne");
		expect(resolved).toEqual({ kind: "approve" });
		expect(FallbackApprovalGate.global().get("ChildOne")).toBeUndefined();
	});

	it("passes the bounded source-model wait timeout", async () => {
		let resolved: FallbackApprovalAction | undefined;
		FallbackApprovalGate.global().request(proposal, async action => {
			resolved = action;
		});
		await FallbackApprovalGate.global().act("Main", "ChildOne", { kind: "wait", timeoutMs: 90_000 });
		expect(resolved).toEqual({ kind: "wait", timeoutMs: 90_000 });
	});

	it("passes abort without changing the proposed model", async () => {
		let resolved: FallbackApprovalAction | undefined;
		FallbackApprovalGate.global().request(proposal, async action => {
			resolved = action;
		});
		const result = await FallbackApprovalGate.global().act("Main", "ChildOne", { kind: "abort" });
		expect(result.proposal.proposedModel).toBe("kimi-code/kimi-for-coding");
		expect(resolved).toEqual({ kind: "abort" });
	});

	it("surfaces all four operator options and rejects a different parent", async () => {
		FallbackApprovalGate.global().request(proposal, async () => {});
		const notice = formatFallbackApprovalNotice(proposal);
		expect(notice).toContain("wait/retry source model with timeout");
		expect(notice).toContain("approve proposed model");
		expect(notice).toContain("choose another explicit model");
		expect(notice).toContain("abort");
		await expect(FallbackApprovalGate.global().act("OtherParent", "ChildOne", { kind: "approve" })).rejects.toThrow(
			"not owned",
		);
	});
});
