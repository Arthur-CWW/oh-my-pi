#!/usr/bin/env bun

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));
const dir = resolve(args.dir ?? "packages/kagi/output/network");
const contains = args.contains ?? "";
const status = args.status ? Number(args.status) : undefined;
const kind = args.kind ?? undefined;

const files = readdirSync(dir).filter((name) => name.endsWith(".json")).sort((a, b) => a.localeCompare(b));
const matches: Array<{
	file: string;
	kind: string;
	method?: string;
	status?: number;
	url: string;
	at: string;
}> = [];

for (const file of files) {
	const raw = readFileSync(join(dir, file), "utf8");
	const json = JSON.parse(raw) as { entries?: Array<Record<string, unknown>> };
	for (const entry of json.entries ?? []) {
		const entryKind = typeof entry.kind === "string" ? entry.kind : "";
		const entryUrl = typeof entry.url === "string" ? entry.url : "";
		const entryStatus = typeof entry.status === "number" ? entry.status : undefined;
		if (kind && entryKind !== kind) {
			continue;
		}
		if (typeof status === "number" && entryStatus !== status) {
			continue;
		}
		if (contains && !entryUrl.includes(contains)) {
			continue;
		}
		matches.push({
			file,
			kind: entryKind,
			method: typeof entry.method === "string" ? entry.method : undefined,
			status: entryStatus,
			url: entryUrl,
			at: typeof entry.at === "string" ? entry.at : "",
		});
	}
}

console.log(JSON.stringify({ dir, filters: { contains, status, kind }, count: matches.length, matches }, null, 2));

function parseArgs(argv: string[]): Record<string, string> {
	const parsed: Record<string, string> = {};
	for (let i = 0; i < argv.length; i += 1) {
		const current = argv[i];
		const next = argv[i + 1];
		if (!current.startsWith("--")) {
			continue;
		}
		const key = current.slice(2);
		if (next && !next.startsWith("--")) {
			parsed[key] = next;
			i += 1;
		} else {
			parsed[key] = "true";
		}
	}
	return parsed;
}
