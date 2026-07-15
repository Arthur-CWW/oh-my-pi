import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

// Local cmux test surfaces are a pool, not disposable browser tabs:
// - exact local URLs reuse and focus the newest matching surface;
// - newly opened 127.0.0.1/localhost tabs belong to the OMP session and close
//   at shutdown;
// - portless-named apps such as video-eval.localhost are the persistent
//   monitored dev-server pool (one surface per exact URL).
// Keep non-local URLs and terminal/workspace lanes out of this policy.
//
// Agents should call `cmux_open_local` for local test URLs. The browser guard
// also blocks a direct `browser.open` local URL in cmux so it cannot bypass
// the URL pool and create another duplicate surface.

export type CmuxTabPool = "session" | "dev-server";
export type CmuxLocalTabAction = "focus-existing" | "open";

export interface CmuxSurfaceRecord {
	id: string;
	ref: string;
	url: string;
	title?: string;
	workspaceRef?: string;
	workspaceTitle?: string;
	index?: number;
}

export interface CmuxLocalTabDecision {
	action: CmuxLocalTabAction;
	url: string;
	pool: CmuxTabPool;
	surface?: CmuxSurfaceRecord;
	duplicates: CmuxSurfaceRecord[];
	trackAtSessionEnd: boolean;
}

export function isLocalTestUrl(value: string): boolean {
	try {
		const url = new URL(value.trim());
		const hostname = url.hostname.toLowerCase();
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			(hostname === "localhost" ||
				hostname.endsWith(".localhost") ||
				hostname === "127.0.0.1" ||
				hostname === "::1")
		);
	} catch {
		return false;
	}
}

export function normalizeLocalTestUrl(value: string): string | null {
	if (!isLocalTestUrl(value)) return null;
	try {
		return new URL(value.trim()).href;
	} catch {
		return null;
	}
}

export function isNamedDevServerUrl(value: string): boolean {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase();
		return hostname.endsWith(".localhost") && hostname !== "localhost";
	} catch {
		return false;
	}
}

function surfaceRecency(surface: CmuxSurfaceRecord): number {
	const match = /:(\d+)$/.exec(surface.ref);
	return match ? Number(match[1]) : surface.index ?? -1;
}

function newestSurface(surfaces: readonly CmuxSurfaceRecord[]): CmuxSurfaceRecord | undefined {
	return [...surfaces].sort((left, right) => surfaceRecency(right) - surfaceRecency(left))[0];
}

export function decideCmuxLocalTab(
	rawUrl: string,
	surfaces: readonly CmuxSurfaceRecord[],
	options: { pool?: CmuxTabPool } = {},
): CmuxLocalTabDecision {
	const url = normalizeLocalTestUrl(rawUrl);
	if (!url) throw new Error(`Only localhost test URLs can use the cmux local tab pool: ${rawUrl}`);
	const pool = options.pool ?? (isNamedDevServerUrl(url) ? "dev-server" : "session");
	const matching = surfaces.filter(surface => normalizeLocalTestUrl(surface.url) === url);
	const surface = newestSurface(matching);
	return {
		action: surface ? "focus-existing" : "open",
		url,
		pool,
		surface,
		duplicates: surface ? matching.filter(candidate => candidate.id !== surface.id) : [],
		trackAtSessionEnd: !surface && pool === "session",
	};
}

export function cmuxSurfacesFromTree(tree: unknown): CmuxSurfaceRecord[] {
	const surfaces: CmuxSurfaceRecord[] = [];
	const seen = new Set<string>();
	const visit = (value: unknown, workspaceRef?: string, workspaceTitle?: string): void => {
		if (!value || typeof value !== "object") return;
		if (Array.isArray(value)) {
			for (const entry of value) visit(entry, workspaceRef, workspaceTitle);
			return;
		}
		const record = value as Record<string, unknown>;
		const nextWorkspaceRef = typeof record.ref === "string" && record.ref.startsWith("workspace:")
			? record.ref
			: workspaceRef;
		const nextWorkspaceTitle = typeof record.title === "string" && nextWorkspaceRef !== workspaceRef
			? record.title
			: workspaceTitle;
		if (
			record.type === "browser" &&
			typeof record.id === "string" &&
			typeof record.ref === "string" &&
			typeof record.url === "string" &&
			!seen.has(record.id)
		) {
			seen.add(record.id);
			surfaces.push({
				id: record.id,
				ref: record.ref,
				url: record.url,
				title: typeof record.title === "string" ? record.title : undefined,
				workspaceRef: nextWorkspaceRef,
				workspaceTitle: nextWorkspaceTitle,
				index: typeof record.index === "number" ? record.index : undefined,
			});
		}
		for (const [key, child] of Object.entries(record)) {
			if (key !== "id" && key !== "ref" && key !== "url") visit(child, nextWorkspaceRef, nextWorkspaceTitle);
		}
	};
	visit(tree);
	return surfaces;
}

