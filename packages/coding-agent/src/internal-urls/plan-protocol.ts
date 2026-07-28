import * as fs from "node:fs/promises";
import { isEnoent } from "@oh-my-pi/pi-utils";
import { AgentRegistry } from "../registry/agent-registry";
import { resolveLocalUrlToPath } from "./local-protocol";
import { decodePlanArtifactEntry, type DecodedPlanArtifactEntry } from "../plan-mode/plan-artifact";
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, UrlCompletion } from "./types";

function artifactsDirFrom(context?: ResolveContext): string | undefined {
	const pinned = context?.localProtocolOptions?.getArtifactsDir?.();
	if (pinned) return pinned;
	const main = AgentRegistry.global().list().find(ref => ref.kind === "main");
	return main?.session?.sessionManager.getArtifactsDir() ?? main?.sessionFile?.slice(0, -6);
}

async function readPlanEntries(artifactsDir: string): Promise<DecodedPlanArtifactEntry[]> {
	let raw: string;
	try {
		raw = await fs.readFile(`${artifactsDir}.jsonl`, "utf8");
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}

	const entries: DecodedPlanArtifactEntry[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const decoded = decodePlanArtifactEntry(JSON.parse(line) as unknown);
			if (decoded) entries.push(decoded);
		} catch {
			// One malformed journal line must not hide later valid plan references.
		}
	}
	return entries;
}

export class PlanProtocolHandler implements ProtocolHandler {
	readonly scheme = "plan";
	readonly immutable = true;

	async resolve(url: InternalUrl, context?: ResolveContext): Promise<InternalResource> {
		const artifactsDir = artifactsDirFrom(context);
		if (!artifactsDir) throw new Error("No session - plan:// unavailable");

		const selector = url.rawHost || url.hostname;
		if (!selector) throw new Error("plan:// URL requires an artifact ID or latest");
		const entries = await readPlanEntries(artifactsDir);
		const entry = selector === "latest" ? entries.at(-1) : entries.find(candidate => candidate.id === selector);
		if (!entry) {
			throw new Error(
				selector === "latest"
					? "No approved plan artifact exists in this session"
					: `Plan artifact ${selector} not found in this session`,
			);
		}

		const sourcePath = resolveLocalUrlToPath(entry.data.localPath, {
			getArtifactsDir: () => artifactsDir,
		});
		let content: string;
		try {
			content = await Bun.file(sourcePath).text();
		} catch (error) {
			if (isEnoent(error)) throw new Error(`Plan artifact file is missing: ${entry.data.localPath}`);
			throw error;
		}
		return {
			url: url.href,
			content,
			contentType: "text/markdown",
			size: Buffer.byteLength(content, "utf-8"),
			sourcePath,
			notes: [`Approved plan: ${entry.data.title}`, `Journal entry: ${entry.id}`],
		};
	}

	complete(): Promise<UrlCompletion[]> {
		return Promise.resolve([{ value: "latest", label: "latest approved plan" }]);
	}
}
