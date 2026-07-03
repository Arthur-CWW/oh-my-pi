import { describe, expect, it } from "bun:test";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import type {
	ReadyInfo,
	RunResultOk,
	WorkerInbound,
	WorkerOutbound,
} from "@oh-my-pi/pi-coding-agent/tools/browser/tab-protocol";
import type { PendingRun, WorkerTabSession } from "@oh-my-pi/pi-coding-agent/tools/browser/tab-supervisor";
import {
	observeRunPromiseRejectionForTest,
	registerTabForTest,
	releaseTab,
} from "@oh-my-pi/pi-coding-agent/tools/browser/tab-supervisor";

class FakeCloseWorker {
	#messageHandlers = new Set<(msg: WorkerOutbound) => void>();
	readonly sent: WorkerInbound[] = [];
	readonly mode = "worker" as const;

	send(msg: WorkerInbound): void {
		this.sent.push(msg);
		if (msg.type === "close") {
			queueMicrotask(() => {
				for (const handler of this.#messageHandlers) handler({ type: "closed" });
			});
		}
	}

	onMessage(handler: (msg: WorkerOutbound) => void): () => void {
		this.#messageHandlers.add(handler);
		return () => this.#messageHandlers.delete(handler);
	}

	onError(): () => void {
		return () => {};
	}

	async terminate(): Promise<void> {}
}

const readyInfo: ReadyInfo = {
	url: "about:blank",
	targetId: "target-for-test",
	viewport: { width: 800, height: 600 },
};

function makeWorkerTab(name: string, worker: FakeCloseWorker, pending: PendingRun): WorkerTabSession {
	const fakeBrowser: WorkerTabSession["browser"]["browser"] = Object.assign(Object.create(null), {
		connected: false,
		targets: () => [],
	});
	const browser: WorkerTabSession["browser"] = {
		key: `browser-for-${name}`,
		kind: { kind: "headless", headless: true },
		refCount: 2,
		browser: fakeBrowser,
		stealth: { browserSession: null, override: null },
	};
	return {
		name,
		browser,
		targetId: readyInfo.targetId,
		backend: "worker",
		worker,
		state: "alive",
		info: readyInfo,
		pending: new Map([["run-for-test", pending]]),
		kindTag: "headless",
	};
}

describe("browser tab pending run close", () => {
	it("does not emit unhandledRejection when releaseTab rejects a pending run", async () => {
		const name = "fbdetail";
		const { promise, resolve, reject } = Promise.withResolvers<RunResultOk>();
		observeRunPromiseRejectionForTest(promise);
		const pending: PendingRun = {
			resolve,
			reject,
			session: {} as ToolSession,
			toolCalls: new Map(),
		};
		const worker = new FakeCloseWorker();
		const unregister = registerTabForTest(makeWorkerTab(name, worker, pending));
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown): void => {
			unhandled.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);

		try {
			await releaseTab(name);
			await new Promise(resolveTick => setTimeout(resolveTick, 0));

			expect(unhandled).toEqual([]);
			await expect(promise).rejects.toThrow('Tab "fbdetail" was closed');
			expect(worker.sent.map(msg => msg.type)).toEqual(["abort", "close"]);
		} finally {
			process.removeListener("unhandledRejection", onUnhandled);
			unregister();
		}
	});
});
