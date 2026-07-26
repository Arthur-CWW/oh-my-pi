import * as path from "node:path";
import { logger, postmortem } from "@oh-my-pi/pi-utils";
import type { Subprocess } from "bun";
import type { Browser, CDPSession } from "puppeteer-core";
import { ToolAbortError, ToolError } from "../tool-errors";
import { findFreeCdpPort, findReusableCdp, gracefulKillTreeOnce, killExistingByPath, waitForCdp } from "./attach";
import type { CmuxKind } from "./cmux/rpc";
import { CmuxSocketClient } from "./cmux/socket-client";
import { BROWSER_PROTOCOL_TIMEOUT_MS, launchHeadlessBrowser, loadPuppeteer, type UserAgentOverride } from "./launch";
import { type OwnedBrowserProfile, recordOwnedBrowserActiveTabs, removeOwnedBrowserProfile } from "./process-ownership";
import { ownedBrowserContextKey } from "./tab-group";

export type PuppeteerBrowserKind =
	| { kind: "headless"; headless: boolean }
	| { kind: "spawned"; path: string }
	| { kind: "connected"; cdpUrl: string };

export type BrowserKind = PuppeteerBrowserKind | CmuxKind;

export type BrowserKindTag = BrowserKind["kind"];

interface BrowserHandleCommon {
	key: string;
	kind: BrowserKind;
	refCount: number;
}

export interface PuppeteerBrowserHandle extends BrowserHandleCommon {
	kind: PuppeteerBrowserKind;
	browser: Browser;
	cdpUrl?: string;
	pid?: number;
	subprocess?: Subprocess;
	ownership?: OwnedBrowserProfile;
	stealth: { browserSession: CDPSession | null; override: UserAgentOverride | null };
}

export interface CmuxBrowserHandle extends BrowserHandleCommon {
	kind: CmuxKind;
	client: CmuxSocketClient;
	surface?: string;
}

export type BrowserHandle = PuppeteerBrowserHandle | CmuxBrowserHandle;

const browsers = new Map<string, BrowserHandle>();
const activeTabUpdates = new WeakMap<BrowserHandle, Promise<void>>();

function browserKey(kind: BrowserKind, group: string): string {
	switch (kind.kind) {
		case "headless":
			return ownedBrowserContextKey(kind.headless, group);
		case "spawned":
			return `spawned:${kind.path}`;
		case "connected":
			return `connected:${kind.cdpUrl}`;
		case "cmux":
			return `cmux:${kind.socketPath}`;
	}
}

export interface AcquireBrowserOptions {
	cwd: string;
	sessionId: string;
	viewport?: { width: number; height: number; deviceScaleFactor?: number };
	appArgs?: string[];
	signal?: AbortSignal;
	maxOwnedPerSession?: number;
	maxOwnedGlobal?: number;
	/** Workstream trust boundary for owned Chromium context reuse. */
	group?: string;
}

export async function acquireBrowser(kind: BrowserKind, opts: AcquireBrowserOptions): Promise<BrowserHandle> {
	const key = browserKey(kind, opts.group ?? "adhoc");
	const existing = browsers.get(key);
	if (existing) {
		if ("client" in existing) return existing;
		if (existing.browser.connected) return existing;
		browsers.delete(key);
		await disposeBrowserHandle(existing, { kill: false });
	}

	const handle = await openBrowserHandle(kind, opts, key);
	browsers.set(key, handle);
	return handle;
}

export function normalizeConnectedCdpUrl(rawCdpUrl: string): string {
	const cdpUrl = rawCdpUrl.replace(/\/+$/, "");
	if (/^wss?:\/\//i.test(cdpUrl)) {
		throw new ToolError(
			"browser app.cdp_url must be the HTTP CDP discovery endpoint (for example http://127.0.0.1:9222), not a ws:// browser websocket URL.",
		);
	}
	return cdpUrl;
}

