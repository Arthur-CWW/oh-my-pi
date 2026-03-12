import {
	closeSync,
	existsSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	rmSync,
	statSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { extname, join } from "node:path";
import type { ExtractedContent } from "../shared/fetch-content-contracts.js";
import { readGitHubCloneConfig } from "./fetch-content-config.js";
import { checkGhAvailable, checkRepoSize, fetchViaApi, showGhHint } from "./github-api.js";

const BINARY_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".bmp",
	".ico",
	".webp",
	".svg",
	".tiff",
	".tif",
	".mp3",
	".mp4",
	".avi",
	".mov",
	".mkv",
	".flv",
	".wmv",
	".wav",
	".ogg",
	".webm",
	".flac",
	".aac",
	".zip",
	".tar",
	".gz",
	".bz2",
	".xz",
	".7z",
	".rar",
	".zst",
	".exe",
	".dll",
	".so",
	".dylib",
	".bin",
	".o",
	".a",
	".lib",
	".woff",
	".woff2",
	".ttf",
	".otf",
	".eot",
	".pdf",
	".doc",
	".docx",
	".xls",
	".xlsx",
	".ppt",
	".pptx",
	".sqlite",
	".db",
	".sqlite3",
	".pyc",
	".pyo",
	".class",
	".jar",
	".war",
	".iso",
	".img",
	".dmg",
]);

const NOISE_DIRS = new Set([
	"node_modules",
	"vendor",
	".next",
	"dist",
	"build",
	"__pycache__",
	".venv",
	"venv",
	".tox",
	".mypy_cache",
	".pytest_cache",
	"target",
	".gradle",
	".idea",
	".vscode",
]);

const MAX_INLINE_FILE_CHARS = 100_000;
const MAX_TREE_ENTRIES = 200;

export interface GitHubUrlInfo {
	readonly owner: string;
	readonly repo: string;
	readonly ref?: string;
	readonly refIsFullSha: boolean;
	readonly path?: string;
	readonly type: "root" | "blob" | "tree";
}

interface CachedClone {
	readonly localPath: string;
	readonly clonePromise: Promise<string | null>;
}

const NON_CODE_SEGMENTS = new Set([
	"issues",
	"pull",
	"pulls",
	"discussions",
	"releases",
	"wiki",
	"actions",
	"settings",
	"security",
	"projects",
	"graphs",
	"compare",
	"commits",
	"tags",
	"branches",
	"stargazers",
	"watchers",
	"network",
	"forks",
	"milestone",
	"labels",
	"packages",
	"codespaces",
	"contribute",
	"community",
	"sponsors",
	"invitations",
	"notifications",
	"insights",
]);

const cloneCache = new Map<string, CachedClone>();

export function clearCloneCache(): void {
	cloneCache.clear();
}

export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}

	if (parsed.hostname !== "github.com") {
		return null;
	}

	const segments = parsed.pathname.split("/").filter(Boolean);
	if (segments.length < 2) {
		return null;
	}

	const owner = segments[0] ?? "";
	const repo = (segments[1] ?? "").replace(/\.git$/, "");
	if (NON_CODE_SEGMENTS.has((segments[2] ?? "").toLowerCase())) {
		return null;
	}
	if (segments.length === 2) {
		return { owner, repo, refIsFullSha: false, type: "root" };
	}

	const action = segments[2];
	if (action !== "blob" && action !== "tree") {
		return null;
	}
	if (segments.length < 4) {
		return null;
	}

	const ref = segments[3] ?? "";
	const path = segments.slice(4).join("/");
	return {
		owner,
		repo,
		ref,
		refIsFullSha: /^[0-9a-f]{40}$/.test(ref),
		path,
		type: action,
	};
}

function cacheKey(owner: string, repo: string, ref?: string): string {
	return ref ? `${owner}/${repo}@${ref}` : `${owner}/${repo}`;
}

function cloneDir(owner: string, repo: string, ref?: string): string {
	const config = readGitHubCloneConfig();
	const dirName = ref ? `${repo}@${ref}` : repo;
	return join(config.clonePath, owner, dirName);
}

