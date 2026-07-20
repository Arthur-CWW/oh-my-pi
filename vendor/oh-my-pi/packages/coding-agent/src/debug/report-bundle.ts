/**
 * Debug report bundle creation.
 *
 * Creates a .tar.gz archive with session data, logs, system info, and optional profiling data.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { WorkProfile } from "@oh-my-pi/pi-natives";
import { APP_NAME, getLogPath, getLogsDir, getReportsDir, isEnoent } from "@oh-my-pi/pi-utils";
import type { CpuProfile, HeapSnapshot } from "./profiler";
import { writeStreamingTarGz, type StreamingArchiveEntry } from "./archive-writer";
import { collectSystemInfo, sanitizeEnv } from "./system-info";

/** Maximum number of log lines to load into memory at once. */
const MAX_LOG_LINES = 5000;

/** Maximum bytes to read from the tail of a log file (2 MB). */
const MAX_LOG_BYTES = 2 * 1024 * 1024;
/** Read last N lines from a file, reading at most `maxBytes` from the tail. */
async function readLastLines(filePath: string, n: number, maxBytes = MAX_LOG_BYTES): Promise<string> {
	try {
		const file = Bun.file(filePath);
		const size = file.size;
		const start = Math.max(0, size - maxBytes);
		const content = start > 0 ? await file.slice(start, size).text() : await file.text();
		const lines = content.split("\n");
		// If we sliced mid-file, drop the first (partial) line
		if (start > 0 && lines.length > 0) {
			lines.shift();
		}
		return lines.slice(-n).join("\n");
	} catch (err) {
		if (isEnoent(err)) return "";
		throw err;
	}
}

export interface ReportBundleOptions {
	/** Session file path */
	sessionFile: string | undefined;
	/** Settings to include */
	settings?: Record<string, unknown>;
	/** Allocation-free TUI render counters and cumulative phase timings. */
	renderMetrics?: Readonly<Record<string, number>>;
	/** CPU profile (for performance reports) */
	cpuProfile?: CpuProfile;
	/** Heap snapshot (for memory reports) */
	heapSnapshot?: HeapSnapshot;
	/** Work profile (for work scheduling reports) */
	workProfile?: WorkProfile;
	/** Raw provider SSE diagnostics captured by the session buffer */
	rawSseText?: string;
}

export interface ReportBundleResult {
	path: string;
	files: string[];
}

export interface DebugLogSource {
	getInitialText(): Promise<string>;
	hasOlderLogs(): boolean;
	loadOlderLogs(limitDays?: number): Promise<string>;
}

/**
 * Create a debug report bundle.
 *
 * Bundle contents:
 * - session.jsonl: Current session transcript
 * - artifacts/: Session artifacts directory
 * - subagents/: Subagent sessions + artifacts
 * - logs.txt: Recent log entries
 * - system.json: OS, arch, CPU, memory, versions
 * - env.json: Sanitized environment variables
 * - config.json: Resolved settings
 * - tui-render.json: TUI scheduling counters and cumulative phase timings
 * - profile.cpuprofile: CPU profile (performance report only)
 * - raw-sse.txt: Recent raw provider SSE diagnostics (when captured)
 * - profile.md: Markdown CPU profile (performance report only)
 * - heap.heapsnapshot: Heap snapshot (memory report only)
 * - work.folded: Work profile folded stacks (work report only)
 * - work.md: Work profile summary (work report only)
 * - work.svg: Work profile flamegraph (work report only)
 */
