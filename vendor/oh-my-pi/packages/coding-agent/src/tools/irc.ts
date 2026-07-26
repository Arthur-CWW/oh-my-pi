/**
 * IRC tool — agent-to-agent messaging over the process-global IrcBus.
 *
 * `send` is fire-and-forget: the bus routes the message to the recipient
 * (waking idle agents with a real turn, reviving parked ones via the
 * lifecycle manager, injecting a non-interrupting aside into busy ones) and
 * returns delivery receipts immediately. Replies are real turns by the
 * recipient, observed with `wait` (or the `await: true` send sugar). `inbox`
 * drains pending messages; `list` shows every addressable peer.
 */

import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { ToolExample } from "@oh-my-pi/pi-ai";
import type { Component } from "@oh-my-pi/pi-tui";
import { formatDuration, prompt } from "@oh-my-pi/pi-utils";
import { z } from "zod/v4";
import type { Settings } from "../config/settings";
import type { RenderResultOptions } from "../extensibility/custom-tools/types";
import { IrcBus, type IrcDeliveryReceipt, type IrcDeliveryRecord, type IrcMessage } from "../irc/bus";
import { getIrcExternalPeerDisplayState, IrcExternalBus, resolveIrcExternalPeerName } from "../irc/bus-external";
import { renderTranscriptBodyLines } from "../modes/components/transcript-body";
import type { Theme } from "../modes/theme/theme";
import { type TranscriptDisplayContext, transcriptDisplayCacheVersion } from "../modes/transcript-display";
import ircDescription from "../prompts/tools/irc.md" with { type: "text" };
import type { AgentRegistry } from "../registry/agent-registry";
import { createFleetCapability } from "../session/fleet-capability";
import { CURRENT_SESSION_CONTROL_PROTOCOL } from "../session/session-control";
import { canSpawnAtDepth } from "../task/types";
import { Ellipsis, renderStatusLine, truncateToWidth } from "../tui";
import type { ToolSession } from ".";
import { buildIrcCallLines, buildIrcResultLines, type IrcRenderArgs, ircGlyph, messageAge } from "./irc-renderer";
import { createCachedComponent } from "./render-utils";

const DEFAULT_IRC_TIMEOUT_MS = 120_000;

/**
 * IRC availability: there must be someone to chat with. True for every
 * subagent (it always has a parent, and possibly siblings) and for any
 * session that can still spawn subagents through the task tool. Only a
 * top-level session with task spawning unavailable has no peers — no irc.
 */
export function isIrcEnabled(settings: Settings, taskDepth: number): boolean {
	if (taskDepth > 0) return true;
	// Top-level session: peers exist only if it can still spawn subagents — the
	// same capacity gate the task tool uses, reused here to avoid drift.
	const maxDepth = settings.get("task.maxRecursionDepth") ?? 2;
	return canSpawnAtDepth(maxDepth, taskDepth);
}

const ircSchema = z.object({
	op: z.enum(["send", "wait", "inbox", "list"]).describe("irc operation"),
	to: z.string().optional().describe('send: recipient agent id or "all"'),
	message: z.string().optional().describe("send: message body"),
	replyTo: z.string().optional().describe("send: message id being answered"),
	await: z.boolean().optional().describe('send: wait for the recipient\'s reply (invalid with to:"all")'),
	from: z.string().optional().describe("wait: only accept a message from this agent id"),
	timeoutMs: z.number().optional().describe("wait: timeout in milliseconds (0 waits indefinitely)"),
	peek: z.boolean().optional().describe("inbox: list messages without consuming them"),
	includeParked: z.boolean().optional().describe("list: include parked historical children (default false)"),
});

type IrcParams = z.infer<typeof ircSchema>;

interface IrcPeerInfo {
	id: string;
	displayName: string;
	kind: string;
	status: string;
	parentId?: string;
	unread: number;
	lastActivity: number;
	activity?: string;
	cwd?: string;
	external?: boolean;
	pendingDeliveries?: number;
	undeliveredDeliveries?: number;
	lastDelivery?: IrcDeliveryRecord;
}

