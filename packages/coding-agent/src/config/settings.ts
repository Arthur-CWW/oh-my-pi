/**
 * Settings singleton with sync get/set and background persistence.
 *
 * Usage:
 *   import { settings } from "./settings";
 *
 *   const enabled = settings.get("compaction.enabled");  // sync read
 *   settings.set("theme.dark", "titanium");               // sync write, saves in background
 *
 * For tests:
 *   const isolated = Settings.isolated({ "compaction.enabled": false });
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
	getAgentDbPath,
	getAgentDir,
	getLastChangelogVersionPath,
	getProjectDir,
	isEnoent,
	logger,
	procmgr,
	setDefaultTabWidth,
} from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { type Settings as SettingsCapabilityItem, settingsCapability } from "../capability/settings";
import type { ModelRole } from "../config/model-roles";
import { invalidate as invalidateCapabilityPath, loadCapability } from "../discovery";
import { isLightTheme, setAutoThemeMapping, setColorBlindMode, setSymbolPreset } from "../modes/theme/theme";
import { AgentStorage } from "../session/agent-storage";
import { type EditMode, normalizeEditMode } from "../utils/edit-mode";
import { updateConfigAtomically, writeConfigAtomically } from "./atomic-config-writer";
import {
	type BashInterceptorRule,
	type GroupPrefix,
	type GroupTypeMap,
	getDefault,
	SETTINGS_SCHEMA,
	type SettingPath,
	type SettingValue,
	validateSettingValue,
} from "./settings-schema";

// Re-export types that callers need
export type * from "./settings-schema";
export * from "./settings-schema";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/** Raw settings object as stored in YAML */
export interface RawSettings {
	[key: string]: unknown;
}

export interface SettingsOptions {
	/** Current working directory for project settings discovery */
	cwd?: string;
	/** Agent directory for config.yml storage */
	agentDir?: string;
	/** Don't persist to disk (for tests) */
	inMemory?: boolean;
	/** Initial overrides */
	overrides?: Partial<Record<SettingPath, unknown>>;
	/** Extra config.yml-style overlays loaded after global/project settings */
	configFiles?: string[];
}

export type SettingsChangeNotice =
	| { kind: "changed"; changedPaths: readonly SettingPath[] }
	| { kind: "warning"; message: string };

type LoadedProjectSettings = {
	data: RawSettings;
	paths: string[];
};

export type ModelRoleWinningLayer = "runtime_override" | "config_overlay" | "project" | "global" | "default";

