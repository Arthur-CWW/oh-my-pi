#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { runProvider } from "./video-understanding-runner";
import {
	buildVideoUnderstandingRerunCommand,
	parseVideoUnderstandingArgs,
} from "./video-understanding-args";
import { safeArtifactPath, sha256 } from "./video-understanding-provider-utils";
import { withSemanticValidation } from "./video-understanding-semantic";
import {
	ANTIGRAVITY_MODEL_ID,
	ANTIGRAVITY_MODEL_SELECTOR,
	ANTIGRAVITY_PROVIDER,
	ANTIGRAVITY_PROVIDER_ID,
	type JsonObject,
	type JsonValue,
	OMP_CONFIG,
	OMP_SOURCE_CLI,
	type ProviderResult,
	type VideoSample,
	type VideoUnderstandingArgs,
} from "./video-understanding-types";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
	const args = parseVideoUnderstandingArgs(process.argv.slice(2));
	const outDir = path.resolve(args.outDir);
	const artifactsDir = path.join(outDir, "artifacts");
	const cacheDir = path.resolve(args.cacheDir);
	const sqlitePath = path.resolve(args.sqlitePath);
	const logPath = path.join(outDir, "provider-run-log.jsonl");
	const needsKeyframes = args.providers.some((provider) => provider !== ANTIGRAVITY_PROVIDER);
	await fsp.mkdir(outDir, { recursive: true });
	if (needsKeyframes) await fsp.mkdir(artifactsDir, { recursive: true });
	await fsp.mkdir(cacheDir, { recursive: true });
	await fsp.mkdir(path.dirname(sqlitePath), { recursive: true });
	const runId = `run_${new Date()
		.toISOString()
		.replace(/[^0-9]/g, "")
		.slice(
			0,
			14,
		)}_${sha256(JSON.stringify({ outDir, cacheDir, providers: args.providers, prompt: args.prompt })).slice(0, 10)}`;
	const metricsDb = openMetricsDb(sqlitePath);

	const inputVideos = (await collectVideos(args.videos, args.manifest)).slice(0, args.limit);
	if (inputVideos.length === 0) {
		throw new Error(
			"No input videos found. Pass files/directories after --videos, or pass --manifest.",
		);
	}

	insertEvalRun(metricsDb, runId, args, outDir, cacheDir, inputVideos.length);
	const selectedSamples = new Map<string, VideoSample>();
	if (!needsKeyframes) {
		for (const videoPath of inputVideos) {
			selectedSamples.set(
				videoPath,
				await prepareVideoSample(videoPath, artifactsDir, args, false),
			);
		}
	}

	const results: Array<{
		video: string;
		sample: Omit<VideoSample, "frames"> & {
			frames: Array<Omit<VideoSample["frames"][number], "base64">>;
		};
		providers: ProviderResult[];
	}> = [];
	let stoppedAfterFailure = false;

	for (const videoPath of inputVideos) {
		const sample =
			selectedSamples.get(videoPath) ??
			(await prepareVideoSample(videoPath, artifactsDir, args, true));
		const providerResults: ProviderResult[] = [];
		for (const provider of args.providers) {
			const providerResult = await withSemanticValidation(
				await runProvider(provider, sample, args, cacheDir, logPath),
				sample,
			);
			providerResults.push(providerResult);
			insertEvalResult(metricsDb, runId, sample, providerResult);
			if (provider === ANTIGRAVITY_PROVIDER && providerResult.status === "failed") {
				stoppedAfterFailure = true;
				break;
			}
		}
		results.push({
			video: safeArtifactPath(videoPath),
			sample: {
				inputPath: safeArtifactPath(sample.inputPath),
				id: sample.id,
				inputBytes: sample.inputBytes,
				inputSha256: sample.inputSha256,
				durationSeconds: sample.durationSeconds,
				width: sample.width,
				height: sample.height,
				frames: sample.frames.map(({ base64: _base64, ...frame }) => ({
					...frame,
					path: safeArtifactPath(frame.path),
				})),
			},
			providers: providerResults,
		});
		if (stoppedAfterFailure) break;
	}

	const rerunCommand = buildVideoUnderstandingRerunCommand(args);
	const summary = summarize(results, args, { runId, outDir, cacheDir, sqlitePath });
	Object.assign(summary, {
		selectedVideos: inputVideos.length,
		attemptedVideos: results.length,
		stoppedAfterFailure,
		rerunCommand,
	});
	const runManifest = {
		schemaVersion: "video-understanding-eval.native-video.v1",
		runId,
		createdAt: new Date().toISOString(),
		modality:
			args.providers.length === 1 && args.providers[0] === ANTIGRAVITY_PROVIDER
				? "native-video"
				: "mixed",
		providers: args.providers,
		modelSelector: args.providers.includes(ANTIGRAVITY_PROVIDER)
			? ANTIGRAVITY_MODEL_SELECTOR
			: undefined,
		expectedResolvedModel: args.providers.includes(ANTIGRAVITY_PROVIDER)
			? `${ANTIGRAVITY_PROVIDER_ID}/${ANTIGRAVITY_MODEL_ID}`
			: undefined,
		config: args.providers.includes(ANTIGRAVITY_PROVIDER) ? OMP_CONFIG : undefined,
		sourceCli: args.providers.includes(ANTIGRAVITY_PROVIDER) ? OMP_SOURCE_CLI : undefined,
		promptFile: args.promptFile,
		promptSha256: sha256(args.prompt),
		inputs: inputVideos.map((path) => {
			const sample = selectedSamples.get(path);
			const attempted = results.find((row) => row.video === safeArtifactPath(path));
			return {
				path: safeArtifactPath(path),
				bytes: sample?.inputBytes ?? attempted?.sample.inputBytes,
				sha256: sample?.inputSha256 ?? attempted?.sample.inputSha256,
				attempted: Boolean(attempted),
			};
		}),
		rawMediaCopied: false,
		extractedFramesPassedToNativeProvider: false,
		rerunCommand,
	};
	await fsp.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(runManifest, null, 2));
	await fsp.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
	await fsp.writeFile(path.join(outDir, "results.json"), JSON.stringify(results, null, 2));
	if (args.providers.includes(ANTIGRAVITY_PROVIDER)) {
		const latestPath = path.resolve(
			"data/provider-evals/video-understanding/runs/latest-antigravity-native.json",
		);
		await fsp.writeFile(
			latestPath,
			JSON.stringify(
				{
					runId,
					runDir: safeArtifactPath(outDir),
					manifest: safeArtifactPath(path.join(outDir, "manifest.json")),
					results: safeArtifactPath(path.join(outDir, "results.json")),
					summary: safeArtifactPath(path.join(outDir, "summary.json")),
					updatedAt: new Date().toISOString(),
				},
				null,
				2,
			),
		);
	}
	metricsDb.close();
	console.log(JSON.stringify(summary, null, 2));
}

