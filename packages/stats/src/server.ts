import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { APP_NAME, isEnoent, VERSION } from "@oh-my-pi/pi-utils";
import { $ } from "bun";
import type { Database } from "bun:sqlite";
import {
	getBehaviorDashboardStats,
	getCostDashboardStats,
	getDashboardStats,
	getModelDashboardStats,
	getOverviewStats,
	getRecentErrors,
	getRecentRequests,
	getRequestDetails,
	getTotalMessageCount,
	syncAllSessions,
} from "./aggregator";
import { closeDb, initDb } from "./db";
import { decodeEmbeddedClientArchive } from "./embedded-client";
import embeddedClientArchiveTxt from "./embedded-client.generated.txt";

const EMBEDDED_CLIENT_ARCHIVE = decodeEmbeddedClientArchive(embeddedClientArchiveTxt);

const CLIENT_DIR = path.join(import.meta.dir, "client");
const STATIC_DIR = path.join(import.meta.dir, "..", "dist", "client");
const IS_BUN_COMPILED =
	Boolean(process.env.PI_COMPILED || Bun.env.PI_COMPILED) ||
	import.meta.url.includes("$bunfs") ||
	import.meta.url.includes("~BUN") ||
	import.meta.url.includes("%7EBUN");
// The prepacked npm bundle (coding-agent dist/cli.js) constant-folds
// process.env.PI_BUNDLED at build time. Like compiled binaries, it ships no
// dashboard sources or prebuilt dist/client next to the bundle, so the
// embedded archive is the only viable asset source.
const IS_PREBUILT = IS_BUN_COMPILED || Boolean(process.env.PI_BUNDLED || Bun.env.PI_BUNDLED);
const USE_EMBEDDED_CLIENT = EMBEDDED_CLIENT_ARCHIVE !== null || IS_PREBUILT;

const EMBEDDED_CLIENT_DIR_ROOT = path.join(os.tmpdir(), "omp-stats-client");
let embeddedClientDirPromise: Promise<string> | null = null;

export interface StatsServer {
	port: number;
	stop: () => Promise<void>;
}

export interface StatsHealth {
	status: "ok";
	db: "ready";
}

export interface StatsVersion {
	name: string;
	version: string;
	runtime: { name: "bun"; version: string };
	provenance: {
		compiled: boolean;
		bundled: boolean;
		forkHash: string | null;
	};
}

export interface StatsErrorPayload {
	error: {
		code: "BAD_REQUEST" | "NOT_FOUND" | "DB_UNAVAILABLE" | "INTERNAL_ERROR";
		message: string;
	};
}

let dbInitPromise: Promise<Database> | null = null;

function ensureDbReady(): Promise<Database> {
	if (!dbInitPromise) {
		dbInitPromise = initDb().catch(error => {
			dbInitPromise = null;
			throw error;
		});
	}
	return dbInitPromise;
}

async function closeStatsDb(): Promise<void> {
	const pendingInit = dbInitPromise;
	if (pendingInit) {
		try {
			await pendingInit;
		} catch {
			// A failed initialization has no open database to close.
		}
	}
	closeDb();
	if (dbInitPromise === pendingInit) dbInitPromise = null;
}

function errorResponse(status: number, code: StatsErrorPayload["error"]["code"], message: string): Response {
	return Response.json({ error: { code, message } } satisfies StatsErrorPayload, { status });
}

function validateServerPort(port: number): void {
	if (!Number.isInteger(port) || port < 0 || port > 65_535) {
		throw new Error(`Invalid stats server port "${String(port)}"; expected an integer from 0 to 65535`);
	}
}

export interface WaitForStatsHealthOptions {
	attempts?: number;
	intervalMs?: number;
	requestTimeoutMs?: number;
}

export async function waitForStatsHealth(
	baseUrl: string,
	options: WaitForStatsHealthOptions = {},
): Promise<StatsHealth> {
	const attempts = options.attempts ?? 20;
	const intervalMs = options.intervalMs ?? 50;
	const requestTimeoutMs = options.requestTimeoutMs ?? 500;
	if (!Number.isInteger(attempts) || attempts < 1) throw new Error("Health check attempts must be a positive integer");
	if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error("Health check interval must be non-negative");
	if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1) {
		throw new Error("Health check request timeout must be positive");
	}

	const healthUrl = new URL("/healthz", baseUrl).href;
	let lastFailure = "no response";
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			const response = await fetch(healthUrl, { signal: AbortSignal.timeout(requestTimeoutMs) });
			if (response.ok) {
				const health = (await response.json()) as Partial<StatsHealth>;
				if (health.status === "ok" && health.db === "ready") return health as StatsHealth;
				lastFailure = "invalid readiness payload";
			} else {
				lastFailure = `HTTP ${response.status}`;
			}
		} catch (error) {
			lastFailure = error instanceof Error ? error.message : String(error);
		}
		if (attempt < attempts && intervalMs > 0) await Bun.sleep(intervalMs);
	}
	throw new Error(`Stats server did not become healthy at ${healthUrl} after ${attempts} attempts (${lastFailure})`);
}

