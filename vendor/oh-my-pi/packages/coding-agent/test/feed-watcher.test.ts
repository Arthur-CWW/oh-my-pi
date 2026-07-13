import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { FeedWatcher, type FeedWatcherCompletion, type FeedWatcherSource } from "../src/feed-watcher";

const SOURCE: FeedWatcherSource = {
	id: "news",
	kind: "rss",
	url: "https://example.test/rss",
	question: "availability?",
};
const RSS = `<?xml version="1.0"?><rss><channel><item><guid>item-1</guid><title>Fable extended</title><link>https://example.test/1</link><pubDate>Mon, 13 Jul 2026 00:00:00 GMT</pubDate><description>Fable is available until July 19, 2026.</description></item></channel></rss>`;
const dirs: string[] = [];

async function tempPaths(): Promise<{ statePath: string; availabilityPath: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "feed-watcher-"));
	dirs.push(dir);
	return { statePath: path.join(dir, "state.json"), availabilityPath: path.join(dir, "availability.md") };
}

afterEach(async () => {
	await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe("FeedWatcher", () => {
	test("detects a new item, appends its dated fact and quote, and persists its cursor across restart", async () => {
		const paths = await tempPaths();
		let completions = 0;
		const complete: FeedWatcherCompletion = async (_prompt, options) => {
			expect(options.model).toBe("smol");
			completions++;
			return JSON.stringify([
				{
					id: "item-1",
					relevant: true,
					fact: "Fable available until July 19, 2026",
					quote: "Fable is available until July 19, 2026.",
				},
			]);
		};
		const notices: string[] = [];
		const messages: string[] = [];
		const options = {
			...paths,
			sources: [SOURCE],
			fetch: async () => ({ status: 200, body: RSS }),
			complete,
			notice: (message: string) => notices.push(message),
			irc: (message: string) => messages.push(message),
			now: () => new Date("2026-07-13T10:00:00.000Z"),
		};
		await new FeedWatcher(options).tick();
		await new FeedWatcher(options).tick();

		expect(completions).toBe(1);
		expect(notices).toHaveLength(1);
		expect(messages).toHaveLength(1);
		expect(await fs.readFile(paths.availabilityPath, "utf8")).toContain(
			"| 2026-07-13 | Fable available until July 19, 2026 | “Fable is available until July 19, 2026.” | [source](https://example.test/1) |",
		);
	});

	test("marks irrelevant items seen without writing or notifying", async () => {
		const paths = await tempPaths();
		let notices = 0;
		const watcher = new FeedWatcher({
			...paths,
			sources: [SOURCE],
			fetch: async () => ({ status: 200, body: RSS }),
			complete: async () => "[]",
			notice: () => notices++,
			irc: () => notices++,
		});
		expect(await watcher.tick()).toEqual([]);
		expect(notices).toBe(0);
		await expect(fs.readFile(paths.availabilityPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		const state = JSON.parse(await fs.readFile(paths.statePath, "utf8"));
		expect(state.sources.news.seen).toEqual(["item-1"]);
	});

	test("falls back between nitter instances and caches the working instance", async () => {
		const paths = await tempPaths();
		const urls: string[] = [];
		const source: FeedWatcherSource = { id: "twitter", kind: "nitter", handle: "thsottiaux", question: "resets?" };
		const options = {
			...paths,
			sources: [source],
			nitterInstances: ["https://dead.test", "https://works.test"],
			fetch: async ({ url }: { url: string }) => {
				urls.push(url);
				return url.startsWith("https://dead.test") ? { status: 503, body: "" } : { status: 200, body: RSS };
			},
			complete: async () => "[]",
			notice: () => {},
			irc: () => {},
		};
		await new FeedWatcher(options).tick();
		await new FeedWatcher(options).tick();
		expect(urls).toEqual([
			"https://dead.test/thsottiaux/rss",
			"https://works.test/thsottiaux/rss",
			"https://works.test/thsottiaux/rss",
		]);
	});
});
