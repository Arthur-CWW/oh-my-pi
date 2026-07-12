import * as path from "node:path";
import { postmortem } from "@oh-my-pi/pi-utils";
import type { SessionRunner } from "../runner/session-runner";
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
	const host = new DisposableTerminalHost({
		runner,
		loader: absoluteManifestPath ? createUniqueRevisionLoader() : createBuiltinLoader(options.defaultFactory!),
		resolveRevision,
	});
	const unregisterCleanup = postmortem.register("disposable-terminal-host", () => host.stop());
	let failure: unknown;
	let started = false;
	let intent: InteractiveHostIntent | undefined;
	try {
		const revision = resolveRevision ? await resolveRevision() : BUILTIN_RICH_REVISION;
		await host.reload(revision);
		started = true;
		intent = await host.completion;
	} catch (error) {
		failure = started
			? error
			: new Error(
					`Failed to start disposable TUI${absoluteManifestPath ? ` from ${absoluteManifestPath}` : ""}: ${error instanceof Error ? error.message : String(error)}`,
					{ cause: error },
				);
	}

	try {
		await host.stop();
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