function sanitizeArchivePath(archivePath: string): string | null {
	const normalized = archivePath.replaceAll("\\", "/").replace(/^\.\//, "");
	if (!normalized || normalized === ".") return null;
	if (normalized.includes("..") || path.isAbsolute(normalized)) return null;
	return normalized;
}

async function extractEmbeddedClientArchive(archiveBytes: Buffer, outputDir: string): Promise<void> {
	const archive = new Bun.Archive(archiveBytes);
	const files = await archive.files();
	const extractRoot = path.resolve(outputDir);

	for (const [archivePath, file] of files) {
		const sanitizedPath = sanitizeArchivePath(archivePath);
		if (!sanitizedPath) continue;
		const destinationPath = path.resolve(extractRoot, sanitizedPath);
		if (!destinationPath.startsWith(extractRoot + path.sep)) {
			throw new Error(`Archive entry escapes extraction directory: ${archivePath}`);
		}
		await Bun.write(destinationPath, file);
	}
}

async function getEmbeddedClientDir(): Promise<string> {
	if (!USE_EMBEDDED_CLIENT) return STATIC_DIR;
	if (embeddedClientDirPromise) return embeddedClientDirPromise;

	if (!EMBEDDED_CLIENT_ARCHIVE) {
		throw new Error(
			"Embedded stats client bundle missing. Rebuild the omp binary or npm bundle with embedded stats assets.",
		);
	}

	embeddedClientDirPromise = (async () => {
		const bundleHash = Bun.hash(EMBEDDED_CLIENT_ARCHIVE).toString(16);
		const outputDir = path.join(EMBEDDED_CLIENT_DIR_ROOT, bundleHash);
		const markerPath = path.join(outputDir, "index.html");
		try {
			const marker = await fs.stat(markerPath);
			if (marker.isFile()) return outputDir;
		} catch {}

		await fs.rm(outputDir, { recursive: true, force: true });
		await fs.mkdir(outputDir, { recursive: true });
		await extractEmbeddedClientArchive(EMBEDDED_CLIENT_ARCHIVE, outputDir);
		return outputDir;
	})();

	return embeddedClientDirPromise;
}

async function getLatestMtime(dir: string): Promise<number> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch (err) {
		// Tolerate missing source trees (e.g. installs without the dashboard
		// sources); the caller falls back to prebuilt assets or a clear build
		// failure instead of crashing on the scan.
		if (isEnoent(err)) return 0;
		throw err;
	}

	const promises = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			promises.push(getLatestMtime(fullPath));
		} else if (entry.isFile()) {
			promises.push(fs.stat(fullPath).then(stats => stats.mtimeMs));
		}
	}

	let latest = 0;
	await Promise.allSettled(promises).then(results => {
		for (const result of results) {
			if (result.status === "fulfilled") {
				latest = Math.max(latest, result.value);
			}
		}
	});
	return latest;
}

