import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isCompiledBinary, VERSION } from "@oh-my-pi/pi-utils";
import { commandConsumed } from "./helpers/parse";
import type { ParsedSlashCommand, SlashCommandResult, SlashCommandRuntime, SlashCommandSpec } from "./types";

const SHA256 = /^[a-f0-9]{64}$/;
const FORK_COMMIT = /\+fork\.([0-9a-f]{7,40}|unknown)$/i;
const DEFAULT_RELEASE_REGISTRY_PATH = path.join(os.homedir(), ".bun", "bin", ".omp-release-registry.json");

type BlessedStatus = "blessed" | "not blessed" | "unknown";

export interface VersionViewModel {
	readonly version: string;
	readonly binarySha256: string;
	readonly sourceCommit: string;
	readonly blessedStatus: BlessedStatus;
	readonly sessionStartedAt: string;
}

export interface VersionViewModelOptions {
	readonly compiled?: boolean;
	readonly executablePath?: string;
	readonly registryPath?: string;
	readonly version?: string;
	readonly sourceCommit?: string;
	readonly sessionStartedAt?: string;
}

interface ReleaseRegistry {
	readonly stable: string | null;
}

const binaryDigestCache = new Map<string, Promise<string>>();

async function sha256File(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const stream = createReadStream(filePath);
	for await (const chunk of stream) hash.update(chunk);
	return hash.digest("hex");
}

function cachedBinaryDigest(filePath: string): Promise<string> {
	const cached = binaryDigestCache.get(filePath);
	if (cached) return cached;
	const digest = sha256File(filePath);
	binaryDigestCache.set(filePath, digest);
	return digest;
}

async function readReleaseRegistry(registryPath: string): Promise<ReleaseRegistry | undefined> {
	try {
		const parsed: unknown = JSON.parse(await fs.readFile(registryPath, "utf8"));
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const stable = (parsed as { stable?: unknown }).stable;
		return stable === null || (typeof stable === "string" && SHA256.test(stable)) ? { stable } : undefined;
	} catch {
		return undefined;
	}
}

function sourceCommitFromVersion(version: string): string {
	return FORK_COMMIT.exec(version)?.[1] ?? "-";
}

function resolveBlessedStatus(binarySha256: string, registry: ReleaseRegistry | undefined): BlessedStatus {
	if (binarySha256 === "-" || !registry?.stable) return "unknown";
	return registry.stable === binarySha256 ? "blessed" : "not blessed";
}

export async function buildVersionViewModel(options: VersionViewModelOptions = {}): Promise<VersionViewModel> {
	const version = options.version ?? VERSION;
	const binarySha256 =
		(options.compiled ?? isCompiledBinary())
			? await cachedBinaryDigest(options.executablePath ?? process.execPath).catch(() => "-")
			: "-";
	const registry = await readReleaseRegistry(options.registryPath ?? DEFAULT_RELEASE_REGISTRY_PATH);
	return {
		version,
		binarySha256,
		sourceCommit: options.sourceCommit ?? sourceCommitFromVersion(version),
		blessedStatus: resolveBlessedStatus(binarySha256, registry),
		sessionStartedAt: options.sessionStartedAt ?? "-",
	};
}

export function formatVersion(viewModel: VersionViewModel): string {
	return [
		"OMP version",
		`  binary: ${viewModel.version}`,
		`  sha256: ${viewModel.binarySha256}`,
		`  source commit: ${viewModel.sourceCommit}`,
		`  blessed: ${viewModel.blessedStatus}`,
		`  session started: ${viewModel.sessionStartedAt}`,
	].join("\n");
}

export async function handleVersionCommand(
	_command: ParsedSlashCommand,
	runtime: SlashCommandRuntime,
): Promise<SlashCommandResult> {
	const viewModel = await buildVersionViewModel({ sessionStartedAt: runtime.sessionManager.getHeader()?.timestamp });
	await runtime.output(formatVersion(viewModel));
	return commandConsumed();
}

export const VERSION_COMMAND_SPEC: SlashCommandSpec = {
	name: "version",
	description: "Show binary, source, and session version details",
	acpDescription: "Show binary and source version details",
	handle: handleVersionCommand,
};
