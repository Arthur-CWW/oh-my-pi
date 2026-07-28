import { formatAge, formatDuration } from "@oh-my-pi/pi-utils";
import type { TranscriptDisplayContext } from "../modes/transcript-display";
import type { Theme } from "../modes/theme/theme";
import { renderTranscriptBodyLines } from "../modes/components/transcript-body";
import type { IrcDeliveryReceipt, IrcMessage } from "../irc/bus";
import { renderStatusLine, renderTreeList } from "../tui";
import type { IrcDetails } from "./irc";
import {
	formatBadge,
	formatErrorDetail,
	PREVIEW_LIMITS,
	replaceTabs,
	type ToolUIColor,
} from "./render-utils";

export interface IrcRenderArgs {
	op?: "send" | "wait" | "inbox" | "list";
	to?: string;
	from?: string;
	message?: string;
	await?: boolean;
	replyTo?: string;
	timeoutMs?: number;
	peek?: boolean;
}

export interface IrcRenderResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

const PEER_STATUS_ORDER: Record<string, number> = {
	running: 0,
	working: 0,
	waiting_input: 1,
	idle: 2,
	paused: 2,
	parked: 3,
	unknown: 4,
	disconnected: 5,
	external: 6,
};

export function ircGlyph(theme: Theme): string {
	return theme.styledSymbol("tool.irc", "accent");
}

function outcomeColor(outcome: IrcDeliveryReceipt["outcome"]): ToolUIColor {
	switch (outcome) {
		case "woken":
			return "success";
		case "revived":
			return "warning";
		case "injected":
			return "accent";
		case "failed":
			return "error";
	}
}

/** Glyph + status word, matching the agent-hub status conventions. */
function peerStatusBadge(status: string, theme: Theme): string {
	switch (status) {
		case "running":
			return theme.fg("accent", `${theme.status.running} running`);
		case "working":
			return theme.fg("accent", `${theme.status.running} working`);
		case "waiting_input":
			return theme.fg("warning", `${theme.status.pending} waiting_input`);
		case "idle":
			return theme.fg("success", `${theme.status.enabled} idle`);
		case "paused":
			return theme.fg("warning", `${theme.status.pending} paused`);
		case "parked":
			return theme.fg("muted", `${theme.status.shadowed} parked`);
		case "unknown":
			return theme.fg("muted", `${theme.status.shadowed} unknown`);
		case "disconnected":
			return theme.fg("muted", `${theme.status.shadowed} disconnected`);
		case "external":
			return theme.fg("accent", "[external]");
		default:
			return theme.fg("error", `${theme.status.aborted} ${status}`);
	}
}

export function messageAge(ts: number | undefined): string {
	if (!ts) return "";
	return formatAge(Math.max(1, Math.round((Date.now() - ts) / 1000)));
}

function textContent(result: IrcRenderResult): string {
	return result.content.find(part => part.type === "text")?.text?.trim() ?? "";
}

/** Header title carrying the op direction: `IRC ➤ peer` out, `IRC ⟵ peer` in. */
export function ircCallTitle(args: IrcRenderArgs | undefined, theme: Theme): string {
	switch (args?.op) {
		case "send":
			return `IRC ${theme.nav.selected} ${args.to?.trim() || "…"}`;
		case "wait":
			return `IRC ${theme.nav.back} ${args.from?.trim() || "anyone"}`;
		case "inbox":
			return "IRC inbox";
		case "list":
			return "IRC peers";
		default:
			return "IRC";
	}
}

export function ircCallMeta(args: IrcRenderArgs | undefined): string[] {
	const meta: string[] = [];
	if (args?.op === "send") {
		if (args.to === "all") meta.push("broadcast");
		if (args.await) meta.push("await reply");
		if (args.replyTo) meta.push("reply");
	}
	if (args?.op === "wait" && args.timeoutMs) meta.push(`timeout ${formatDuration(args.timeoutMs)}`);
	if (args?.op === "inbox" && args.peek) meta.push("peek");
	return meta;
}

export function buildIrcCallLines(
	args: IrcRenderArgs,
	expanded: boolean,
	width: number,
	theme: Theme,
	transcriptDisplay?: TranscriptDisplayContext,
): string[] {
	const lines = [renderStatusLine({ icon: "pending", title: ircCallTitle(args, theme), meta: ircCallMeta(args) }, theme)];
	if (args.op === "send" && args.message?.trim()) {
		lines.push(
			...renderTranscriptBodyLines(args.message, expanded, theme, {
				indent: "  ",
				tone: "dim",
				collapsedLines: 1,
				width,
				transcriptDisplay,
			}),
		);
	}
	return lines;
}

