import { describe, expect, it } from "bun:test";
import { TempDir } from "@oh-my-pi/pi-utils";
import { IrcBus, type IrcMessage } from "../../src/irc/bus";
import { IrcExternalBus, IrcExternalDeliveryError } from "../../src/irc/bus-external";
import { IRC_BODY_MAX_CHARS, IRC_BROADCAST_BODY_MAX_CHARS } from "../../src/irc/irc-limits";
import { AgentLifecycleManager } from "../../src/registry/agent-lifecycle";
import { AgentRegistry } from "../../src/registry/agent-registry";
import type { AgentSession } from "../../src/session/agent-session";
import type { CustomMessage } from "../../src/session/messages";

interface CapturingSession {
	readonly session: AgentSession;
	readonly delivered: IrcMessage[];
	readonly relayed: CustomMessage[];
}

function capturingSession(provider: string): CapturingSession {
	const delivered: IrcMessage[] = [];
	const relayed: CustomMessage[] = [];
	const session = {
		model: { provider },
		deliverIrcMessage: async (message: IrcMessage) => {
			delivered.push(message);
			return "injected" as const;
		},
		emitIrcRelayObservation: (message: CustomMessage) => {
			relayed.push(message);
		},
	};
	return { session: session as unknown as AgentSession, delivered, relayed };
}

function createBus(provider = "openai-codex"): {
	readonly bus: IrcBus;
	readonly recipient: CapturingSession;
	readonly main: CapturingSession;
} {
	const registry = new AgentRegistry();
	const main = capturingSession("openai-codex");
	const recipient = capturingSession(provider);
	registry.register({ id: "Main", displayName: "main", kind: "main", session: main.session });
	registry.register({ id: "Recipient", displayName: "recipient", kind: "sub", session: recipient.session });
	return { bus: new IrcBus(registry), recipient, main };
}

const OVERSIZED_BODY = `Review the inventory at local://research-index.txt ${"x".repeat(IRC_BODY_MAX_CHARS)}`;

function withExternalBus(test: (bus: IrcExternalBus) => void): void {
	using tmp = TempDir.createSync("@omp-irc-content-safety-");
	const previousHome = process.env.HOME;
	const previousControlDb = process.env.OMP_SESSION_CONTROL_DB;
	process.env.HOME = tmp.path();
	process.env.OMP_SESSION_CONTROL_DB = `${tmp.path()}/session-control.sqlite`;
	const bus = new IrcExternalBus(`${tmp.path()}/irc-bus.sqlite`);
	try {
		test(bus);
	} finally {
		bus.close();
		if (previousHome === undefined) delete process.env.HOME;
		else process.env.HOME = previousHome;
		if (previousControlDb === undefined) delete process.env.OMP_SESSION_CONTROL_DB;
		else process.env.OMP_SESSION_CONTROL_DB = previousControlDb;
	}
}

describe("IRC coordination bodies", () => {
	it("passes realistic ordinary engineering coordination through the bus", async () => {
		const ordinaryMessages = [
			"The JSON payload now preserves the reply id.",
			"Please review the dependency injection cleanup in the registry.",
			"We can exploit the existing cache instead of adding another lookup.",
			"Keep the shutdown sequence idempotent across retries.",
			"That regular expression accepts the new agent name.",
			"The virus scanner rejected the downloaded fixture.",
			"This narrows the attack surface of the local control socket.",
			"Sanitize the display label before rendering it in the TUI.",
			"The embedding vector index is rebuilt only when inputs change.",
			"Archive the test logs and send the artifact path.",
			"The request corpus covers malformed tool arguments.",
			"The benchmark dataset contains only synthetic timing results.",
		];
		const { bus, recipient } = createBus("anthropic");

		for (const body of ordinaryMessages) {
			expect((await bus.send({ from: "Sender", to: "Recipient", body })).outcome, body).toBe("injected");
		}
		expect(recipient.delivered.map(message => message.body)).toEqual(ordinaryMessages);
	});

	it("delivers on subject matter alone — only length refuses a send", async () => {
		const { bus, recipient } = createBus("anthropic");
		const body = "Review the genome dataset inventory at local://research-index.txt";

		expect((await bus.send({ from: "Sender", to: "Recipient", body })).outcome).toBe("injected");
		expect(recipient.delivered.map(message => message.body)).toEqual([body]);
	});
});

