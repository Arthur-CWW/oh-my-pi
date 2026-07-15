import { getPuppeteerDir, logger, Snowflake, workerHostEntry } from "@oh-my-pi/pi-utils";
import type { Page, Target } from "puppeteer-core";
import { callSessionTool } from "../../eval/js/tool-bridge";
import type { ToolSession } from "../../sdk";
import { webpExclusionForModel } from "../../utils/image-loading";
import { expandPath } from "../path-utils";
import { ToolAbortError, ToolError } from "../tool-errors";
import { pickElectronTarget } from "./attach";
import { CmuxTab, runCmuxCode } from "./cmux/cmux-tab";
import { mapWaitUntil } from "./cmux/rpc";
import { DEFAULT_VIEWPORT } from "./launch";
import {
	type BrowserHandle,
	type BrowserKindTag,
	type CmuxBrowserHandle,
	holdBrowser,
	type PuppeteerBrowserHandle,
	releaseBrowser,
} from "./registry";
import {
	releaseOwnedBrowserTabLease,
	reserveOwnedBrowserTabLease,
	touchOwnedBrowserTabLease,
} from "./process-ownership";
import {
	DEFAULT_MAX_GLOBAL_TABS,
	DEFAULT_MAX_TABS_PER_SESSION,
	enforceTabBudget,
	type BrowserTabBudgetRecord,
	normalizeTabBudgetCap,
} from "./tab-budget";
import type {
	ReadyInfo,
	RunErrorPayload,
	RunResultOk,
	SessionSnapshot,
	Transferable,
	Transport,
	WorkerInbound,
	WorkerInitPayload,
	WorkerOutbound,
} from "./tab-protocol";

// Coding-agent binary/bundle workers route through the CLI entrypoint with a
// hidden argv mode, so compiled/npm builds only need one JavaScript entry.

interface WorkerHandle {
	send(msg: WorkerInbound, transferList?: Transferable[]): void;
	onMessage(handler: (msg: WorkerOutbound) => void): () => void;
	onError(handler: (error: Error) => void): () => void;
	terminate(): Promise<void>;
	readonly mode: "worker" | "inline";
}

export type DialogPolicy = "accept" | "dismiss";

export interface PendingRun {
	resolve(result: RunResultOk): void;
	reject(error: unknown): void;
	session: ToolSession;
	signal?: AbortSignal;
	toolCalls: Map<string, AbortController>;
}

interface TabSessionBase<TBrowser extends BrowserHandle = BrowserHandle> {
	name: string;
	browser: TBrowser;
	targetId: string;
	state: "alive" | "dead";
	info: ReadyInfo;
	pending: Map<string, PendingRun>;
	dialogPolicy?: DialogPolicy;
	kindTag: BrowserKindTag;
	/** Durable ownership label for diagnostics and budget enforcement. */
	ownerSessionId: string;
	ownerAgentId: string;
	purpose: string;
	/** Wall-clock timestamps used by the lazy idle reaper. */
	createdAt: number;
	lastUsedAt: number;
	/** Current URL identity under the acquisition's query-sensitivity policy. */
	urlKey: string;
}

export interface TabPoolEntry {
	readonly name: string;
	readonly url: string;
	readonly urlKey: string;
	readonly backend: TabSession["backend"];
	readonly kind: BrowserKindTag;
	readonly state: TabSession["state"];
	readonly busy: boolean;
	readonly ownerSessionId: string;
	readonly ownerAgentId: string;
	readonly purpose: string;
	readonly createdAt: number;
	readonly lastUsedAt: number;
	readonly idleMs: number;
	readonly exempt?: "external";
}

export interface TabPoolOptions {
	readonly tabIdleTtlMs?: number;
	readonly urlQuerySensitive?: boolean;
	readonly reuse?: boolean;
}

export interface WorkerTabSession extends TabSessionBase<PuppeteerBrowserHandle> {
	backend: "worker";
	worker: WorkerHandle;
}

export interface CmuxTabSession extends TabSessionBase<CmuxBrowserHandle> {
	backend: "cmux";
	cmuxTab: CmuxTab;
	cmuxOwnsSurface: boolean;
	cmuxAttachedSurface?: string;
}

export type TabSession = WorkerTabSession | CmuxTabSession;

export interface AcquireTabOptions extends TabPoolOptions {
	url?: string;
	waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
	viewport?: { width: number; height: number; deviceScaleFactor?: number };
	target?: string;
	signal?: AbortSignal;
	timeoutMs: number;
	dialogs?: DialogPolicy;
	cmuxSurface?: string;
	/** Cap admission identity/options supplied by BrowserTool. */
	sessionId?: string;
	maxTabsPerSession?: number;
	maxGlobalTabs?: number;
	/** Ownership labels supplied by BrowserTool; test callers use defaults. */
	ownerSessionId?: string;
	ownerAgentId?: string;
	purpose?: string;
}

export interface AcquireTabResult {
	tab: TabSession;
	created: boolean;
}