export interface ModelRoleResolution {
	role: string;
	effectiveSelector: string | undefined;
	winningLayer: ModelRoleWinningLayer | undefined;
	shadowedCandidates: readonly { layer: ModelRoleWinningLayer; selector: string }[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Path Utilities
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a nested value from an object by path segments.
 */
function getByPath(obj: RawSettings, segments: readonly string[]): unknown {
	let current: unknown = obj;
	for (const segment of segments) {
		if (current === null || current === undefined || typeof current !== "object") {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

const SETTING_PATH_SEGMENTS: Record<SettingPath, readonly string[]> = Object.fromEntries(
	(Object.keys(SETTINGS_SCHEMA) as SettingPath[]).map(settingPath => [settingPath, settingPath.split(".")]),
) as unknown as Record<SettingPath, readonly string[]>;

/**
 * Set a nested value in an object by path segments.
 * Creates intermediate objects as needed.
 */
function setByPath(obj: RawSettings, segments: string[], value: unknown): void {
	let current = obj;
	for (let i = 0; i < segments.length - 1; i++) {
		const segment = segments[i];
		if (!(segment in current) || typeof current[segment] !== "object" || current[segment] === null) {
			current[segment] = {};
		}
		current = current[segment] as RawSettings;
	}
	current[segments[segments.length - 1]] = value;
}

const PATH_SCOPED_ARRAY_SETTINGS = new Set<SettingPath>(["enabledModels", "disabledProviders"]);
type PathScopedStringArrayEntry = {
	path?: unknown;
	paths?: unknown;
	pathPrefix?: unknown;
	pathPrefixes?: unknown;
	values?: unknown;
	items?: unknown;
	models?: unknown;
	providers?: unknown;
};

function expandTilde(p: string): string {
	return p === "~" ? os.homedir() : p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

function normalizePathPrefix(prefix: string): string {
	return path.resolve(expandTilde(prefix));
}

function pathMatchesPrefix(cwd: string, prefix: string): boolean {
	const relative = path.relative(normalizePathPrefix(prefix), path.resolve(cwd));
	return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function stringArrayFromUnknown(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	return [];
}

function shallowStringRecord(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};

	const result: Record<string, string> = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === "string") {
			result[key] = item;
		}
	}
	return result;
}

function modelRoleSelector(value: unknown, role: string): string | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const selector = (value as Record<string, unknown>)[role];
	return typeof selector === "string" && selector.length > 0 ? selector : undefined;
}

function resolvePathScopedStringArray(settingPath: SettingPath, value: unknown, cwd: string): string[] | undefined {
	if (!PATH_SCOPED_ARRAY_SETTINGS.has(settingPath) || !Array.isArray(value)) return undefined;

	const resolved: string[] = [];
	for (const entry of value) {
		if (typeof entry === "string") {
			resolved.push(entry);
			continue;
		}
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

		const scoped = entry as PathScopedStringArrayEntry;
		const prefixes = [
			...stringArrayFromUnknown(scoped.path),
			...stringArrayFromUnknown(scoped.paths),
			...stringArrayFromUnknown(scoped.pathPrefix),
			...stringArrayFromUnknown(scoped.pathPrefixes),
		];
		if (prefixes.length === 0 || !prefixes.some(prefix => pathMatchesPrefix(cwd, prefix))) continue;

		const values =
			settingPath === "enabledModels"
				? [
						...stringArrayFromUnknown(scoped.values),
						...stringArrayFromUnknown(scoped.items),
						...stringArrayFromUnknown(scoped.models),
					]
				: [
						...stringArrayFromUnknown(scoped.values),
						...stringArrayFromUnknown(scoped.items),
						...stringArrayFromUnknown(scoped.providers),
					];
		resolved.push(...values);
	}

	return resolved;
}

// ═══════════════════════════════════════════════════════════════════════════
// Settings Class
// ═══════════════════════════════════════════════════════════════════════════

export class Settings {
	#configPath: string | null;
	#cwd: string;
	#agentDir: string;
	#storage: AgentStorage | null = null;

	#configFiles: string[] = [];
	/** Global settings from config.yml */
	#global: RawSettings = {};
	/** Project settings from .claude/settings.yml etc */
	#project: RawSettings = {};
	/** Extra config.yml-style overlays passed by CLI */
	#configOverlay: RawSettings = {};
	/** Resolved project files contributing to the project layer */
	#projectConfigPaths: string[] = [];
	/** Runtime overrides (not persisted) */
	#overrides: RawSettings = {};
	/** Merged view (global + project + overrides) */
	#merged: RawSettings = {};
	/** Cached resolved values from the merged view, including defaults/path scoping */
	#resolvedCache = new Map<SettingPath, unknown>();

	/** Paths modified during this session (for partial save) */
	#modified = new Set<string>();

	/** Legacy `lastChangelogVersion` captured from config.yml during migration (now a marker file). */
	#legacyLastChangelogVersion?: string;

	/** Pending save (debounced) */
	#saveTimer?: NodeJS.Timeout;
	#savePromise?: Promise<void>;
	/** Serialized disk reloads and live file-watch state */
	#reloadPromise: Promise<void> = Promise.resolve();
	#watchDebounceTimer?: NodeJS.Timeout;
	#watchers = new Map<string, fs.FSWatcher>();
	#pendingWatchPaths = new Set<string>();
	#selfWriteGeneration = 0;
	#selfWriteTokens = new Map<string, { generation: number; token: string }>();
	#lastReloadWarningToken?: string;
	#persistentMutationGeneration = 0;
	#changeListeners = new Set<(notice: SettingsChangeNotice) => void>();
	#disposed = false;

	/** Whether to persist changes */
	#persist: boolean;

	private constructor(options: SettingsOptions = {}) {
		this.#cwd = path.normalize(options.cwd ?? getProjectDir());
		this.#agentDir = path.normalize(options.agentDir ?? getAgentDir());
		this.#configPath = options.inMemory ? null : path.join(this.#agentDir, "config.yml");
		this.#configFiles = options.configFiles?.map(file => path.resolve(this.#cwd, expandTilde(file))) ?? [];
		this.#persist = !options.inMemory;

		if (options.overrides) {
			for (const [key, value] of Object.entries(options.overrides)) {
				setByPath(this.#overrides, key.split("."), value);
			}

			this.#overrides = this.#migrateRawSettings(this.#overrides);
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Factory Methods
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Initialize the global singleton.
	 * Call once at startup before accessing `settings`.
	 */
	static init(options: SettingsOptions = {}): Promise<Settings> {
		const requestedAgentDir = options.agentDir === undefined ? undefined : path.normalize(options.agentDir);
		if (globalInstancePromise) {
			if (
				requestedAgentDir === undefined ||
				(globalInstance !== null && globalInstance.#agentDir === requestedAgentDir)
			) {
				return globalInstancePromise;
			}
			return globalInstancePromise.then(async instance => {
				if (instance.#agentDir === requestedAgentDir) return instance;
				await instance.flush();
				instance.dispose();
				if (globalInstance === instance) {
					globalInstance = null;
					globalInstancePromise = null;
					clearBoundSettingsMethods();
				}
				return Settings.init(options);
			});
		}

		const instance = new Settings(options);
		const promise = instance.#load();
		globalInstancePromise = promise;

		return promise.then(
			instance => {
				globalInstance = instance;
				clearBoundSettingsMethods();
				globalInstancePromise = Promise.resolve(instance);
				return instance;
			},
			error => {
				globalInstance = null;
				globalInstancePromise = null;
				clearBoundSettingsMethods();
				throw error;
			},
		);
	}

	/**
	 * Create an isolated instance for testing.
	 * Does not affect the global singleton.
	 */
	static isolated(overrides: Partial<Record<SettingPath, unknown>> = {}): Settings {
		const instance = new Settings({ inMemory: true, overrides });
		instance.#rebuildMerged();
		return instance;
	}

	/**
	 * Get the global singleton.
	 * Throws if not initialized.
	 */
	static get instance(): Settings {
		if (!globalInstance) {
			throw new Error("Settings not initialized. Call Settings.init() first.");
		}
		return globalInstance;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Core API
	// ─────────────────────────────────────────────────────────────────────────

	/**
	 * Get a setting value (sync).
	 * Returns the merged value from global + project + overrides, or the default.
	 */
	get<P extends SettingPath>(path: P): SettingValue<P> {
		if (this.#resolvedCache.has(path)) {
			return this.#resolvedCache.get(path) as SettingValue<P>;
		}

		const value = getByPath(this.#merged, SETTING_PATH_SEGMENTS[path]);
		const resolvedValue =
			value !== undefined ? (resolvePathScopedStringArray(path, value, this.#cwd) ?? value) : undefined;
		const resolved =
			resolvedValue !== undefined && validateSettingValue(path, resolvedValue) ? resolvedValue : getDefault(path);
		this.#resolvedCache.set(path, resolved);
		return resolved as SettingValue<P>;
	}

	/**
	 * Read only the host-global config layer. Project, CLI overlay, and runtime
	 * overrides cannot widen host resource admission.
	 */
	getGlobal<P extends SettingPath>(path: P): SettingValue<P> {
		const value = getByPath(this.#global, SETTING_PATH_SEGMENTS[path]);
		return (value !== undefined && validateSettingValue(path, value) ? value : getDefault(path)) as SettingValue<P>;
	}

	/**
	 * Whether `path` has an explicitly configured value (global config, project
	 * config, or runtime override) rather than falling back to the schema default.
	 */
	isConfigured(path: SettingPath): boolean {
		return getByPath(this.#merged, SETTING_PATH_SEGMENTS[path]) !== undefined;
	}

	/**
	 * Subscribe to live disk reload changes and reload warnings.
	 * Returns an unsubscribe function.
	 */
	onChange(cb: (notice: SettingsChangeNotice) => void): () => void {
		this.#changeListeners.add(cb);
		return () => {
			this.#changeListeners.delete(cb);
		};
	}

	/**
	 * Set a setting value (sync).
	 * Updates global settings and queues a background save.
	 * Triggers hooks for settings that have side effects.
	 */
	set<P extends SettingPath>(path: P, value: SettingValue<P>): void {
		if (path === "modelRoles") {
			this.#assertModelRolesWritable(value as Record<string, string>);
		}
		const prev = this.get(path);
		const segments = path.split(".");
		this.#persistentMutationGeneration++;
		setByPath(this.#global, segments, value);
		this.#modified.add(path);
		this.#rebuildMerged();
		const next = this.get(path);
		this.#queueSave();

		// Trigger hook if exists
		const hook = SETTING_HOOKS[path];
		if (hook) {
			hook(value, prev);
		}
		this.#fireEffectiveSettingChanged(path, next, prev);
	}

	/**
	 * Apply runtime overrides (not persisted).
	 */
	override<P extends SettingPath>(path: P, value: SettingValue<P>): void {
		if ("scope" in SETTINGS_SCHEMA[path] && SETTINGS_SCHEMA[path].scope === "global") {
			throw new Error(`Setting ${path} is global-only and cannot be overridden at runtime`);
		}
		const prev = this.get(path);
		const segments = path.split(".");
		setByPath(this.#overrides, segments, value);
		this.#rebuildMerged();
		this.#fireEffectiveSettingChanged(path, this.get(path), prev);
	}

	/**
	 * Clear a runtime override.
	 */
	clearOverride(path: SettingPath): void {
		const prev = this.get(path);
		const segments = path.split(".");
		let current = this.#overrides;
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i];
			if (!(segment in current)) return;
			current = current[segment] as RawSettings;
		}
		delete current[segments[segments.length - 1]];
		this.#rebuildMerged();
		this.#fireEffectiveSettingChanged(path, this.get(path), prev);
	}

	#fireEffectiveSettingChanged(path: SettingPath, value: unknown, prev: unknown): void {
		if (isDeepStrictEqual(value, prev)) return;
		if (path.startsWith("statusLine.")) {
			statusLineSessionAccentSignal.fire();
		}
	}

	/**
	 * Flush any pending saves to disk.
	 * Call before exit to ensure all changes are persisted.
	 */
	async flush(): Promise<void> {
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer);
			this.#saveTimer = undefined;
		}
		if (this.#savePromise) {
			await this.#savePromise;
		}
		if (this.#modified.size > 0) {
			await this.#saveNow();
		}
	}

	/**
	 * Reload persisted settings layers from disk while keeping runtime overrides.
	 * Reload failures preserve the previous good layers and are surfaced through
	 * the change-notice subscription instead of escaping into a live session.
	 */
	async reloadFromDisk(): Promise<void> {
		if (!this.#persist || !this.#configPath) return;
		const paths = this.#resolvedConfigPaths();
		this.#reloadPromise = this.#reloadPromise.then(() => this.#reloadPersistedLayers(paths));
		await this.#reloadPromise;
	}

	/** Stop file watching and release change subscribers. */
	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#watchDebounceTimer) {
			clearTimeout(this.#watchDebounceTimer);
			this.#watchDebounceTimer = undefined;
		}
		for (const watcher of this.#watchers.values()) watcher.close();
		this.#watchers.clear();
		this.#pendingWatchPaths.clear();
		this.#changeListeners.clear();
	}

	async cloneForCwd(cwd: string): Promise<Settings> {
		const cloned = new Settings({
			cwd,
			agentDir: this.#agentDir,
			inMemory: !this.#persist,
		});
		cloned.#storage = this.#storage;
		cloned.#global = structuredClone(this.#global);
		const project = this.#persist
			? await cloned.#loadProjectSettings()
			: { data: structuredClone(this.#project), paths: [...this.#projectConfigPaths] };
		cloned.#project = project.data;
		cloned.#projectConfigPaths = project.paths;
		cloned.#configFiles = [...this.#configFiles];
		cloned.#configOverlay = structuredClone(this.#configOverlay);
		cloned.#overrides = structuredClone(this.#overrides);
		cloned.#rebuildMerged();
		cloned.#fireAllHooks();
		cloned.#configureWatchers();
		return cloned;
	}

	/**
	 * Re-scope this instance to a new working directory *in place*: reload the
	 * project layer (`.claude/settings.yml` etc.) from `cwd`, re-resolve
	 * path-scoped settings against it, and re-fire side-effect hooks (theme,
	 * symbols, tab width, …). Global settings and runtime overrides are preserved.
	 *
	 * Unlike {@link cloneForCwd}, this mutates the live instance, so every holder
	 * (the `settings` proxy, the active session, controllers) observes the new
	 * project scope without swapping references — used when the process changes
	 * directory mid-run (`/move`, cross-project resume). No-op when `cwd` is
	 * already the current scope.
	 */
	async reloadForCwd(cwd: string): Promise<void> {
		const normalized = path.normalize(cwd);
		if (normalized === this.#cwd) return;
		this.#cwd = normalized;
		if (this.#persist) {
			const project = await this.#loadProjectSettings();
			this.#project = project.data;
			this.#projectConfigPaths = project.paths;
		}
		this.#rebuildMerged();
		this.#fireAllHooks();
		this.#configureWatchers();
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Accessors
	// ─────────────────────────────────────────────────────────────────────────

	getStorage(): AgentStorage | null {
		return this.#storage;
	}

	getCwd(): string {
		return this.#cwd;
	}

	getAgentDir(): string {
		return this.#agentDir;
	}

	getPlansDirectory(): string {
		return path.join(this.#agentDir, "plans");
	}

	/**
	 * Get shell configuration based on settings.
	 */
	getShellConfig() {
		const shell = this.get("shellPath");
		return procmgr.getShellConfig(shell);
	}

	/**
	 * Get all settings in a group with full type safety.
	 */
	getGroup<G extends GroupPrefix>(prefix: G): GroupTypeMap[G] {
		const result: Record<string, unknown> = {};
		for (const key of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
			if (key.startsWith(`${prefix}.`)) {
				const suffix = key.slice(prefix.length + 1);
				result[suffix] = this.get(key);
			}
		}
		return result as unknown as GroupTypeMap[G];
	}

	/**
	 * Get the edit variant for a specific model.
	 * Returns "patch", "replace", "hashline", "apply_patch", or null (use global default).
	 */
	getEditVariantForModel(model: string | undefined): EditMode | null {
		if (!model) return null;
		const variants = (this.#merged.edit as { modelVariants?: Record<string, string> })?.modelVariants;
		if (!variants) return null;
		for (const pattern in variants) {
			if (model.includes(pattern)) {
				const value = normalizeEditMode(variants[pattern]);
				if (value) {
					return value;
				}
			}
		}
		return null;
	}

	/**
	 * Get bash interceptor rules (typed accessor for complex array config).
	 */
	getBashInterceptorRules(): BashInterceptorRule[] {
		return this.get("bashInterceptor.patterns");
	}

	/**
	 * Set a model role (helper for modelRoles record).
	 */
	setModelRole(role: ModelRole | string, modelId: string): void {
		this.#assertModelRolesWritable({ [role]: modelId });
		const current = shallowStringRecord(getByPath(this.#global, ["modelRoles"]));
		current[role] = modelId;
		this.#setModelRolesGlobal(current);
	}

	/**
	 * Determine whether a model role is shadowed by a read-only winning layer
	 * (project settings or --config overlay). Returns the winning source name, or
	 * undefined when the role is writable at the global layer.
	 */
	#modelRoleWinningReadOnlySource(role: string): "project" | "config overlay" | undefined {
		const overlayRoles = getByPath(this.#configOverlay, ["modelRoles"]);
		if (
			overlayRoles !== null &&
			typeof overlayRoles === "object" &&
			!Array.isArray(overlayRoles) &&
			role in overlayRoles
		) {
			return "config overlay";
		}

		const projectRoles = getByPath(this.#project, ["modelRoles"]);
		if (
			projectRoles !== null &&
			typeof projectRoles === "object" &&
			!Array.isArray(projectRoles) &&
			role in projectRoles
		) {
			return "project";
		}

		return undefined;
	}

	/**
	 * Validate that all roles in an incoming modelRoles record are writable at
	 * the global layer. Throws a descriptive Error listing any shadowed roles.
	 */
	#assertModelRolesWritable(incoming: Record<string, string>): void {
		const conflicts: { role: string; source: "project" | "config overlay" }[] = [];
		for (const role of Object.keys(incoming)) {
			const source = this.#modelRoleWinningReadOnlySource(role);
			if (source) {
				conflicts.push({ role, source });
			}
		}

		if (conflicts.length > 0) {
			const messages = conflicts.map(
				({ role, source }) => `modelRoles.${role} is overridden by ${source} settings and cannot be changed here`,
			);
			throw new Error(messages.join("; "));
		}
	}

	/**
	 * Validate that a single model role can be written to the global layer.
	 * Public so AgentSession can preflight before mutating live state.
	 */
	assertModelRoleWritable(role: ModelRole | string): void {
		this.#assertModelRolesWritable({ [role]: "" });
	}

	/**
	 * Write a modelRoles record to the global layer without re-running the
	 * preflight. Used by setModelRole after it has already validated the role
	 * being changed; keeps the generic `set("modelRoles", ...)` path validating
	 * every incoming key.
	 */
	#setModelRolesGlobal(value: Record<string, string>): void {
		const path: SettingPath = "modelRoles";
		const prev = this.get(path);
		setByPath(this.#global, path.split("."), value);

		this.#modified.add(path);
		this.#rebuildMerged();
		const next = this.get(path);
		this.#queueSave();
		this.#fireEffectiveSettingChanged(path, next, prev);
	}

	/**
	 * Set a non-persistent selector for one model role.
	 */
	setRuntimeModelRole(role: ModelRole | string, selector: string): void {
		if (selector.length === 0) {
			throw new Error("Runtime model role selector must not be empty");
		}

		const path: SettingPath = "modelRoles";
		const prev = this.get(path);
		const roles = shallowStringRecord(getByPath(this.#overrides, ["modelRoles"]));
		roles[role] = selector;
		setByPath(this.#overrides, ["modelRoles"], roles);
		this.#rebuildMerged();
		this.#fireEffectiveSettingChanged(path, this.get(path), prev);
	}

	/**
	 * Clear a non-persistent selector for one model role.
	 */
	clearRuntimeModelRole(role: ModelRole | string): void {
		const roles = shallowStringRecord(getByPath(this.#overrides, ["modelRoles"]));
		if (!(role in roles)) return;

		const path: SettingPath = "modelRoles";
		const prev = this.get(path);
		delete roles[role];
		setByPath(this.#overrides, ["modelRoles"], roles);
		this.#rebuildMerged();
		this.#fireEffectiveSettingChanged(path, this.get(path), prev);
	}

	/**
	 * Resolve a role selector directly from each settings layer.
	 */
	resolveModelRole(role: ModelRole | string): ModelRoleResolution {
		const candidates: { layer: ModelRoleWinningLayer; selector: string }[] = [];
		const layers: readonly { layer: Exclude<ModelRoleWinningLayer, "default">; settings: RawSettings }[] = [
			{ layer: "runtime_override", settings: this.#overrides },
			{ layer: "config_overlay", settings: this.#configOverlay },
			{ layer: "project", settings: this.#project },
			{ layer: "global", settings: this.#global },
		];

		for (const { layer, settings } of layers) {
			const selector = modelRoleSelector(getByPath(settings, ["modelRoles"]), role);
			if (selector !== undefined) candidates.push({ layer, selector });
		}

		const defaultSelector = modelRoleSelector(getDefault("modelRoles"), role);
		if (defaultSelector !== undefined) {
			candidates.push({ layer: "default", selector: defaultSelector });
		}

		const [winner, ...shadowedCandidates] = candidates;
		return {
			role,
			effectiveSelector: winner?.selector,
			winningLayer: winner?.layer,
			shadowedCandidates,
		};
	}

	getModelRoles(): Readonly<Record<string, string>> {
		return shallowStringRecord(this.get("modelRoles"));
	}
	/**
	 * Get the configured model selector for a single role.
	 */
	getModelRole(role: ModelRole | string): string | undefined {
		return this.resolveModelRole(role).effectiveSelector;
	}

	/*
	 * Override model roles (helper for modelRoles record).
	 */
	overrideModelRoles(roles: Readonly<Record<string, string>>): void {
		const next = shallowStringRecord(getByPath(this.#overrides, ["modelRoles"]));
		for (const [role, modelId] of Object.entries(roles)) {
			if (modelId) {
				next[role] = modelId;
			}
		}
		this.override("modelRoles", next);
	}

	/**
	 * Set disabled providers (for compatibility with discovery system).
	 */
	setDisabledProviders(ids: string[]): void {
		this.set("disabledProviders", ids);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Loading
	// ─────────────────────────────────────────────────────────────────────────

	#resolvedConfigPaths(): string[] {
		const paths = [
			...(this.#configPath ? [this.#configPath] : []),
			...this.#configFiles,
			...this.#projectConfigPaths,
		];
		return [...new Set(paths.map(filePath => path.resolve(filePath)))];
	}

	#configureWatchers(): void {
		for (const watcher of this.#watchers.values()) watcher.close();
		this.#watchers.clear();
		if (!this.#persist || this.#disposed) return;

		const targetsByDirectory = new Map<string, Set<string>>();
		for (const filePath of this.#resolvedConfigPaths()) {
			const directory = path.dirname(filePath);
			let targets = targetsByDirectory.get(directory);
			if (!targets) {
				targets = new Set();
				targetsByDirectory.set(directory, targets);
			}
			targets.add(filePath);
		}

		for (const [directory, targets] of targetsByDirectory) {
			try {
				const watcher = fs.watch(directory, { persistent: false }, (_event, filename) => {
					const changedPath = filename ? path.resolve(directory, filename.toString()) : undefined;
					for (const target of targets) {
						if (!changedPath || target === changedPath) this.#pendingWatchPaths.add(target);
					}
					this.#scheduleWatchedReload();
				});
				watcher.on("error", error => {
					logger.warn("Settings: config watcher failed", { path: directory, error: String(error) });
				});
				this.#watchers.set(directory, watcher);
			} catch (error) {
				logger.warn("Settings: failed to watch config directory", { path: directory, error: String(error) });
			}
		}
	}

	#scheduleWatchedReload(): void {
		if (this.#pendingWatchPaths.size === 0 || this.#disposed) return;
		if (this.#watchDebounceTimer) clearTimeout(this.#watchDebounceTimer);
		this.#watchDebounceTimer = setTimeout(() => {
			this.#watchDebounceTimer = undefined;
			const paths = [...this.#pendingWatchPaths];
			this.#pendingWatchPaths.clear();
			this.#reloadPromise = this.#reloadPromise.then(() => this.#reloadPersistedLayers(paths, true));
			void this.#reloadPromise.catch(error => {
				logger.warn("Settings: unexpected config reload failure", { error: String(error) });
			});
		}, 150);
		this.#watchDebounceTimer.unref?.();
	}

	async #reloadPersistedLayers(triggerPaths: readonly string[], ignoreSelfWrites = false): Promise<void> {
		if (!this.#persist || !this.#configPath || this.#disposed) return;
		const paths = ignoreSelfWrites ? await this.#withoutSelfWrites(triggerPaths) : [...triggerPaths];
		if (paths.length === 0) return;

		for (const filePath of paths) {
			invalidateCapabilityPath(filePath);
			invalidateCapabilityPath(path.dirname(filePath));
		}

		for (;;) {
			if (this.#watchDebounceTimer) {
				clearTimeout(this.#watchDebounceTimer);
				this.#watchDebounceTimer = undefined;
			}
			if (this.#saveTimer) {
				clearTimeout(this.#saveTimer);
				this.#saveTimer = undefined;
			}
			if (this.#savePromise) await this.#savePromise;

			const mutationGeneration = this.#persistentMutationGeneration;
			try {
				const global = await this.#loadYaml(this.#configPath, true);
				const project = await this.#loadProjectSettings(paths);
				const configOverlay = await this.#loadConfigOverlays();
				this.#assertDecodedSettings(project.data, "project settings");
				this.#assertDecodedSettings(configOverlay, "config overlay");
				if (mutationGeneration !== this.#persistentMutationGeneration) continue;

				for (const modifiedPath of this.#modified) {
					const segments = modifiedPath.split(".");
					setByPath(global, segments, getByPath(this.#global, segments));
				}

				const previous = new Map<SettingPath, unknown>();
				for (const settingPath of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
					previous.set(settingPath, this.get(settingPath));
				}

				this.#global = global;
				this.#project = project.data;
				this.#projectConfigPaths = [...new Set([...this.#projectConfigPaths, ...project.paths])];
				this.#configOverlay = configOverlay;
				this.#rebuildMerged();

				const changedPaths: SettingPath[] = [];
				let statusLineChanged = false;
				for (const settingPath of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
					const prev = previous.get(settingPath);
					const next = this.get(settingPath);
					if (isDeepStrictEqual(next, prev)) continue;
					changedPaths.push(settingPath);
					const hook = SETTING_HOOKS[settingPath];
					if (hook) hook(next as any, prev as any);
					if (settingPath.startsWith("statusLine.")) statusLineChanged = true;
				}
				if (statusLineChanged) statusLineSessionAccentSignal.fire();

				this.#lastReloadWarningToken = undefined;
				this.#configureWatchers();
				if (this.#modified.size > 0) this.#queueSave();
				if (changedPaths.length > 0) this.#emitChangeNotice({ kind: "changed", changedPaths });
				return;
			} catch (error) {
				await this.#emitReloadWarning(error, paths);
				return;
			}
		}
	}

	async #withoutSelfWrites(paths: readonly string[]): Promise<string[]> {
		const external: string[] = [];
		for (const filePath of paths) {
			const normalized = path.resolve(filePath);
			const selfWrite = this.#selfWriteTokens.get(normalized);
			if (selfWrite && selfWrite.token === (await this.#fileToken(normalized))) continue;
			external.push(normalized);
		}
		return external;
	}

	async #fileToken(filePath: string): Promise<string> {
		try {
			const stat = await fs.promises.stat(filePath, { bigint: true });
			return `${stat.dev}:${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
		} catch (error) {
			return isEnoent(error) ? "missing" : `error:${String(error)}`;
		}
	}

	async #emitReloadWarning(error: unknown, paths: readonly string[]): Promise<void> {
		const tokens = await Promise.all(paths.map(async filePath => `${filePath}:${await this.#fileToken(filePath)}`));
		const token = tokens.sort().join("|");
		if (token === this.#lastReloadWarningToken) return;
		this.#lastReloadWarningToken = token;
		const detail = error instanceof Error ? error.message : String(error);
		const message = `Settings reload ignored: ${detail}`;
		logger.warn(message);
		this.#emitChangeNotice({ kind: "warning", message });
	}

	#emitChangeNotice(notice: SettingsChangeNotice): void {
		for (const listener of [...this.#changeListeners]) {
			try {
				listener(notice);
			} catch (error) {
				logger.warn("Settings: change-notice hook failed", { error: String(error) });
			}
		}
	}

	async #load(): Promise<Settings> {
		// Project settings load (loadCapability scans cwd) is independent of the
		// persist chain (storage open → legacy migration → global config.yml read).
		const projectPromise = this.#loadProjectSettings();

		if (this.#persist) {
			this.#storage = await AgentStorage.open(getAgentDbPath(this.#agentDir));
			await this.#migrateFromLegacy();
			this.#global = await this.#loadYaml(this.#configPath!);
			await this.#seedLastChangelogVersionMarker();
		}

		const project = await projectPromise;
		this.#project = project.data;
		this.#projectConfigPaths = project.paths;
		this.#configOverlay = await this.#loadConfigOverlays();

		this.#rebuildMerged();
		this.#fireAllHooks();
		this.#configureWatchers();
		return this;
	}

	async #loadYaml(filePath: string, strict = false): Promise<RawSettings> {
		try {
			const content = await Bun.file(filePath).text();
			if (strict && content.trim().length === 0) throw new Error("config is empty");
			const parsed = YAML.parse(content);
			if (parsed === null || parsed === undefined) {
				if (strict) throw new Error("expected a YAML mapping");
				return {};
			}
			if (typeof parsed !== "object" || Array.isArray(parsed)) {
				if (strict) throw new Error("expected a YAML mapping");
				return {};
			}
			const migrated = this.#migrateRawSettings(parsed as RawSettings);
			if (strict) this.#assertDecodedSettings(migrated, filePath);
			return migrated;
		} catch (error) {
			if (isEnoent(error)) return {};
			if (strict) throw new Error(`Failed to load config ${filePath}: ${String(error)}`);
			logger.warn("Settings: failed to load", { path: filePath, error: String(error) });
			return {};
		}
	}

	async #loadProjectSettings(strictPaths: readonly string[] = []): Promise<LoadedProjectSettings> {
		try {
			const result = await loadCapability(settingsCapability.id, { cwd: this.#cwd });
			const strictWarning = result.warnings.find(warning =>
				strictPaths.some(filePath => warning.includes(filePath)),
			);
			if (strictWarning) throw new Error(strictWarning);

			let merged: RawSettings = {};
			const paths: string[] = [];
			for (const item of result.items as SettingsCapabilityItem[]) {
				if (item.level === "project") {
					merged = this.#deepMerge(merged, item.data as RawSettings);
					paths.push(path.resolve(item.path));
				}
			}
			const migrated = this.#migrateRawSettings(merged);
			if (strictPaths.length > 0) this.#assertDecodedSettings(migrated, "project settings");
			return { data: migrated, paths };
		} catch (error) {
			if (strictPaths.length > 0) throw error;
			return { data: {}, paths: [] };
		}
	}

	async #loadConfigOverlays(): Promise<RawSettings> {
		let merged: RawSettings = {};
		for (const filePath of this.#configFiles) {
			merged = this.#deepMerge(merged, await this.#loadOverlayYaml(filePath));
		}
		return merged;
	}

	/**
	 * Strict loader for explicit `--config` overlays: unlike `#loadYaml`,
	 * missing or malformed files are hard errors so a typo'd path cannot
	 * silently fall back to the persistent settings.
	 */
	async #loadOverlayYaml(filePath: string): Promise<RawSettings> {
		let content: string;
		try {
			content = await Bun.file(filePath).text();
		} catch (error) {
			throw new Error(
				isEnoent(error)
					? `Config overlay not found: ${filePath}`
					: `Failed to read config overlay ${filePath}: ${String(error)}`,
			);
		}
		let parsed: unknown;
		try {
			parsed = YAML.parse(content);
		} catch (error) {
			throw new Error(`Failed to parse config overlay ${filePath}: ${String(error)}`);
		}
		if (parsed === null || parsed === undefined) return {};
		if (typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error(`Config overlay must be a YAML mapping: ${filePath}`);
		}
		return this.#migrateRawSettings(parsed as RawSettings);
	}

	async #migrateFromLegacy(): Promise<void> {
		if (!this.#configPath) return;

		// Check if config.yml already exists
		try {
			await Bun.file(this.#configPath).text();
			return; // Already exists, no migration needed
		} catch (err) {
			if (!isEnoent(err)) return;
		}

		let settings: RawSettings = {};
		let migrated = false;

		// 1. Migrate from settings.json
		const settingsJsonPath = path.join(this.#agentDir, "settings.json");
		try {
			const parsed = JSON.parse(await Bun.file(settingsJsonPath).text());
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				settings = this.#deepMerge(settings, this.#migrateRawSettings(parsed));
				migrated = true;
				try {
					fs.renameSync(settingsJsonPath, `${settingsJsonPath}.bak`);
				} catch {}
			}
		} catch {}

		// 2. Migrate from agent.db
		try {
			const dbSettings = this.#storage?.getSettings();
			if (dbSettings) {
				settings = this.#deepMerge(settings, this.#migrateRawSettings(dbSettings as RawSettings));
				migrated = true;
			}
		} catch {}

		// 3. Write merged settings
		if (migrated && Object.keys(settings).length > 0) {
			try {
				await writeConfigAtomically(this.#configPath, YAML.stringify(settings, null, 2));
				logger.debug("Settings: migrated to config.yml", { path: this.#configPath });
			} catch {}
		}
	}

	/** Apply schema migrations to raw settings */
	#migrateRawSettings(raw: RawSettings): RawSettings {
		if ("modelRoles" in raw) {
			const modelRoles = raw.modelRoles;
			if (!modelRoles || typeof modelRoles !== "object" || Array.isArray(modelRoles)) {
				logger.warn("Settings: ignoring malformed modelRoles; expected an object", {
					actualType: Array.isArray(modelRoles) ? "array" : modelRoles === null ? "null" : typeof modelRoles,
				});
				delete raw.modelRoles;
			} else {
				raw.modelRoles = shallowStringRecord(modelRoles);
			}
		}

		// queueMode -> steeringMode
		if ("queueMode" in raw && !("steeringMode" in raw)) {
			raw.steeringMode = raw.queueMode;
			delete raw.queueMode;
		}

		// lastChangelogVersion moved out of config.yml into the
		// <agentDir>/last-changelog-version marker file so version bumps no
		// longer dirty user-tracked configs. Capture for marker seeding (see
		// #seedLastChangelogVersionMarker), then strip the key — the next
		// config save drops it from disk.
		if (typeof raw.lastChangelogVersion === "string") {
			this.#legacyLastChangelogVersion ??= raw.lastChangelogVersion;
		}
		delete raw.lastChangelogVersion;

		// ask.timeout: ms -> seconds (if value > 1000, it's old ms format)
		if (raw.ask && typeof (raw.ask as Record<string, unknown>).timeout === "number") {
			const oldValue = (raw.ask as Record<string, unknown>).timeout as number;
			if (oldValue > 1000) {
				(raw.ask as Record<string, unknown>).timeout = Math.round(oldValue / 1000);
			}
		}

		// Migrate old flat "theme" string to nested theme.dark/theme.light
		if (typeof raw.theme === "string") {
			const oldTheme = raw.theme;
			if (oldTheme === "light" || oldTheme === "dark") {
				// Built-in defaults — just remove, let new defaults apply
				delete raw.theme;
			} else {
				// Custom theme — detect luminance to place in correct slot
				const slot = isLightTheme(oldTheme) ? "light" : "dark";
				raw.theme = { [slot]: oldTheme };
			}
		}

		// task.isolation.enabled (boolean) -> task.isolation.mode (enum)
		const taskObj = raw.task as Record<string, unknown> | undefined;
		const isolationObj = taskObj?.isolation as Record<string, unknown> | undefined;
		if (isolationObj && "enabled" in isolationObj) {
			if (typeof isolationObj.enabled === "boolean") {
				isolationObj.mode = isolationObj.enabled ? "auto" : "none";
			}
			delete isolationObj.enabled;
		}

		// task.simple: removed — the task tool no longer accepts a per-call
		// schema (workflows drive structured output via eval agent()) and the
		// batch/context shape is gated by task.batch instead.
		if (taskObj && "simple" in taskObj) {
			delete taskObj.simple;
		}

		// task.eager / todo.eager: boolean -> enum (default | preferred | always).
		// `true` reproduced the previous "on" behavior, which is now `always`.
		if (taskObj && typeof taskObj.eager === "boolean") {
			taskObj.eager = taskObj.eager ? "always" : "default";
		}
		const todoObj = raw.todo as Record<string, unknown> | undefined;
		if (todoObj && typeof todoObj.eager === "boolean") {
			todoObj.eager = todoObj.eager ? "always" : "default";
		}

		// task.isolation.mode: legacy values from before the pi-iso PAL refactor.
		// `worktree` was git worktree → now lives under `rcopy`. `fuse-overlay`
		// and `fuse-projfs` are now the platform-named `overlayfs` / `projfs`
		// kinds; the PAL falls back internally when the chosen one isn't
		// available, so we don't need the old TS-side platform guards.
		if (isolationObj && typeof isolationObj.mode === "string") {
			const legacy: Record<string, string> = {
				worktree: "rcopy",
				"fuse-overlay": "overlayfs",
				"fuse-projfs": "projfs",
			};
			const mapped = legacy[isolationObj.mode as string];
			if (mapped !== undefined) {
				isolationObj.mode = mapped;
			}
		}

		// edit.mode: removed "atom" and "vim" variants map back to "hashline"
		const editObj = raw.edit as Record<string, unknown> | undefined;
		if (editObj) {
			if (editObj.mode === "atom" || editObj.mode === "vim") {
				editObj.mode = "hashline";
			}
			const modelVariants = editObj.modelVariants as Record<string, unknown> | undefined;
			if (modelVariants && typeof modelVariants === "object" && !Array.isArray(modelVariants)) {
				for (const [pattern, variant] of Object.entries(modelVariants)) {
					if (variant === "atom" || variant === "vim") {
						modelVariants[pattern] = "hashline";
					}
				}
			}
		}
		if (raw["edit.mode"] === "atom" || raw["edit.mode"] === "vim") {
			raw["edit.mode"] = "hashline";
		}

		// compaction.strategy: removed local-model shake-summary mode; plain shake
		// keeps the same mechanical artifact-backed reduction without background CPU.
		const compactionObj = raw.compaction as Record<string, unknown> | undefined;
		if (compactionObj?.strategy === "shake-summary") {
			compactionObj.strategy = "shake";
		}
		if (raw["compaction.strategy"] === "shake-summary") {
			raw["compaction.strategy"] = "shake";
		}

		// snapcompact.systemPrompt: boolean -> scoped enum.
		const snapcompactObj = raw.snapcompact as Record<string, unknown> | undefined;
		if (snapcompactObj && typeof snapcompactObj.systemPrompt === "boolean") {
			snapcompactObj.systemPrompt = snapcompactObj.systemPrompt ? "all" : "none";
		}
		if (typeof raw["snapcompact.systemPrompt"] === "boolean") {
			raw["snapcompact.systemPrompt"] = raw["snapcompact.systemPrompt"] ? "all" : "none";
		}

		// statusLine: rename "plan_mode" segment to "mode"
		const statusLineObj = raw.statusLine as Record<string, unknown> | undefined;
		if (statusLineObj) {
			for (const key of ["leftSegments", "rightSegments"] as const) {
				const segments = statusLineObj[key];
				if (Array.isArray(segments)) {
					statusLineObj[key] = segments.map(seg => (seg === "plan_mode" ? "mode" : seg));
				}
			}
			const segmentOptions = statusLineObj.segmentOptions as Record<string, unknown> | undefined;
			if (segmentOptions && "plan_mode" in segmentOptions && !("mode" in segmentOptions)) {
				segmentOptions.mode = segmentOptions.plan_mode;
				delete segmentOptions.plan_mode;
			}
		}

		// providers.parallelFetch (boolean) replaced by the providers.fetch reader
		// priority enum. The new default ("auto") supersedes both old values —
		// Parallel is now a deep fallback in the auto chain rather than the first
		// choice — so drop the legacy key (flat and nested) and let the enum
		// default apply.
		const providersObj = raw.providers as Record<string, unknown> | undefined;
		if (providersObj && "parallelFetch" in providersObj) {
			delete providersObj.parallelFetch;
		}
		delete raw["providers.parallelFetch"];

		// codexResets.autoRedeem: boolean -> tri-state enum.
		// Existing explicit false keeps the old "do not run" behavior; missing
		// config now falls through to the new "unset" default, which asks before
		// the first eligible spend.
		const codexResetsObj = raw.codexResets as Record<string, unknown> | undefined;
		if (codexResetsObj && typeof codexResetsObj.autoRedeem === "boolean") {
			codexResetsObj.autoRedeem = codexResetsObj.autoRedeem ? "yes" : "no";
		}
		if (typeof raw["codexResets.autoRedeem"] === "boolean") {
			raw["codexResets.autoRedeem"] = raw["codexResets.autoRedeem"] ? "yes" : "no";
		}

		// Map legacy `memories.enabled` boolean to the explicit `memory.backend`
		// enum if the latter hasn't been set yet. Idempotent: subsequent
		// migrations are no-ops once memory.backend is materialised.
		const memoryBackendObj = raw.memory as Record<string, unknown> | undefined;
		const memoryBackendSet = memoryBackendObj && typeof memoryBackendObj.backend === "string";
		const memoriesObj = raw.memories as Record<string, unknown> | undefined;
		if (!memoryBackendSet && memoriesObj && typeof memoriesObj.enabled === "boolean") {
			const next = memoriesObj.enabled ? "local" : "off";
			const memoryRoot = (memoryBackendObj ?? {}) as Record<string, unknown>;
			memoryRoot.backend = next;
			raw.memory = memoryRoot;
		}

		// Rename the legacy local `mnemosyne` memory backend to `mnemopi`.
		// - `memory.backend: "mnemosyne"` now selects the renamed backend.
		// - the top-level `mnemosyne` settings object becomes `mnemopi`.
		// Idempotent: skips the object move once `mnemopi` is materialised.
		if (memoryBackendObj && memoryBackendObj.backend === "mnemosyne") {
			memoryBackendObj.backend = "mnemopi";
		}
		if ("mnemosyne" in raw && !("mnemopi" in raw)) {
			raw.mnemopi = raw.mnemosyne;
			delete raw.mnemosyne;
		}

		// hindsight: dynamicBankId/agentName -> scoping enum + bankId
		// - dynamicBankId=true  → scoping="per-project" (closest semantic match;
		//   the legacy `agent::project::channel::user` tuple was per-project in
		//   practice — the channel/user env vars were rarely set).
		// - hindsight.agentName was only used as the agent slot in the legacy
		//   dynamic tuple; if the user customised it we surface it as the new
		//   bankId base when no explicit bankId is set.
		const hindsightObj = raw.hindsight as Record<string, unknown> | undefined;
		if (hindsightObj) {
			if ("dynamicBankId" in hindsightObj) {
				if (!("scoping" in hindsightObj) && hindsightObj.dynamicBankId === true) {
					hindsightObj.scoping = "per-project";
				}
				delete hindsightObj.dynamicBankId;
			}
			if ("agentName" in hindsightObj) {
				const agentName = hindsightObj.agentName;
				if (
					!("bankId" in hindsightObj) &&
					typeof agentName === "string" &&
					agentName.trim().length > 0 &&
					agentName !== "omp"
				) {
					hindsightObj.bankId = agentName;
				}
				delete hindsightObj.agentName;
			}
		}

		return raw;
	}

	#assertDecodedSettings(raw: RawSettings, source: string): void {
		for (const settingPath of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
			const value = getByPath(raw, SETTING_PATH_SEGMENTS[settingPath]);
			if (value === undefined) continue;

			const definition = SETTINGS_SCHEMA[settingPath];
			const valid =
				definition.type === "boolean"
					? typeof value === "boolean"
					: definition.type === "string"
						? typeof value === "string"
						: definition.type === "array"
							? Array.isArray(value)
							: definition.type === "record"
								? value !== null && typeof value === "object" && !Array.isArray(value)
								: validateSettingValue(settingPath, value);
			if (!valid) throw new Error(`Invalid setting ${settingPath} in ${source}`);
		}
	}

	/**
	 * One-time migration: seed the last-changelog-version marker file from the
	 * legacy config.yml key. An existing marker always wins — it is the newer
	 * source of truth.
	 */
	async #seedLastChangelogVersionMarker(): Promise<void> {
		const legacy = this.#legacyLastChangelogVersion;
		if (!legacy) return;
		const markerPath = getLastChangelogVersionPath(this.#agentDir);
		try {
			if ((await Bun.file(markerPath).text()).trim()) return;
		} catch (error) {
			if (!isEnoent(error)) return;
		}
		try {
			await Bun.write(markerPath, legacy);
		} catch (error) {
			logger.warn("Settings: failed to seed last-changelog-version marker", { error: String(error) });
		}
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Saving
	// ─────────────────────────────────────────────────────────────────────────

	#queueSave(): void {
		if (!this.#persist || !this.#configPath) return;

		// Debounce: wait 100ms for more changes
		if (this.#saveTimer) {
			clearTimeout(this.#saveTimer);
		}
		this.#saveTimer = setTimeout(() => {
			this.#saveTimer = undefined;
			const savePromise = this.#saveNow();
			this.#savePromise = savePromise;
			void savePromise
				.catch(error => {
					logger.warn("Settings: background save failed", { error: String(error) });
				})
				.finally(() => {
					if (this.#savePromise === savePromise) this.#savePromise = undefined;
				});
		}, 100);
		this.#saveTimer.unref?.();
	}

	async #saveNow(): Promise<void> {
		if (!this.#persist || !this.#configPath || this.#modified.size === 0) return;

		const configPath = this.#configPath;
		const modifiedPaths = [...this.#modified];
		const previous = new Map<SettingPath, unknown>();
		for (const settingPath of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
			previous.set(settingPath, this.get(settingPath));
		}
		this.#modified.clear();
		let saved = false;

		try {
			const current = await updateConfigAtomically(configPath, async () => {
				// Re-read strictly while holding the cross-process writer lock.
				// A malformed external edit must never be replaced by this
				// process's partial save.
				const current = await this.#loadYaml(configPath, true);

				for (const modifiedPath of modifiedPaths) {
					const segments = modifiedPath.split(".");
					setByPath(current, segments, getByPath(this.#global, segments));
				}

				return { content: YAML.stringify(current, null, 2), value: current };
			});
			this.#global = current;
			const generation = ++this.#selfWriteGeneration;
			const normalizedPath = path.resolve(configPath);
			this.#selfWriteTokens.set(normalizedPath, {
				generation,
				token: await this.#fileToken(normalizedPath),
			});
			saved = true;
		} catch (error) {
			logger.warn("Settings: save failed", { error: String(error) });
			for (const modifiedPath of modifiedPaths) this.#modified.add(modifiedPath);
		}

		this.#rebuildMerged();
		if (!saved) return;

		const changedPaths: SettingPath[] = [];
		let statusLineChanged = false;
		for (const settingPath of Object.keys(SETTINGS_SCHEMA) as SettingPath[]) {
			const prev = previous.get(settingPath);
			const next = this.get(settingPath);
			if (isDeepStrictEqual(next, prev)) continue;
			changedPaths.push(settingPath);
			const hook = SETTING_HOOKS[settingPath];
			if (hook) hook(next as any, prev as any);
			if (settingPath.startsWith("statusLine.")) statusLineChanged = true;
		}
		if (statusLineChanged) statusLineSessionAccentSignal.fire();
		if (changedPaths.length > 0) this.#emitChangeNotice({ kind: "changed", changedPaths });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// Utilities
	// ─────────────────────────────────────────────────────────────────────────

	#rebuildMerged(): void {
		this.#merged = this.#deepMerge(this.#deepMerge({}, this.#global), this.#project);
		this.#merged = this.#deepMerge(this.#merged, this.#configOverlay);
		this.#merged = this.#deepMerge(this.#merged, this.#overrides);
		this.#resolvedCache.clear();
	}

	#fireAllHooks(): void {
		for (const key of Object.keys(SETTING_HOOKS) as SettingPath[]) {
			const hook = SETTING_HOOKS[key];
			if (hook) {
				const value = this.get(key);
				hook(value, value);
			}
		}
	}

	#deepMerge(base: RawSettings, overrides: RawSettings): RawSettings {
		const result = { ...base };
		for (const key of Object.keys(overrides)) {
			const override = overrides[key];
			const baseVal = base[key];

			if (override === undefined) continue;

			if (
				typeof override === "object" &&
				override !== null &&
				!Array.isArray(override) &&
				typeof baseVal === "object" &&
				baseVal !== null &&
				!Array.isArray(baseVal)
			) {
				result[key] = this.#deepMerge(baseVal as RawSettings, override as RawSettings);
			} else {
				result[key] = override;
			}
		}
		return result;
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// Setting Hooks
// ═══════════════════════════════════════════════════════════════════════════

type SettingHook<P extends SettingPath> = (value: SettingValue<P>, prev: SettingValue<P>) => void;

/**
 * Minimal change-notification primitive backing the exported `on*Changed`
 * subscriptions. Holds a listener set, hands out unsubscribe closures, and
 * isolates errors so a single throwing listener can't abort the rest or bubble
 * out of `Settings.set()`.
 *
 * @typeParam A - argument tuple forwarded to each listener on `fire`.
 */
class SettingSignal<A extends unknown[] = []> {
	#listeners = new Set<(...args: A) => void>();

	constructor(private readonly label: string) {}

	/** Subscribe `cb`; returns an unsubscribe function. */
	on(cb: (...args: A) => void): () => void {
		this.#listeners.add(cb);
		return () => {
			this.#listeners.delete(cb);
		};
	}

	/**
	 * Invoke every listener with `args`. Iterates a snapshot so a listener may
	 * (un)subscribe mid-fire without re-entrancy — the Hindsight backend
	 * re-registers the fresh state's listener on every rebuild — and wraps each
	 * call so a throwing listener is logged and skipped instead of aborting the
	 * rest.
	 */
	fire(...args: A): void {
		for (const cb of [...this.#listeners]) {
			try {
				cb(...args);
			} catch (err) {
				logger.warn(`Settings: ${this.label} hook failed`, { error: String(err) });
			}
		}
	}
}

const SETTING_HOOKS: Partial<Record<SettingPath, SettingHook<any>>> = {
	"theme.dark": value => {
		if (typeof value === "string") {
			setAutoThemeMapping("dark", value);
		}
	},
	"theme.light": value => {
		if (typeof value === "string") {
			setAutoThemeMapping("light", value);
		}
	},
	symbolPreset: value => {
		if (typeof value === "string" && (value === "unicode" || value === "nerd" || value === "ascii")) {
			setSymbolPreset(value).catch(err => {
				logger.warn("Settings: symbolPreset hook failed", { preset: value, error: String(err) });
			});
		}
	},
	colorBlindMode: value => {
		if (typeof value === "boolean") {
			setColorBlindMode(value).catch(err => {
				logger.warn("Settings: colorBlindMode hook failed", { enabled: value, error: String(err) });
			});
		}
	},
	"display.tabWidth": value => {
		if (typeof value === "number") {
			setDefaultTabWidth(value);
		}
	},
	"provider.appendOnlyContext": value => {
		if (typeof value === "string") {
			appendOnlyModeSignal.fire(value);
		}
	},
	"hindsight.bankId": () => hindsightScopeSignal.fire(),
	"hindsight.bankIdPrefix": () => hindsightScopeSignal.fire(),
	"hindsight.scoping": () => hindsightScopeSignal.fire(),
};
/** Fires when `provider.appendOnlyContext` changes at runtime. */
const appendOnlyModeSignal = new SettingSignal<[value: string]>("provider.appendOnlyContext");

/**
 * Subscribe to append-only mode setting changes.
 * Returns an unsubscribe function. Multiple sessions (main + subagents)
 * can register independently without overwriting each other.
 */
export const onAppendOnlyModeChanged = (cb: (value: string) => void) => appendOnlyModeSignal.on(cb);

/** Fires when any effective `statusLine.*` setting changes at runtime. */
const statusLineSessionAccentSignal = new SettingSignal("statusLine.sessionAccent");

/**
 * Subscribe to status-line setting changes (legacy session-accent hook name).
 * Returns an unsubscribe function. Callers should re-read settings in the callback.
 */
export const onStatusLineSessionAccentChanged = (cb: () => void) => statusLineSessionAccentSignal.on(cb);

/** Fires when any `hindsight.bankId` / `bankIdPrefix` / `scoping` value changes. */
const hindsightScopeSignal = new SettingSignal("hindsight scope");

/**
 * Subscribe to changes in the Hindsight bank-scoping settings. Lets the
 * Hindsight backend rebuild the active `HindsightSessionState` when the
 * operator switches `hindsight.bankId`, `hindsight.bankIdPrefix`, or
 * `hindsight.scoping` mid-session so subsequent retain/recall calls land in
 * the new bank instead of the one selected at session start.
 *
 * Returns an unsubscribe function. The callback receives no arguments — the
 * caller is expected to re-read the relevant settings via `Settings.get`.
 */
export const onHindsightScopeChanged = (cb: () => void) => hindsightScopeSignal.on(cb);

// ═══════════════════════════════════════════════════════════════════════════
// Global Singleton
// ═══════════════════════════════════════════════════════════════════════════

let globalInstance: Settings | null = null;
let globalInstancePromise: Promise<Settings> | null = null;
let boundSettingsInstance: Settings | null = null;
let boundSettingsMethods = new Map<PropertyKey, unknown>();

function clearBoundSettingsMethods(): void {
	boundSettingsInstance = null;
	boundSettingsMethods = new Map<PropertyKey, unknown>();
}

export function isSettingsInitialized(): boolean {
	return globalInstance !== null;
}

/**
 * Reset the global singleton for testing.
 * @internal
 */
export function resetSettingsForTest(): void {
	globalInstance?.dispose();
	globalInstance = null;
	globalInstancePromise = null;
	clearBoundSettingsMethods();
}

/**
 * The global settings singleton.
 * Must call `Settings.init()` before using.
 */
export const settings = new Proxy({} as Settings, {
	get(_target, prop) {
		if (!globalInstance) {
			throw new Error("Settings not initialized. Call Settings.init() first.");
		}
		if (boundSettingsInstance !== globalInstance) {
			clearBoundSettingsMethods();
			boundSettingsInstance = globalInstance;
		}
		const value = (globalInstance as unknown as Record<PropertyKey, unknown>)[prop];
		if (typeof value === "function") {
			const cached = boundSettingsMethods.get(prop);
			if (cached) return cached;
			const bound = value.bind(globalInstance);
			boundSettingsMethods.set(prop, bound);
			return bound;
		}
		return value;
	},
});