export interface IrcDetails {
	op: "send" | "wait" | "inbox" | "list";
	from?: string;
	to?: string;
	receipts?: IrcDeliveryReceipt[];
	/** Message consumed by `wait` / `send await:true`; null when the wait timed out. */
	waited?: IrcMessage | null;
	inbox?: IrcMessage[];
	peers?: IrcPeerInfo[];
}

function formatIncoming(msg: IrcMessage): string {
	const replyTag = msg.replyTo ? ` (reply to ${msg.replyTo})` : "";
	return `[${msg.id}] ${msg.from}${replyTag}: ${msg.body}`;
}

export class IrcTool implements AgentTool<typeof ircSchema, IrcDetails> {
	readonly name = "irc";
	readonly approval = "read" as const;
	readonly label = "IRC";
	readonly summary = "Send and receive messages between agents";
	readonly description: string;
	readonly parameters = ircSchema;
	readonly strict = true;

	readonly examples: readonly ToolExample<z.input<typeof ircSchema>>[] = [
		{
			caption: "List peers",
			call: { op: "list" },
		},
		{
			caption: "Fire-and-forget DM — same send wakes idle/parked peers",
			call: {
				op: "send",
				to: "AuthLoader",
				message: "Still touching src/server/auth.ts? I need to add a 401 path.",
			},
		},
		{
			caption: "Round-trip when you cannot proceed without the answer",
			call: {
				op: "send",
				to: "Main",
				message: "JWT or session cookies for the auth flow?",
				await: true,
			},
		},
		{
			caption: "Block until a specific peer answers",
			call: { op: "wait", from: "AuthLoader", timeoutMs: 60000 },
		},
		{
			caption: "Drain pending messages",
			call: { op: "inbox" },
		},
		{
			caption: "Broadcast to live peers (no replies expected)",
			call: {
				op: "send",
				to: "all",
				message: "About to refactor src/server/middleware/*. Anyone already in there?",
			},
		},
	];
	readonly loadMode = "discoverable";
	constructor(
		private readonly session: ToolSession,
		private readonly externalBus?: IrcExternalBus | null,
	) {
		this.description = prompt.render(ircDescription);
	}

	static createIf(session: ToolSession): IrcTool | null {
		if (!isIrcEnabled(session.settings, session.taskDepth ?? 0)) return null;
		if (!session.agentRegistry || !session.getAgentId) return null;
		return new IrcTool(session);
	}