function renderSendResult(
	result: IrcRenderResult,
	details: Partial<IrcDetails>,
	args: IrcRenderArgs | undefined,
	expanded: boolean,
	width: number,
	theme: Theme,
	transcriptDisplay?: TranscriptDisplayContext,
): string[] {
	const receipts = details.receipts ?? [];
	const to = details.to ?? args?.to?.trim() ?? "?";
	const title = `IRC ${theme.nav.selected} ${to}`;

	// Pre-delivery failures (validation) and empty broadcasts carry no receipts.
	if (receipts.length === 0) {
		const text = textContent(result) || (result.isError ? "Send failed." : "Nothing to deliver.");
		return [
			renderStatusLine({ icon: result.isError ? "error" : "warning", title }, theme),
			result.isError ? formatErrorDetail(text, theme) : `  ${theme.fg("muted", replaceTabs(text))}`,
		];
	}

	const delivered = receipts.filter(receipt => receipt.outcome !== "failed");
	const failedCount = receipts.length - delivered.length;
	const waited = details.waited;
	const timedOut = waited === null;

	const meta: string[] = [];
	if (to === "all") meta.push("broadcast");
	if (receipts.length === 1) {
		const receipt = receipts[0]!;
		meta.push(theme.fg(outcomeColor(receipt.outcome), receipt.outcome));
	} else {
		if (delivered.length > 0) meta.push(theme.fg("success", `${delivered.length} delivered`));
		if (failedCount > 0) meta.push(theme.fg("error", `${failedCount} failed`));
	}
	if (timedOut) meta.push(theme.fg("warning", "no reply"));

	const icon = result.isError
		? { icon: "error" as const }
		: timedOut
			? { icon: "warning" as const }
			: { iconOverride: ircGlyph(theme) };
	const lines = [renderStatusLine({ ...icon, title, meta }, theme)];

	const sent = args?.message?.trim();
	if (sent) {
		lines.push(
			...renderTranscriptBodyLines(sent, expanded, theme, {
				indent: "  ",
				tone: "dim",
				width,
				transcriptDisplay,
			}),
		);
	}

	if (receipts.length > 1 || failedCount > 0) {
		lines.push(
			...renderTreeList<IrcDeliveryReceipt>(
				{
					items: receipts,
					expanded,
					maxCollapsed: PREVIEW_LIMITS.COLLAPSED_ITEMS,
					itemType: "recipient",
					renderItem: receipt => {
						const badge = formatBadge(receipt.outcome, outcomeColor(receipt.outcome), theme);
						const error =
							receipt.outcome === "failed" && receipt.error
								? ` ${theme.fg("error", `${theme.format.dash} ${receipt.error}`)}`
								: "";
						return `${theme.fg("toolOutput", receipt.to)} ${badge}${error}`;
					},
				},
				theme,
			),
		);
	}

	if (waited) {
		const age = messageAge(waited.ts);
		lines.push(
			`  ${theme.fg("dim", theme.nav.back)} ${theme.fg("accent", waited.from)}${age ? ` ${theme.fg("dim", age)}` : ""}`,
		);
		lines.push(
			...renderTranscriptBodyLines(waited.body, expanded, theme, {
				indent: "  ",
				width,
				transcriptDisplay,
			}),
		);
	} else if (timedOut) {
		lines.push(`  ${theme.fg("warning", "No reply yet — they may answer later; check inbox or wait again.")}`);
	}
	return lines;
}

function renderWaitResult(
	result: IrcRenderResult,
	details: Partial<IrcDetails>,
	args: IrcRenderArgs | undefined,
	expanded: boolean,
	width: number,
	theme: Theme,
	transcriptDisplay?: TranscriptDisplayContext,
): string[] {
	const waited = details.waited;
	if (!waited) {
		const text = textContent(result) || "No message arrived.";
		return [
			renderStatusLine(
				{ icon: "warning", title: `IRC ${theme.nav.back} ${args?.from?.trim() || "anyone"}`, meta: ["timed out"] },
				theme,
			),
			`  ${theme.fg("muted", replaceTabs(text))}`,
		];
	}
	const meta = [messageAge(waited.ts)];
	if (waited.replyTo) meta.push("reply");
	return [
		renderStatusLine({ iconOverride: ircGlyph(theme), title: `IRC ${theme.nav.back} ${waited.from}`, meta }, theme),
		...renderTranscriptBodyLines(waited.body, expanded, theme, {
			indent: "  ",
			width,
			transcriptDisplay,
		}),
	];
}

