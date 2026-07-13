import { Database } from "bun:sqlite";
import * as path from "node:path";
import { YAML } from "bun";

export type FeedKind = "nitter-handle" | "rss" | "page-hash";
export type FeedCadence = "hourly" | "daily";

export interface FeedEntry {
	readonly name: string;
	readonly kind: FeedKind;
	readonly target: string;
	readonly cadence: FeedCadence;
	readonly classifierProfile: string;
}

export interface FeedRegistry {
	readonly feeds: readonly FeedEntry[];
}

export interface FeedSurfacePaths {
	readonly registryPath: string;
	readonly databasePath: string;
}

export interface FeedListRow extends FeedEntry {
	readonly lastSyncAt: string | null;
	readonly itemCount: number;
}

export interface FeedItemRow {
	readonly timestamp: string;
	readonly author: string;
	readonly handle: string;
	readonly text: string;
	readonly url: string;
}

const AVAILABILITY_PACKAGE_RELATIVE = ["packages", "availability-watcher"];

export function defaultFeedSurfacePaths(cwd = process.cwd()): FeedSurfacePaths {
	const packageRoot = path.resolve(cwd, ...AVAILABILITY_PACKAGE_RELATIVE);
	return {
		registryPath: path.join(packageRoot, "feeds.yml"),
		databasePath: path.join(packageRoot, ".state", "feeds.sqlite"),
	};
}

/** Locate the checkout-local registry when the session cwd is a subdirectory. */
export async function resolveFeedSurfacePaths(cwd = process.cwd()): Promise<FeedSurfacePaths> {
	const candidates = [
		path.resolve(cwd, ...AVAILABILITY_PACKAGE_RELATIVE),
		path.resolve(import.meta.dir, "../../../../..", ...AVAILABILITY_PACKAGE_RELATIVE),
	];
	for (const packageRoot of candidates) {
		if (await Bun.file(path.join(packageRoot, "feeds.yml")).exists()) {
			return {
				registryPath: path.join(packageRoot, "feeds.yml"),
				databasePath: path.join(packageRoot, ".state", "feeds.sqlite"),
			};
		}
	}
	return defaultFeedSurfacePaths(cwd);
}

export async function loadFeedRegistry(registryPath: string): Promise<FeedRegistry> {
	const parsed = YAML.parse(await Bun.file(registryPath).text()) as unknown;
	return decodeFeedRegistry(parsed);
}

export function decodeFeedRegistry(value: unknown): FeedRegistry {
	if (!isRecord(value) || !Array.isArray(value.feeds)) throw new Error("feeds.yml must contain a feeds array");
	const feeds = value.feeds.map((entry, index) => decodeFeedEntry(entry, index));
	return { feeds };
}