export interface RunInTabOptions {
	code: string;
	timeoutMs: number;
	signal?: AbortSignal;
	session: ToolSession;
}

export interface ReleaseTabOptions {
	kill?: boolean;
}

const tabs = new Map<string, TabSession>();
const tabAliases = new Map<string, string>();
// A URL pool lookup spans names, so all acquisitions share one serialized gate.
let acquirePoolTail: Promise<void> = Promise.resolve();
// Per-name acquisition chain: serializes concurrent `acquireTab` calls for the
// same tab name so the existence check and `tabs.set` (separated by several
// awaits) cannot interleave and leak a worker + browser refCount.
const acquireChains = new Map<string, Promise<void>>();

const ownedTabLeases = new WeakMap<TabSession, string>();

function isBudgetedTab(tab: TabSession): boolean {
	return tab.kindTag === "headless" && "browser" in tab.browser && tab.browser.ownership !== undefined;
}

function currentBudgetRecords(): readonly BrowserTabBudgetRecord[] {
	return [...tabs.values()]
		.filter(tab => isBudgetedTab(tab) && tab.ownerSessionId.length > 0)
		.map(tab => ({
			name: tab.name,
			sessionId: tab.ownerSessionId,
			createdAt: tab.createdAt,
			lastUsedAt: tab.lastUsedAt,
			idle: isIdle(tab),
		}));
}

async function touchOwnedTabLease(tab: TabSession, idle: boolean): Promise<void> {
	const leaseId = ownedTabLeases.get(tab);
	if (leaseId) await touchOwnedBrowserTabLease(leaseId, idle).catch(() => undefined);
}

const GRACE_MS = 750;
export const DEFAULT_TAB_IDLE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_TAB_PURPOSE = "browser";

function resolvedTabName(name: string): string | undefined {
	if (tabs.has(name)) return name;
	const alias = tabAliases.get(name);
	return alias && tabs.has(alias) ? alias : undefined;
}

function resolvedTab(name: string): TabSession | undefined {
	const canonical = resolvedTabName(name);
	return canonical ? tabs.get(canonical) : undefined;
}

function removeTabAliases(canonical: string): void {
	for (const [alias, target] of tabAliases) {
		if (target === canonical) tabAliases.delete(alias);
	}
}

function bindTabAlias(alias: string, canonical: string): void {
	if (alias === canonical) return;
	const existing = resolvedTabName(alias);
	if (existing && existing !== canonical) {
		removeTabAliases(existing);
	}
	tabAliases.set(alias, canonical);
}

function normalizeUrl(url: string, querySensitive = false): string {
	try {
		const parsed = new URL(url);
		return `${parsed.origin}${parsed.pathname}${querySensitive ? parsed.search : ""}`;
	} catch {
		const withoutHash = url.split("#", 1)[0] ?? url;
		if (!querySensitive) return withoutHash.split("?", 1)[0] ?? withoutHash;
		return withoutHash;
	}
}

function isIdle(tab: TabSession): boolean {
	return tab.state === "alive" && tab.pending.size === 0;
}

function idleTtlMs(value: number | undefined): number {
	return Number.isFinite(value) && value !== undefined && value >= 0 ? value : DEFAULT_TAB_IDLE_TTL_MS;
}

export function getTab(name: string): TabSession | undefined {
	return resolvedTab(name);
}

export function listTabs(now = Date.now()): readonly TabPoolEntry[] {
	return [...tabs.values()]
		.filter(tab => tab.state === "alive")
		.map(tab => {
			const budgeted = isBudgetedTab(tab);
			return {
				name: tab.name,
				url: tab.info.url,
				urlKey: tab.urlKey,
				backend: tab.backend,
				kind: tab.kindTag,
				state: tab.state,
				busy: tab.pending.size > 0,
				ownerSessionId: tab.ownerSessionId,
				ownerAgentId: tab.ownerAgentId,
				purpose: tab.purpose,
				createdAt: tab.createdAt,
				lastUsedAt: tab.lastUsedAt,
				idleMs: Math.max(0, now - tab.lastUsedAt),
				exempt: budgeted ? undefined : "external",
			};
		});
}

export function normalizeTabUrlForTest(url: string, querySensitive = false): string {
	return normalizeUrl(url, querySensitive);
}


export function acquireTab(name: string, browser: BrowserHandle, opts: AcquireTabOptions): Promise<AcquireTabResult> {
	const priorName = acquireChains.get(name) ?? Promise.resolve();
	const priorPool = acquirePoolTail;
	const result = priorName.then(() => priorPool).then(() => acquireTabImpl(name, browser, opts));
	const tail = result.then(
		() => undefined,
		() => undefined,
	);
	acquireChains.set(name, tail);
	acquirePoolTail = tail;
	void tail.then(() => {
		if (acquireChains.get(name) === tail) acquireChains.delete(name);
		if (acquirePoolTail === tail) acquirePoolTail = Promise.resolve();
	});
	return result;
}