function execClone(
	args: ReadonlyArray<string>,
	localPath: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<string | null> {
	return new Promise((resolve) => {
		const child = execFile(args[0] ?? "", args.slice(1), { timeout: timeoutMs }, (error) => {
			if (error) {
				try {
					rmSync(localPath, { recursive: true, force: true });
				} catch {
					// Ignore cleanup failure.
				}
				resolve(null);
				return;
			}
			resolve(localPath);
		});

		if (signal) {
			const onAbort = () => child.kill();
			signal.addEventListener("abort", onAbort, { once: true });
			child.on("exit", () => signal.removeEventListener("abort", onAbort));
		}
	});
}

async function cloneRepo(
	owner: string,
	repo: string,
	ref: string | undefined,
	signal?: AbortSignal,
): Promise<string | null> {
	const config = readGitHubCloneConfig();
	const localPath = cloneDir(owner, repo, ref);

	try {
		rmSync(localPath, { recursive: true, force: true });
	} catch {
		// Ignore cleanup failure.
	}

	const timeoutMs = config.cloneTimeoutSeconds * 1000;
	const hasGh = await checkGhAvailable();
	if (hasGh) {
		const args = [
			"gh",
			"repo",
			"clone",
			`${owner}/${repo}`,
			localPath,
			"--",
			"--depth",
			"1",
			"--single-branch",
		];
		if (ref) {
			args.push("--branch", ref);
		}
		return execClone(args, localPath, timeoutMs, signal);
	}

	showGhHint();
	const gitUrl = `https://github.com/${owner}/${repo}.git`;
	const args = ["git", "clone", "--depth", "1", "--single-branch"];
	if (ref) {
		args.push("--branch", ref);
	}
	args.push(gitUrl, localPath);
	return execClone(args, localPath, timeoutMs, signal);
}

function isBinaryFile(filePath: string): boolean {
	const ext = extname(filePath).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext)) {
		return true;
	}

	let fd: number;
	try {
		fd = openSync(filePath, "r");
	} catch {
		return false;
	}
	try {
		const buffer = Buffer.alloc(512);
		const bytesRead = readSync(fd, buffer, 0, 512, 0);
		for (let index = 0; index < bytesRead; index += 1) {
			if (buffer[index] === 0) {
				return true;
			}
		}
	} catch {
		return false;
	} finally {
		closeSync(fd);
	}
	return false;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function buildTree(rootPath: string): string {
	const entries: string[] = [];

	function walk(dir: string, relPath: string): void {
		if (entries.length >= MAX_TREE_ENTRIES) {
			return;
		}
		let items: string[];
		try {
			items = readdirSync(dir).sort();
		} catch {
			return;
		}

		for (const item of items) {
			if (entries.length >= MAX_TREE_ENTRIES) {
				return;
			}
			if (item === ".git") {
				continue;
			}
			const fullPath = join(dir, item);
			let stat: ReturnType<typeof statSync>;
			try {
				stat = statSync(fullPath);
			} catch {
				continue;
			}
			const rel = relPath ? `${relPath}/${item}` : item;
			if (stat.isDirectory()) {
				if (NOISE_DIRS.has(item)) {
					entries.push(`${rel}/  [skipped]`);
					continue;
				}
				entries.push(`${rel}/`);
				walk(fullPath, rel);
			} else {
				entries.push(rel);
			}
		}
	}

	walk(rootPath, "");
	if (entries.length >= MAX_TREE_ENTRIES) {
		entries.push(`... (truncated at ${MAX_TREE_ENTRIES} entries)`);
	}
	return entries.join("\n");
}

function buildDirListing(rootPath: string, subPath: string): string {
	const targetPath = join(rootPath, subPath);
	const lines: string[] = [];
	let items: string[];
	try {
		items = readdirSync(targetPath).sort();
	} catch {
		return "(directory not readable)";
	}

	for (const item of items) {
		if (item === ".git") {
			continue;
		}
		const fullPath = join(targetPath, item);
		try {
			const stat = statSync(fullPath);
			if (stat.isDirectory()) {
				lines.push(`  ${item}/`);
			} else {
				lines.push(`  ${item}  (${formatFileSize(stat.size)})`);
			}
		} catch {
			lines.push(`  ${item}  (unreadable)`);
		}
	}
	return lines.join("\n");
}

function readReadme(localPath: string): string | null {
	const candidates = ["README.md", "readme.md", "README", "README.txt", "README.rst"];
	for (const name of candidates) {
		const readmePath = join(localPath, name);
		if (!existsSync(readmePath)) {
			continue;
		}
		try {
			const content = readFileSync(readmePath, "utf-8");
			return content.length > 8192
				? content.slice(0, 8192) + "\n\n[README truncated at 8K chars]"
				: content;
		} catch {
			return null;
		}
	}
	return null;
}

