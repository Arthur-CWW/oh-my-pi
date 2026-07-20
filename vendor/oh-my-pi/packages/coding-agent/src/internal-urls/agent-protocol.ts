/**
 * Protocol handler for agent:// URLs.
 *
 * Resolves agent output IDs against the artifacts directories of every active
 * session. Parents and subagents share outputs via this registry: a subagent
 * can read its parent's output IDs because both sessions are registered in
 * the shared context.
 *
 * URL forms:
 * - agent://<id> - Full output content
 * - agent://<id>/<path> - JSON extraction via path form
 * - agent://<id>?q=<query> - JSON extraction via query form
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { AgentRegistry } from "../registry/agent-registry";
import { formatIdPreview } from "./id-preview";
import { applyQuery, pathToQuery } from "./json-query";
import { listArchivedChildHistories } from "./history-protocol";
import { artifactsDirsFromRegistry } from "./registry-helpers";
import type { InternalResource, InternalUrl, ProtocolHandler, UrlCompletion } from "./types";

/**
 * Handler for agent:// URLs.
 *
 * Resolves output IDs like "reviewer_0" to their artifact files,
 * with optional JSON extraction.
 */
export class AgentProtocolHandler implements ProtocolHandler {
	readonly scheme = "agent";
	readonly immutable = true;

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const outputId = url.rawHost || url.hostname;
		if (!outputId) {
			throw new Error("agent:// URL requires an output ID: agent://<id>");
		}

		const urlPath = url.pathname;
		const queryParam = url.searchParams.get("q");
		const hasPathExtraction = urlPath && urlPath !== "/" && urlPath !== "";
		const hasQueryExtraction = queryParam !== null && queryParam !== "";

		if (hasPathExtraction && hasQueryExtraction) {
			throw new Error("agent:// URL cannot combine path extraction with ?q=");
		}

		const registry = AgentRegistry.global();
		const refs = registry.list();
		const knownRef = registry.get(outputId);

		const dirs = artifactsDirsFromRegistry();


		let foundPath: string | undefined;
		let anyDirExists = false;
		const availableIds = new Set<string>();

		for (const dir of dirs) {
			try {
				await fs.stat(dir);
				anyDirExists = true;
			} catch (err) {
				if (isEnoent(err)) continue;
				throw err;
			}
			const candidate = path.join(dir, `${outputId}.md`);
			try {
				await fs.stat(candidate);
				foundPath = candidate;
				break;
			} catch (err) {
				if (!isEnoent(err)) throw err;
				try {
					const files = await fs.readdir(dir);
					for (const f of files) {
						if (f.endsWith(".md")) availableIds.add(f.replace(/\.md$/, ""));
					}
				} catch {
					// Listing failures are non-fatal; continue searching.
				}
			}
		}

		if (!foundPath) {
			const archives = await listArchivedChildHistories(refs);
			const archive = archives.find(candidate => candidate.id === outputId);
			if (knownRef) {
				throw new Error(
					[
						`Agent output unavailable: ${outputId}`,
						`Status: ${knownRef.status}`,
						`Final output is not finalized or is unavailable at agent://${outputId}.`,
						`Read the transcript at history://${outputId}.`,
					].join("\n"),
				);
			}
			if (archive) {
				throw new Error(
					[
						`Agent output unavailable: ${outputId}`,
						`Status: archived (${archive.reason})`,
						`No final output is available at agent://${outputId}.`,
						`Read the archived transcript at history://${outputId}.`,
					].join("\n"),
				);
			}
			const knownIds = [...refs.map(ref => ref.id), ...archives.map(candidate => candidate.id)];
			const artifactsNote = anyDirExists ? "" : "\nNo artifacts directory is currently available.";
			throw new Error(
				`Not found: ${outputId}\nAvailable finalized outputs: ${formatIdPreview(availableIds)}\nKnown agents: ${formatIdPreview(knownIds)}${artifactsNote}\nList all agents with history://`,
			);
		}

		const rawContent = await Bun.file(foundPath).text();
		const notes: string[] = [];
		let content = rawContent;
		let contentType: InternalResource["contentType"] = "text/markdown";

		if (hasPathExtraction || hasQueryExtraction) {
			let jsonValue: unknown;
			try {
				jsonValue = JSON.parse(rawContent);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				throw new Error(`Output ${outputId} is not valid JSON: ${message}`);
			}

			const query = hasPathExtraction ? pathToQuery(urlPath) : queryParam!;
			if (query) {
				const extracted = applyQuery(jsonValue, query);
				try {
					content = JSON.stringify(extracted, null, 2) ?? "null";
				} catch {
					content = String(extracted);
				}
				notes.push(`Extracted: ${query}`);
			} else {
				content = JSON.stringify(jsonValue, null, 2);
			}
			contentType = "application/json";
		}

		return {
			url: url.href,
			content,
			contentType,
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath: foundPath,
			notes,
		};
	}

	async complete(): Promise<UrlCompletion[]> {
		const ids = new Set<string>();
		for (const dir of artifactsDirsFromRegistry()) {
			let files: string[];
			try {
				files = await fs.readdir(dir);
			} catch (err) {
				if (isEnoent(err)) continue;
				throw err;
			}
			for (const f of files) {
				if (f.endsWith(".md")) ids.add(f.slice(0, -3));
			}
		}
		return [...ids].sort().map(value => ({ value }));
	}
}
