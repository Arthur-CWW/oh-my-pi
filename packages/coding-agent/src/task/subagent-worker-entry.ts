import {
	decodeCoordinatorMessage,
	type WorkerAckMessage,
	type WorkerResultMessage,
	type WorkerRunMessage,
	type WorkerToCoordinatorMessage,
} from "./subagent-worker-protocol";

type IpcProcess = NodeJS.Process & { send?: (message: unknown) => boolean };

const parent = process as IpcProcess;
let active:
	| {
			request: WorkerRunMessage;
			allocation: Uint8Array | undefined;
			recycle: boolean;
	  }
	| undefined;
let turnsCompleted = 0;

function send(message: WorkerToCoordinatorMessage): void {
	if (!parent.send) process.exit(70);
	parent.send(message);
}

function sameTurn(ack: WorkerAckMessage, request: WorkerRunMessage): boolean {
	return ack.leaseId === request.leaseId && ack.turnId === request.turnId && ack.attempt === request.attempt;
}

async function runTurn(request: WorkerRunMessage): Promise<void> {
	if (active) throw new Error("worker received a run while another turn is active");
	if (request.payload.crash === "before-result" && request.attempt === 1) process.exit(81);

	let allocation: Uint8Array | undefined;
	if (request.payload.allocateBytes) {
		allocation = new Uint8Array(request.payload.allocateBytes);
		for (let index = 0; index < allocation.byteLength; index += 4096) allocation[index] = 1;
		if (allocation.byteLength > 0) allocation[allocation.byteLength - 1] = 1;
	}
	if (request.payload.delayMs) await Bun.sleep(request.payload.delayMs);

	turnsCompleted += 1;
	const rssBytes = process.memoryUsage().rss;
	const recycle =
		request.payload.crash === "after-result-before-ack" ||
		turnsCompleted >= request.limits.maxTurns ||
		rssBytes >= request.limits.maxRssBytes;
	active = { request, allocation, recycle };
	const result: WorkerResultMessage = {
		type: "result",
		leaseId: request.leaseId,
		turnId: request.turnId,
		attempt: request.attempt,
		payload: request.payload.value,
		pid: process.pid,
		rssBytes,
		turnsCompleted,
		recycle,
	};
	send(result);
}

function acknowledge(message: WorkerAckMessage): void {
	if (!active || !sameTurn(message, active.request)) throw new Error("ACK does not match the active turn");
	const recycle = active.recycle;
	active = undefined;
	if (recycle) process.exit(0);
}

process.on("message", (raw: unknown) => {
	try {
		const message = decodeCoordinatorMessage(raw);
		if (message.type === "ack") {
			acknowledge(message);
			return;
		}
		void runTurn(message).catch((error: unknown) => {
			send({ type: "protocol-error", message: error instanceof Error ? error.message : String(error) });
			process.exit(71);
		});
	} catch (error) {
		send({ type: "protocol-error", message: error instanceof Error ? error.message : String(error) });
		process.exit(72);
	}
});

send({ type: "ready", pid: process.pid });
