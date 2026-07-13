import * as path from "node:path";
import { Effect } from "effect";
import { postmortem } from "@oh-my-pi/pi-utils";
import { CollabHost, collabDisplayName } from "../collab/host";
import { DEFAULT_RELAY_URL } from "../collab/protocol";
import { buildRestartSpawnSpec, handoffRestartProcess } from "../cli/restart-session";
import type { SessionRunner } from "../runner/session-runner";
import { startSessionControlTarget, type SessionControlTarget } from "../session/session-control-target";
import type { SessionOwnershipHandle } from "../session/session-ownership";
import {
	createUniqueRevisionLoader,
	DisposableTerminalHost,
	type DisposableTerminalRevision,
	type DisposableTerminalRevisionLoader,
	type DisposableTerminalViewFactory,
	type InteractiveHostIntent,
} from "./disposable-terminal-host";

export interface DisposableTuiManifest {
	readonly specifier: string;
	readonly cacheKey: string;
}

function validateManifest(value: unknown, manifestPath: string): DisposableTuiManifest {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError(`Disposable TUI manifest ${manifestPath} must be a JSON object`);
	}
	const manifest = value as Record<string, unknown>;
	if (typeof manifest.specifier !== "string" || manifest.specifier.trim().length === 0) {
		throw new TypeError(`Disposable TUI manifest ${manifestPath} must contain a non-empty string specifier`);
	}
	if (typeof manifest.cacheKey !== "string" || manifest.cacheKey.trim().length === 0) {
		throw new TypeError(`Disposable TUI manifest ${manifestPath} must contain a non-empty string cacheKey`);
	}
	return { specifier: manifest.specifier, cacheKey: manifest.cacheKey };
}

/** Read and resolve one immutable disposable TUI revision from its launch-fixed manifest. */
export async function resolveDisposableTuiManifest(manifestPath: string): Promise<DisposableTerminalRevision> {
	const absoluteManifestPath = path.resolve(manifestPath);
	let value: unknown;
	try {
		value = JSON.parse(await Bun.file(absoluteManifestPath).text()) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot read disposable TUI manifest ${absoluteManifestPath}: ${message}`, { cause: error });
	}
	const manifest = validateManifest(value, absoluteManifestPath);
	const specifier =
		path.isAbsolute(manifest.specifier) || manifest.specifier.startsWith("file:")
			? manifest.specifier
			: path.resolve(path.dirname(absoluteManifestPath), manifest.specifier);
	return { specifier, cacheKey: manifest.cacheKey };
}

export interface RunDisposableInteractiveModeOptions {
	/** Optional immutable revision manifest used by the opt-in hash reload path. */
	readonly manifestPath?: string;
	/** In-process rich view used by the default interactive terminal. */
	readonly defaultFactory?: DisposableTerminalViewFactory;
	/** Start a collaboration host over the same runner for the lifetime of this terminal host. */
	readonly collabHost?: boolean;
	/** Relay used by the collaboration host. Flag wins over environment, then the public default. */
	readonly collabRelay?: string;
	/** Live ownership enables the external session control target. */
	readonly ownership?: SessionOwnershipHandle;
	readonly cwd?: string;
}

const BUILTIN_RICH_REVISION: DisposableTerminalRevision = {
	specifier: "omp:rich-interactive-terminal",
	cacheKey: "builtin-rich",
};

function createBuiltinLoader(factory: DisposableTerminalViewFactory): DisposableTerminalRevisionLoader {
	return { load: async () => factory };
}

/** Own one disposable terminal host while the supplied runner remains the session authority. */
export async function runDisposableInteractiveMode(
	runner: SessionRunner,
	options: RunDisposableInteractiveModeOptions,
): Promise<InteractiveHostIntent | undefined> {
	const absoluteManifestPath = options.manifestPath ? path.resolve(options.manifestPath) : undefined;
	if (!absoluteManifestPath && !options.defaultFactory) {
		throw new Error("Default disposable terminal launch requires a rich view factory");
	}
	const resolveRevision = absoluteManifestPath
		? () => resolveDisposableTuiManifest(absoluteManifestPath)
		: undefined;
	const terminalHost = new DisposableTerminalHost({
		runner,
		loader: absoluteManifestPath ? createUniqueRevisionLoader() : createBuiltinLoader(options.defaultFactory!),
		resolveRevision,
	});
	const collabHost = options.collabHost ? new CollabHost(runner, { displayName: collabDisplayName() }) : undefined;
	if (collabHost) {
		await collabHost.start(options.collabRelay ?? process.env.OMP_COLLAB_RELAY ?? DEFAULT_RELAY_URL);
		process.stderr.write(`Collab URL: ${collabHost.link}\nCollab web URL: ${collabHost.webLink}\n`);
	}
	let controlTarget: SessionControlTarget | undefined;
	const unregisterCleanup = postmortem.register("disposable-terminal-host", async () => {
		await controlTarget?.stop();
		await collabHost?.stop();
		await terminalHost.stop();
	});
	let failure: unknown;
	let started = false;
	let intent: InteractiveHostIntent | undefined;
	try {
		const revision = resolveRevision ? await resolveRevision() : BUILTIN_RICH_REVISION;
		await terminalHost.reload(revision);
		if (options.ownership) {
			const ownership = options.ownership;
			controlTarget = await startSessionControlTarget({
				ownership,
				actions: {
					status: command => Effect.runPromise(Effect.scoped(runner.applySessionControl(command))),
					pause: command => Effect.runPromise(Effect.scoped(runner.applySessionControl(command))).then(() => undefined),
					resume: command => Effect.runPromise(Effect.scoped(runner.applySessionControl(command))).then(() => undefined),
					setModel: (_selector, command) => Effect.runPromise(Effect.scoped(runner.applySessionControl(command))),
					compact: (_instructions, command) => Effect.runPromise(Effect.scoped(runner.applySessionControl(command))),
					restart: async () => {
						await collabHost?.stop();
						await terminalHost.stop();
						await handoffRestartProcess(
							buildRestartSpawnSpec({
								sessionId: ownership.sessionId,
								cwd: options.cwd ?? process.cwd(),
							}),
							ownership,
							async () => {
								await Effect.runPromise(Effect.scoped(runner.stop()));
								return [];
							},
						);
					},
					stop: async () => {
						await collabHost?.stop();
						await terminalHost.stop();
						await Effect.runPromise(Effect.scoped(runner.stop()));
					},
				},
			});
		}
		started = true;
		intent = await terminalHost.completion;
	} catch (error) {
		failure = started
			? error
			: new Error(
					`Failed to start disposable TUI${absoluteManifestPath ? ` from ${absoluteManifestPath}` : ""}: ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				);
	}

	try {
		await controlTarget?.stop();
		await collabHost?.stop();
		await terminalHost.stop();
	} catch (error) {
		failure = failure
			? new AggregateError([failure, error], "Disposable TUI failed and its cleanup also failed")
			: error;
	} finally {
		unregisterCleanup();
	}
	if (failure) throw failure;
	return intent;
}
