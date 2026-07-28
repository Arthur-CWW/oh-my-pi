import { Result, Schema } from "effect"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { hostname } from "node:os"
import { CellProvisionError } from "./errors"
import type { InputHash } from "./manifest"

export interface CapturedCommand {
	readonly ok: boolean
	readonly stdout: string
	readonly stderr: string
	readonly status: number
}

export function capture(argv: readonly string[], cwd?: string): CapturedCommand {
	const [command, ...args] = argv
	if (command === undefined) return { ok: false, stdout: "", stderr: "empty argv", status: -1 }
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	})
	return {
		ok: result.status === 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
		status: result.status ?? -1,
	}
}

const FlakeMetadataSchema = Schema.Struct({
	path: Schema.String,
	locked: Schema.Struct({
		narHash: Schema.String,
		lastModified: Schema.optionalKey(Schema.Int),
	}),
})
const decodeFlakeMetadata = Schema.decodeUnknownResult(Schema.fromJsonString(FlakeMetadataSchema))

export interface ResolvedNixpkgs {
	readonly storePath: string
	readonly narHash: string
	readonly lastModified: number | null
	readonly nixVersion: string
}

/**
 * Resolves the `nixpkgs` flake reference this host is pinned to. The runner never fetches a
 * moving reference: whatever the registry resolves to is recorded by store path and NAR hash,
 * so a rerun on the same host is bit-identical and a rerun elsewhere is provably different.
 */
export function resolveNixpkgs(reference: string): ResolvedNixpkgs {
	const version = capture(["nix", "--version"])
	if (!version.ok) {
		throw new CellProvisionError({
			phase: "resolve-nixpkgs",
			message: "nix is not available on this host",
			detail: version.stderr.trim(),
		})
	}
	const metadata = capture(["nix", "flake", "metadata", reference, "--json"])
	if (!metadata.ok) {
		throw new CellProvisionError({
			phase: "resolve-nixpkgs",
			message: `could not resolve flake reference ${reference}`,
			detail: metadata.stderr.trim().slice(0, 1024),
		})
	}
	const decoded = decodeFlakeMetadata(metadata.stdout)
	if (Result.isFailure(decoded)) {
		throw new CellProvisionError({
			phase: "resolve-nixpkgs",
			message: "nix flake metadata returned an unexpected shape",
			detail: metadata.stdout.slice(0, 512),
		})
	}
	return {
		storePath: decoded.success.path,
		narHash: decoded.success.locked.narHash,
		lastModified: decoded.success.locked.lastModified ?? null,
		nixVersion: version.stdout.trim(),
	}
}

export interface GitProvenance {
	readonly commit: string
	readonly dirty: boolean
	readonly describe: string
}

export function resolveGit(cwd: string): GitProvenance {
	const commit = capture(["git", "rev-parse", "HEAD"], cwd)
	const status = capture(["git", "status", "--porcelain"], cwd)
	const described = capture(["git", "describe", "--always", "--dirty"], cwd)
	return {
		commit: commit.ok ? commit.stdout.trim() : "unknown",
		dirty: status.ok ? status.stdout.trim().length > 0 : true,
		describe: described.ok ? described.stdout.trim() : "unknown",
	}
}

export function sha256OfFile(path: string): { sha256: string; bytes: number } {
	const bytes = readFileSync(path)
	return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength }
}

export function sha256OfText(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex")
}

/**
 * Content hash of a directory tree: paths and file digests folded in sorted order, so the
 * value is stable across checkouts and independent of inode or mtime noise.
 */
export function sha256OfTree(root: string): { sha256: string; bytes: number } {
	const digest = createHash("sha256")
	let total = 0
	const walk = (directory: string, prefix: string): void => {
		const entries = readdirSync(directory).sort()
		for (const entry of entries) {
			const absolute = join(directory, entry)
			const relative = prefix.length === 0 ? entry : `${prefix}/${entry}`
			if (statSync(absolute).isDirectory()) {
				walk(absolute, relative)
				continue
			}
			const file = sha256OfFile(absolute)
			total += file.bytes
			digest.update(`${relative}\u0000${file.sha256}\n`, "utf8")
		}
	}
	walk(root, "")
	return { sha256: digest.digest("hex"), bytes: total }
}

export function inputHash(name: string, kind: InputHash["kind"], path: string): InputHash {
	const isDirectory = statSync(path).isDirectory()
	const { sha256, bytes } = isDirectory ? sha256OfTree(path) : sha256OfFile(path)
	return { name, kind, path, bytes, sha256 }
}

export interface HostProvenance {
	readonly hostname: string
	readonly kernel: string
	readonly arch: string
	readonly qemuVersion: string
}

export function resolveHost(qemuVersion: string): HostProvenance {
	const kernel = capture(["uname", "-sr"])
	const arch = capture(["uname", "-m"])
	return {
		hostname: hostname(),
		kernel: kernel.ok ? kernel.stdout.trim() : "unknown",
		arch: arch.ok ? arch.stdout.trim() : "unknown",
		qemuVersion,
	}
}