async function collectVideos(inputs: string[], manifestPath?: string): Promise<string[]> {
	const out: string[] = [];
	if (manifestPath) {
		const manifest = JSON.parse(await fsp.readFile(path.resolve(manifestPath), "utf8")) as {
			videos?: Array<{ mp4?: JsonValue }>;
		};
		if (!Array.isArray(manifest.videos))
			throw new Error(`Manifest has no videos array: ${manifestPath}`);
		for (const video of manifest.videos) {
			if (typeof video.mp4 !== "string" || !isVideoPath(video.mp4)) {
				throw new Error(`Manifest video has invalid mp4 path: ${String(video.mp4)}`);
			}
			const filePath = path.resolve(video.mp4);
			const info = await fsp.stat(filePath);
			if (!info.isFile()) throw new Error(`Manifest mp4 is not a file: ${video.mp4}`);
			out.push(filePath);
		}
	}
	for (const input of inputs) {
		const filePath = path.resolve(input);
		if (!fs.existsSync(filePath)) continue;
		const info = await fsp.stat(filePath);
		if (info.isDirectory()) {
			for (const child of await walk(filePath)) {
				if (isVideoPath(child)) out.push(child);
			}
		} else if (isVideoPath(filePath)) {
			out.push(filePath);
		}
	}
	return [...new Set(out)].sort();
}

