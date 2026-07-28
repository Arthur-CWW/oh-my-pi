/**
 * Bounded, in-process tar.gz writer for debug reports.
 *
 * The writer never materialises the archive or disk-backed entries. Sources are
 * consumed in fixed-size chunks and written to an atomic same-directory temp
 * file before the final rename.
 */
import { randomUUID } from "node:crypto";
import { open, rename, rm, stat } from "node:fs/promises";
import { Gzip } from "fflate";

const TAR_BLOCK_SIZE = 512;
const MAX_USTAR_SIZE = 0o77777777777;
const SOURCE_CHUNK_SIZE = 64 * 1024;
const TEXT_CODE_UNIT_CHUNK_SIZE = SOURCE_CHUNK_SIZE / 4 - 1;
const ZERO_BLOCK = new Uint8Array(TAR_BLOCK_SIZE);
const encoder = new TextEncoder();

export type ArchiveBinary = ArrayBuffer | ArchiveByteView;

/** A typed-array/DataView-like source retained without copying its bytes. */
export interface ArchiveByteView {
	readonly buffer: ArrayBufferLike;
	readonly byteOffset: number;
	readonly byteLength: number;
}

export type StreamingArchiveSource =
	| { readonly type: "file"; readonly path: string }
	| { readonly type: "text"; readonly value: string }
	| { readonly type: "bytes"; readonly value: ArchiveBinary };

export interface StreamingArchiveEntry {
	readonly path: string;
	readonly source: StreamingArchiveSource;
}

export interface StreamingArchiveMetrics {
	/** Largest uncompressed source chunk passed to the gzip stream. */
	readonly maxSourceChunk: number;
}

export interface StreamingArchiveOptions {
	/** Called after each bounded source chunk is accepted by the gzip stream. */
	readonly onSourceChunk?: (size: number) => void;
}

interface ArchiveSink {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<void>;
}