async function sweepExpiredTabs(ttlValue: number | undefined): Promise<void> {
	const ttl = idleTtlMs(ttlValue);
	const cutoff = Date.now() - ttl;
	const expired = [...tabs.values()]
		.filter(tab => isBudgetedTab(tab) && isIdle(tab) && tab.lastUsedAt < cutoff)
		.map(tab => tab.name);
	for (const name of expired) await releaseTab(name);
}

async function navigateAndTouchTab(
	tab: TabSession,
	opts: AcquireTabOptions,
): Promise<void> {
	const reuseSteps: string[] = [];
	if (opts.viewport && tab.kindTag !== "cmux") {
		const dsf = opts.viewport.deviceScaleFactor;
		reuseSteps.push(
			`await page.setViewport({ width: ${opts.viewport.width}, height: ${opts.viewport.height}, deviceScaleFactor: ${dsf === undefined ? "undefined" : String(dsf)} });`,
		);
	}
	if (opts.url) {
		reuseSteps.push(
			`await tab.goto(${JSON.stringify(opts.url)}, { waitUntil: ${JSON.stringify(opts.waitUntil ?? "load")} });`,
		);
	}
	if (reuseSteps.length) {
		await runInTabWithSnapshot(
			tab.name,
			{ code: reuseSteps.join("\n"), timeoutMs: opts.timeoutMs, signal: opts.signal },
			{ cwd: process.cwd() },
		);
	}
	if (opts.url) tab.info = { ...tab.info, url: opts.url };
	tab.urlKey = normalizeUrl(tab.info.url, opts.urlQuerySensitive);
	tab.lastUsedAt = Date.now();
	await touchOwnedTabLease(tab, true);
}

async function admitOwnedTab(name: string, browser: BrowserHandle, opts: AcquireTabOptions): Promise<string | undefined> {
	if (
		!opts.sessionId ||
		browser.kind.kind !== "headless" ||
		!("browser" in browser) ||
		browser.ownership === undefined
	) {
		return undefined;
	}
	const maxTabsPerSession = normalizeTabBudgetCap(opts.maxTabsPerSession, DEFAULT_MAX_TABS_PER_SESSION);
	const maxGlobalTabs = normalizeTabBudgetCap(opts.maxGlobalTabs, DEFAULT_MAX_GLOBAL_TABS);
	await enforceTabBudget({
		sessionId: opts.sessionId,
		maxTabsPerSession,
		// The persisted lease reservation below owns the machine-wide count and
		// attribution; this local pass only reclaims the requesting session's tab.
		maxGlobalTabs: Number.MAX_SAFE_INTEGER,
		records: currentBudgetRecords,
		reclaim: async record => {
			if (tabs.has(record.name)) await releaseTab(record.name, { kill: false });
		},
	});
	const lease = await reserveOwnedBrowserTabLease({
		sessionId: opts.sessionId,
		tabName: name,
		maxTabsPerSession,
		maxGlobalTabs,
	});
	return lease.leaseId;
}