const ensureClientBuild = async () => {
	if (USE_EMBEDDED_CLIENT) return;
	const indexPath = path.join(STATIC_DIR, "index.html");
	const cssPath = path.join(STATIC_DIR, "styles.css");
	const clientSourceMtime = await getLatestMtime(CLIENT_DIR);
	const tailwindConfigPath = path.join(import.meta.dir, "..", "tailwind.config.js");
	let tailwindConfigMtime = 0;
	try {
		const tailwindConfigStats = await fs.stat(tailwindConfigPath);
		tailwindConfigMtime = tailwindConfigStats.mtimeMs;
	} catch {}
	const sourceMtime = Math.max(clientSourceMtime, tailwindConfigMtime);
	let shouldBuild = true;
	try {
		const [indexStats, cssStats] = await Promise.all([fs.stat(indexPath), fs.stat(cssPath)]);
		if (
			indexStats.isFile() &&
			cssStats.isFile() &&
			indexStats.mtimeMs >= sourceMtime &&
			cssStats.mtimeMs >= sourceMtime
		) {
			shouldBuild = false;
		}
	} catch {
		shouldBuild = true;
	}

	if (!shouldBuild) return;

	await fs.rm(STATIC_DIR, { recursive: true, force: true });

	console.log("Building stats client...");
	const packageRoot = path.join(import.meta.dir, "..");
	const buildResult = await $`bun run build.ts`.cwd(packageRoot).quiet().nothrow();
	if (buildResult.exitCode !== 0) {
		const output = buildResult.text().trim();
		const details = output ? `\n${output}` : "";
		throw new Error(`Failed to build stats client (exit ${buildResult.exitCode})${details}`);
	}

	const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Usage Statistics</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div id="root"></div>
    <script src="index.js" type="module"></script>
</body>
</html>`;

	await Bun.write(path.join(STATIC_DIR, "index.html"), indexHtml);
};

/**
 * Handle API requests.
 */
async function handleApi(req: Request): Promise<Response> {
	const url = new URL(req.url);
	const path = url.pathname;

	// Stats reads are DB-only; explicit /api/sync does the expensive session scan.
	const range = url.searchParams.get("range");

	if (path === "/api/stats") {
		const stats = await getDashboardStats(range);
		return Response.json(stats);
	}

	if (path === "/api/stats/overview") {
		const stats = await getOverviewStats(range);
		return Response.json(stats);
	}

	if (path === "/api/stats/model-dashboard") {
		const stats = await getModelDashboardStats(range);
		return Response.json(stats);
	}

	if (path === "/api/stats/costs") {
		const stats = await getCostDashboardStats(range);
		return Response.json(stats);
	}

	if (path === "/api/stats/behavior") {
		const stats = await getBehaviorDashboardStats(range);
		return Response.json(stats);
	}

	if (path === "/api/stats/recent") {
		const limit = url.searchParams.get("limit");
		const stats = await getRecentRequests(limit ? parseInt(limit, 10) : undefined);
		return Response.json(stats);
	}

	if (path === "/api/stats/errors") {
		const limit = url.searchParams.get("limit");
		const stats = await getRecentErrors(limit ? parseInt(limit, 10) : undefined);
		return Response.json(stats);
	}

	if (path === "/api/stats/models") {
		const stats = await getDashboardStats(range);
		return Response.json(stats.byModel);
	}

	if (path === "/api/stats/folders") {
		const stats = await getDashboardStats(range);
		return Response.json(stats.byFolder);
	}

	if (path === "/api/stats/timeseries") {
		const stats = await getDashboardStats(range);
		return Response.json(stats.timeSeries);
	}

	if (path.startsWith("/api/request/")) {
		const id = path.split("/").pop();
		if (!id || !/^\d+$/.test(id)) return errorResponse(400, "BAD_REQUEST", "Request id must be an integer");
		const details = await getRequestDetails(Number(id));
		if (!details) return errorResponse(404, "NOT_FOUND", `Request ${id} was not found`);
		return Response.json(details);
	}

	if (path === "/api/sync") {
		const result = await syncAllSessions();
		const count = await getTotalMessageCount();
		return Response.json({ ...result, totalMessages: count });
	}

	return errorResponse(404, "NOT_FOUND", `No stats API route exists for ${path}`);
}

/**
 * Handle static file requests.
 */
async function handleStatic(requestPath: string): Promise<Response> {
	const staticDir = await getEmbeddedClientDir();
	const filePath = requestPath === "/" ? "/index.html" : requestPath;
	const fullPath = path.join(staticDir, filePath);

	const file = Bun.file(fullPath);
	if (await file.exists()) {
		return new Response(file);
	}

	// SPA fallback
	const index = Bun.file(path.join(staticDir, "index.html"));
	if (await index.exists()) {
		return new Response(index);
	}

	return new Response("Not Found", { status: 404 });
}

/**
 * Start the HTTP server.
 */
export async function startServer(port = 3847): Promise<StatsServer> {
	validateServerPort(port);
	try {
		await ensureClientBuild();
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Unable to prepare the stats dashboard client: ${detail}`, { cause: error });
	}

	let server: ReturnType<typeof Bun.serve>;
	try {
		server = Bun.serve({
			port,
			async fetch(req) {
				const url = new URL(req.url);
				const requestPath = url.pathname;
				const corsHeaders = {
					"Access-Control-Allow-Origin": "*",
					"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
					"Access-Control-Allow-Headers": "Content-Type",
				};

				if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

				try {
					let response: Response;
					if (requestPath === "/version") {
						response = Response.json({
							name: APP_NAME,
							version: VERSION,
							runtime: { name: "bun", version: Bun.version },
							provenance: {
								compiled: IS_BUN_COMPILED,
								bundled: Boolean(process.env.PI_BUNDLED || Bun.env.PI_BUNDLED),
								forkHash: process.env.PI_FORK_HASH?.trim() || null,
							},
						} satisfies StatsVersion);
					} else if (requestPath === "/healthz") {
						const database = await ensureDbReady();
						database.query("SELECT 1 AS ready").get();
						response = Response.json({ status: "ok", db: "ready" } satisfies StatsHealth);
					} else if (requestPath.startsWith("/api/")) {
						await ensureDbReady();
						response = await handleApi(req);
					} else {
						response = await handleStatic(requestPath);
					}

					const headers = new Headers(response.headers);
					for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value);
					return new Response(response.body, { status: response.status, headers });
				} catch (error) {
					console.error("Stats server request failed:", error);
					const databaseFailure = requestPath === "/healthz" && dbInitPromise === null;
					return errorResponse(
						databaseFailure ? 503 : 500,
						databaseFailure ? "DB_UNAVAILABLE" : "INTERNAL_ERROR",
						error instanceof Error ? error.message : "Unknown stats server error",
					);
				}
			},
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Unable to start the stats server on port ${port}: ${detail}`, { cause: error });
	}

	let stopped = false;
	return {
		port: server.port ?? port,
		async stop() {
			if (stopped) return;
			stopped = true;
			await server.stop(true);
			await closeStatsDb();
		},
	};
}