export function duplicateLocalTestSurfaces(surfaces: readonly CmuxSurfaceRecord[]): CmuxSurfaceRecord[] {
	const byUrl = new Map<string, CmuxSurfaceRecord[]>();
	for (const surface of surfaces) {
		const url = normalizeLocalTestUrl(surface.url);
		if (!url) continue;
		const group = byUrl.get(url) ?? [];
		group.push(surface);
		byUrl.set(url, group);
	}
	const duplicates: CmuxSurfaceRecord[] = [];
	for (const group of byUrl.values()) {
		const winner = newestSurface(group);
		if (winner) duplicates.push(...group.filter(surface => surface.id !== winner.id));
	}
	return duplicates;
}

interface CmuxCommandResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

function cmuxExecutable(): string {
	return process.env.CMUX_OMP_CMUX_BIN || "cmux";
}

function runCmux(args: readonly string[]): Promise<CmuxCommandResult> {
	return new Promise(resolve => {
		const child = spawn(cmuxExecutable(), [...args], {
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
		child.on("error", error => resolve({ exitCode: 1, stdout: "", stderr: error.message }));
		child.on("close", code =>
			resolve({
				exitCode: code ?? 1,
				stdout: Buffer.concat(stdout).toString("utf8"),
				stderr: Buffer.concat(stderr).toString("utf8"),
			}),
		);
	});
}

async function cmuxRpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
	const result = await runCmux(["rpc", method, JSON.stringify(params)]);
	if (result.exitCode !== 0) throw new Error(result.stderr || `cmux ${method} failed`);
	try {
		const parsed: unknown = JSON.parse(result.stdout);
		if (!parsed || typeof parsed !== "object") throw new Error("invalid response");
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(`cmux ${method} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function cmuxContextParams(): Record<string, unknown> {
	const params: Record<string, unknown> = {};
	if (process.env.CMUX_WORKSPACE_ID) params.workspace_id = process.env.CMUX_WORKSPACE_ID;
	if (process.env.CMUX_SURFACE_ID) params.surface_id = process.env.CMUX_SURFACE_ID;
	return params;
}

async function currentCmuxSurfaces(): Promise<CmuxSurfaceRecord[]> {
	const tree = await cmuxRpc("system.tree", { all: true });
	return cmuxSurfacesFromTree(tree);
}

async function closeSurface(surface: CmuxSurfaceRecord): Promise<void> {
	await cmuxRpc("surface.close", { surface_id: surface.id }).catch(() => undefined);
}

async function focusSurface(surface: CmuxSurfaceRecord): Promise<void> {
	await cmuxRpc("surface.focus", { surface_id: surface.id });
}

async function openSurface(url: string): Promise<CmuxSurfaceRecord> {
	const params = { ...cmuxContextParams(), url, focus: false };
	if (!params.surface_id) {
		const tree = await cmuxRpc("system.tree", { all: true });
		const active = tree.active;
		if (active && typeof active === "object" && typeof (active as Record<string, unknown>).surface_id === "string") {
			params.surface_id = (active as Record<string, unknown>).surface_id;
		}
	}
	const opened = await cmuxRpc("browser.open_split", params);
	const id = typeof opened.surface_id === "string" ? opened.surface_id : null;
	const ref = typeof opened.surface_ref === "string" ? opened.surface_ref : null;
	if (!id || !ref) throw new Error("cmux browser.open_split did not return a surface handle");
	return {
		id,
		ref,
		url,
		title: undefined,
		workspaceRef: typeof opened.workspace_ref === "string" ? opened.workspace_ref : undefined,
	};
}

const BROWSER_TASK_RE =
  /\b(browser|chrome|chromium|helium|firefox|safari|playwright|puppeteer|cdp|devtools|scrap(?:e|ing)|api\s+revers|network\s+requests?|websocket|frontend)\b/i;

const GUIDANCE = `Browser automation safety policy for this turn:
- Prefer headless or protocol-only browser automation. Use CDP/Playwright/Puppeteer APIs, not OS click/type automation.
- Do not open DevTools UI for API reversing. Use CDP Network/Fetch events instead: Network.requestWillBeSent, Network.responseReceived, Network.getResponseBody, Network.webSocketFrameReceived/Sent, Fetch.requestPaused.
- Do not call page.bringToFront(), Target.activateTarget, Target.openDevTools, browsingContext.activate, or use --auto-open-devtools-for-tabs.
- When creating Chromium targets through CDP, use Target.createTarget({ url, background: true }) and do not select/activate the tab.
- On macOS, launch browser apps with open -g/-j or an existing guarded CDP profile. Never use AppleScript activate for automation.
- For local cmux testing, call cmux_open_local with the exact URL. It reuses and focuses the newest matching surface, tracks numeric localhost tabs for session cleanup, and keeps one persistent monitored tab per named portless app such as video-eval.localhost.
- If a visible foreground browser is explicitly required by the human, state that first and run the command with AGENT_ALLOW_FOREGROUND_BROWSER=1.`;

const BLOCK_ADVICE = `Use background-safe automation instead: headless mode, an existing guarded CDP browser, Target.createTarget({url, background: true}), and CDP Network/Fetch APIs for API reversing. For cmux local test URLs, use cmux_open_local instead of browser.open or cmux browser open. If available, load /skill:background-browser-automation. If the human explicitly asked for visible foreground browser control, rerun with AGENT_ALLOW_FOREGROUND_BROWSER=1.`;

const UNSAFE_BASH_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bbringToFront\s*\(/i, reason: "page.bringToFront() focuses a browser tab/window." },
  { re: /\bTarget\.activateTarget\b|["']Target\.activateTarget["']/i, reason: "Target.activateTarget focuses a browser target." },
  { re: /\bTarget\.openDevTools\b|["']Target\.openDevTools["']/i, reason: "Target.openDevTools opens a foreground DevTools window." },
  { re: /\bbrowsingContext\.activate\b|["']browsingContext\.activate["']/i, reason: "WebDriver BiDi browsingContext.activate focuses a browsing context." },
  { re: /--auto-open-devtools-for-tabs\b/i, reason: "--auto-open-devtools-for-tabs opens foreground DevTools windows." },
  { re: /\b(?:npx\s+)?playwright\s+codegen\b/i, reason: "playwright codegen is an interactive foreground browser workflow." },
  { re: /\b(?:npx\s+)?playwright\s+.*\s--ui\b/i, reason: "Playwright UI is a foreground interactive workflow." },
  { re: /\b(?:playwright|puppeteer|chrome|chromium|helium)\b[^\n]*\s--headed\b/i, reason: "headed browser automation can steal focus; use headless or a guarded CDP profile." },
];

const UNSAFE_CODE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bbringToFront\s*\(/i, reason: "page.bringToFront() focuses a browser tab/window." },
  { re: /["']Target\.activateTarget["']/i, reason: "Target.activateTarget focuses a browser target." },
  { re: /["']Target\.openDevTools["']/i, reason: "Target.openDevTools opens a foreground DevTools window." },
  { re: /["']browsingContext\.activate["']/i, reason: "WebDriver BiDi browsingContext.activate focuses a browsing context." },
  { re: /--auto-open-devtools-for-tabs\b/i, reason: "--auto-open-devtools-for-tabs opens foreground DevTools windows." },
];

const CODE_PATH_RE = /\.(?:[cm]?[jt]sx?|py|sh|bash|zsh|fish)$/i;

function foregroundAllowed(commandOrText = ""): boolean {
  return process.env.AGENT_ALLOW_FOREGROUND_BROWSER === "1"
    || process.env.PI_ALLOW_FOREGROUND_BROWSER === "1"
    || /\b(?:AGENT_ALLOW_FOREGROUND_BROWSER|PI_ALLOW_FOREGROUND_BROWSER)=1\b/.test(commandOrText);
}

function unsafeOpenReason(command: string): string | null {
  if (!/\bopen\b/.test(command)) return null;
  if (/\bopen\b[^\n;&|]*\s-[^\s;&|]*[gj][^\s;&|]*/i.test(command)) return null;
  if (/\bopen\b[^\n;&|]*(?:https?:\/\/|-a\s+["']?(?:Google Chrome|Google Chrome for Testing|Chromium|Chrome|Helium|Firefox|Safari)\b|\/Applications\/[^\n;&|]*(?:Chrome|Chromium|Helium|Firefox|Safari)[^\n;&|]*\.app)/i.test(command)) {
    return "macOS open without -g/-j can activate the browser.";
  }
  return null;
}

function blockedBashReason(command: string): string | null {
  const openReason = unsafeOpenReason(command);
  if (openReason) return openReason;

  for (const pattern of UNSAFE_BASH_PATTERNS) {
    if (pattern.re.test(command)) return pattern.reason;
  }
  return null;
}

function blockedCodeReason(path: string, text: string): string | null {
  if (!CODE_PATH_RE.test(path)) return null;
  for (const pattern of UNSAFE_CODE_PATTERNS) {
    if (pattern.re.test(text)) return pattern.reason;
  }
  return null;
}

function editTextForScan(input: unknown): { path: string; text: string } | null {
  const value = input as { path?: unknown; edits?: Array<{ newText?: unknown }> };
  if (typeof value?.path !== "string" || !Array.isArray(value.edits)) return null;
  const text = value.edits
    .map((edit) => typeof edit.newText === "string" ? edit.newText : "")
    .join("\n");
  return { path: value.path, text };
}

function writeTextForScan(input: unknown): { path: string; text: string } | null {
  const value = input as { path?: unknown; content?: unknown };
  if (typeof value?.path !== "string" || typeof value.content !== "string") return null;
  return { path: value.path, text: value.content };
}

const sessionOwnedSurfaceIds = new Set<string>();

async function closeDuplicateSurfaces(surfaces: readonly CmuxSurfaceRecord[]): Promise<void> {
	await Promise.all(surfaces.map(surface => closeSurface(surface)));
}

async function openOrReuseLocalTab(rawUrl: string, requestedPool?: CmuxTabPool): Promise<CmuxLocalTabDecision> {
	const surfaces = await currentCmuxSurfaces();
	const decision = decideCmuxLocalTab(rawUrl, surfaces, { pool: requestedPool });
	if (decision.action === "focus-existing" && decision.surface) {
		await focusSurface(decision.surface);
		await closeDuplicateSurfaces(decision.duplicates);
		return decision;
	}
	const opened = await openSurface(decision.url);
	if (decision.trackAtSessionEnd) sessionOwnedSurfaceIds.add(opened.id);
	return { ...decision, surface: opened };
}

async function closeSessionOwnedSurfaces(): Promise<void> {
	const surfaceIds = [...sessionOwnedSurfaceIds];
	sessionOwnedSurfaceIds.clear();
	await Promise.all(
		surfaceIds.map(surfaceId => cmuxRpc("surface.close", { surface_id: surfaceId }).catch(() => undefined)),
	);
}

function localBrowserOpenUrl(event: unknown): string | null {
	const typed = event as { toolName?: unknown; input?: unknown };
	if (typed.toolName !== "browser" || !typed.input || typeof typed.input !== "object") return null;
	const input = typed.input as { action?: unknown; url?: unknown; app?: unknown };
	if (input.action !== "open" || input.app !== undefined || typeof input.url !== "string") return null;
	return normalizeLocalTestUrl(input.url);
}

async function guardLocalBrowserOpen(event: unknown): Promise<{ block: true; reason: string } | undefined> {
	const url = localBrowserOpenUrl(event);
	if (!url || !process.env.CMUX_SOCKET_PATH) return undefined;
	try {
		const decision = decideCmuxLocalTab(url, await currentCmuxSurfaces());
		if (decision.action === "focus-existing" && decision.surface) {
			await focusSurface(decision.surface);
			await closeDuplicateSurfaces(decision.duplicates);
			return {
				block: true,
				reason: `Reused existing cmux local surface ${decision.surface.ref} for ${url}. Use cmux_open_local for the successful pooled open result.`,
			};
		}
		return {
			block: true,
			reason: `Local cmux opens must use cmux_open_local so the session pool can track ${url}.`,
		};
	} catch {
		return {
			block: true,
			reason: `Local cmux opens must use cmux_open_local for ${url}; the cmux surface inventory was unavailable.`,
		};
	}
}

export default function browserAutomationGuard(pi: ExtensionAPI) {
	const { z } = pi.zod;

	pi.registerTool({
		name: "cmux_open_local",
		label: "Open Local Test Surface",
		description:
			"Open or reuse one cmux browser surface for an exact localhost test URL. Named .localhost dev-server URLs are persistent; numeric localhost URLs close with the session.",
		parameters: z.object({
			url: z.string().describe("Exact local test URL to open or focus"),
			pool: z
				.enum(["session", "dev-server"])
				.optional()
				.describe("Override the pool; named .localhost URLs default to dev-server"),
		}),
		approval: "write",
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			if (signal?.aborted) throw new Error("Local cmux surface open aborted");
			const decision = await openOrReuseLocalTab(params.url, params.pool);
			const surface = decision.surface;
			const action = decision.action === "focus-existing" ? "Focused" : "Opened";
			return {
				content: [
					{
						type: "text",
						text: `${action} ${surface?.ref ?? "cmux surface"} for ${decision.url}${decision.pool === "dev-server" ? " (persistent dev-server pool)" : " (session-owned)"}`,
					},
				],
				details: {
					action: decision.action,
					url: decision.url,
					pool: decision.pool,
					surfaceRef: surface?.ref,
					surfaceId: surface?.id,
					closedDuplicateRefs: decision.duplicates.map(candidate => candidate.ref),
					trackAtSessionEnd: decision.trackAtSessionEnd,
				},
			};
		},
		onSession: async event => {
			if (event.reason === "start" || event.reason === "switch" || event.reason === "branch" || event.reason === "tree") {
				sessionOwnedSurfaceIds.clear();
			} else if (event.reason === "shutdown") {
				await closeSessionOwnedSurfaces();
			}
		},
	});

	pi.on("before_agent_start", event => {
		if (!BROWSER_TASK_RE.test(event.prompt)) return undefined;
		return { systemPrompt: `${event.systemPrompt}\n\n${GUIDANCE}` };
	});

	pi.on("session_shutdown", async () => {
		await closeSessionOwnedSurfaces();
	});

	pi.on("tool_call", async event => {
		const localBrowserGuard = await guardLocalBrowserOpen(event);
		if (localBrowserGuard) return localBrowserGuard;

		if (event.toolName === "bash") {
			const command = String((event.input as { command?: unknown }).command ?? "");
			if (!foregroundAllowed(command)) {
				const reason = blockedBashReason(command);
				if (reason) return { block: true, reason: `${reason}\n\n${BLOCK_ADVICE}` };
			}
		}

		if (event.toolName === "write") {
			const scan = writeTextForScan(event.input);
			if (scan && !foregroundAllowed(scan.text)) {
				const reason = blockedCodeReason(scan.path, scan.text);
				if (reason) return { block: true, reason: `${reason}\n\n${BLOCK_ADVICE}` };
			}
		}

		if (event.toolName === "edit") {
			const scan = editTextForScan(event.input);
			if (scan && !foregroundAllowed(scan.text)) {
				const reason = blockedCodeReason(scan.path, scan.text);
				if (reason) return { block: true, reason: `${reason}\n\n${BLOCK_ADVICE}` };
			}
		}

		return undefined;
	});
}