async function walk(dir: string): Promise<string[]> {
	const entries = await fsp.readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(filePath)));
		} else {
			files.push(filePath);
		}
	}
	return files;
}

function isVideoPath(filePath: string): boolean {
	return [".mp4", ".mov", ".m4v", ".webm"].includes(path.extname(filePath).toLowerCase());
}

async function prepareVideoSample(
	videoPath: string,
	artifactsDir: string,
	args: VideoUnderstandingArgs,
	needsKeyframes: boolean,
): Promise<VideoSample> {
	const fileBytes = await fsp.readFile(videoPath);
	const inputSha256 = sha256(fileBytes);
	const fileHash = inputSha256.slice(0, 16);
	const id = `${path.basename(videoPath, path.extname(videoPath)).replace(/[^a-zA-Z0-9_.-]/g, "_")}_${fileHash}`;

	const metadata = await ffprobe(videoPath).catch((): JsonObject => ({}));
	const format = metadata.format;
	const durationSeconds = Number(
		format !== null && typeof format === "object" && !Array.isArray(format)
			? format.duration
			: undefined,
	);
	const streams = Array.isArray(metadata.streams) ? metadata.streams : [];
	const videoStream = streams.find(
		(stream): stream is JsonObject =>
			stream !== null &&
			typeof stream === "object" &&
			!Array.isArray(stream) &&
			stream.codec_type === "video",
	);

	if (!needsKeyframes) {
		return {
			inputPath: videoPath,
			id,
			inputBytes: fileBytes.byteLength,
			inputSha256,
			durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
			width: typeof videoStream?.width === "number" ? videoStream.width : undefined,
			height: typeof videoStream?.height === "number" ? videoStream.height : undefined,
			frames: [],
		};
	}

	const sampleDir = path.join(artifactsDir, id);
	await fsp.mkdir(sampleDir, { recursive: true });

	const framePattern = path.join(sampleDir, "frame_%03d.jpg");
	await execFileAsync("ffmpeg", [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-i",
		videoPath,
		"-vf",
		`fps=1/${args.frameEverySeconds},scale=640:-1`,
		"-frames:v",
		String(args.maxFrames),
		framePattern,
	]);

	const frameFiles = (await fsp.readdir(sampleDir))
		.filter((name) => name.endsWith(".jpg"))
		.sort()
		.map((name) => path.join(sampleDir, name));

	const frames = [];
	for (const [index, framePath] of frameFiles.entries()) {
		const bytes = await fsp.readFile(framePath);
		frames.push({
			path: framePath,
			sha256: sha256(bytes),
			base64: bytes.toString("base64"),
			mimeType: "image/jpeg",
			timestampSeconds: index * args.frameEverySeconds,
			index,
		});
	}

	await fsp.writeFile(path.join(sampleDir, "metadata.json"), JSON.stringify(metadata, null, 2));
	return {
		inputPath: videoPath,
		id,
		inputBytes: fileBytes.byteLength,
		inputSha256,
		durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
		width: typeof videoStream?.width === "number" ? videoStream.width : undefined,
		height: typeof videoStream?.height === "number" ? videoStream.height : undefined,
		frames,
	};
}

async function ffprobe(videoPath: string): Promise<JsonObject> {
	const { stdout } = await execFileAsync("ffprobe", [
		"-v",
		"error",
		"-show_format",
		"-show_streams",
		"-of",
		"json",
		videoPath,
	]);
	const parsed = JSON.parse(stdout) as JsonValue;
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("ffprobe returned a non-object payload");
	return parsed;
}

