import * as os from "node:os";
import { createDisposableTerminalView } from "./disposable-chat-view";
import type { DisposableTerminalHostCallbacks, DisposableTerminalView } from "./disposable-terminal-host";
import { createTerminalSessionController, type TerminalSessionController } from "./terminal-session-controller";
import {
	discoverTerminalSessionManifest,
	type TerminalSessionAttachManifest,
	UnixSocketTerminalSessionTransport,
} from "../runner/wire/client";

export interface AttachedTerminalConnection {
	readonly controller: TerminalSessionController;
	readonly manifest: TerminalSessionAttachManifest;
	readonly remoteHost: string | undefined;
}


function remoteHostLabel(hostLabel: string): string | undefined {
	const normalized = hostLabel.trim().toLowerCase();
	const hostname = os.hostname().toLowerCase();
	if (normalized === "localhost" || normalized === hostname || normalized === hostname.split(".", 1)[0]) {
		return undefined;
	}
	return hostLabel;
}

/** Discover, fence, and acquire the controller capability over one Unix socket. */
export async function connectAttachedTerminalController(socketPath: string): Promise<AttachedTerminalConnection> {
	const manifest = await discoverTerminalSessionManifest(socketPath);
	const transport = new UnixSocketTerminalSessionTransport({
		socketPath,
		hello: {
			protocol: manifest.protocol,
			sessionId: manifest.sessionId,
			ownerEpoch: manifest.ownerEpoch,
			runnerInstanceId: manifest.runnerInstanceId,
			build: manifest.build,
			authority: manifest.authority,
			requestedCapability: "controller",
			features: manifest.features,
		},
	});
	try {
		const controller = await createTerminalSessionController(transport, {
			viewId: `attached:${process.pid}`,
		});
		return { controller, manifest, remoteHost: remoteHostLabel(manifest.hostLabel) };
	} catch (error) {
		await transport.close().catch(() => undefined);
		throw error;
	}
}

/** Run the controller-backed local TUI. Closing it only detaches the view. */
export async function runAttachedTerminalMode(socketPath: string): Promise<void> {
	const connection = await connectAttachedTerminalController(socketPath);
	let current = true;
	let view: DisposableTerminalView | undefined;
	const stopped = Promise.withResolvers<void>();
	const callbacks: DisposableTerminalHostCallbacks = {
		epoch: 1,
		isCurrentEpoch: () => current,
		assertCurrentEpoch: () => {
			if (!current) throw new Error("Attached terminal view is stopped");
		},
		requestReload: async () => {
			await connection.controller.refresh();
		},
		requestStop: async () => {
			if (!current) return;
			current = false;
			stopped.resolve();
		},
		requestTransition: async () => {
			throw new Error("Session transitions are unavailable from an attached terminal view");
		},
	};
	const stopFromSignal = (): void => {
		if (!current) return;
		current = false;
		stopped.resolve();
	};
	process.once("SIGINT", stopFromSignal);
	process.once("SIGTERM", stopFromSignal);
	try {
		view = createDisposableTerminalView(connection.controller, callbacks, {
			remoteHost: connection.remoteHost,
		});
		await view.run();
		await stopped.promise;
	} finally {
		current = false;
		process.off("SIGINT", stopFromSignal);
		process.off("SIGTERM", stopFromSignal);
		try {
			await view?.quiesce();
		} finally {
			try {
				await view?.dispose();
			} finally {
				await connection.controller.close();
			}
		}
	}
}