async function acquireTabImpl(
	name: string,
	browser: BrowserHandle,
	opts: AcquireTabOptions,
): Promise<AcquireTabResult> {
	// Serialized opens can sit behind a slow predecessor in the pool chain;
	// honor an abort at dequeue instead of spawning an unowned worker.
	if (opts.signal?.aborted) throw new ToolAbortError("Browser tab open aborted");
	await sweepExpiredTabs(opts.tabIdleTtlMs);

	// Temporary refCount hold so releasing an existing tab on the SAME browser
	// below cannot dispose the instance we are about to replace.
	let tempHold = false;
	const existing = resolvedTab(name);
	if (existing) {
		if (opts.reuse !== false && existing.browser === browser && existing.state === "alive") {
			const requestedCmuxSurface = "client" in browser ? (opts.cmuxSurface ?? browser.surface) : undefined;
			if (existing.backend === "cmux" && existing.cmuxAttachedSurface !== requestedCmuxSurface) {
				holdBrowser(browser);
				tempHold = true;
				await releaseTab(name, { kill: false });
			} else if (opts.dialogs !== undefined && opts.dialogs !== existing.dialogPolicy) {
				holdBrowser(browser);
				tempHold = true;
				await releaseTab(name, { kill: false });
			} else {
				await navigateAndTouchTab(existing, opts);
				return { tab: existing, created: false };
			}
		} else {
			if (existing.browser === browser) {
				holdBrowser(browser);
				tempHold = true;
			}
			await releaseTab(name, { kill: false });
		}
	}

	// Reuse an idle tab by URL across caller-provided names. The browser handle
	// must match too: a tab cannot be moved between cmux/CDP/worker backends.
	const requestedUrlKey = opts.url ? normalizeUrl(opts.url, opts.urlQuerySensitive) : undefined;
	if (opts.reuse !== false && requestedUrlKey) {
		const byUrl = [...tabs.values()].find(
			tab =>
				tab.browser === browser &&
				tab.ownerSessionId === (opts.ownerSessionId ?? opts.sessionId ?? "unknown") &&
				isIdle(tab) &&
				normalizeUrl(tab.info.url, opts.urlQuerySensitive) === requestedUrlKey,
		);
		if (byUrl) {
			bindTabAlias(name, byUrl.name);
			await navigateAndTouchTab(byUrl, opts);
			if (tempHold) await releaseBrowser(browser, { kill: false });
			return { tab: byUrl, created: false };
		}
	}

	let ownedLeaseId: string | undefined;
	try {
		ownedLeaseId = await admitOwnedTab(name, browser, opts);
	} catch (error) {
		if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
		throw error;
	}

	if ("client" in browser) {
		try {
			const result = await acquireCmuxTab(name, browser, opts);
			if (tempHold) await releaseBrowser(browser, { kill: false });
			if (ownedLeaseId) ownedTabLeases.set(result.tab, ownedLeaseId);
			return result;
		} catch (error) {
			if (ownedLeaseId) await releaseOwnedBrowserTabLease(ownedLeaseId).catch(() => undefined);
			if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
			throw error;
		}
	}
	let initPayload: WorkerInitPayload;
	let worker: WorkerHandle;
	try {
		initPayload = await buildInitPayload(browser, opts);
		worker = await spawnTabWorker();
	} catch (error) {
		// Failing before the worker took its own hold must release the
		// temporary one, or the browser's refCount never reaches 0 again.
		if (ownedLeaseId) await releaseOwnedBrowserTabLease(ownedLeaseId).catch(() => undefined);
		if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
		throw error;
	}
	let info: ReadyInfo;
	try {
		info = await initializeTabWorker(worker, initPayload, opts.timeoutMs + GRACE_MS);
	} catch (error) {
		// `BuildMessage`-class failures arrive asynchronously via the worker's `error` event,
		// after `spawnTabWorker`'s synchronous try/catch has already returned. Fall back to
		// the inline worker here so module-resolution failures don't poison every tab open.
		await worker.terminate().catch(() => undefined);
		if (worker.mode === "inline") {
			if (ownedLeaseId) await releaseOwnedBrowserTabLease(ownedLeaseId).catch(() => undefined);
			if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
			throw error;
		}
		logger.warn("Tab worker init failed; retrying with inline tab worker (no sync-loop guard)", {
			error: error instanceof Error ? error.message : String(error),
		});
		worker = await spawnInlineWorker();
		try {
			info = await initializeTabWorker(worker, initPayload, opts.timeoutMs + GRACE_MS);
		} catch (inlineError) {
			await worker.terminate().catch(() => undefined);
			if (ownedLeaseId) await releaseOwnedBrowserTabLease(ownedLeaseId).catch(() => undefined);
			if (tempHold || browser.refCount === 0) await releaseBrowser(browser, { kill: false });
			const finalError = new ToolError(
				`Failed to start browser tab worker (inline fallback also failed): ${inlineError instanceof Error ? inlineError.message : String(inlineError)}`,
			);
			(finalError as { cause?: unknown }).cause = error;
			throw finalError;
		}
	}

	holdBrowser(browser);
	if (tempHold) await releaseBrowser(browser, { kill: false });
	const now = Date.now();
	const tab: WorkerTabSession = {
		name,
		browser,
		targetId: info.targetId,
		backend: "worker",
		worker,
		state: "alive",
		info,
		pending: new Map(),
		dialogPolicy: opts.dialogs,
		kindTag: browser.kind.kind,
		ownerSessionId: opts.ownerSessionId ?? opts.sessionId ?? "unknown",
		ownerAgentId: opts.ownerAgentId ?? "unknown",
		purpose: opts.purpose ?? DEFAULT_TAB_PURPOSE,
		createdAt: now,
		lastUsedAt: now,
		urlKey: normalizeUrl(info.url, opts.urlQuerySensitive),
	};
	worker.onMessage(msg => handleTabMessage(tab, msg));
	tabs.set(name, tab);
	if (ownedLeaseId) ownedTabLeases.set(tab, ownedLeaseId);
	return { tab, created: true };
}