function summarize(
	results: Array<{ providers: ProviderResult[] }>,
	args: VideoUnderstandingArgs,
	runInfo: { runId: string; outDir: string; cacheDir: string; sqlitePath: string },
): JsonObject {
	const byProvider = new Map<
		string,
		{
			calls: number;
			completed: number;
			failed: number;
			cacheHits: number;
			dryRuns: number;
			semanticPasses: number;
			semanticFailures: number;
			semanticUnknown: number;
			estimatedCostUsd: number;
			avoidedCostUsd: number;
			totalLatencyMs: number;
			avgLatencyMs: number;
			completedPerMinute: number;
		}
	>();
	for (const row of results) {
		for (const result of row.providers) {
			const key = `${result.provider}:${result.model}`;
			const current = byProvider.get(key) ?? {
				calls: 0,
				completed: 0,
				failed: 0,
				cacheHits: 0,
				dryRuns: 0,
				semanticPasses: 0,
				semanticFailures: 0,
				semanticUnknown: 0,
				estimatedCostUsd: 0,
				avoidedCostUsd: 0,
				totalLatencyMs: 0,
				avgLatencyMs: 0,
				completedPerMinute: 0,
			};
			current.calls += 1;
			if (result.status === "completed") current.completed += 1;
			if (result.status === "failed") current.failed += 1;
			if (result.status === "cache_hit") current.cacheHits += 1;
			if (result.status === "dry_run") current.dryRuns += 1;
			if (result.semanticOk === true) current.semanticPasses += 1;
			else if (result.semanticOk === false) current.semanticFailures += 1;
			else current.semanticUnknown += 1;
			current.estimatedCostUsd += result.estimatedCostUsd ?? 0;
			current.avoidedCostUsd += result.avoidedCostUsd ?? 0;
			current.totalLatencyMs += result.latencyMs ?? 0;
			current.avgLatencyMs = current.completed > 0 ? current.totalLatencyMs / current.completed : 0;
			current.completedPerMinute =
				current.totalLatencyMs > 0 ? current.completed / (current.totalLatencyMs / 60000) : 0;
			byProvider.set(key, current);
		}
	}
	return {
		live: args.live,
		runId: runInfo.runId,
		outDir: safeArtifactPath(runInfo.outDir),
		cacheDir: safeArtifactPath(runInfo.cacheDir),
		sqlitePath: safeArtifactPath(runInfo.sqlitePath),
		videos: results.length,
		providers: Object.fromEntries(byProvider),
		notes: args.live
			? "Costs are estimated from provider usage/credits where available. Check provider dashboards for final billing."
			: "Dry run only; no provider calls made. Re-run with --live after setting keys.",
	};
}