	async execute(
		_toolCallId: string,
		params: IrcParams,
		signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<IrcDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<IrcDetails>> {
		const registry = this.session.agentRegistry;
		const senderId = this.session.getAgentId?.() ?? null;
		if (!registry) {
			return errorResult("IRC is unavailable in this session.", { op: params.op });
		}
		if (!senderId) {
			return errorResult("IRC is unavailable: caller has no agent id.", { op: params.op });
		}

		switch (params.op) {
			case "list":
				return this.#executeList(registry, senderId, params.includeParked ?? false);
			case "send":
				return this.#executeSend(registry, senderId, params, signal);
			case "wait":
				return this.#executeWait(senderId, params, signal);
			case "inbox":
				return this.#executeInbox(senderId, params);
			default:
				return errorResult("Unknown irc op.", { op: params.op });
		}
	}

	#executeList(registry: AgentRegistry, senderId: string, includeParked: boolean): AgentToolResult<IrcDetails> {
		const bus = IrcBus.global();
		const localPeers: IrcPeerInfo[] = registry
			.list()
			.filter(ref => ref.id !== senderId && ref.status !== "aborted")
			.map(ref => ({
				id: ref.id,
				displayName: ref.displayName,
				kind: ref.kind,
				status: ref.status,
				parentId: ref.parentId,
				unread: bus.unreadCount(ref.id),
				pendingDeliveries: bus.peerDeliverySummary(ref.id).pendingCount,
				undeliveredDeliveries: bus.peerDeliverySummary(ref.id).undeliveredCount,
				lastDelivery: bus.peerDeliverySummary(ref.id).lastMessage,
				lastActivity: ref.lastActivity,
				activity: ref.activity,
			}));
		const external = this.#registerExternalPeer();
		const externalPeers: IrcPeerInfo[] = external
			? external.bus.listPeers({ excludeSessionId: external.sessionId }).map(peer => ({
					id: peer.name,
					displayName: "[external]",
					kind: "external",
					status: getIrcExternalPeerDisplayState(peer),
					unread: external.bus.unreadCount(peer.name),
					lastActivity: Date.parse(peer.lastSeen) || Date.now(),
					cwd: peer.cwd,
					external: true,
					lastDelivery: external.bus.recentDeliveries({ peerId: peer.name, limit: 1 })[0],
				}))
			: [];
		const omittedParked = includeParked ? 0 : localPeers.filter(peer => peer.status === "parked").length;
		const visibleLocalPeers = includeParked
			? localPeers
			: localPeers.filter(
					peer =>
						peer.status !== "parked" ||
						peer.unread > 0 ||
						(peer.pendingDeliveries ?? 0) > 0 ||
						(peer.undeliveredDeliveries ?? 0) > 0,
				);
		const peers = [...visibleLocalPeers, ...externalPeers];
		const lines: string[] = [];
		if (peers.length === 0) {
			lines.push("No other agents.");
		} else {
			lines.push(`${peers.length} peer(s):`);
			for (const peer of peers) {
				if (peer.external) {
					const extras = [
						peer.cwd ? `cwd ${peer.cwd}` : undefined,
						peer.unread > 0 ? `unread ${peer.unread}` : undefined,
						`active ${formatDuration(Date.now() - peer.lastActivity)} ago`,
					].filter(Boolean);
					lines.push(`- ${peer.id} [external, ${peer.status}] — ${extras.join(", ")}`);
					continue;
				}
				const extras = [
					peer.activity || undefined,
					peer.unread > 0 ? `unread ${peer.unread}` : undefined,
					peer.pendingDeliveries ? `pending ${peer.pendingDeliveries}` : undefined,
					peer.undeliveredDeliveries ? `undelivered ${peer.undeliveredDeliveries}` : undefined,
					peer.lastDelivery ? `last message ${peer.lastDelivery.state}` : undefined,
					peer.parentId ? `parent ${peer.parentId}` : undefined,
					`active ${formatDuration(Date.now() - peer.lastActivity)} ago`,
				].filter(Boolean);
				lines.push(`- ${peer.id} [${peer.displayName} · ${peer.kind} · ${peer.status}] — ${extras.join(", ")}`);
			}
			if (omittedParked > 0) {
				lines.push(
					`- ${omittedParked} parked historical child${omittedParked === 1 ? "" : "ren"} omitted; use includeParked:true or an exact history://<id>.`,
				);
			}
			if (peers.some(peer => peer.status === "parked")) {
				lines.push("");
				lines.push("Parked agents are revived automatically when you message them.");
			}
		}
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: { op: "list", from: senderId, peers },
		};
	}

	async #executeSend(
		registry: AgentRegistry,
		senderId: string,
		params: IrcParams,
		signal?: AbortSignal,
	): Promise<AgentToolResult<IrcDetails>> {
		const to = params.to?.trim();
		const message = params.message?.trim();
		if (!to) {
			return errorResult('`to` is required for op="send".', { op: "send", from: senderId });
		}
		if (!message) {
			return errorResult('`message` is required for op="send".', { op: "send", from: senderId });
		}
		if (to === senderId) {
			return errorResult("Cannot send an IRC message to yourself.", { op: "send", from: senderId, to });
		}
		const isBroadcast = to === "all";
		if (isBroadcast && params.await) {
			return errorResult('`await` is invalid with to:"all" — broadcasts have no single replier.', {
				op: "send",
				from: senderId,
				to,
			});
		}

		const external = this.#registerExternalPeer();
		if (external?.name === to) {
			return errorResult("Cannot send an IRC message to yourself.", { op: "send", from: senderId, to });
		}
		const localTarget = !isBroadcast ? registry.get(to) : undefined;
		const externalTarget =
			!isBroadcast && (!localTarget || localTarget.session === null) && external
				? external.bus.findPeerByName(to, { excludeSessionId: external.sessionId })
				: undefined;
		if (external && externalTarget) {
			if (params.await) {
				return errorResult("`await:true` is in-process-only; external peers receive fire-and-forget messages.", {
					op: "send",
					from: senderId,
					to,
				});
			}
			external.bus.sendMessage({
				fromPeer: external.name,
				toPeer: externalTarget.name,
				body: message,
				audience: "direct",
			});
			const receipts: IrcDeliveryReceipt[] = [{ to: externalTarget.name, outcome: "injected" }];
			return {
				content: [{ type: "text", text: `Delivered to 1 peer(s):\n- ${externalTarget.name}: injected` }],
				details: { op: "send", from: senderId, to, receipts },
			};
		}

		const bus = IrcBus.global();
		let waited: IrcMessage | null | undefined;
		const timeoutMs = params.await ? this.#resolveTimeoutMs(params) : undefined;
		const awaitAbort = params.await ? new AbortController() : undefined;
		const awaitCancelled = new Error("IRC await cancelled");
		let removeAwaitAbortListener: (() => void) | undefined;
		const waiting = params.await
			? bus
					.wait(senderId, { from: to }, timeoutMs ?? DEFAULT_IRC_TIMEOUT_MS, awaitAbort?.signal, {
						drainPending: false,
					})
					.then(
						message => ({ message, error: null as Error | null }),
						error => ({
							message: null,
							error: error === awaitCancelled ? null : error instanceof Error ? error : new Error(String(error)),
						}),
					)
			: undefined;
		if (params.await && signal && awaitAbort) {
			if (signal.aborted) {
				awaitAbort.abort(signal.reason instanceof Error ? signal.reason : new Error("IRC wait aborted"));
			} else {
				const onAbort = (): void => {
					awaitAbort.abort(signal.reason instanceof Error ? signal.reason : new Error("IRC wait aborted"));
				};
				signal.addEventListener("abort", onAbort, { once: true });
				removeAwaitAbortListener = () => signal.removeEventListener("abort", onAbort);
			}
		}

		try {
			// Broadcasts fan out to live peers only (running | idle); reviving every
			// parked agent on a broadcast would be a stampede. Direct sends go
			// through the bus unfiltered so parked recipients are revived.
			const targets = isBroadcast ? registry.listVisibleTo(senderId).map(ref => ref.id) : [to];
			const receipts = await Promise.all(
				targets.map(target =>
					bus.send(
						{ from: senderId, to: target, body: message, replyTo: params.replyTo },
						// Awaited sends mark the sender as blocked on an answer so a
						// busy recipient that cannot reach a step boundary (async
						// disabled) auto-replies instead of stranding the sender.
						params.await ? { expectsReply: true } : undefined,
					),
				),
			);

			const lines: string[] = [];
			const delivered = receipts.filter(receipt => receipt.outcome !== "failed");
			if (targets.length === 0) {
				lines.push("No live peers to broadcast to.");
			} else if (delivered.length === 0) {
				lines.push("No recipients received the message.");
			} else {
				lines.push(`Delivered to ${delivered.length} peer(s):`);
			}
			for (const receipt of receipts) {
				lines.push(
					receipt.outcome === "failed"
						? `- ${receipt.to}: failed — ${receipt.error ?? "unknown error"}`
						: `- ${receipt.to}: ${receipt.outcome}`,
				);
			}

			if (params.await && waiting && timeoutMs !== undefined) {
				lines.push("");
				if (delivered.length > 0) {
					const reply = await waiting;
					if (reply.error) throw reply.error;
					waited = reply.message;
					if (waited) {
						lines.push(`Reply from ${waited.from}:`);
						lines.push(waited.body);
					} else {
						lines.push(
							`No reply from ${to} within ${formatDuration(timeoutMs)}. ` +
								"They may answer later — check `inbox` or `wait` again.",
						);
					}
				} else {
					awaitAbort?.abort(awaitCancelled);
					const reply = await waiting;
					if (reply.error) throw reply.error;
				}
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: {
					op: "send",
					from: senderId,
					to,
					receipts,
					...(waited !== undefined ? { waited } : {}),
				},
				isError: delivered.length === 0 && targets.length > 0,
			};
		} finally {
			awaitAbort?.abort(awaitCancelled);
			removeAwaitAbortListener?.();
		}
	}

	async #executeWait(senderId: string, params: IrcParams, signal?: AbortSignal): Promise<AgentToolResult<IrcDetails>> {
		const from = params.from?.trim() || undefined;
		const timeoutMs = this.#resolveTimeoutMs(params);
		const waited = await IrcBus.global().wait(senderId, { from }, timeoutMs, signal);
		if (!waited) {
			const filterNote = from ? ` from ${from}` : "";
			return {
				content: [{ type: "text", text: `No message${filterNote} within ${formatDuration(timeoutMs)}.` }],
				details: { op: "wait", from: senderId, waited: null },
				// A clean wait timeout carries no information once consumed.
				useless: true,
			};
		}
		return {
			content: [{ type: "text", text: formatIncoming(waited) }],
			details: { op: "wait", from: senderId, waited },
		};
	}

	#executeInbox(senderId: string, params: IrcParams): AgentToolResult<IrcDetails> {
		const localMessages = IrcBus.global().inbox(senderId, { peek: params.peek });
		const external = this.#registerExternalPeer();
		const externalMessages: IrcMessage[] = external
			? external.bus.drainMessages(external.name, { peek: params.peek }).map(message => ({
					id: `external:${message.id}`,
					from: message.fromPeer,
					to: senderId,
					body: message.body,
					ts: Date.parse(message.ts) || Date.now(),
					origin: message.origin,
				}))
			: [];
		const messages = [...localMessages, ...externalMessages];
		if (messages.length === 0) {
			return {
				content: [{ type: "text", text: "Inbox empty." }],
				details: { op: "inbox", from: senderId, inbox: [] },
				// An empty inbox drain carries no information once consumed.
				useless: true,
			};
		}
		const header = params.peek ? `${messages.length} unread message(s):` : `${messages.length} message(s):`;
		const lines = [header, ...messages.map(msg => `- ${formatIncoming(msg)}`)];
		return {
			content: [{ type: "text", text: lines.join("\n") }],
			details: { op: "inbox", from: senderId, inbox: messages },
		};
	}

	#registerExternalPeer(): { bus: IrcExternalBus; sessionId: string; name: string } | null {
		if (this.externalBus === null) return null;
		const senderId = this.session.getAgentId?.() ?? undefined;
		const ownership = this.session.sessionManager?.getSessionOwnership();
		const isSubprocessWorker = process.env.OMP_SUBPROCESS_WORKER === "1" && senderId !== undefined;
		const sessionId = isSubprocessWorker
			? senderId
			: (ownership?.sessionId ?? this.session.getSessionId?.() ?? `${this.session.cwd}:${process.pid}`);
		const bus = this.externalBus ?? IrcExternalBus.global();
		const name = isSubprocessWorker
			? senderId
			: resolveIrcExternalPeerName({
					configuredName: this.session.settings.get("irc.peerName"),
					cwd: this.session.cwd,
					sessionId,
				});
		bus.registerPeer({
			sessionId,
			agentId: senderId,
			name,
			cwd: this.session.cwd,
			pid: process.pid,
			explicitName: Boolean(this.session.settings.get("irc.peerName")?.trim()),
			sessionFile: this.session.getSessionFile() ?? undefined,
			ownerEpoch: ownership?.ownerEpoch,
			buildDigest: ownership?.buildRevision.digest,
			version: ownership?.buildRevision.version,
			fleetCapability:
				ownership === undefined
					? undefined
					: createFleetCapability({
							buildDigest: ownership.buildRevision.digest,
							productVersion: ownership.buildRevision.version,
							controlProtocol: CURRENT_SESSION_CONTROL_PROTOCOL,
							workstream: this.session.sessionManager?.getWorkstream(),
						}),
		});
		return { bus, sessionId, name };
	}

	#resolveTimeoutMs(params: IrcParams): number {
		if (params.timeoutMs !== undefined) {
			return normalizeIrcTimeoutMs(params.timeoutMs);
		}
		return normalizeIrcTimeoutMs(this.session.settings.get("irc.timeoutMs"));
	}
}

