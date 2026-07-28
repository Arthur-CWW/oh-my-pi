import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { logger } from "@oh-my-pi/pi-utils";

export const DEFAULT_FEED_WATCH_INTERVAL_MS = 90 * 60 * 1000;
export const DEFAULT_NITTER_INSTANCES = [
	"https://nitter.poast.org",
	"https://nitter.privacydev.net",
	"https://nitter.1d4.us",
] as const;

export interface FeedWatcherSource {
	id: string;
	kind: "rss" | "nitter";
	url?: string;
	handle?: string;
	question: string;
}

export const DEFAULT_FEED_WATCHER_SOURCES: readonly FeedWatcherSource[] = [
	{
		id: "thsottiaux",
		kind: "nitter",
		handle: "thsottiaux",
		question: "codex/ChatGPT Pro usage limits, resets, bonus credits, or Fable/model availability announcements?",
	},
	{
		id: "openai-news",
		kind: "rss",
		url: "https://openai.com/news/rss.xml",
		question: "OpenAI model availability announcements, especially Fable, launch windows, extensions, or end dates?",
	},
];

export interface FeedFetchRequest {
	url: string;
	headers: Record<string, string>;
}

export interface FeedFetchResponse {
	status: number;
	body: string;
	headers?: Record<string, string | undefined>;
}

export interface FeedClassification {
	id: string;
	relevant: boolean;
	fact?: string;
	quote?: string;
}

export interface FeedWatcherCompletionOptions {
	model: "smol";
}

export type FeedWatcherCompletion = (prompt: string, options: FeedWatcherCompletionOptions) => Promise<string>;

interface FeedItem {
	id: string;
	title: string;
	link: string;
	published: string;
	text: string;
}

interface SourceState {
	seen: string[];
	etag?: string;
	lastModified?: string;
	lastWorkingNitter?: string;
}

interface WatcherState {
	sources: Record<string, SourceState>;
}

export interface FeedWatcherOptions {
	sources?: readonly FeedWatcherSource[];
	fetch: (request: FeedFetchRequest) => Promise<FeedFetchResponse>;
	complete: FeedWatcherCompletion;
	notice: (message: string) => void;
	irc: (message: string) => void;
	statePath?: string;
	availabilityPath?: string;
	intervalMs?: number;
	nitterInstances?: readonly string[];
	now?: () => Date;
	random?: () => number;
	setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
	clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class FeedWatcher {
	readonly #options: FeedWatcherOptions;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#running = false;
	#loggedFetchFailures = new Set<string>();

	constructor(options: FeedWatcherOptions) {
		this.#options = options;
	}

	start(): void {
		if (this.#timer) return;
		this.#schedule();
	}

	stop(): void {
		if (this.#timer) (this.#options.clearTimeout ?? clearTimeout)(this.#timer);
		this.#timer = undefined;
	}

	async tick(): Promise<FeedClassification[]> {
		if (this.#running) return [];
		this.#running = true;
		try {
			const state = await this.#loadState();
			const batches: Array<{ source: FeedWatcherSource; items: FeedItem[] }> = [];
			for (const source of this.#options.sources ?? DEFAULT_FEED_WATCHER_SOURCES) {
				const sourceState = state.sources[source.id] ?? { seen: [] };
				state.sources[source.id] = sourceState;
				const items = await this.#fetchSource(source, sourceState);
				if (!items) continue;
				const seen = new Set(sourceState.seen);
				const fresh = items.filter(item => !seen.has(item.id));
				const freshIds = new Set(fresh.map(item => item.id));
				sourceState.seen = [...freshIds, ...sourceState.seen.filter(id => !freshIds.has(id))].slice(0, 500);
				if (fresh.length > 0) batches.push({ source, items: fresh.slice(0, 50) });
			}

			const results = batches.length > 0 ? await this.#classify(batches) : [];
			const relevant = results.filter(result => result.relevant);
			if (relevant.length > 0) {
				await this.#appendAvailability(relevant, batches);
				const summary = relevant.map(result => result.fact ?? result.quote ?? result.id).join("; ");
				this.#options.notice(`Feed watcher: ${summary}`);
				this.#options.irc(
					`Feed watcher found ${relevant.length} new relevant update${relevant.length === 1 ? "" : "s"}: ${summary}`,
				);
			}
			await this.#saveState(state);
			return results;
		} finally {
			this.#running = false;
		}
	}

	#schedule(): void {
		const interval = this.#options.intervalMs ?? DEFAULT_FEED_WATCH_INTERVAL_MS;
		const jitter = 0.9 + (this.#options.random ?? Math.random)() * 0.2;
		const schedule = this.#options.setTimeout ?? setTimeout;
		const timer = schedule(
			() => {
				this.#timer = undefined;
				void this.tick().finally(() => this.#schedule());
			},
			Math.round(interval * jitter),
		) as ReturnType<typeof setTimeout>;
		this.#timer = timer;
		timer.unref?.();
	}

	async #fetchSource(source: FeedWatcherSource, state: SourceState): Promise<FeedItem[] | undefined> {
		const urls = source.kind === "rss" ? (source.url ? [source.url] : []) : this.#nitterUrls(source, state);
		for (const url of urls) {
			try {
				const headers: Record<string, string> = { accept: "application/rss+xml, application/atom+xml, text/xml" };
				if (state.etag) headers["if-none-match"] = state.etag;
				if (state.lastModified) headers["if-modified-since"] = state.lastModified;
				const response = await this.#options.fetch({ url, headers });
				if (response.status === 304) return [];
				if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status}`);
				state.etag = response.headers?.etag ?? state.etag;
				state.lastModified = response.headers?.["last-modified"] ?? state.lastModified;
				if (source.kind === "nitter") state.lastWorkingNitter = url;
				this.#loggedFetchFailures.delete(source.id);
				return parseFeed(response.body);
			} catch (error) {
				if (!this.#loggedFetchFailures.has(source.id)) {
					logger.debug("Feed watcher fetch failed; trying fallback", {
						source: source.id,
						url,
						error: String(error),
					});
					this.#loggedFetchFailures.add(source.id);
				}
			}
		}
		return undefined;
	}

	#nitterUrls(source: FeedWatcherSource, state: SourceState): string[] {
		const handle = source.handle;
		if (!handle) return [];
		const encodedHandle = encodeURIComponent(handle);
		const urls = [
			...(this.#options.nitterInstances ?? DEFAULT_NITTER_INSTANCES).map(
				instance => `${instance.replace(/\/$/, "")}/${encodedHandle}/rss`,
			),
			`https://rsshub.app/twitter/user/${encodedHandle}`,
		];
		if (state.lastWorkingNitter) {
			const index = urls.indexOf(state.lastWorkingNitter);
			if (index > 0) urls.unshift(...urls.splice(index, 1));
		}
		return urls;
	}

	async #classify(batches: Array<{ source: FeedWatcherSource; items: FeedItem[] }>): Promise<FeedClassification[]> {
		const payload = batches.flatMap(({ source, items }) =>
			items.map(item => ({ sourceId: source.id, question: source.question, ...item })),
		);
		const prompt = `Classify these feed items. Return ONLY a JSON array with one object per relevant item: {"id": string, "relevant": true, "fact": concise extracted fact preserving every date, "quote": short verbatim quote}. Return [] if none are relevant.\n${JSON.stringify(payload)}`;
		try {
			const text = await this.#options.complete(prompt, { model: "smol" });
			const parsed: unknown = JSON.parse(text.trim().replace(/^```json\s*|\s*```$/g, ""));
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(isClassification);
		} catch (error) {
			logger.debug("Feed watcher classification failed", { error: String(error) });
			return [];
		}
	}

	async #appendAvailability(
		results: FeedClassification[],
		batches: Array<{ source: FeedWatcherSource; items: FeedItem[] }>,
	): Promise<void> {
		const items = new Map(batches.flatMap(batch => batch.items.map(item => [item.id, item] as const)));
		const date = (this.#options.now ?? (() => new Date()))().toISOString().slice(0, 10);
		const rows = results.flatMap(result => {
			const item = items.get(result.id);
			if (!item) return [];
			const quote = (result.quote ?? item.title).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
			const fact = (result.fact ?? "Relevant availability update").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
			return [`| ${date} | ${fact} | “${quote}” | [source](${item.link}) |`];
		});
		if (rows.length === 0) return;
		const file = this.#availabilityPath();
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.appendFile(file, `${rows.join("\n")}\n`, "utf8");
	}

	async #loadState(): Promise<WatcherState> {
		try {
			const parsed: unknown = JSON.parse(await fs.readFile(this.#statePath(), "utf8"));
			if (isWatcherState(parsed)) return parsed;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				logger.debug("Feed watcher state read failed", { error: String(error) });
		}
		return { sources: {} };
	}

	async #saveState(state: WatcherState): Promise<void> {
		const file = this.#statePath();
		await fs.mkdir(path.dirname(file), { recursive: true });
		await Bun.write(file, `${JSON.stringify(state, null, 2)}\n`);
	}

	#statePath(): string {
		return this.#options.statePath ?? path.join(os.homedir(), ".omp", "feed-watcher-state.json");
	}

	#availabilityPath(): string {
		return (
			this.#options.availabilityPath ?? path.join(os.homedir(), "agents", "docs", "state", "model-availability.md")
		);
	}
}