describe("IrcBus content safety", () => {
	it("refuses an oversized direct message with a file-reference action", async () => {
		const { bus, recipient } = createBus();
		const receipt = await bus.send({ from: "Sender", to: "Recipient", body: "x".repeat(IRC_BODY_MAX_CHARS + 1) });

		expect(receipt).toMatchObject({ to: "Recipient", outcome: "failed" });
		expect(receipt.error).toContain(`${IRC_BODY_MAX_CHARS}-character limit`);
		expect(receipt.error).toContain("local:// or artifact:// path");
		expect(recipient.delivered).toEqual([]);
		expect(bus.inbox("Recipient", { peek: true })).toEqual([]);
	});

	it("refuses an oversized broadcast at its lower limit", async () => {
		const { bus, recipient } = createBus();
		const body = "x".repeat(IRC_BROADCAST_BODY_MAX_CHARS + 1);
		expect(body.length).toBeLessThan(IRC_BODY_MAX_CHARS);

		const receipt = await bus.send({ from: "Sender", to: "Recipient", body }, { broadcast: true });

		expect(receipt.outcome).toBe("failed");
		expect(receipt.error).toContain(`${IRC_BROADCAST_BODY_MAX_CHARS}-character limit`);
		expect(recipient.delivered).toEqual([]);
	});

	it("refuses an oversized message without mailbox or UI leakage", async () => {
		const { bus, recipient, main } = createBus("anthropic");

		const receipt = await bus.send({ from: "Sender", to: "Recipient", body: OVERSIZED_BODY });

		expect(receipt.outcome).toBe("failed");
		expect(recipient.delivered).toEqual([]);
		expect(bus.inbox("Recipient", { peek: true })).toEqual([]);
		expect(main.relayed).toEqual([]);
	});

	it("refuses before reviving a parked recipient", async () => {
		const registry = new AgentRegistry();
		const main = capturingSession("openai-codex");
		const revivedSession = capturingSession("anthropic");
		registry.register({ id: "Main", displayName: "main", kind: "main", session: main.session });
		registry.register({
			id: "Parked",
			displayName: "parked",
			kind: "sub",
			session: null,
			status: "parked",
			recovery: {
				task: "parked task",
				model: "anthropic/claude-test",
				thinkingLevel: null,
				turnState: "interrupted_by_restart",
			},
		});
		const lifecycle = new AgentLifecycleManager(registry);
		let reviveCount = 0;
		lifecycle.adopt("Parked", {
			idleTtlMs: 0,
			revive: async () => {
				reviveCount++;
				return revivedSession.session;
			},
		});
		const bus = new IrcBus(registry, lifecycle);
		try {
			const receipt = await bus.send({ from: "Sender", to: "Parked", body: OVERSIZED_BODY });

			expect(receipt.outcome).toBe("failed");
			expect(reviveCount).toBe(0);
			expect(registry.get("Parked")?.status).toBe("parked");
			expect(bus.inbox("Parked", { peek: true })).toEqual([]);
			expect(main.relayed).toEqual([]);
		} finally {
			await lifecycle.dispose();
		}
	});

	it("delivers a broadcast that fits the broadcast limit", async () => {
		const { bus, recipient } = createBus("anthropic");
		const body = "Anyone already editing src/irc/bus.ts? I need to add a delivery guard.";
		expect(body.length).toBeLessThan(IRC_BROADCAST_BODY_MAX_CHARS);

		const receipt = await bus.send({ from: "Sender", to: "Recipient", body }, { broadcast: true });

		expect(receipt.outcome).toBe("injected");
		expect(recipient.delivered.map(message => message.body)).toEqual([body]);
	});
});

describe("IrcExternalBus content safety", () => {
	it("refuses an oversized cross-session message and never persists it", () => {
		withExternalBus(bus => {
			bus.registerPeer({ sessionId: "recipient-session", name: "Recipient", cwd: "/tmp" });

			try {
				bus.sendMessage({ fromPeer: "ExternalSender", toPeer: "Recipient", body: OVERSIZED_BODY });
				throw new Error("Expected external IRC size refusal");
			} catch (error) {
				expect(error).toBeInstanceOf(IrcExternalDeliveryError);
				if (!(error instanceof IrcExternalDeliveryError)) throw error;
				expect(error.receipt).toMatchObject({
					to: "Recipient",
					outcome: "failed",
					error: expect.stringContaining(`${IRC_BODY_MAX_CHARS}-character limit`),
				});
			}
			expect(bus.pollMessages("Recipient")).toEqual([]);
		});
	});

	it("drops an inbound row that exceeds the limit instead of injecting it", () => {
		withExternalBus(bus => {
			bus.registerPeer({
				sessionId: "recipient-session",
				name: "Recipient",
				cwd: "/tmp",
				labels: { model: "openai-codex/test-model" },
			});
			bus.sendMessage({ fromPeer: "ExternalSender", toPeer: "Recipient", body: "short coordination ping" });
			expect(bus.unreadCount("Recipient")).toBe(1);
			expect(bus.pollMessages("Recipient").map(message => message.body)).toEqual(["short coordination ping"]);
		});
	});
});