function errorResult(text: string, details: IrcDetails): AgentToolResult<IrcDetails> {
	return {
		content: [{ type: "text", text }],
		details,
		isError: true,
	};
}

function normalizeIrcTimeoutMs(value: number): number {
	if (value === 0) return 0; // 0 = timeout disabled
	// Negative or non-finite settings are misconfigurations — fall back to the
	// default instead of producing an instant 1 ms timeout.
	if (!Number.isFinite(value) || value < 0) return DEFAULT_IRC_TIMEOUT_MS;
	return Math.max(1, Math.trunc(value));
}

// =============================================================================
// TUI Renderer
// =============================================================================

/**
 * Display-only transcript card for live IRC traffic: `irc:incoming` DMs
 * delivered to this session, `irc:autoreply` side-channel replies sent on
 * this session's behalf, and `irc:relay` observations of agent↔agent
 * traffic. Shares the tool renderer's glyph + quote-border conventions so
 * cards and `irc` tool output look identical in the transcript.
 */
export function createIrcMessageCard(
	card: {
		kind: "incoming" | "autoreply" | "relay";
		from?: string;
		to?: string;
		body?: string;
		replyTo?: string;
		timestamp?: number;
	},
	getExpanded: () => boolean,
	uiTheme: Theme,
	transcriptDisplay?: TranscriptDisplayContext,
): Component {
	const from = card.from?.trim() || "?";
	const title =
		card.kind === "incoming"
			? `IRC ${uiTheme.nav.back} ${from}`
			: card.kind === "autoreply"
				? `IRC ${uiTheme.nav.selected} ${card.to?.trim() || "?"}`
				: `IRC ${from} ${uiTheme.nav.selected} ${card.to?.trim() || "?"}`;
	const body = card.body ?? "";
	const meta: string[] = [];
	if (card.kind === "autoreply") meta.push("auto");
	if (card.replyTo) meta.push("reply");
	const age = messageAge(card.timestamp);
	if (age) meta.push(age);
	return createCachedComponent(
		getExpanded,
		(width, expanded) => {
			const lines = [renderStatusLine({ iconOverride: ircGlyph(uiTheme), title, meta }, uiTheme)];
			if (body.trim()) {
				lines.push(
					...renderTranscriptBodyLines(body, expanded, uiTheme, {
						indent: "  ",
						collapsedLines: 3,
						width,
						transcriptDisplay,
					}),
				);
			}
			return lines.map(line => truncateToWidth(line, width, Ellipsis.Unicode));
		},
		{
			paddingX: 1,
			cacheVersion: () => transcriptDisplayCacheVersion(transcriptDisplay),
		},
	);
}