async function acquireCmuxTab(
	name: string,
	browser: CmuxBrowserHandle,
	opts: AcquireTabOptions,
): Promise<AcquireTabResult> {
	const attachedSurface = opts.cmuxSurface ?? browser.surface;
	if (attachedSurface?.startsWith("surface:")) {
		throw new ToolError(
			"app.surface must be a surface UUID (e.g. CMUX_SURFACE_ID), not a 'surface:N' ref; omit it to open a new split",
		);
	}

	let surfaceId = attachedSurface;
	let initialUrl = opts.url;
	let ownsSurface = false;
	try {
		if (!surfaceId) {
			const params: Record<string, unknown> = { url: opts.url ?? "about:blank", focus: false };
			if (process.env.CMUX_WORKSPACE_ID) params.workspace_id = process.env.CMUX_WORKSPACE_ID;
			if (process.env.CMUX_SURFACE_ID) params.surface_id = process.env.CMUX_SURFACE_ID;
			const result = await browser.client.request("browser.open_split", params, { timeoutMs: opts.timeoutMs });
			if (typeof result.surface_id !== "string" || result.surface_id.length === 0) {
				throw new ToolError("cmux browser.open_split did not return a surface_id");
			}
			surfaceId = result.surface_id;
			ownsSurface = true;
			if (typeof result.url === "string" && result.url.length > 0) initialUrl = result.url;
			if (opts.url) {
				await browser.client.request(
					"browser.wait",
					{
						surface_id: surfaceId,
						load_state: mapWaitUntil(opts.waitUntil ?? "load"),
						timeout_ms: opts.timeoutMs,
					},
					{ timeoutMs: opts.timeoutMs },
				);
			}
		}

		const cmuxTab = new CmuxTab({ client: browser.client, surfaceId, url: initialUrl });
		if (attachedSurface && opts.url) {
			await cmuxTab.goto(opts.url, { waitUntil: opts.waitUntil ?? "load", timeoutMs: opts.timeoutMs });
		}
		const info = await cmuxTab.readyInfo(opts.viewport ?? DEFAULT_VIEWPORT);
		holdBrowser(browser);
		const now = Date.now();
		const tab: CmuxTabSession = {
			name,
			browser,
			targetId: surfaceId,
			backend: "cmux",
			cmuxTab,
			cmuxOwnsSurface: ownsSurface,
			state: "alive",
			info,
			pending: new Map(),
			dialogPolicy: opts.dialogs,
			kindTag: browser.kind.kind,
			cmuxAttachedSurface: attachedSurface,
			ownerSessionId: opts.ownerSessionId ?? opts.sessionId ?? "unknown",
			ownerAgentId: opts.ownerAgentId ?? "unknown",
			purpose: opts.purpose ?? DEFAULT_TAB_PURPOSE,
			createdAt: now,
			lastUsedAt: now,
			urlKey: normalizeUrl(info.url, opts.urlQuerySensitive),
		};
		tabs.set(name, tab);
		return { tab, created: true };
	} catch (error) {
		if (ownsSurface && surfaceId) {
			await browser.client.request("surface.close", { surface_id: surfaceId }).catch(() => undefined);
		}
		throw error;
	}
}

export async function runInTab(name: string, opts: RunInTabOptions): Promise<RunResultOk> {
	return await runInTabWithSnapshot(
		name,
		{ code: opts.code, timeoutMs: opts.timeoutMs, signal: opts.signal, session: opts.session },
		{
			cwd: opts.session.cwd,
			browserScreenshotDir: expandBrowserScreenshotDir(opts.session),
			excludeWebP: webpExclusionForModel(opts.session.getActiveModel?.()),
		},
	);
}

async function runInTabWithSnapshot(
	name: string,
	opts: { code: string; timeoutMs: number; signal?: AbortSignal; session?: ToolSession },
	snapshot: SessionSnapshot,
): Promise<RunResultOk> {
	const tab = resolvedTab(name);
	if (!tab || tab.state === "dead") throw new ToolError(`Tab ${JSON.stringify(name)} is not alive. Reopen it.`);
	if (tab.pending.size > 0) throw new ToolError(`Tab ${JSON.stringify(name)} is busy`);
	tab.lastUsedAt = Date.now();
	await touchOwnedTabLease(tab, false);
	const id = Snowflake.next();
	const { promise, resolve, reject } = Promise.withResolvers<RunResultOk>();
	observeRunPromiseRejection(promise);
	const pending: PendingRun = {
		resolve,
		reject,
		session: opts.session ?? ({} as ToolSession),
		signal: opts.signal,
		toolCalls: new Map(),
	};
	tab.pending.set(id, pending);
	if (tab.backend === "cmux") {
		try {
			return await runCmuxCode(tab.cmuxTab, {
				code: opts.code,
				timeoutMs: opts.timeoutMs,
				signal: opts.signal,
				session: pending.session,
				snapshot,
			});
		} finally {
			tab.pending.delete(id);
			await touchOwnedTabLease(tab, true);
		}
	}
	const abort = (): void => {
		tab.worker.send({ type: "abort", id });
		for (const ctrl of pending.toolCalls.values()) ctrl.abort(opts.signal?.reason);
	};
	if (opts.signal?.aborted) abort();
	else opts.signal?.addEventListener("abort", abort, { once: true });
	try {
		tab.worker.send({
			type: "run",
			id,
			name,
			code: opts.code,
			timeoutMs: opts.timeoutMs,
			session: snapshot,
		});
		return await raceWithTimeout(
			promise,
			opts.timeoutMs + GRACE_MS,
			"Browser code execution hung past grace; tab killed",
			async reason => await forceKillTab(name, reason),
		);
	} finally {
		opts.signal?.removeEventListener("abort", abort);
		tab.pending.delete(id);
		await touchOwnedTabLease(tab, true);
	}
}

