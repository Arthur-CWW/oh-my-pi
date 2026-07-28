import { describe, expect, it } from "bun:test";
import { ErrorInbox } from "@oh-my-pi/pi-coding-agent/modes/utils/error-inbox";
import type { CustomEntry } from "@oh-my-pi/pi-coding-agent/session/session-entries";
import { recordSubagentFailure, recordThrownSubagentFailure } from "@oh-my-pi/pi-coding-agent/task/subagent-failure";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

const failure = {
	agent: "ProviderWorker",
	job: "task-job-1",
	operation: "async-finalize",
	errorClass: "provider" as const,
	message: `Provider rejected Bearer sk-taskfailuresecret123456789 ${"diagnostic ".repeat(300)}`,
	historyUri: "history://ProviderWorker",
	finalOutputUri: "agent://ProviderWorker",
	finalOutputAvailable: false,
};

type PersistedErrorData = {
	message: string;
};

describe("subagent failure ErrorInbox ledger", () => {
	it("persists a bounded redacted failure once and reconciles all task facets", () => {
		const manager = SessionManager.inMemory("/task-error-ledger");

		expect(recordSubagentFailure(manager, failure)).toBe(true);
		expect(recordSubagentFailure(manager, failure)).toBe(false);

		const entries = manager.getEntries();
		const persisted = entries.filter(
			(entry): entry is CustomEntry<PersistedErrorData> =>
				entry.type === "custom" && entry.customType === "ui_error",
		);
		expect(persisted).toHaveLength(1);
		const data = persisted[0]?.data;
		if (!data) throw new Error("Expected persisted task error data");
		expect(data).toMatchObject({
			version: 2,
			source: "task",
			category: "provider",
			errorClass: "provider",
			agent: "ProviderWorker",
			job: "task-job-1",
			operation: "async-finalize",
			historyUri: "history://ProviderWorker",
			finalOutputUri: "agent://ProviderWorker",
			finalOutputAvailable: false,
			count: 1,
			unread: true,
			resolved: false,
		});
		expect(data.message).toBeString();
		expect(data.message.length).toBeLessThanOrEqual(1_024);
		expect(data.message).not.toContain("sk-taskfailuresecret123456789");

		const inbox = new ErrorInbox(manager);
		inbox.reconcile(entries);
		expect(inbox.getErrors()).toHaveLength(1);
		expect(inbox.getErrors()[0]).toMatchObject({
			source: "task",
			category: "provider",
			errorClass: "provider",
			agent: "ProviderWorker",
			job: "task-job-1",
			operation: "async-finalize",
			historyUri: "history://ProviderWorker",
			finalOutputUri: "agent://ProviderWorker",
			finalOutputAvailable: false,
		});
	});

	it("does not persist intentional user cancellation", () => {
		const manager = SessionManager.inMemory("/task-error-ledger-cancel");

		expect(
			recordSubagentFailure(manager, {
				...failure,
				job: "task-job-cancelled",
				errorClass: "failed",
				message: "Cancelled by the user",
				intentionalCancellation: true,
			}),
		).toBe(false);
		expect(manager.getEntries().filter(entry => entry.type === "custom" && entry.customType === "ui_error")).toHaveLength(0);
	});
	it("classifies thrown DNS failures as network incidents", () => {
		const manager = SessionManager.inMemory("/task-network-error-ledger");

		expect(
			recordThrownSubagentFailure(
				manager,
				"NetworkWorker",
				"task-job-network",
				"fetch failed: getaddrinfo ENOTFOUND chatgpt.com",
				false,
				true,
			),
		).toBe(true);
		const inbox = new ErrorInbox(manager);
		inbox.reconcile(manager.getEntries());
		expect(inbox.getErrors()).toHaveLength(1);
		expect(inbox.getErrors()[0]).toMatchObject({
			source: "task",
			category: "network",
			errorClass: "network",
			agent: "NetworkWorker",
		});
	});

});