function decodeFeedEntry(value: unknown, index: number): FeedEntry {
	if (!isRecord(value)) throw new Error(`feeds.yml feeds[${index}] must be an object`);
	const name = stringField(value, "name");
	const kind = stringField(value, "kind");
	const target = stringField(value, "target");
	const cadence = stringField(value, "cadence");
	const classifierProfile = stringField(value, "classifierProfile") ?? stringField(value, "classifier-profile");
	if (!name || !target || !classifierProfile) throw new Error(`feeds.yml feeds[${index}] is missing a required field`);
	if (kind !== "nitter-handle" && kind !== "rss" && kind !== "page-hash") {
		throw new Error(`feeds.yml feeds[${index}] has invalid kind: ${kind ?? "missing"}`);
	}
	if (cadence !== "hourly" && cadence !== "daily") {
		throw new Error(`feeds.yml feeds[${index}] has invalid cadence: ${cadence ?? "missing"}`);
	}
	return { name, kind, target, cadence, classifierProfile };
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function inferFeedKind(input: string): FeedKind {
	const value = input.trim();
	if (isHandleInput(value) || isXUrl(value)) return "nitter-handle";
	if (/\.xml(?:[?#].*)?$/i.test(value) || /\/(?:rss|feed)(?:[/?#].*)?$/i.test(value)) return "rss";
	return "page-hash";
}

export function inferFeedEntry(
	input: string,
	options: { readonly name?: string; readonly cadence?: FeedCadence; readonly classifierProfile?: string } = {},
): FeedEntry {
	const value = input.trim();
	if (!value) throw new Error("Feed target is required");
	const kind = inferFeedKind(value);
	const target = kind === "nitter-handle" ? extractHandle(value) : value;
	const name = options.name?.trim() || defaultFeedName(value, target, kind);
	if (!name) throw new Error("Feed name is required");
	return {
		name,
		kind,
		target,
		cadence: options.cadence ?? (kind === "nitter-handle" ? "hourly" : "daily"),
		classifierProfile: options.classifierProfile?.trim() || "availability",
	};
}

function isHandleInput(value: string): boolean {
	return /^@[A-Za-z0-9_]+$/.test(value) || /^[A-Za-z0-9_]+$/.test(value);
}

function isXUrl(value: string): boolean {
	try {
		const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
		return (
			(parsed.hostname === "x.com" ||
				parsed.hostname === "www.x.com" ||
				parsed.hostname === "twitter.com" ||
				parsed.hostname === "www.twitter.com") &&
			Boolean(parsed.pathname.split("/")[1])
		);
	} catch {
		return false;
	}
}

function extractHandle(value: string): string {
	if (value.startsWith("@")) return value.slice(1);
	if (/^[A-Za-z0-9_]+$/.test(value)) return value;
	const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
	const segment = parsed.pathname.split("/").find(Boolean);
	if (!segment) throw new Error(`Unable to infer a handle from ${value}`);
	return segment.replace(/^@/, "");
}

function defaultFeedName(input: string, target: string, kind: FeedKind): string {
	if (kind === "nitter-handle") return target;
	try {
		const parsed = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
		const slug = `${parsed.hostname}${parsed.pathname}`.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
		return slug || "feed";
	} catch {
		return target.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "feed";
	}
}

export async function appendFeedEntry(registryPath: string, entry: FeedEntry): Promise<void> {
	const text = await Bun.file(registryPath).text();
	const registry = decodeFeedRegistry(YAML.parse(text) as unknown);
	if (registry.feeds.some(feed => feed.name === entry.name)) throw new Error(`Feed already registered: ${entry.name}`);
	const jsonRoot = parseJsonRegistry(text);
	if (jsonRoot) {
		const arrayStart = findFeedsArrayStart(text);
		const arrayEnd = arrayStart === undefined ? undefined : findArrayEnd(text, arrayStart);
		if (arrayStart !== undefined && arrayEnd !== undefined) {
			const beforeEnd = text.slice(0, arrayEnd);
			const trailing = beforeEnd.match(/\s*$/)?.[0] ?? "";
			const contentEnd = beforeEnd.length - trailing.length;
			const hasEntries = text.slice(arrayStart + 1, contentEnd).trim().length > 0;
			const block = JSON.stringify(entry, null, 2)
				.split("\n")
				.map(line => `    ${line}`)
				.join("\n");
			const updated = `${beforeEnd.slice(0, contentEnd)}${hasEntries ? "," : ""}\n${block}${trailing}${text.slice(arrayEnd)}`;
			await Bun.write(registryPath, updated);
			return;
		}
	}
	await Bun.write(registryPath, appendYamlEntry(text, entry));
}

function parseJsonRegistry(text: string): Record<string, unknown> | undefined {
	try {
		const value = JSON.parse(text) as unknown;
		return isRecord(value) && Array.isArray(value.feeds) ? value : undefined;
	} catch {
		return undefined;
	}
}

function findFeedsArrayStart(text: string): number | undefined {
	const match = /["']?feeds["']?\s*:/.exec(text);
	if (!match) return undefined;
	const bracket = text.indexOf("[", match.index + match[0].length - 1);
	return bracket >= 0 ? bracket : undefined;
}

function findArrayEnd(text: string, start: number): number | undefined {
	let depth = 0;
	let inString = false;
	let quote = "";
	let escaped = false;
	for (let index = start; index < text.length; index++) {
		const character = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (character === "\\") escaped = true;
			else if (character === quote) inString = false;
			continue;
		}
		if (character === '"' || character === "'") {
			inString = true;
			quote = character;
		} else if (character === "[") depth++;
		else if (character === "]") {
			depth--;
			if (depth === 0) return index;
		}
	}
	return undefined;
}

function appendYamlEntry(text: string, entry: FeedEntry): string {
	const emptyList = /(^|\n)(\s*feeds:)\s*\[\s*\](\s*(?:#.*)?)?\s*$/.exec(text);
	const block = [
		`  - name: ${yamlString(entry.name)}`,
		`    kind: ${yamlString(entry.kind)}`,
		`    target: ${yamlString(entry.target)}`,
		`    cadence: ${yamlString(entry.cadence)}`,
		`    classifierProfile: ${yamlString(entry.classifierProfile)}`,
	].join("\n");
	if (emptyList)
		return `${text.slice(0, emptyList.index + emptyList[1].length)}${emptyList[2]}\n${block}${emptyList[3] ?? ""}\n`;
	return `${text}${text.endsWith("\n") ? "" : "\n"}${block}\n`;
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

export async function buildFeedsListViewModel(options: {
	readonly registryPath: string;
	readonly databasePath: string;
}): Promise<readonly FeedListRow[]> {
	const registry = await loadFeedRegistry(options.registryPath);
	const database = openReadonly(options.databasePath);
	try {
		return registry.feeds.map(feed => {
			const feedKey = feed.kind === "nitter-handle" ? feed.target : feed.name;
			const state = database ? readFeedState(database, feed.name, feedKey) : undefined;
			return { ...feed, lastSyncAt: state?.lastSyncAt ?? null, itemCount: state?.itemCount ?? 0 };
		});
	} finally {
		database?.close();
	}
}

interface FeedStateSummary {
	readonly lastSyncAt: string | null;
	readonly itemCount: number;
}

function readFeedState(database: Database, feedName: string, feedKey: string): FeedStateSummary | undefined {
	const hasFeedState = tableExists(database, "feed_state");
	const hasRecords = tableExists(database, "public_source_records");
	if (!hasFeedState && !hasRecords) return undefined;
	const row = hasFeedState
		? (database.query("SELECT last_synced_at FROM feed_state WHERE feed_name=?").get(feedName) as
				| { last_synced_at: string | null }
				| undefined)
		: undefined;
	const itemCount = hasRecords
		? Number(
				(
					database
						.query("SELECT COUNT(*) AS count FROM public_source_records WHERE handle=? COLLATE NOCASE")
						.get(feedKey) as { count: number }
				).count,
			)
		: 0;
	let lastSyncAt = row?.last_synced_at ?? null;
	if (!lastSyncAt && hasRecords && tableExists(database, "public_source_state")) {
		const latest = database
			.query("SELECT MAX(last_synced_at) AS last_synced_at FROM public_source_state WHERE handle=? COLLATE NOCASE")
			.get(feedKey) as { last_synced_at: string | null } | undefined;
		lastSyncAt = latest?.last_synced_at ?? null;
	}
	return { lastSyncAt, itemCount };
}

function tableExists(database: Database, table: string): boolean {
	return database.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) !== null;
}

function openReadonly(databasePath: string): Database | undefined {
	try {
		const database = new Database(databasePath, { readonly: true, strict: true });
		database.run("PRAGMA busy_timeout = 3000");
		return database;
	} catch {
		return undefined;
	}
}

export async function renderFeedResource(feedName: string | undefined, options: FeedSurfacePaths): Promise<string> {
	const registry = await loadFeedRegistry(options.registryPath);
	const rows = await buildFeedsListViewModel(options);
	if (!feedName) return formatFeedsList(rows);
	const feed = registry.feeds.find(candidate => candidate.name === feedName);
	if (!feed)
		throw new Error(
			`Unknown feed: ${feedName}\nAvailable: ${registry.feeds.map(candidate => candidate.name).join(", ") || "none"}`,
		);
	const feedKey = feed.kind === "nitter-handle" ? feed.target : feed.name;
	const items = readFeedItems(options.databasePath, feedKey);
	return formatFeedDigest(feed, items);
}

function readFeedItems(databasePath: string, feedKey: string): readonly FeedItemRow[] {
	const database = openReadonly(databasePath);
	if (!database || !tableExists(database, "public_source_records")) {
		database?.close();
		return [];
	}
	try {
		return database
			.query(`SELECT timestamp,author,handle,text,source_url AS url
			FROM public_source_records WHERE handle=? COLLATE NOCASE ORDER BY timestamp DESC LIMIT 200`)
			.all(feedKey) as FeedItemRow[];
	} finally {
		database.close();
	}
}

export function formatFeedsList(rows: readonly FeedListRow[]): string {
	const lines = ["# Feeds", "", "| Name | Kind | Cadence | Items | Last sync |", "| --- | --- | --- | ---: | --- |"];
	for (const row of rows)
		lines.push(`| ${row.name} | ${row.kind} | ${row.cadence} | ${row.itemCount} | ${row.lastSyncAt ?? "never"} |`);
	if (rows.length === 0) lines.push("| *(none)* |  |  | 0 | never |");
	return lines.join("\n");
}

export function formatFeedDigest(feed: FeedEntry, items: readonly FeedItemRow[]): string {
	const lines = [
		`# Feed: ${feed.name}`,
		"",
		`Kind: ${feed.kind}`,
		`Target: ${feed.target}`,
		`Cached items: ${items.length}`,
	];
	if (items.length === 0) {
		lines.push("", "No cached items.");
		return lines.join("\n");
	}
	lines.push("");
	for (const item of items) {
		const handle = item.handle ? ` (@${item.handle.replace(/^@/, "")})` : "";
		lines.push(`## ${item.timestamp} — ${item.author}${handle}`, "", item.text, "", `URL: ${item.url}`, "");
	}
	return lines.join("\n").trimEnd();
}