export const ircToolRenderer = {
	inline: true,
	mergeCallAndResult: true,

	renderCall(args: IrcRenderArgs, options: RenderResultOptions, uiTheme: Theme): Component {
		return createCachedComponent(
			() => options.expanded,
			(width, expanded) => {
				const lines = buildIrcCallLines(args, expanded, width, uiTheme, options.transcriptDisplay);
				if (options.headline) {
					lines[0] = renderStatusLine({ icon: "pending", title: options.headline }, uiTheme);
				}
				return lines.map(line => truncateToWidth(line, width, Ellipsis.Unicode));
			},
			{ cacheVersion: () => transcriptDisplayCacheVersion(options.transcriptDisplay) },
		);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: IrcDetails; isError?: boolean },
		options: RenderResultOptions,
		uiTheme: Theme,
		args?: IrcRenderArgs,
	): Component {
		const details: Partial<IrcDetails> = result.details ?? {};
		return createCachedComponent(
			() => options.expanded,
			(width, expanded) => {
				const lines = buildIrcResultLines(
					result,
					details,
					args,
					expanded,
					width,
					uiTheme,
					options.transcriptDisplay,
				);
				if (options.headline) {
					lines[0] = renderStatusLine(
						{
							icon: result.isError ? "error" : options.isPartial ? "running" : "success",
							spinnerFrame: options.spinnerFrame,
							title: options.headline,
						},
						uiTheme,
					);
				}
				return lines.map(line => truncateToWidth(line, width, Ellipsis.Unicode));
			},
			{ cacheVersion: () => transcriptDisplayCacheVersion(options.transcriptDisplay) },
		);
	},
};