export async function releaseTab(name: string, opts: ReleaseTabOptions = {}): Promise<boolean> {
	const canonical = resolvedTabName(name);
	const tab = canonical ? tabs.get(canonical) : undefined;
	if (!tab || !canonical) {
		logger.debug("releaseTab: unknown tab", { name });
		return false;
	}
	const wasAlive = tab.state === "alive";
	tab.state = "dead";
	const closeError = new ToolError(`Tab ${JSON.stringify(name)} was closed`);
	for (const [id, pending] of tab.pending) {
		if (tab.backend === "worker") {
			try {
				tab.worker.send({ type: "abort", id });
			} catch {}
		}
		for (const ctrl of pending.toolCalls.values()) ctrl.abort(closeError);
		pending.reject(closeError);
	}
	tab.pending.clear();
	if (tab.backend === "cmux") {
		let nonLastCloseError: unknown;
		if (wasAlive && tab.cmuxOwnsSurface) {
			try {
				await tab.browser.client.request("surface.close", { surface_id: tab.targetId });
			} catch (err) {
				if (isLastSurfaceCloseError(err)) {
					logger.debug("Leaving cmux browser surface open because it is the last surface in the workspace", {
						error: err instanceof Error ? err.message : String(err),
					});
				} else {
					nonLastCloseError = err;
				}
			}
		}
		const leaseId = ownedTabLeases.get(tab);
		if (leaseId) await releaseOwnedBrowserTabLease(leaseId).catch(() => undefined);
		ownedTabLeases.delete(tab);
		await releaseBrowser(tab.browser, { kill: opts.kill ?? false });
		tabs.delete(canonical);
		removeTabAliases(canonical);
		if (nonLastCloseError) throw nonLastCloseError;
		return true;
	}
	let forced = false;
	if (wasAlive) {
		try {
			tab.worker.send({ type: "close" });
			await waitForClosed(tab);
		} catch {
			forced = true;
		}
	}
	await tab.worker.terminate().catch(() => undefined);
	if (forced && tab.kindTag === "headless") await closeOrphanTarget(tab);
	const leaseId = ownedTabLeases.get(tab);
	if (leaseId) await releaseOwnedBrowserTabLease(leaseId).catch(() => undefined);
	ownedTabLeases.delete(tab);
	await releaseBrowser(tab.browser, { kill: opts.kill ?? false });
	tabs.delete(canonical);
	removeTabAliases(canonical);
	return true;
}

export async function releaseAllTabs(opts: ReleaseTabOptions = {}): Promise<number> {
	const names = [...tabs.keys()];
	let count = 0;
	for (const name of names) {
		if (await releaseTab(name, opts)) count++;
	}
	return count;
}

export async function dropHeadlessTabs(): Promise<void> {
	const names = [...tabs.values()].filter(tab => tab.kindTag === "headless").map(tab => tab.name);
	for (const name of names) await releaseTab(name);
}

function isLastSurfaceCloseError(err: unknown): boolean {
	const message = err instanceof Error ? err.message : String(err);
	return /last/i.test(message);
}

async function buildInitPayload(browser: PuppeteerBrowserHandle, opts: AcquireTabOptions): Promise<WorkerInitPayload> {
	const safeDir = getPuppeteerDir();
	const browserWSEndpoint = browser.browser.wsEndpoint();
	if (!browserWSEndpoint) throw new ToolError("Browser websocket endpoint is unavailable");
	if (browser.kind.kind === "headless") {
		return {
			mode: "headless",
			browserWSEndpoint,
			safeDir,
			viewport: opts.viewport,
			dialogs: opts.dialogs,
			url: opts.url,
			waitUntil: opts.waitUntil,
			timeoutMs: opts.timeoutMs,
		};
	}
	const page = await pickElectronTarget(browser.browser, opts.target);
	const targetId = await targetIdForPage(page);
	return {
		mode: "attach",
		browserWSEndpoint,
		safeDir,
		targetId,
		dialogs: opts.dialogs,
	};
}

function handleTabMessage(tab: WorkerTabSession, msg: WorkerOutbound): void {
	if (msg.type === "result") {
		const pending = tab.pending.get(msg.id);
		if (!pending) return;
		tab.pending.delete(msg.id);
		if (msg.ok) {
			pending.resolve(msg.payload);
			return;
		}
		pending.reject(errorFromPayload(msg.error));
		return;
	}
	if (msg.type === "ready") {
		tab.info = msg.info;
		return;
	}
	if (msg.type === "tool-call") {
		void dispatchToolCall(tab, msg);
		return;
	}
	if (msg.type === "log") logWorkerMessage(msg);
}