function renderInboxResult(
	details: Partial<IrcDetails>,
	args: IrcRenderArgs | undefined,
	expanded: boolean,
	width: number,
	theme: Theme,
	transcriptDisplay?: TranscriptDisplayContext,
): string[] {
	const messages = details.inbox ?? [];
	if (messages.length === 0) {
		return [renderStatusLine({ iconOverride: ircGlyph(theme), title: "IRC inbox", meta: ["empty"] }, theme)];
	}
	const meta = [`${messages.length} ${messages.length === 1 ? "message" : "messages"}`];
	if (args?.peek) meta.push("peek");
	const header = renderStatusLine({ iconOverride: ircGlyph(theme), title: "IRC inbox", meta }, theme);
	const items = renderTreeList<IrcMessage>(
		{
			items: messages,
			expanded,
			maxCollapsed: PREVIEW_LIMITS.COLLAPSED_ITEMS,
			itemType: "message",
			renderItem: msg => {
				const age = messageAge(msg.ts);
				const replyBadge = msg.replyTo ? ` ${formatBadge("reply", "muted", theme)}` : "";
				const head = `${theme.fg("accent", msg.from)}${age ? ` ${theme.fg("dim", age)}` : ""}${replyBadge}`;
				return [
					head,
					...renderTranscriptBodyLines(msg.body, expanded, theme, {
						collapsedLines: 1,
						width,
						transcriptDisplay,
					}),
				];
			},
		},
		theme,
	);
	return [header, ...items];
}

function renderListResult(details: Partial<IrcDetails>, expanded: boolean, theme: Theme): string[] {
	const peers = [...(details.peers ?? [])].sort(
		(a, b) =>
			(PEER_STATUS_ORDER[a.status] ?? 9) - (PEER_STATUS_ORDER[b.status] ?? 9) || b.lastActivity - a.lastActivity,
	);
	if (peers.length === 0) {
		return [renderStatusLine({ icon: "info", title: "IRC peers", meta: ["no other agents"] }, theme)];
	}
	const counts = new Map<string, number>();
	for (const peer of peers) counts.set(peer.status, (counts.get(peer.status) ?? 0) + 1);
	const meta = [...counts].map(([status, count]) => `${count} ${status}`);
	const unreadTotal = peers.reduce((sum, peer) => sum + peer.unread, 0);
	if (unreadTotal > 0) meta.push(theme.fg("warning", `${unreadTotal} unread`));
	const header = renderStatusLine({ iconOverride: ircGlyph(theme), title: "IRC peers", meta }, theme);
	const items = renderTreeList(
		{
			items: peers,
			expanded,
			maxCollapsed: PREVIEW_LIMITS.COLLAPSED_ITEMS,
			itemType: "peer",
			renderItem: peer => {
				const kindText = peer.external
					? peer.cwd
						? `cwd ${peer.cwd}`
						: "external"
					: peer.parentId
						? `${peer.kind}${theme.sep.dot}of ${peer.parentId}`
						: peer.kind;
				const unread = peer.unread > 0 ? ` ${formatBadge(`${peer.unread} unread`, "warning", theme)}` : "";
				const age = messageAge(peer.lastActivity);
				const activity = peer.activity ? ` ${theme.fg("dim", replaceTabs(peer.activity))}` : "";
				const name = peer.external ? "" : ` ${theme.fg("dim", replaceTabs(peer.displayName))}`;
				return `${peerStatusBadge(peer.status, theme)} ${theme.bold(replaceTabs(peer.id))}${name} ${theme.fg("dim", kindText)}${activity}${unread}${age ? ` ${theme.fg("dim", age)}` : ""}`;
			},
		},
		theme,
	);
	return [header, ...items];
}

export function buildIrcResultLines(
	result: IrcRenderResult,
	details: Partial<IrcDetails>,
	args: IrcRenderArgs | undefined,
	expanded: boolean,
	width: number,
	theme: Theme,
	transcriptDisplay?: TranscriptDisplayContext,
): string[] {
	switch (details.op ?? args?.op) {
		case "send":
			return renderSendResult(result, details, args, expanded, width, theme, transcriptDisplay);
		case "wait":
			return renderWaitResult(result, details, args, expanded, width, theme, transcriptDisplay);
		case "inbox":
			return renderInboxResult(details, args, expanded, width, theme, transcriptDisplay);
		case "list":
			return renderListResult(details, expanded, theme);
		default: {
			const text = textContent(result) || (result.isError ? "IRC call failed." : "Done.");
			return [
				renderStatusLine({ icon: result.isError ? "error" : "success", title: ircCallTitle(args, theme) }, theme),
				result.isError ? formatErrorDetail(text, theme) : `  ${theme.fg("muted", replaceTabs(text))}`,
			];
		}
	}
}
