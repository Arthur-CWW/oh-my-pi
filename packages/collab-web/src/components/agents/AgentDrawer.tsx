import type { AgentSnapshot, SessionEntry, SubagentProgressPayload } from "@oh-my-pi/pi-wire";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { fmtCost, fmtDuration, fmtTokens } from "../../lib/format";
import type { TranscriptProps } from "../transcript/Transcript";
import { Transcript } from "../transcript/Transcript";

const EMPTY_TOOLS: TranscriptProps["activeTools"] = new Map();

export function AgentDrawer(props: {
	agent: AgentSnapshot;
	progress?: SubagentProgressPayload;
	entries: readonly SessionEntry[];
	/** Forwarded to tool renderers so nested task cards can drill further. */
	host?: TranscriptProps["host"];
	onClose(): void;
}): ReactNode {
	const { progress, host, onClose, entries, agent } = props;

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);


	const p = progress?.progress;
	const model = p?.resolvedModel;
	const ctxPct =
		p?.contextTokens !== undefined && p.contextWindow
			? Math.min(100, (p.contextTokens / p.contextWindow) * 100)
			: null;

	return (
		<aside className="ag-drawer" role="dialog" aria-label={agent.displayName}>
			<header className="ag-drawer-head">
				<div className="ag-drawer-title">
					<span className="ag-drawer-name">{agent.displayName}</span>
					<span className={`ag-chip ag-chip--${agent.status}`}>{agent.status}</span>
					{model ? <span className="ag-chip ag-chip--model">{model}</span> : null}
				</div>
				<div className="ag-drawer-actions">
					<button type="button" className="ag-iconbtn" aria-label="close" onClick={onClose}>
						<X size={15} aria-hidden />
					</button>
				</div>
			</header>
			{agent.operation?.reason || agent.quota?.decisionReason ? (
				<div className="ag-operation-note">
					<strong>{agent.operation?.state ?? "routing"}</strong>
					<span>{agent.operation?.reason ?? agent.quota?.decisionReason}</span>
				</div>
			) : null}
			{p ? (
				<div className="ag-stats">
					<span className="ag-stat">
						<span className="ag-stat-label">tok</span>
						<span className="ag-stat-value">{fmtTokens(p.tokens)}</span>
					</span>
					{ctxPct !== null ? (
						<span className="ag-stat" title={`context ${fmtTokens(p.contextTokens ?? 0)}`}>
							<span className="ag-stat-label">ctx</span>
							<span className="ag-gauge">
								<span
									className={ctxPct > 80 ? "ag-gauge-fill ag-gauge-fill--warn" : "ag-gauge-fill"}
									style={{ width: `${ctxPct}%` }}
								/>
							</span>
						</span>
					) : null}
					<span className="ag-stat">
						<span className="ag-stat-label">cost</span>
						<span className="ag-stat-value">{fmtCost(p.cost)}</span>
					</span>
					<span className="ag-stat">
						<span className="ag-stat-label">tools</span>
						<span className="ag-stat-value">{p.toolCount}</span>
					</span>
					<span className="ag-stat">
						<span className="ag-stat-value">{fmtDuration(p.durationMs)}</span>
					</span>
				</div>
			) : null}
			{agent.quota ? (
				<div className="ag-stats">
					{agent.quota.quotaPoolId ? <span className="ag-stat"><span className="ag-stat-label">pool</span><span className="ag-stat-value">{agent.quota.quotaPoolId}</span></span> : null}
					{agent.quota.routedModel ? <span className="ag-stat"><span className="ag-stat-label">route</span><span className="ag-stat-value">{agent.quota.originalModel && agent.quota.originalModel !== agent.quota.routedModel ? `${agent.quota.originalModel} → ` : ""}{agent.quota.routedModel}</span></span> : null}
					{agent.quota.resetAt ? <span className="ag-stat"><span className="ag-stat-label">reset</span><span className="ag-stat-value">{new Date(agent.quota.resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></span> : null}
				</div>
			) : null}
			<div className="ag-drawer-body">
				{entries.length > 0 ? (
					<Transcript
						compact
						entries={entries}
						stream={null}
						streamDone
						activeTools={EMPTY_TOOLS}
						working={agent.status === "running"}
						host={host}
					/>
				) : (
					<div className="ag-empty">no transcript available</div>
				)}
			</div>
		</aside>
	);
}
