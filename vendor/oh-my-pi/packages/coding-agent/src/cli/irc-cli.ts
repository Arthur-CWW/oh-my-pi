import {
	IRC_EXTERNAL_STALE_MS,
	getIrcExternalPeerDisplayState,
	IrcExternalBus,
	type IrcExternalMessage,
	type IrcExternalPeer,
	isIrcExternalPeerFresh,
} from "../irc/bus-external";

export type IrcCliAction = "list" | "send" | "inbox";

export interface IrcCliIo {
	stdout: Pick<typeof process.stdout, "write">;
	stderr: Pick<typeof process.stderr, "write">;
}

export interface IrcCliCommandArgs {
	action: IrcCliAction;
	args: string[];
	flags: {
		from?: string;
		peek?: boolean;
	};
	bus?: IrcExternalBus;
	io?: IrcCliIo;
	nowMs?: number;
}

export interface IrcCliCommandResult {
	exitCode: number;
}

const DEFAULT_IO: IrcCliIo = {
	stdout: process.stdout,
	stderr: process.stderr,
};

export function runIrcCommand(cmd: IrcCliCommandArgs): IrcCliCommandResult {
	const bus = cmd.bus ?? IrcExternalBus.global();
	const io = cmd.io ?? DEFAULT_IO;
	const nowMs = cmd.nowMs ?? Date.now();

	switch (cmd.action) {
		case "list":
			return handleList(bus, io, nowMs);
		case "send":
			return handleSend(cmd, bus, io);
		case "inbox":
			return handleInbox(cmd, bus, io);
		default:
			return fail(io, `Unknown action: ${cmd.action}`, "Usage: omp irc list | send <peer> <message> [--from <name>] | inbox <peer> [--peek]");
	}
}

function handleList(bus: IrcExternalBus, io: IrcCliIo, nowMs: number): IrcCliCommandResult {
	const peers = bus.listPeers({ includeStale: true });
	if (peers.length === 0) {
		io.stdout.write("No IRC peers registered.\n");
		return { exitCode: 0 };
	}

	io.stdout.write("NAME\tSTATE\tSTATUS\tLAST SEEN\tPID\tCWD\n");
	for (const peer of peers) {
		io.stdout.write(formatPeer(peer, nowMs));
	}
	return { exitCode: 0 };
}

function handleSend(cmd: IrcCliCommandArgs, bus: IrcExternalBus, io: IrcCliIo): IrcCliCommandResult {
	const toPeer = cmd.args[0]?.trim();
	const body = cmd.args.slice(1).join(" ").trim();
	if (!toPeer || !body) {
		return fail(io, "Peer and message are required", "Usage: omp irc send <peer> <message> [--from <name>]");
	}

	const target = bus.findPeerByName(toPeer);
	if (!target) {
		return fail(io, `No live IRC peer named ${JSON.stringify(toPeer)}. Run 'omp irc list' to see available peers.`);
	}

	const fromPeer = cmd.flags.from?.trim() || "human";
	const id = bus.sendMessage({ fromPeer, toPeer: target.name, body });
	io.stdout.write(`Sent IRC message ${id} to ${target.name} from ${fromPeer}.\n`);
	return { exitCode: 0 };
}

function handleInbox(cmd: IrcCliCommandArgs, bus: IrcExternalBus, io: IrcCliIo): IrcCliCommandResult {
	const peer = cmd.args[0]?.trim();
	if (!peer) {
		return fail(io, "Peer is required", "Usage: omp irc inbox <peer> [--peek]");
	}

	const messages = bus.drainMessages(peer, { peek: cmd.flags.peek });
	if (messages.length === 0) {
		io.stdout.write(`No IRC messages for ${peer}.\n`);
		return { exitCode: 0 };
	}

	for (const message of messages) {
		io.stdout.write(formatMessage(message));
	}
	return { exitCode: 0 };
}

function fail(io: IrcCliIo, message: string, usage?: string): IrcCliCommandResult {
	io.stderr.write(`Error: ${message}\n`);
	if (usage) io.stderr.write(`${usage}\n`);
	return { exitCode: 1 };
}

function formatPeer(peer: IrcExternalPeer, nowMs: number): string {
	const lastSeenMs = Date.parse(peer.lastSeen) || 0;
	const status = isIrcExternalPeerFresh(peer.lastSeen, nowMs, IRC_EXTERNAL_STALE_MS) ? "fresh" : "stale";
	const state = getIrcExternalPeerDisplayState(peer, nowMs, IRC_EXTERNAL_STALE_MS);
	return `${peer.name}\t${state}\t${status}\t${formatAge(nowMs - lastSeenMs)} ago\t${peer.pid}\t${peer.cwd}\n`;
}

function formatMessage(message: IrcExternalMessage): string {
	return `[${message.id}] ${message.ts} ${message.fromPeer} -> ${message.toPeer}: ${message.body}\n`;
}

function formatAge(ageMs: number): string {
	if (!Number.isFinite(ageMs) || ageMs < 0) return "unknown";
	const seconds = Math.floor(ageMs / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}
