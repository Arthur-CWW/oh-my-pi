#!/usr/bin/env bun
/** Summarize a live Companion soak JSONL file for the morning handoff. */

import { resolve } from "node:path";

type JsonRecord = Record<string, unknown>;
type SoakRow = JsonRecord & { timestamp?: unknown };

type ReplayStats = {
	attempted: number;
	successful: number;
};

const DEFAULT_REPORT_PATH = resolve(import.meta.dir, "..", "local", "soak", "soak-2026-07-15.jsonl");
const MB = 1_000_000;

function isRecord(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

function normalized(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function probeOk(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value >= 200 && value < 300;
	if (typeof value === "string") {
		const status = finiteNumber(value);
		if (status !== null) return status >= 200 && status < 300;
		if (/^(ok|success|healthy)$/i.test(value.trim())) return true;
		if (/^(error|failed|failure|unhealthy)$/i.test(value.trim())) return false;
		return null;
	}
	if (!isRecord(value)) return null;

	for (const key of ["ok", "success", "healthy"]) {
		if (typeof value[key] === "boolean") return value[key] as boolean;
	}
	for (const key of ["status", "statusCode", "httpStatus"]) {
		const status = finiteNumber(value[key]);
		if (status !== null) return status >= 200 && status < 300;
	}
	if (typeof value.error === "string" && value.error.trim() !== "") return false;
	if (value.error !== null && value.error !== undefined && value.error !== false) return false;
	return null;
}

function matchingProbeResults(value: unknown, matches: (path: string[]) => boolean, path: string[] = []): boolean[] {
	if (Array.isArray(value)) {
		return value.flatMap((entry, index) => matchingProbeResults(entry, matches, [...path, String(index)]));
	}
	if (!isRecord(value)) {
		if (matches(path)) {
			const result = probeOk(value);
			return result === null ? [] : [result];
		}
		return [];
	}

	if (matches(path)) {
		const result = probeOk(value);
		if (result !== null) return [result];
	}
	const results: boolean[] = [];
	for (const [key, child] of Object.entries(value)) {
		results.push(...matchingProbeResults(child, matches, [...path, key]));
	}
	return results;
}

function replaySummary(value: unknown): ReplayStats | null {
	if (!isRecord(value)) return null;
	const attempted = Object.entries(value).find(([key]) => /^(attempted|attempts|calls|routecalls)$/i.test(normalized(key)))?.[1];
	const successful = Object.entries(value).find(([key]) => /^(successful|successes|succeeded|successcalls)$/i.test(normalized(key)))?.[1];
	const attemptCount = finiteNumber(attempted);
	const successCount = finiteNumber(successful);
	if (!Number.isSafeInteger(attemptCount) || !Number.isSafeInteger(successCount) || attemptCount < 0 || successCount < 0) return null;
	return { attempted: attemptCount, successful: Math.min(successCount, attemptCount) };
}

function replayOutcomes(value: unknown, path: string[] = []): boolean[] {
	if (Array.isArray(value)) return value.flatMap((entry, index) => replayOutcomes(entry, [...path, String(index)]));
	if (!isRecord(value)) {
		const result = probeOk(value);
		return result === null ? [] : [result];
	}
	const summary = replaySummary(value);
	if (summary !== null) {
		return [...Array(summary.successful).fill(true), ...Array(summary.attempted - summary.successful).fill(false)];
	}
	const direct = probeOk(value);
	if (direct !== null && path.length > 0) return [direct];
	return Object.entries(value).flatMap(([key, child]) => replayOutcomes(child, [...path, key]));
}

function replayStats(row: SoakRow): ReplayStats {
	const candidates = Object.entries(row).filter(([key]) => normalized(key).includes("replay"));
	for (const [, value] of candidates) {
		const summary = replaySummary(value);
		if (summary !== null) return summary;
		const outcomes = replayOutcomes(value);
		if (outcomes.length > 0) {
			return {
				attempted: outcomes.length,
				successful: outcomes.filter(Boolean).length,
			};
		}
	}
	return { attempted: 0, successful: 0 };
}

function rssBytes(row: SoakRow): number | null {
	const server = isRecord(row.server) ? row.server : null;
	const rssKb = finiteNumber(server?.rssKb);
	if (rssKb !== null && rssKb >= 0) return rssKb * 1024;

	let fallback: number | null = null;
	const visit = (value: unknown, path: string[]): void => {
		if (fallback !== null) return;
		if (Array.isArray(value)) {
			value.forEach((entry, index) => visit(entry, [...path, String(index)]));
			return;
		}
		if (!isRecord(value)) return;
		for (const [key, child] of Object.entries(value)) {
			const nextPath = [...path, key];
			const text = nextPath.map(normalized).join(".");
			const number = finiteNumber(child);
			if (number !== null && /rss|residentsetsize/.test(text)) {
				const leaf = normalized(key);
				const multiplier = leaf.includes("byte") ? 1 : leaf.includes("mb") || leaf.includes("mib") ? MB : 1024;
				if (number >= 0) fallback = number * multiplier;
				if (fallback !== null) return;
			}
			visit(child, nextPath);
			if (fallback !== null) return;
		}
	};
	visit(row, []);
	return fallback;
}

function newErrorLineCount(row: SoakRow): number {
	const errors = isRecord(row.errors) ? row.errors : null;
	const lines = errors?.newLines;
	if (Array.isArray(lines)) return lines.length;
	const direct = finiteNumber(lines);
	if (direct !== null && direct >= 0) return direct;

	let best: number | null = null;
	const visit = (value: unknown, path: string[]): void => {
		if (Array.isArray(value)) return;
		if (!isRecord(value)) return;
		for (const [key, child] of Object.entries(value)) {
			const nextPath = [...path, key].map(normalized);
			const keyName = normalized(key);
			const number = finiteNumber(child);
			if (number !== null && number >= 0 && (/new.*(error|line)/.test(keyName) || (nextPath.includes("errors") && /new.*line/.test(keyName)))) {
				best = number;
				return;
			}
			if (/new.*(error|line)/.test(keyName) && Array.isArray(child)) {
				best = child.length;
				return;
			}
			visit(child, [...path, key]);
			if (best !== null) return;
		}
	};
	visit(row, []);
	return best ?? 0;
}

function timestamp(row: SoakRow): string | null {
	for (const key of ["timestamp", "time", "at", "completedAt"]) {
		if (typeof row[key] === "string" || typeof row[key] === "number") return String(row[key]);
	}
	return null;
}

function rssSlope(samples: number[]): number | null {
	if (samples.length === 0) return null;
	if (samples.length === 1) return 0;
	const meanX = (samples.length - 1) / 2;
	const meanY = samples.reduce((sum, value) => sum + value, 0) / samples.length;
	let numerator = 0;
	let denominator = 0;
	for (let index = 0; index < samples.length; index++) {
		numerator += (index - meanX) * (samples[index]! - meanY);
		denominator += (index - meanX) ** 2;
	}
	return denominator === 0 ? 0 : numerator / denominator;
}

async function main(): Promise<void> {
	const argument = Bun.argv[2];
	const path = argument === undefined ? DEFAULT_REPORT_PATH : resolve(process.cwd(), argument);
	let text: string;
	try {
		text = await Bun.file(path).text();
	} catch (error) {
		console.error(`Could not read soak JSONL: ${path}`);
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
		return;
	}

	const rows: SoakRow[] = [];
	const malformedLines: number[] = [];
	for (const [index, line] of text.split(/\r?\n/).entries()) {
		if (line.trim() === "") continue;
		try {
			const value: unknown = JSON.parse(line);
			if (!isRecord(value)) throw new Error("row is not a JSON object");
			rows.push(value as SoakRow);
		} catch {
			malformedLines.push(index + 1);
		}
	}

	const timestamps = rows.map(timestamp).filter((value): value is string => value !== null);
	const rssSamples = rows.map(rssBytes).filter((value): value is number => value !== null);
	const replay = rows.reduce<ReplayStats>((total, row) => {
		const current = replayStats(row);
		return { attempted: total.attempted + current.attempted, successful: total.successful + current.successful };
	}, { attempted: 0, successful: 0 });
	const healthyCycles = rows.filter(row => {
		const state = matchingProbeResults(row, path => path.some(key => normalized(key).includes("labstate")));
		const lab = matchingProbeResults(row, path => path.some(key => {
			const name = normalized(key);
			return (name === "lab" || name === "labstatus" || name === "labpage" || name.endsWith("lab") || name.endsWith("labstatus") || name.endsWith("labpage")) && !name.includes("state");
		}));
		const labStateRecord = isRecord(row.labState) ? row.labState : null;
		const labStateParseError = labStateRecord?.stateKind === "error";
		const currentReplay = replayStats(row);
		return !labStateParseError && state.length > 0 && state.every(Boolean) && lab.length > 0 && lab.every(Boolean) && currentReplay.attempted >= 2 && currentReplay.successful === currentReplay.attempted;
	}).length;
	const errorLines = rows.reduce((total, row) => total + newErrorLineCount(row), 0);
	const uptime = rows.length === 0 ? 0 : (healthyCycles / rows.length) * 100;
	const replayRate = replay.attempted === 0 ? 0 : (replay.successful / replay.attempted) * 100;
	const slope = rssSlope(rssSamples);

	console.log("Morning soak report");
	console.log(`path: ${path}`);
	console.log(`cycles: ${rows.length}`);
	console.log(`malformed rows: ${malformedLines.length}${malformedLines.length === 0 ? "" : ` (lines ${malformedLines.join(", ")})`}`);
	console.log(`timestamps: ${timestamps[0] ?? "unavailable"} → ${timestamps.at(-1) ?? "unavailable"}`);
	console.log(`uptime: ${uptime.toFixed(1)}% (${healthyCycles}/${rows.length} healthy cycles; healthy = /lab, /api/debug/lab-state, and both replay routes reported 2xx/ok)`);
	console.log(`RSS trend: ${slope === null ? "unavailable (no RSS samples)" : `${slope >= 0 ? "+" : ""}${(slope / MB).toFixed(3)} MB/cycle (least-squares by cycle order; input server.rssKb)`}`);
	console.log(`new error lines: ${errorLines}`);
	console.log(`replay success: ${replay.successful}/${replay.attempted} (${replayRate.toFixed(1)}%; successful route calls / attempted route calls)`);
}

if (import.meta.main) await main();
