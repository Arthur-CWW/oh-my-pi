import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	appendFeedEntry,
	buildFeedsListViewModel,
	type FeedSurfacePaths,
	formatFeedDigest,
	inferFeedEntry,
	inferFeedKind,
	loadFeedRegistry,
	renderFeedResource,
} from "../src/feeds";

async function fixturePaths(): Promise<{ readonly root: string; readonly paths: FeedSurfacePaths }> {
	const root = await mkdtemp(path.join(os.tmpdir(), "omp-feed-surface-"));
	return {
		root,
		paths: {
			registryPath: path.join(root, "feeds.yml"),
			databasePath: path.join(root, "feeds.sqlite"),
		},
	};
}

describe("feed surface helpers", () => {
	it("infers nitter, RSS, and page-hash kinds", () => {
		expect(inferFeedKind("@teortaxes")).toBe("nitter-handle");
		expect(inferFeedEntry("https://x.com/teortaxes")).toMatchObject({ kind: "nitter-handle", target: "teortaxes" });
		expect(inferFeedKind("https://example.com/updates/feed.xml")).toBe("rss");
		expect(inferFeedKind("https://example.com/news")).toBe("page-hash");
	});

	it("appends a YAML entry without rewriting existing comments or order", async () => {
		const { root, paths } = await fixturePaths();
		try {
			await writeFile(
				paths.registryPath,
				[
					"feeds:",
					"  # keep this comment",
					"  - name: first",
					"    kind: rss",
					"    target: https://example.com/feed.xml",
					"    cadence: daily",
					"    classifierProfile: availability",
					"",
				].join("\n"),
			);
			await appendFeedEntry(paths.registryPath, inferFeedEntry("@second"));
			const text = await readFile(paths.registryPath, "utf8");
			const registry = await loadFeedRegistry(paths.registryPath);
			expect(text).toContain("# keep this comment");
			expect(text.indexOf("name: first")).toBeLessThan(text.indexOf('name: "second"'));
			expect(registry.feeds.map(feed => feed.name)).toEqual(["first", "second"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("renders newest cached items and list view-model state", async () => {
		const { root, paths } = await fixturePaths();
		const database = new Database(paths.databasePath);
		try {
			await writeFile(
				paths.registryPath,
				JSON.stringify(
					{
						feeds: [
							{
								name: "thsottiaux",
								kind: "nitter-handle",
								target: "thsottiaux",
								cadence: "hourly",
								classifierProfile: "availability",
							},
							{
								name: "anthropic-news",
								kind: "page-hash",
								target: "https://www.anthropic.com/news",
								cadence: "daily",
								classifierProfile: "availability",
							},
						],
					},
					null,
					2,
				),
			);
			database.exec(
				"CREATE TABLE public_source_records (handle TEXT, id TEXT, author TEXT, timestamp TEXT, text TEXT, source_url TEXT); CREATE TABLE public_source_state (handle TEXT, last_synced_at TEXT); CREATE TABLE feed_state (feed_name TEXT, last_synced_at TEXT);",
			);
			database
				.query("INSERT INTO public_source_records VALUES (?,?,?,?,?,?)")
				.run("thsottiaux", "old", "Author", "2026-07-11T00:00:00Z", "older post", "https://x.com/old");
			database
				.query("INSERT INTO public_source_records VALUES (?,?,?,?,?,?)")
				.run("thsottiaux", "new", "Author", "2026-07-12T00:00:00Z", "weekly reset post", "https://x.com/new");
			database.query("INSERT INTO feed_state VALUES (?,?)").run("thsottiaux", "2026-07-12T01:00:00Z");
			const rows = await buildFeedsListViewModel(paths);
			expect(rows[0]).toMatchObject({ name: "thsottiaux", itemCount: 2, lastSyncAt: "2026-07-12T01:00:00Z" });
			const digest = await renderFeedResource("thsottiaux", paths);
			expect(digest.indexOf("2026-07-12T00:00:00Z")).toBeLessThan(digest.indexOf("2026-07-11T00:00:00Z"));
			expect(digest).toContain("weekly reset post");
			expect(formatFeedDigest(rows[0]!, [])).toContain("No cached items.");
		} finally {
			database.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});