/** Write a portable USTAR tar.gz archive using bounded source chunks. */
export async function writeStreamingTarGz(
	outputPath: string,
	entries: readonly StreamingArchiveEntry[],
	options: StreamingArchiveOptions = {},
): Promise<StreamingArchiveMetrics> {
	const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
	let sink: ArchiveSink | undefined;
	let renamed = false;

	try {
		sink = await openSink(temporaryPath);
		const emitted: Uint8Array[] = [];
		const gzip = new Gzip({ mtime: 0 }, (chunk) => {
			emitted.push(chunk);
		});
		let maxSourceChunk = 0;

		const push = async (chunk: Uint8Array, source = true): Promise<void> => {
			if (source && chunk.byteLength > SOURCE_CHUNK_SIZE) {
				throw new Error(`Archive source chunk exceeds ${SOURCE_CHUNK_SIZE} bytes`);
			}
			emitted.length = 0;
			gzip.push(chunk);
			if (source) {
				if (chunk.byteLength > maxSourceChunk) maxSourceChunk = chunk.byteLength;
				options.onSourceChunk?.(chunk.byteLength);
			}
			const activeSink = sink;
			if (!activeSink) throw new Error("Archive sink is closed");
			for (const compressedChunk of emitted) await activeSink.write(compressedChunk);
		};

		for (const entry of entries) {
			const expectedSize = await sourceSize(entry.source);
			const header = makeHeader(entry, expectedSize);
			await push(header, false);
			let streamedSize = 0;
			const writeSourceChunk = async (chunk: Uint8Array): Promise<void> => {
				streamedSize += chunk.byteLength;
				if (streamedSize > expectedSize) {
					throw new Error(`Archive entry size changed while reading: ${entry.path}`);
				}
				await push(chunk);
			};

			await streamSource(entry.source, writeSourceChunk, expectedSize);
			if (streamedSize !== expectedSize) {
				throw new Error(
					`Archive entry size mismatch for ${entry.path}: expected ${expectedSize}, got ${streamedSize}`,
				);
			}
			const padding = (TAR_BLOCK_SIZE - (expectedSize % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
			if (padding > 0) await push(ZERO_BLOCK.subarray(0, padding), false);
		}

		await push(ZERO_BLOCK, false);
		await push(ZERO_BLOCK, false);
		emitted.length = 0;
		gzip.push(ZERO_BLOCK.subarray(0, 0), true);
		const activeSink = sink;
		if (!activeSink) throw new Error("Archive sink is closed");
		for (const compressedChunk of emitted) await activeSink.write(compressedChunk);
		await activeSink.close();
		sink = undefined;
		await rename(temporaryPath, outputPath);
		renamed = true;
		return { maxSourceChunk };
	} catch (error) {
		if (sink) {
			try {
				await sink.close();
			} catch {
				// Preserve the original archive failure.
			}
		}
		throw error;
	} finally {
		if (!renamed) await rm(temporaryPath, { force: true }).catch(() => undefined);
	}
}

async function openSink(filePath: string): Promise<ArchiveSink> {
	const handle = await open(filePath, "wx");
	let closed = false;
	return {
		async write(chunk) {
			let offset = 0;
			while (offset < chunk.byteLength) {
				const result = await handle.write(chunk, offset, chunk.byteLength - offset, null);
				if (result.bytesWritten <= 0) throw new Error("Archive sink made no progress");
				offset += result.bytesWritten;
			}
		},
		async close() {
			if (closed) return;
			await handle.close();
			closed = true;
		},
	};
}

function makeHeader(entry: StreamingArchiveEntry, size: number): Uint8Array {
	const archiveSize = validateArchiveSize(size, entry.path);
	const pathParts = splitTarPath(entry.path);
	const header = new Uint8Array(TAR_BLOCK_SIZE);
	writeTextField(header, 0, 100, pathParts.name);
	writeOctalField(header, 100, 8, 0o644);
	writeOctalField(header, 108, 8, 0);
	writeOctalField(header, 116, 8, 0);
	writeOctalField(header, 124, 12, archiveSize);
	writeOctalField(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header[156] = 0x30;
	writeTextField(header, 257, 6, "ustar\0");
	writeTextField(header, 263, 2, "00");
	writeTextField(header, 265, 32, "");
	writeTextField(header, 297, 32, "");
	writeTextField(header, 329, 8, "");
	writeTextField(header, 337, 8, "");
	writeTextField(header, 345, 155, pathParts.prefix);

	let checksum = 0;
	for (const byte of header) checksum += byte;
	const checksumText = checksum.toString(8).padStart(6, "0");
	writeTextField(header, 148, 6, checksumText);
	header[154] = 0;
	header[155] = 0x20;
	return header;
}

async function sourceSize(source: StreamingArchiveSource): Promise<number> {
	switch (source.type) {
		case "file": {
			const fileStat = await stat(source.path);
			if (!fileStat.isFile()) throw new Error(`Archive source is not a file: ${source.path}`);
			return validateArchiveSize(fileStat.size, source.path);
		}
		case "text":
			return validateArchiveSize(utf8ByteLength(source.value), "text source");
		case "bytes":
			return validateArchiveSize(source.value.byteLength, "byte source");
	}
}

function validateArchiveSize(size: number, source: string): number {
	if (!Number.isSafeInteger(size) || size < 0 || size > MAX_USTAR_SIZE) {
		throw new Error(`Archive source is too large: ${source}`);
	}
	return size;
}

async function streamSource(
	source: StreamingArchiveSource,
	writeChunk: (chunk: Uint8Array) => Promise<void>,
	expectedSize: number,
): Promise<void> {
	switch (source.type) {
		case "file":
			await streamFile(source.path, writeChunk, expectedSize);
			return;
		case "text":
			await streamText(source.value, writeChunk);
			return;
		case "bytes": {
			const bytes = source.value instanceof ArrayBuffer
				? new Uint8Array(source.value)
				: new Uint8Array(source.value.buffer, source.value.byteOffset, source.value.byteLength);
			for (let offset = 0; offset < bytes.byteLength; offset += SOURCE_CHUNK_SIZE) {
				await writeChunk(bytes.subarray(offset, Math.min(offset + SOURCE_CHUNK_SIZE, bytes.byteLength)));
			}
			return;
		}
	}
}

async function streamFile(
	filePath: string,
	writeChunk: (chunk: Uint8Array) => Promise<void>,
	expectedSize: number,
): Promise<void> {
	const handle = await open(filePath, "r");
	const buffer = new Uint8Array(SOURCE_CHUNK_SIZE);
	let offset = 0;
	try {
		while (offset < expectedSize) {
			const readLength = Math.min(buffer.byteLength, expectedSize - offset);
			const result = await handle.read(buffer, 0, readLength, offset);
			if (result.bytesRead <= 0) throw new Error(`Archive source ended early: ${filePath}`);
			await writeChunk(buffer.subarray(0, result.bytesRead));
			offset += result.bytesRead;
		}
		const probe = new Uint8Array(1);
		const extra = await handle.read(probe, 0, 1, expectedSize);
		if (extra.bytesRead !== 0) throw new Error(`Archive source changed while reading: ${filePath}`);
	} finally {
		await handle.close();
	}
}

async function streamText(text: string, writeChunk: (chunk: Uint8Array) => Promise<void>): Promise<void> {
	let offset = 0;
	while (offset < text.length) {
		let end = Math.min(text.length, offset + TEXT_CODE_UNIT_CHUNK_SIZE);
		if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end++;
		const chunk = encoder.encode(text.slice(offset, end));
		await writeChunk(chunk);
		offset = end;
	}
}

function utf8ByteLength(text: string): number {
	let length = 0;
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		if (code < 0x80) length += 1;
		else if (code < 0x800) length += 2;
		else if (isHighSurrogate(code) && index + 1 < text.length && isLowSurrogate(text.charCodeAt(index + 1))) {
			length += 4;
			index++;
		} else length += 3;
	}
	return length;
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

function splitTarPath(value: string): { name: string; prefix: string } {
	if (value.length > 1024 || value.length === 0 || value.startsWith("/") || value.includes("\0")) {
		throw new Error(`Invalid USTAR path: ${value}`);
	}
	const segments = value.split("/");
	if (segments.some(segment => segment.length === 0 || segment === "." || segment === "..")) {
		throw new Error(`Invalid USTAR path: ${value}`);
	}
	const wholeBytes = encoder.encode(value);
	if (wholeBytes.byteLength > 255) throw new Error(`USTAR path exceeds 255 bytes: ${value}`);
	if (wholeBytes.byteLength <= 100) return { name: value, prefix: "" };

	for (let slash = value.lastIndexOf("/"); slash > 0; slash = value.lastIndexOf("/", slash - 1)) {
		const prefix = value.slice(0, slash);
		const name = value.slice(slash + 1);
		if (encoder.encode(name).byteLength <= 100 && encoder.encode(prefix).byteLength <= 155) {
			return { name, prefix };
		}
	}
	throw new Error(`USTAR path exceeds 255 bytes or has an oversized component: ${value}`);
}

function writeTextField(target: Uint8Array, offset: number, width: number, value: string): void {
	const bytes = encoder.encode(value);
	if (bytes.byteLength > width) throw new Error("USTAR field value is too long");
	target.set(bytes, offset);
}

function writeOctalField(target: Uint8Array, offset: number, width: number, value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error("USTAR numeric field value is invalid");
	const digits = value.toString(8);
	if (digits.length > width - 1) throw new Error("USTAR numeric field value is too large");
	target.fill(0x30, offset, offset + width - 1);
	target.set(encoder.encode(digits), offset + width - 1 - digits.length);
	target[offset + width - 1] = 0;
}