export function parseFeedWatcherSources(json: string): readonly FeedWatcherSource[] {
	try {
		const value: unknown = JSON.parse(json);
		if (!Array.isArray(value)) return DEFAULT_FEED_WATCHER_SOURCES;
		const sources = value.filter((item): item is FeedWatcherSource => {
			if (!item || typeof item !== "object") return false;
			const source = item as Record<string, unknown>;
			return (
				typeof source.id === "string" &&
				(source.kind === "rss" || source.kind === "nitter") &&
				typeof source.question === "string" &&
				(source.kind === "rss" ? typeof source.url === "string" : typeof source.handle === "string")
			);
		});
		return sources.length > 0 ? sources : DEFAULT_FEED_WATCHER_SOURCES;
	} catch {
		return DEFAULT_FEED_WATCHER_SOURCES;
	}
}

export function parseFeed(xml: string): FeedItem[] {
	const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) ?? [];
	return blocks.flatMap(block => {
		const title = field(block, "title");
		const link = field(block, "link") || /<link\b[^>]*href=["']([^"']+)/i.exec(block)?.[1] || "";
		const id = field(block, "guid") || field(block, "id") || link || title;
		if (!id) return [];
		return [
			{
				id,
				title,
				link,
				published: field(block, "pubDate") || field(block, "published") || field(block, "updated"),
				text: field(block, "description") || field(block, "summary") || field(block, "content"),
			},
		];
	});
}

function field(block: string, tag: string): string {
	const value = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block)?.[1] ?? "";
	return decodeXml(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "))
		.replace(/\s+/g, " ")
		.trim();
}

function decodeXml(value: string): string {
	return value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function isClassification(value: unknown): value is FeedClassification {
	if (!value || typeof value !== "object") return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.id === "string" &&
		item.relevant === true &&
		(item.fact === undefined || typeof item.fact === "string") &&
		(item.quote === undefined || typeof item.quote === "string")
	);
}

function isWatcherState(value: unknown): value is WatcherState {
	return Boolean(
		value && typeof value === "object" && "sources" in value && typeof (value as WatcherState).sources === "object",
	);
}