async function openBrowserHandle(kind: BrowserKind, opts: AcquireBrowserOptions, key: string): Promise<BrowserHandle> {
	if (kind.kind === "cmux") {
		const client = new CmuxSocketClient({ socketPath: kind.socketPath, password: kind.password });
		await client.connect();
		return {
			key,
			kind,
			client,
			surface: kind.surface,
			refCount: 0,
		};
	}
	if (kind.kind === "headless") {
		const launch = await launchHeadlessBrowser({
			headless: kind.headless,
			sessionId: opts.sessionId,
			viewport: opts.viewport,
			maxOwnedPerSession: opts.maxOwnedPerSession,
			maxOwnedGlobal: opts.maxOwnedGlobal,
		});
		return {
			key,
			kind,
			browser: launch.browser,
			pid: launch.pid,
			ownership: launch.ownership,
			refCount: 0,
			stealth: { browserSession: null, override: null },
		};
	}
	if (kind.kind === "connected") {
		const cdpUrl = normalizeConnectedCdpUrl(kind.cdpUrl);
		await waitForCdp(cdpUrl, 5_000, opts.signal);
		const puppeteer = await loadPuppeteer();
		const browser = await puppeteer.connect({
			browserURL: cdpUrl,
			defaultViewport: null,
			protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
		});
		return {
			key,
			kind,
			browser,
			cdpUrl,
			refCount: 0,
			stealth: { browserSession: null, override: null },
		};
	}

	const exe = kind.path;
	if (!path.isAbsolute(exe)) {
		throw new ToolError(
			`app.path must be absolute (got ${JSON.stringify(exe)}). Pass the binary inside Foo.app/Contents/MacOS/, not the .app bundle.`,
		);
	}
	const reused = await findReusableCdp(exe, opts.signal);
	let cdpUrl: string;
	let pid: number;
	let subprocess: Subprocess | undefined;
	if (reused) {
		logger.debug("Reusing existing CDP endpoint for attach", { exe, pid: reused.pid, cdpUrl: reused.cdpUrl });
		cdpUrl = reused.cdpUrl;
		pid = reused.pid;
	} else {
		const killed = await killExistingByPath(exe, opts.signal);
		if (killed > 0) logger.debug("Killed existing instances before attach", { exe, killed });
		const port = await findFreeCdpPort();
		const launchArgs = [...(opts.appArgs ?? []), `--remote-debugging-port=${port}`];
		const child = Bun.spawn([exe, ...launchArgs], {
			stdout: "ignore",
			stderr: "ignore",
			stdin: "ignore",
		});
		child.unref();
		subprocess = child;
		pid = child.pid;
		cdpUrl = `http://127.0.0.1:${port}`;
		try {
			await waitForCdp(cdpUrl, 30_000, opts.signal);
		} catch (err) {
			await gracefulKillTreeOnce(child.pid).catch(() => undefined);
			if (err instanceof ToolAbortError) throw err;
			if (err instanceof Error && err.name === "AbortError") throw err;
			throw new ToolError(`Failed to attach to ${path.basename(exe)} on ${cdpUrl}: ${(err as Error).message}`);
		}
	}

	const puppeteer = await loadPuppeteer();
	let browser: Browser;
	try {
		browser = await puppeteer.connect({
			browserURL: cdpUrl,
			defaultViewport: null,
			protocolTimeout: BROWSER_PROTOCOL_TIMEOUT_MS,
		});
	} catch (err) {
		if (subprocess) await gracefulKillTreeOnce(subprocess.pid);
		throw new ToolError(`Connected to ${cdpUrl} but puppeteer.connect failed: ${(err as Error).message}`);
	}
	return {
		key,
		kind,
		browser,
		cdpUrl,
		pid,
		subprocess,
		refCount: 0,
		stealth: { browserSession: null, override: null },
	};
}

export function holdBrowser(handle: BrowserHandle): void {
	handle.refCount++;
	updateOwnedBrowserActiveTabs(handle);
}

export async function releaseBrowser(handle: BrowserHandle, opts: { kill: boolean }): Promise<void> {
	handle.refCount = Math.max(0, handle.refCount - 1);
	updateOwnedBrowserActiveTabs(handle);
	if (handle.refCount === 0) {
		// Only evict if the registry still points at THIS handle. After a disconnect,
		// `acquireBrowser` may have already replaced the entry with a fresh live handle
		// under the same key; deleting blindly would orphan that new browser.
		if (browsers.get(handle.key) === handle) browsers.delete(handle.key);
		await disposeBrowserHandle(handle, opts);
	}
}

export async function disposeAllBrowsers(): Promise<void> {
	const handles = [...browsers.values()];
	browsers.clear();
	const results = await Promise.allSettled(handles.map(handle => disposeBrowserHandle(handle, { kill: true })));
	for (const result of results) {
		if (result.status === "rejected") {
			logger.debug("Failed to dispose browser during shutdown", { error: String(result.reason) });
		}
	}
}

async function disposeBrowserHandle(handle: BrowserHandle, opts: { kill: boolean }): Promise<void> {
	if ("client" in handle) {
		handle.client.close();
		return;
	}
	if (handle.kind.kind === "headless") {
		try {
			if (handle.browser.connected) {
				const close = handle.browser.close().catch(err => {
					logger.debug("Failed to close headless browser", { error: (err as Error).message });
				});
				await Promise.race([close, Bun.sleep(2000)]);
			}
			if (handle.pid !== undefined) await gracefulKillTreeOnce(handle.pid);
		} finally {
			await removeOwnedBrowserProfile(handle.ownership);
		}
		return;
	}
	if (handle.kind.kind === "connected") {
		if (handle.browser.connected) {
			try {
				handle.browser.disconnect();
			} catch (err) {
				logger.debug("Failed to disconnect from remote browser", { error: (err as Error).message });
			}
		}
		return;
	}
	if (handle.browser.connected) {
		try {
			handle.browser.disconnect();
		} catch (err) {
			logger.debug("Failed to disconnect from spawned browser", { error: (err as Error).message });
		}
	}
	if (opts.kill && handle.subprocess) await gracefulKillTreeOnce(handle.subprocess.pid);
}

postmortem.register("browser-processes", disposeAllBrowsers);

function updateOwnedBrowserActiveTabs(handle: BrowserHandle): void {
	if (!("browser" in handle) || handle.kind.kind !== "headless") return;
	const ownership = handle.ownership;
	if (!ownership) return;
	const previous = activeTabUpdates.get(handle) ?? Promise.resolve();
	const update = previous.catch(() => undefined).then(() => recordOwnedBrowserActiveTabs(ownership, handle.refCount));
	activeTabUpdates.set(handle, update);
	void update.catch(error => {
		logger.debug("Failed to update owned browser activity", { error: String(error) });
	});
}
