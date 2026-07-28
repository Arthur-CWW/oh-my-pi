import { randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { withFileLock } from "./file-lock";

export interface AtomicConfigWriteOperations {
	stat(filePath: string): Promise<{ mode: number }>;
	open(filePath: string, flags: string, mode?: number): Promise<FileHandle>;
	writeFile(handle: FileHandle, content: string | Uint8Array): Promise<void>;
	chmod(handle: FileHandle, mode: number): Promise<void>;
	fsync(handle: FileHandle): Promise<void>;
	close(handle: FileHandle): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	unlink(filePath: string): Promise<void>;
	syncDirectory(directory: string): Promise<void>;
}

const UNSUPPORTED_DIRECTORY_SYNC_CODES: Record<string, true> = {
	EBADF: true,
	EINVAL: true,
	EISDIR: true,
	ENOTSUP: true,
	EPERM: true,
};

async function syncDirectory(directory: string): Promise<void> {
	let handle: FileHandle | undefined;
	try {
		handle = await fs.open(directory, "r");
		await handle.sync();
	} catch (error) {
		if (!UNSUPPORTED_DIRECTORY_SYNC_CODES[(error as NodeJS.ErrnoException).code ?? ""]) throw error;
	} finally {
		await handle?.close();
	}
}

const DEFAULT_OPERATIONS: AtomicConfigWriteOperations = {
	stat: filePath => fs.stat(filePath),
	open: (filePath, flags, mode) => fs.open(filePath, flags, mode),
	writeFile: (handle, content) => handle.writeFile(content),
	chmod: (handle, mode) => handle.chmod(mode),
	fsync: handle => handle.sync(),
	close: handle => handle.close(),
	rename: (from, to) => fs.rename(from, to),
	unlink: filePath => fs.unlink(filePath),
	syncDirectory,
};

export interface AtomicConfigWriteOptions {
	/** Mode used only when the destination does not exist. Existing mode is preserved. */
	defaultMode?: number;
	/** Filesystem boundary for focused fault-injection tests. */
	operations?: Partial<AtomicConfigWriteOperations>;
}

async function destinationMode(
	filePath: string,
	defaultMode: number,
	operations: AtomicConfigWriteOperations,
): Promise<number> {
	try {
		return (await operations.stat(filePath)).mode & 0o777;
	} catch (error) {
		if (isEnoent(error)) return defaultMode;
		throw error;
	}
}

export interface PreparedConfigWrite<T> {
	content: string | Uint8Array;
	value: T;
}

/**
 * Serializes a read/merge/write transaction and durably replaces its config
 * file without ever truncating the live path.
 */
export async function updateConfigAtomically<T>(
	filePath: string,
	prepare: () => Promise<PreparedConfigWrite<T>>,
	options: AtomicConfigWriteOptions = {},
): Promise<T> {
	const operations: AtomicConfigWriteOperations = { ...DEFAULT_OPERATIONS, ...options.operations };
	const resolvedPath = path.resolve(filePath);
	let value!: T;

	await withFileLock(resolvedPath, async () => {
		const prepared = await prepare();
		const mode = await destinationMode(resolvedPath, options.defaultMode ?? 0o600, operations);
		const tempPath = path.join(
			path.dirname(resolvedPath),
			`.${path.basename(resolvedPath)}.tmp-${process.pid}-${randomUUID()}`,
		);
		let handle: FileHandle | undefined;
		let renamed = false;

		try {
			handle = await operations.open(tempPath, "wx", mode);
			await operations.writeFile(handle, prepared.content);
			await operations.chmod(handle, mode);
			await operations.fsync(handle);
			await operations.close(handle);
			handle = undefined;
			await operations.rename(tempPath, resolvedPath);
			renamed = true;
			await operations.syncDirectory(path.dirname(resolvedPath));
			value = prepared.value;
		} finally {
			if (handle) {
				try {
					await operations.close(handle);
				} catch {}
			}
			if (!renamed) {
				try {
					await operations.unlink(tempPath);
				} catch {}
			}
		}
	});

	return value;
}

/**
 * Durably replaces a config file without ever truncating the live path.
 *
 * Writers are serialized across processes. The replacement is written and
 * synced under a same-directory temporary name before a single atomic rename;
 * any pre-rename failure leaves the prior file untouched and removes the temp.
 */
export async function writeConfigAtomically(
	filePath: string,
	content: string | Uint8Array,
	options: AtomicConfigWriteOptions = {},
): Promise<void> {
	await updateConfigAtomically(filePath, async () => ({ content, value: undefined }), options);
}