function openMetricsDb(sqlitePath: string): Database {
	const db = new Database(sqlitePath);
	db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS eval_runs (
      run_id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      live INTEGER NOT NULL,
      providers_json TEXT NOT NULL,
      videos_json TEXT NOT NULL,
      video_count INTEGER NOT NULL,
      limit_count INTEGER NOT NULL,
      max_frames INTEGER NOT NULL,
      frame_every_seconds REAL NOT NULL,
      max_output_tokens INTEGER,
      prompt_hash TEXT NOT NULL,
      google_model TEXT,
      kie_model TEXT,
      out_dir TEXT NOT NULL,
      cache_dir TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eval_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      video_id TEXT NOT NULL,
      video_path TEXT NOT NULL,
      duration_seconds REAL,
      width INTEGER,
      height INTEGER,
      frame_count INTEGER NOT NULL,
      frames_json TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      cache_status TEXT NOT NULL,
      cache_path TEXT NOT NULL,
      response_path TEXT,
      parsed_path TEXT,
      error TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      thoughts_tokens INTEGER,
      usage_json TEXT,
      latency_ms REAL,
      estimated_cost_usd REAL,
      avoided_cost_usd REAL,
      raw_credits_consumed REAL,
      finish_reason TEXT,
      output_chars INTEGER,
      parsed_ok INTEGER,
      FOREIGN KEY(run_id) REFERENCES eval_runs(run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_eval_results_run_provider ON eval_results(run_id, provider, model);
    CREATE INDEX IF NOT EXISTS idx_eval_results_request_hash ON eval_results(request_hash);
    CREATE INDEX IF NOT EXISTS idx_eval_results_video ON eval_results(video_id);
  `);
	ensureColumn(db, "eval_runs", "max_output_tokens", "INTEGER");
	ensureColumn(db, "eval_results", "avoided_cost_usd", "REAL");
	ensureColumn(db, "eval_results", "finish_reason", "TEXT");
	ensureColumn(db, "eval_results", "output_chars", "INTEGER");
	ensureColumn(db, "eval_results", "parsed_ok", "INTEGER");
	return db;
}

function ensureColumn(
	db: Database,
	tableName: string,
	columnName: string,
	definition: string,
): void {
	const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
	if (rows.some((row) => row.name === columnName)) {
		return;
	}
	db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
}

function insertEvalRun(
	db: Database,
	runId: string,
	args: VideoUnderstandingArgs,
	outDir: string,
	cacheDir: string,
	videoCount: number,
): void {
	db.prepare(`
    INSERT OR REPLACE INTO eval_runs (
      run_id, created_at, live, providers_json, videos_json, video_count, limit_count,
      max_frames, frame_every_seconds, max_output_tokens, prompt_hash, google_model, kie_model, out_dir, cache_dir
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		runId,
		new Date().toISOString(),
		args.live ? 1 : 0,
		JSON.stringify(args.providers),
		JSON.stringify(args.videos),
		videoCount,
		args.limit,
		args.maxFrames,
		args.frameEverySeconds,
		args.maxOutputTokens,
		sha256(args.prompt),
		args.googleModel,
		args.kieModel,
		outDir,
		cacheDir,
	);
}

function insertEvalResult(
	db: Database,
	runId: string,
	sample: VideoSample,
	result: ProviderResult,
): void {
	const id = sha256(
		[runId, sample.id, result.provider, result.model, result.requestHash, result.status].join(
			"\u001f",
		),
	);
	const cacheStatus =
		result.status === "cache_hit"
			? "hit"
			: result.status === "dry_run"
				? "miss_dry_run"
				: result.status === "completed"
					? "write"
					: "miss_failed";
	db.prepare(`
    INSERT OR REPLACE INTO eval_results (
      id, run_id, created_at, video_id, video_path, duration_seconds, width, height,
      frame_count, frames_json, provider, model, status, request_hash, cache_status,
      cache_path, response_path, parsed_path, error, prompt_tokens, completion_tokens,
      total_tokens, thoughts_tokens, usage_json, latency_ms, estimated_cost_usd,
      avoided_cost_usd, raw_credits_consumed, finish_reason, output_chars, parsed_ok
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
		id,
		runId,
		new Date().toISOString(),
		sample.id,
		sample.inputPath,
		sample.durationSeconds ?? null,
		sample.width ?? null,
		sample.height ?? null,
		sample.frames.length,
		JSON.stringify(sample.frames.map(({ base64: _base64, ...frame }) => frame)),
		result.provider,
		result.model,
		result.status,
		result.requestHash,
		cacheStatus,
		result.cachePath,
		result.responsePath ?? null,
		result.parsedPath ?? null,
		result.error ?? null,
		result.promptTokens ?? null,
		result.completionTokens ?? null,
		result.totalTokens ?? null,
		result.thoughtsTokens ?? null,
		result.usage ? JSON.stringify(result.usage) : null,
		result.latencyMs ?? null,
		result.estimatedCostUsd ?? null,
		result.avoidedCostUsd ?? null,
		result.rawCreditsConsumed ?? null,
		result.finishReason ?? null,
		result.outputChars ?? null,
		result.parsedOk === undefined ? null : result.parsedOk ? 1 : 0,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : error);
	process.exit(1);
});
