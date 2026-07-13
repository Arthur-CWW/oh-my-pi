import * as path from "node:path";
import {
	appendFeedEntry,
	buildFeedsListViewModel,
	type FeedCadence,
	formatFeedsList,
	inferFeedEntry,
	loadFeedRegistry,
	resolveFeedSurfacePaths,
} from "../feeds";
import { commandConsumed, parseSubcommand, usage } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime } from "./types";

const FEEDS_USAGE = "Usage: /feeds [list|add <handle-or-url> [--name n] [--cadence hourly|daily]|sync [name]]";

export async function handleFeedsCommand(
	command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
): Promise<SlashCommandResult> {
	const { verb, rest } = parseSubcommand(command.args);
	if (!verb || verb === "list") {
		if (verb === "list" && rest) return usage(FEEDS_USAGE, runtime);
		try {
			const paths = await resolveFeedSurfacePaths(runtime.cwd);
			const rows = await buildFeedsListViewModel(paths);
			await runtime.output(formatFeedsList(rows));
		} catch (error) {
			await runtime.output(`Feeds list failed: ${errorMessage(error)}`);
		}
		return commandConsumed();
	}
	if (verb === "add") {
		try {
			const paths = await resolveFeedSurfacePaths(runtime.cwd);
			const { target, name, cadence } = parseAddArgs(rest);
			const entry = inferFeedEntry(target, { name, cadence });
			await appendFeedEntry(paths.registryPath, entry);
			await runtime.output(`Added feed to ${paths.registryPath}:\n${JSON.stringify(entry, null, 2)}`);
		} catch (error) {
			await runtime.output(`Feeds add failed: ${errorMessage(error)}`);
		}
		return commandConsumed();
	}
	if (verb === "sync") {
		try {
			const paths = await resolveFeedSurfacePaths(runtime.cwd);
			const name = rest.trim() || undefined;
			if (name) {
				const registry = await loadFeedRegistry(paths.registryPath);
				if (!registry.feeds.some(feed => feed.name === name)) throw new Error(`Unknown feed: ${name}`);
			}
			const output = await runAvailabilitySync(path.dirname(paths.registryPath));
			await runtime.output(name ? `Requested sync for ${name}.\n${output}` : output);
		} catch (error) {
			await runtime.output(`Feeds sync failed: ${errorMessage(error)}`);
		}
		return commandConsumed();
	}
	return usage(FEEDS_USAGE, runtime);
}

interface ParsedAddArgs {
	readonly target: string;
	readonly name?: string;
	readonly cadence?: FeedCadence;
}

function parseAddArgs(input: string): ParsedAddArgs {
	const tokens = input.trim().split(/\s+/).filter(Boolean);
	const target = tokens.shift();
	if (!target) throw new Error("Feed target is required");
	let name: string | undefined;
	let cadence: FeedCadence | undefined;
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index];
		if (token === "--name") {
			name = tokens[++index];
			if (!name) throw new Error("--name requires a value");
			continue;
		}
		if (token === "--cadence") {
			const value = tokens[++index];
			if (value !== "hourly" && value !== "daily") throw new Error("--cadence must be hourly or daily");
			cadence = value;
			continue;
		}
		throw new Error(`Unknown option: ${token}`);
	}
	return { target, name, cadence };
}

async function runAvailabilitySync(packageRoot: string): Promise<string> {
	const process = Bun.spawn(["bun", "run", "availability:sync"], {
		cwd: packageRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	const output = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
	if (exitCode !== 0) throw new Error(output || `availability:sync exited with status ${exitCode}`);
	return output || "availability:sync completed (no output)";
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