function generateContent(localPath: string, info: GitHubUrlInfo): string {
	const lines: string[] = [];
	lines.push(`Repository cloned to: ${localPath}`);
	lines.push("");

	if (info.type === "root") {
		lines.push("## Structure");
		lines.push(buildTree(localPath));
		lines.push("");
		const readme = readReadme(localPath);
		if (readme) {
			lines.push("## README.md");
			lines.push(readme);
			lines.push("");
		}
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}

	if (info.type === "tree") {
		const dirPath = info.path || "";
		const fullDirPath = join(localPath, dirPath);
		if (!existsSync(fullDirPath)) {
			lines.push(`Path \`${dirPath}\` not found in clone. Showing repository root instead.`);
			lines.push("");
			lines.push("## Structure");
			lines.push(buildTree(localPath));
		} else {
			lines.push(`## ${dirPath || "/"}`);
			lines.push(buildDirListing(localPath, dirPath));
		}
		lines.push("");
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}

	const filePath = info.path || "";
	const fullFilePath = join(localPath, filePath);
	if (!existsSync(fullFilePath)) {
		lines.push(`Path \`${filePath}\` not found in clone. Showing repository root instead.`);
		lines.push("");
		lines.push("## Structure");
		lines.push(buildTree(localPath));
		lines.push("");
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}

	const stat = statSync(fullFilePath);
	if (stat.isDirectory()) {
		lines.push(`## ${filePath || "/"}`);
		lines.push(buildDirListing(localPath, filePath));
		lines.push("");
		lines.push("Use `read` and `bash` tools at the path above to explore further.");
		return lines.join("\n");
	}

	if (isBinaryFile(fullFilePath)) {
		const ext = extname(filePath).replace(".", "");
		lines.push(`## ${filePath}`);
		lines.push(
			`Binary file (${ext}, ${formatFileSize(stat.size)}). Use \`read\` or \`bash\` tools at the path above to inspect.`,
		);
		return lines.join("\n");
	}

	const content = readFileSync(fullFilePath, "utf-8");
	lines.push(`## ${filePath}`);
	if (content.length > MAX_INLINE_FILE_CHARS) {
		lines.push(content.slice(0, MAX_INLINE_FILE_CHARS));
		lines.push("");
		lines.push(`[File truncated at 100K chars. Full file: ${fullFilePath}]`);
	} else {
		lines.push(content);
	}
	lines.push("");
	lines.push("Use `read` and `bash` tools at the path above to explore further.");
	return lines.join("\n");
}

async function awaitCachedClone(
	cached: CachedClone,
	url: string,
	owner: string,
	repo: string,
	info: GitHubUrlInfo,
	signal?: AbortSignal,
): Promise<ExtractedContent | null> {
	if (signal?.aborted) {
		return fetchViaApi(url, owner, repo, info);
	}
	const result = await cached.clonePromise;
	if (signal?.aborted) {
		return fetchViaApi(url, owner, repo, info);
	}
	if (result) {
		return {
			url,
			title: info.path ? `${owner}/${repo} - ${info.path}` : `${owner}/${repo}`,
			content: generateContent(result, info),
			error: null,
		};
	}
	return fetchViaApi(url, owner, repo, info);
}

export async function extractGitHub(
	url: string,
	signal?: AbortSignal,
	forceClone?: boolean,
): Promise<ExtractedContent | null> {
	const info = parseGitHubUrl(url);
	if (!info) {
		return null;
	}

	const config = readGitHubCloneConfig();
	if (!config.enabled) {
		return null;
	}

	const key = cacheKey(info.owner, info.repo, info.ref);
	const cached = cloneCache.get(key);
	if (cached) {
		return awaitCachedClone(cached, url, info.owner, info.repo, info, signal);
	}

	if (info.refIsFullSha) {
		return fetchViaApi(
			url,
			info.owner,
			info.repo,
			info,
			"Note: Commit SHA URLs use the GitHub API instead of cloning.",
		);
	}

	if (!forceClone) {
		const sizeKB = await checkRepoSize(info.owner, info.repo);
		if (sizeKB !== null) {
			const sizeMB = sizeKB / 1024;
			if (sizeMB > config.maxRepoSizeMB) {
				const sizeNote =
					`Note: Repository is ${Math.round(sizeMB)}MB (threshold: ${config.maxRepoSizeMB}MB). ` +
					"Showing API-fetched content instead of full clone. Ask the user if they'd like to clone the full repo -- " +
					"if yes, call fetch_content again with the same URL and add forceClone: true to the params.";
				return fetchViaApi(url, info.owner, info.repo, info, sizeNote);
			}
		}
	}

	const cachedAfterSizeCheck = cloneCache.get(key);
	if (cachedAfterSizeCheck) {
		return awaitCachedClone(cachedAfterSizeCheck, url, info.owner, info.repo, info, signal);
	}

	const localPath = cloneDir(info.owner, info.repo, info.ref);
	const clonePromise = cloneRepo(info.owner, info.repo, info.ref, signal);
	cloneCache.set(key, { localPath, clonePromise });

	const cloned = await clonePromise;
	if (!cloned) {
		cloneCache.delete(key);
		return fetchViaApi(url, info.owner, info.repo, info);
	}

	return {
		url,
		title: info.path ? `${info.owner}/${info.repo} - ${info.path}` : `${info.owner}/${info.repo}`,
		content: generateContent(cloned, info),
		error: null,
	};
}
