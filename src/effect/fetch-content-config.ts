import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Exit, Schema } from "effect";

const WEB_SEARCH_CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

const YouTubeConfigSchema = Schema.Struct({
	enabled: Schema.optional(Schema.Boolean),
	preferredModel: Schema.optional(Schema.String),
});

const VideoConfigSchema = Schema.Struct({
	enabled: Schema.optional(Schema.Boolean),
	preferredModel: Schema.optional(Schema.String),
	maxSizeMB: Schema.optional(Schema.Number),
});

const GitHubCloneConfigSchema = Schema.Struct({
	enabled: Schema.optional(Schema.Boolean),
	maxRepoSizeMB: Schema.optional(Schema.Number),
	cloneTimeoutSeconds: Schema.optional(Schema.Number),
	clonePath: Schema.optional(Schema.String),
});

export interface YouTubeConfig {
	readonly enabled: boolean;
	readonly preferredModel: string;
}

export interface VideoConfig {
	readonly enabled: boolean;
	readonly preferredModel: string;
	readonly maxSizeMB: number;
}

export interface GitHubCloneConfig {
	readonly enabled: boolean;
	readonly maxRepoSizeMB: number;
	readonly cloneTimeoutSeconds: number;
	readonly clonePath: string;
}

const DEFAULT_YOUTUBE_CONFIG: YouTubeConfig = {
	enabled: true,
	preferredModel: "gemini-3-flash-preview",
};

const DEFAULT_VIDEO_CONFIG: VideoConfig = {
	enabled: true,
	preferredModel: "gemini-3-flash-preview",
	maxSizeMB: 50,
};

const DEFAULT_GITHUB_CLONE_CONFIG: GitHubCloneConfig = {
	enabled: true,
	maxRepoSizeMB: 350,
	cloneTimeoutSeconds: 30,
	clonePath: "/tmp/pi-github-repos",
};

let cachedConfigJson: unknown | null = null;

function loadConfigJson(): unknown {
	if (cachedConfigJson !== null) {
		return cachedConfigJson;
	}
	if (existsSync(WEB_SEARCH_CONFIG_PATH)) {
		try {
			cachedConfigJson = JSON.parse(readFileSync(WEB_SEARCH_CONFIG_PATH, "utf-8")) as unknown;
			return cachedConfigJson;
		} catch {
			// Fall back to empty config object.
		}
	}
	cachedConfigJson = {};
	return cachedConfigJson;
}

function getObjectField(value: unknown, key: string): unknown {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return Reflect.get(value, key);
}

function decodeSection<S extends Schema.Top & { readonly DecodingServices: never }>(
	schema: S,
	value: unknown,
): S["Type"] | null {
	const decoded = Schema.decodeUnknownExit(schema)(value);
	return Exit.isSuccess(decoded) ? decoded.value : null;
}

export function readYouTubeConfig(): YouTubeConfig {
	const decoded = decodeSection(YouTubeConfigSchema, getObjectField(loadConfigJson(), "youtube"));
	return {
		...DEFAULT_YOUTUBE_CONFIG,
		...(decoded ?? {}),
	};
}

export function readVideoConfig(): VideoConfig {
	const decoded = decodeSection(VideoConfigSchema, getObjectField(loadConfigJson(), "video"));
	return {
		...DEFAULT_VIDEO_CONFIG,
		...(decoded ?? {}),
	};
}

export function readGitHubCloneConfig(): GitHubCloneConfig {
	const decoded = decodeSection(
		GitHubCloneConfigSchema,
		getObjectField(loadConfigJson(), "githubClone"),
	);
	return {
		...DEFAULT_GITHUB_CLONE_CONFIG,
		...(decoded ?? {}),
	};
}
