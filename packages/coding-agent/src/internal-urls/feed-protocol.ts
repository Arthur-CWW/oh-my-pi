import { loadFeedRegistry, renderFeedResource, resolveFeedSurfacePaths } from "../feeds";
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, UrlCompletion } from "./types";

/** Read-only digest protocol backed by the availability-watcher cache. */
export class FeedProtocolHandler implements ProtocolHandler {
	readonly scheme = "feed";
	readonly immutable = true;

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		const name = url.rawHost || url.hostname;
		if (url.pathname && url.pathname !== "/") throw new Error(`feed:// accepts only feed://<name>: ${url.href}`);
		let decodedName: string | undefined;
		try {
			decodedName = name ? decodeURIComponent(name) : undefined;
		} catch {
			throw new Error(`Invalid feed name encoding: ${name}`);
		}
		const paths = await resolveFeedSurfacePaths(context?.cwd ?? process.cwd());
		const content = await renderFeedResource(decodedName, paths);
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf8"),
			notes: ["Read-only cached feed digest; network sync is never triggered."],
		};
	}

	async complete(_query: string): Promise<UrlCompletion[]> {
		try {
			const paths = await resolveFeedSurfacePaths(process.cwd());
			const registry = await loadFeedRegistry(paths.registryPath);
			return registry.feeds.map(feed => ({ value: feed.name, label: feed.name, description: feed.kind }));
		} catch {
			return [];
		}
	}
}
