import * as path from "node:path";
import { postmortem } from "@oh-my-pi/pi-utils";
import type { SessionRunner } from "../runner/session-runner";
import {
	createUniqueRevisionLoader,
	DisposableTerminalHost,
	type DisposableTerminalRevision,
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

/** Own the disposable terminal host while the supplied runner remains the persistent session authority. */
export async function runDisposableInteractiveMode(runner: SessionRunner, manifestPath: string): Promise<void> {
	const absoluteManifestPath = path.resolve(manifestPath);
	const resolveRevision = () => resolveDisposableTuiManifest(absoluteManifestPath);
	const host = new DisposableTerminalHost({
		runner,
		loader: createUniqueRevisionLoader(),
		resolveRevision,
	});
	const unregisterCleanup = postmortem.register("disposable-terminal-host", () => host.stop());
	let failure: unknown;
	let started = false;
	try {
		await host.reload(await resolveRevision());
		started = true;
		await host.completion;
	} catch (error) {
		failure = started
			? error
			: new Error(
					`Failed to start disposable TUI from ${absoluteManifestPath}: ${error instanceof Error ? error.message : String(error)}`,
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
}