async function dispatchToolCall(
	tab: WorkerTabSession,
	msg: Extract<WorkerOutbound, { type: "tool-call" }>,
): Promise<void> {
	const pending = tab.pending.get(msg.runId);
	if (!pending?.session.cwd) {
		safeSend(tab, {
			type: "tool-reply",
			id: msg.id,
			reply: {
				ok: false,
				error: { name: "ToolError", message: "No active run for tool call", isToolError: true, isAbort: false },
			},
		});
		return;
	}
	const ctrl = new AbortController();
	pending.toolCalls.set(msg.id, ctrl);
	const onParentAbort = (): void => ctrl.abort(pending.signal?.reason);
	if (pending.signal?.aborted) onParentAbort();
	else pending.signal?.addEventListener("abort", onParentAbort, { once: true });
	try {
		const value = await callSessionTool(msg.name, msg.args, {
			session: pending.session,
			signal: ctrl.signal,
			emitStatus: () => {
				// Status events from tool calls aren't piped back to user code yet; the worker
				// already pushes its own helper status via the display channel.
			},
		});
		safeSend(tab, { type: "tool-reply", id: msg.id, reply: { ok: true, value } });
	} catch (error) {
		safeSend(tab, { type: "tool-reply", id: msg.id, reply: { ok: false, error: toErrorPayload(error) } });
	} finally {
		pending.toolCalls.delete(msg.id);
		pending.signal?.removeEventListener("abort", onParentAbort);
	}
}

function safeSend(tab: WorkerTabSession, msg: WorkerInbound): void {
	if (tab.state !== "alive") return;
	try {
		tab.worker.send(msg);
	} catch (err) {
		logger.debug("tab worker send failed", { error: err instanceof Error ? err.message : String(err) });
	}
}

function toErrorPayload(error: unknown): RunErrorPayload {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack,
			isAbort: error.name === "AbortError" || error.name === "ToolAbortError",
			isToolError: error instanceof ToolError || error.name === "ToolError",
		};
	}
	return { name: "Error", message: String(error), isAbort: false, isToolError: false };
}

async function forceKillTab(name: string, reason: string): Promise<void> {
	const canonical = resolvedTabName(name);
	const tab = canonical ? tabs.get(canonical) : undefined;
	if (!tab || !canonical) return;
	tab.state = "dead";
	const error = new ToolError(reason);
	for (const pending of tab.pending.values()) pending.reject(error);
	tab.pending.clear();
	const leaseId = ownedTabLeases.get(tab);
	if (leaseId) await releaseOwnedBrowserTabLease(leaseId).catch(() => undefined);
	ownedTabLeases.delete(tab);
	if (tab.backend === "cmux") {
		await releaseBrowser(tab.browser, { kill: false });
		tabs.delete(canonical);
		removeTabAliases(canonical);
		return;
	}
	await tab.worker.terminate().catch(() => undefined);
	if (tab.kindTag === "headless") await closeOrphanTarget(tab);
	await releaseBrowser(tab.browser, { kill: false });
	tabs.delete(canonical);
	removeTabAliases(canonical);
}

async function closeOrphanTarget(tab: WorkerTabSession): Promise<void> {
	for (const target of tab.browser.browser.targets()) {
		if ((await targetIdForTarget(target).catch(() => "")) !== tab.targetId) continue;
		const page = await target.page().catch(() => null);
		await page?.close().catch(() => undefined);
		return;
	}
}

function observeRunPromiseRejection(promise: Promise<RunResultOk>): void {
	void promise.catch(() => undefined);
}

async function waitForClosed(tab: WorkerTabSession): Promise<void> {
	const { promise, resolve } = Promise.withResolvers<void>();
	const unsubscribe = tab.worker.onMessage(msg => {
		if (msg.type === "closed") resolve();
	});
	try {
		await raceWithTimeout(promise, GRACE_MS, "Timed out closing browser tab worker");
	} finally {
		unsubscribe();
	}
}

function expandBrowserScreenshotDir(session: ToolSession): string | undefined {
	const value = session.settings.get("browser.screenshotDir") as string | undefined;
	return value ? expandPath(value) : undefined;
}

async function targetIdForPage(page: Page): Promise<string> {
	return await targetIdForTarget(page.target());
}

async function targetIdForTarget(target: Target): Promise<string> {
	const raw = target as unknown as { _targetId?: unknown };
	if (typeof raw._targetId === "string") return raw._targetId;
	const session = await target.createCDPSession();
	try {
		const info = (await session.send("Target.getTargetInfo")) as { targetInfo?: { targetId?: string } };
		if (info.targetInfo?.targetId) return info.targetInfo.targetId;
		throw new ToolError("Target id unavailable from CDP target info");
	} finally {
		await session.detach().catch(() => undefined);
	}
}

function errorFromPayload(payload: RunErrorPayload): Error {
	const error = payload.isAbort
		? new ToolAbortError()
		: payload.isToolError
			? new ToolError(payload.message)
			: new Error(payload.message);
	error.name = payload.name;
	if (payload.stack) error.stack = payload.stack;
	return error;
}

function logWorkerMessage(msg: Extract<WorkerOutbound, { type: "log" }>): void {
	if (msg.level === "debug") logger.debug(msg.msg, msg.meta);
	else if (msg.level === "warn") logger.warn(msg.msg, msg.meta);
	else logger.error(msg.msg, msg.meta);
}