export async function createReportBundle(options: ReportBundleOptions): Promise<ReportBundleResult> {
	const reportsDir = getReportsDir();
	await fs.mkdir(reportsDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const outputPath = path.join(reportsDir, `omp-report-${timestamp}.tar.gz`);

	const entries: StreamingArchiveEntry[] = [];
	const files: string[] = [];
	const addTextEntry = (archivePath: string, value: string): void => {
		entries.push({ path: archivePath, source: { type: "text", value } });
		files.push(archivePath);
	};

	const systemInfo = await collectSystemInfo();
	addTextEntry("system.json", JSON.stringify(systemInfo, null, 2));
	addTextEntry("env.json", JSON.stringify(sanitizeEnv(Bun.env as Record<string, string>), null, 2));

	if (options.settings) addTextEntry("config.json", JSON.stringify(options.settings, null, 2));
	if (options.renderMetrics) addTextEntry("tui-render.json", JSON.stringify(options.renderMetrics, null, 2));

	const logs = await readLastLines(getLogPath(), 1000);
	if (logs) addTextEntry("logs.txt", logs);

	if (options.rawSseText && options.rawSseText.trim().length > 0) addTextEntry("raw-sse.txt", options.rawSseText);

	if (options.sessionFile) {
		await addDiskEntry(entries, files, "session.jsonl", options.sessionFile);
		const artifactsDir = options.sessionFile.slice(0, -6);
		await addDirectoryToArchive(entries, files, artifactsDir, "artifacts");

		const sessionDir = path.dirname(options.sessionFile);
		const sessionBasename = path.basename(options.sessionFile, ".jsonl");
		await addSubagentSessions(entries, files, sessionDir, sessionBasename);
	}

	if (options.cpuProfile) {
		addTextEntry("profile.cpuprofile", options.cpuProfile.data);
		addTextEntry("profile.md", options.cpuProfile.markdown);
	}

	if (options.heapSnapshot) {
		entries.push({
			path: "heap.heapsnapshot",
			source: { type: "bytes", value: options.heapSnapshot.data },
		});
		files.push("heap.heapsnapshot");
	}

	if (options.workProfile) {
		addTextEntry("work.folded", options.workProfile.folded);
		addTextEntry("work.md", options.workProfile.summary);
		if (options.workProfile.svg) addTextEntry("work.svg", options.workProfile.svg);
	}

	await writeStreamingTarGz(outputPath, entries);
	return { path: outputPath, files };
}

/** Add a disk-backed file entry without reading its contents. */
async function addDiskEntry(
	entries: StreamingArchiveEntry[],
	files: string[],
	archivePath: string,
	filePath: string,
): Promise<boolean> {
	try {
		const sourceStat = await fs.stat(filePath);
		if (!sourceStat.isFile()) return false;
		const readable = await fs.open(filePath, "r");
		await readable.close();
		entries.push({ path: archivePath, source: { type: "file", path: filePath } });
		files.push(archivePath);
		return true;
	} catch {
		return false;
	}
}

/** Add all files from a directory to the archive. */
async function addDirectoryToArchive(
	entries: StreamingArchiveEntry[],
	files: string[],
	dirPath: string,
	archivePrefix: string,
): Promise<void> {
	try {
		const directoryEntries = await fs.readdir(dirPath, { withFileTypes: true });
		for (const directoryEntry of directoryEntries) {
			if (!directoryEntry.isFile()) continue;
			const filePath = path.join(dirPath, directoryEntry.name);
			await addDiskEntry(entries, files, `${archivePrefix}/${directoryEntry.name}`, filePath);
		}
	} catch {
		// Directory doesn't exist.
	}
}

/** Find and add subagent session files */
async function addSubagentSessions(
	entries: StreamingArchiveEntry[],
	files: string[],
	sessionDir: string,
	parentBasename: string,
): Promise<void> {
	try {
		const directoryEntries = await fs.readdir(sessionDir, { withFileTypes: true });
		const sessionFiles = directoryEntries
			.filter(entry => entry.isFile() && entry.name.endsWith(".jsonl") && entry.name !== `${parentBasename}.jsonl`)
			.map(entry => entry.name);

		for (const filename of sessionFiles.sort().slice(-10)) {
			const filePath = path.join(sessionDir, filename);
			const archivePath = `subagents/${filename}`;
			if (await addDiskEntry(entries, files, archivePath, filePath)) {
				const artifactsDir = filePath.slice(0, -6);
				await addDirectoryToArchive(entries, files, artifactsDir, `subagents/${filename.slice(0, -6)}`);
			}
		}
	} catch {
		// Directory doesn't exist.
	}
}

/** Get recent log entries for display (tail-limited to avoid OOM on large files). */
export async function getLogText(): Promise<string> {
	return readLastLines(getLogPath(), MAX_LOG_LINES);
}

const LOG_FILE_PATTERN = new RegExp(`^${APP_NAME}\\.(\\d{4}-\\d{2}-\\d{2})\\.log$`);

export async function createDebugLogSource(): Promise<DebugLogSource> {
	const logsDir = getLogsDir();
	const todayPath = getLogPath();
	const todayName = path.basename(todayPath);
	let olderFiles: string[] = [];
	try {
		const entries = await fs.readdir(logsDir, { withFileTypes: true });
		const datedFiles = entries
			.filter(entry => entry.isFile())
			.map(entry => {
				const match = LOG_FILE_PATTERN.exec(entry.name);
				return match ? { name: entry.name, date: match[1] } : undefined;
			})
			.filter((entry): entry is { name: string; date: string } => entry !== undefined)
			.filter(entry => entry.name !== todayName)
			.sort((a, b) => b.date.localeCompare(a.date));
		olderFiles = datedFiles.map(entry => entry.name);
	} catch {
		olderFiles = [];
	}

	let cursor = 0;

	const getInitialText = async (): Promise<string> => {
		return readLastLines(todayPath, MAX_LOG_LINES);
	};

	const hasOlderLogs = (): boolean => cursor < olderFiles.length;

	const loadOlderLogs = async (limitDays: number = 1): Promise<string> => {
		if (!hasOlderLogs()) {
			return "";
		}
		const count = Math.max(1, limitDays);
		const slice = olderFiles.slice(cursor, cursor + count);
		cursor += slice.length;
		const chunks: string[] = [];
		for (const filename of slice.reverse()) {
			const filePath = path.join(logsDir, filename);
			try {
				const content = await readLastLines(filePath, MAX_LOG_LINES);
				if (content.length > 0) {
					chunks.push(content);
				}
			} catch (err) {
				if (!isEnoent(err)) {
					throw err;
				}
			}
		}
		return chunks.filter(chunk => chunk.length > 0).join("\n");
	};

	return {
		getInitialText,
		hasOlderLogs,
		loadOlderLogs,
	};
}

/** Calculate total size of artifact cache */
export async function getArtifactCacheStats(
	sessionsDir: string,
): Promise<{ count: number; totalSize: number; oldestDate: Date | null }> {
	let count = 0;
	let totalSize = 0;
	let oldestDate: Date | null = null;

	try {
		const sessions = await fs.readdir(sessionsDir, { withFileTypes: true });

		for (const session of sessions) {
			// Artifact directories don't have .jsonl extension
			if (session.isDirectory()) {
				const dirPath = path.join(sessionsDir, session.name);
				try {
					const stat = await fs.stat(dirPath);
					const files = await fs.readdir(dirPath);
					for (const file of files) {
						const filePath = path.join(dirPath, file);
						const fileStat = await fs.stat(filePath);
						if (fileStat.isFile()) {
							count++;
							totalSize += fileStat.size;
						}
					}
					if (!oldestDate || stat.mtime < oldestDate) {
						oldestDate = stat.mtime;
					}
				} catch {
					// Skip inaccessible directories
				}
			}
		}
	} catch {
		// Directory doesn't exist
	}

	return { count, totalSize, oldestDate };
}

/** Clear artifact cache older than N days */
export async function clearArtifactCache(sessionsDir: string, daysOld: number = 30): Promise<{ removed: number }> {
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - daysOld);
	let removed = 0;

	try {
		const sessions = await fs.readdir(sessionsDir, { withFileTypes: true });

		for (const session of sessions) {
			if (session.isDirectory()) {
				const dirPath = path.join(sessionsDir, session.name);
				try {
					const stat = await fs.stat(dirPath);
					if (stat.mtime < cutoff) {
						await fs.rm(dirPath, { recursive: true, force: true });
						removed++;
					}
				} catch {
					// Skip inaccessible directories
				}
			}
		}
	} catch {
		// Directory doesn't exist
	}

	return { removed };
}
