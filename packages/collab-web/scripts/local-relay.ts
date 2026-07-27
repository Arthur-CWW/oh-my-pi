/** Standalone server for the same encrypted relay route served by omp-hub. */
import { createRelayHandlers } from "./relay";

const DEFAULT_PORT = 7466;

export interface LocalRelay {
	url: string;
	stop(): void;
}

export function startLocalRelay(port = 0): LocalRelay {
	const relay = createRelayHandlers();
	const server = Bun.serve({ port, fetch: relay.fetch, websocket: relay.websocket });
	return {
		url: `ws://localhost:${server.port}`,
		stop(): void {
			relay.close();
			server.stop(true);
		},
	};
}

function parsePort(argv: readonly string[]): number {
	let raw: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]!;
		if (arg === "--port") raw = argv[i + 1];
		else if (arg.startsWith("--port=")) raw = arg.slice("--port=".length);
	}
	if (raw === undefined) return DEFAULT_PORT;
	const port = Number(raw);
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		console.error(`local-relay: invalid --port ${raw}`);
		process.exit(1);
	}
	return port;
}

if (import.meta.main) {
	const relay = startLocalRelay(parsePort(Bun.argv.slice(2)));
	let stopping = false;
	const shutdown = (): void => {
		if (stopping) return;
		stopping = true;
		relay.stop();
		process.exit(0);
	};
	console.log(`local collab relay listening on ${relay.url}`);
	console.log("connect with /r/<roomId>?role=host|guest; Ctrl+C stops the relay");
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