async function raceWithTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	reason: string,
	onTimeout?: (reason: string) => Promise<void>,
): Promise<T> {
	const timeoutSignal = AbortSignal.timeout(timeoutMs);
	const { promise: timeoutPromise, reject } = Promise.withResolvers<never>();
	const onAbort = (): void => reject(new ToolError(reason));
	timeoutSignal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([promise, timeoutPromise]);
	} catch (error) {
		if (error instanceof ToolError && error.message === reason) await onTimeout?.(reason);
		throw error;
	} finally {
		timeoutSignal.removeEventListener("abort", onAbort);
	}
}

async function spawnTabWorker(): Promise<WorkerHandle> {
	try {
		const hostEntry = workerHostEntry();
		const worker = hostEntry
			? new Worker(hostEntry, { type: "module", argv: ["__omp_worker_tab"] })
			: new Worker(new URL("./tab-worker-entry.ts", import.meta.url).href, { type: "module" });
		return wrapBunWorker(worker);
	} catch (err) {
		logger.warn("Bun Worker spawn failed; using inline tab worker (no sync-loop guard)", {
			error: err instanceof Error ? err.message : String(err),
		});
		return spawnInlineWorker();
	}
}

function wrapBunWorker(worker: Worker): WorkerHandle {
	return {
		mode: "worker",
		send(msg, transferList) {
			worker.postMessage(msg, { transfer: transferList ?? [] });
		},
		onMessage(handler) {
			const wrap = (event: MessageEvent): void => handler(event.data as WorkerOutbound);
			worker.addEventListener("message", wrap);
			return () => worker.removeEventListener("message", wrap);
		},
		onError(handler) {
			const onError = (event: ErrorEvent): void => handler(errorFromWorkerEvent(event));
			const onMessageError = (event: MessageEvent): void =>
				handler(new ToolError(`Tab worker message error: ${String(event.data)}`));
			worker.addEventListener("error", onError);
			worker.addEventListener("messageerror", onMessageError);
			return () => {
				worker.removeEventListener("error", onError);
				worker.removeEventListener("messageerror", onMessageError);
			};
		},
		async terminate() {
			worker.terminate();
		},
	};
}

/**
 * Inline fallback for environments where Bun cannot compile or spawn the worker
 * entry. This preserves normal browser behavior but cannot interrupt synchronous
 * infinite loops because user code runs on the main thread.
 */
async function spawnInlineWorker(): Promise<WorkerHandle> {
	const hostListeners = new Set<(message: WorkerOutbound) => void>();
	const workerListeners = new Set<(message: WorkerInbound) => void>();
	const workerTransport: Transport = {
		send: msg =>
			queueMicrotask(() => {
				for (const listener of hostListeners) listener(msg as WorkerOutbound);
			}),
		onMessage: handler => {
			const typed = handler as (message: WorkerInbound) => void;
			workerListeners.add(typed);
			return () => workerListeners.delete(typed);
		},
		close: () => {},
	};
	const { WorkerCore } = await import("./tab-worker");
	new WorkerCore(workerTransport);
	return {
		mode: "inline",
		send: msg =>
			queueMicrotask(() => {
				for (const listener of workerListeners) listener(msg);
			}),
		onMessage: handler => {
			hostListeners.add(handler);
			return () => hostListeners.delete(handler);
		},
		onError: () => () => {},
		async terminate() {},
	};
}

async function initializeTabWorker(
	worker: WorkerHandle,
	payload: WorkerInitPayload,
	timeoutMs: number,
): Promise<ReadyInfo> {
	const { promise, resolve, reject } = Promise.withResolvers<ReadyInfo>();
	const unlisten = worker.onMessage(msg => {
		if (msg.type === "ready") resolve(msg.info);
		else if (msg.type === "init-failed") reject(errorFromPayload(msg.error));
		else if (msg.type === "log") logWorkerMessage(msg);
	});
	const unlistenError = worker.onError(error => {
		reject(new ToolError(`Tab worker failed during startup: ${error.message}`));
	});
	try {
		worker.send({ type: "init", payload });
		return await raceWithTimeout(promise, timeoutMs, "Timed out initializing browser tab worker");
	} finally {
		unlisten();
		unlistenError();
	}
}

export function initializeTabWorkerForTest(
	worker: WorkerHandle,
	payload: WorkerInitPayload,
	timeoutMs: number,
): Promise<ReadyInfo> {
	return initializeTabWorker(worker, payload, timeoutMs);
}

export function observeRunPromiseRejectionForTest(promise: Promise<RunResultOk>): void {
	observeRunPromiseRejection(promise);
}

export function registerTabForTest(tab: TabSession): () => void {
	tabs.set(tab.name, tab);
	const unsubscribe = tab.backend === "worker" ? tab.worker.onMessage(msg => handleTabMessage(tab, msg)) : undefined;
	return () => {
		unsubscribe?.();
		if (tabs.get(tab.name) === tab) {
			tabs.delete(tab.name);
			removeTabAliases(tab.name);
		}
	};
}

function errorFromWorkerEvent(event: ErrorEvent): Error {
	if (event.error instanceof Error) return event.error;
	if (event.message) return new Error(event.message);
	return new Error("Unknown tab worker error");
}
