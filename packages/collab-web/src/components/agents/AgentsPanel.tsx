import type { AgentSnapshot, SubagentLifecyclePayload, SubagentProgressPayload } from "@oh-my-pi/pi-wire";
import { ChevronDown, ChevronRight, CircleAlert, RefreshCcw, Search, Square } from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { fmtCost, fmtTokens, relTime } from "../../lib/format";
import "./agents.css";

type OperationAction = "retry" | "reconcile" | "cancel" | "inspect";
type DeckAgent = AgentSnapshot & {
	parentId?: string;
	group?: string;
	activity?: { fromId?: string; toId?: string; kind?: string; at?: number };
	recovery?: { state?: string; reason?: string; attempt?: number };
	quota?: { originalModel?: string; routedModel?: string; quotaPoolId?: string; limitWindowId?: string; resetAt?: number; decisionReason?: string };
	operation?: { inputId?: string; state?: string; resetAt?: number; reason?: string; supportedActions?: OperationAction[] };
};

const ACTION_ICONS = { retry: RefreshCcw, reconcile: RefreshCcw, cancel: Square, inspect: Search } as const;
const ATTENTION_STATES = new Set(["blocked", "uncertain", "retrying"]);

function resetLabel(at?: number): string | null {
	if (!at) return null;
	return at <= Date.now() ? "reset due" : `resets ${relTime(at)}`;
}

function AgentNode({ agent, progress, lifecycle, selected, onSelect }: {
	agent: DeckAgent;
	progress?: SubagentProgressPayload;
	lifecycle?: SubagentLifecyclePayload;
	selected: boolean;
	onSelect(id: string): void;
}): ReactNode {
	const p = progress?.progress;
	const op = agent.operation;
	const state = op?.state ?? agent.recovery?.state ?? agent.status;
	const activity = p?.currentTool ?? p?.lastIntent ?? lifecycle?.status ?? agent.status;
	const routed = agent.quota?.routedModel;
	const original = agent.quota?.originalModel;
	return (
		<button type="button" className={`ag-node ag-node--${state}${selected ? " ag-node--selected" : ""}`} onClick={() => onSelect(agent.id)} aria-pressed={selected}>
			<span className="ag-node-signal" aria-hidden="true" />
			<span className="ag-node-head"><strong>{agent.displayName}</strong><span className={`ag-chip ag-chip--${agent.status}`}>{state}</span></span>
			<span className="ag-node-activity">{activity}</span>
			<span className="ag-node-route">
				{routed ? <span className="ag-route" title={agent.quota?.decisionReason}>{original && original !== routed ? `${original} → ` : ""}{routed}</span> : p?.resolvedModel ? <span>{p.resolvedModel}</span> : null}
				{agent.quota?.quotaPoolId ? <span className="ag-pool">pool {agent.quota.quotaPoolId}</span> : null}
			</span>
			<span className="ag-node-meta"><span>{p ? `${fmtTokens(p.tokens)} tok · ${fmtCost(p.cost)}` : agent.kind}</span><span>{relTime(agent.lastActivity)}</span></span>
		</button>
	);
}

export function AgentsPanel(props: {
	agents: readonly AgentSnapshot[];
	progress: ReadonlyMap<string, SubagentProgressPayload>;
	lifecycle: ReadonlyMap<string, SubagentLifecyclePayload>;
	selectedId: string | null;
	onSelect(id: string | null): void;
	onAction?(action: OperationAction, agent: AgentSnapshot, inputId?: string): void;
}): ReactNode {
	const { progress, lifecycle, selectedId, onSelect, onAction } = props;
	const agents = props.agents as readonly DeckAgent[];
	const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
	const groups = useMemo(() => {
		const result = new Map<string, DeckAgent[]>();
		for (const agent of agents) {
			const key = agent.group ?? (agent.kind === "main" ? "command" : agent.parentId ?? "field agents");
			const list = result.get(key) ?? [];
			list.push(agent); result.set(key, list);
		}
		return [...result.entries()];
	}, [agents]);
	const attention = agents.filter(a => ATTENTION_STATES.has(a.operation?.state ?? a.recovery?.state ?? ""));
	const toggle = (key: string) => setFolded(old => { const next = new Set(old); next.has(key) ? next.delete(key) : next.add(key); return next; });
	return (
		<section className="ag-deck" aria-label="Operations Deck">
			<header className="ag-deck-header"><div><span className="ag-kicker">LIVE CONTROL SURFACE</span><h1>Operations Deck</h1></div><div className="ag-telemetry"><span><b>{agents.filter(a => a.status === "running").length}</b> active</span><span><b>{attention.length}</b> attention</span></div></header>
			{attention.length > 0 ? <section className="ag-attention" aria-labelledby="ag-attention-title"><h2 id="ag-attention-title"><CircleAlert size={14} /> Needs attention</h2><div className="ag-attention-list">{attention.map(agent => <article className={`ag-alert ag-alert--${agent.operation?.state ?? agent.recovery?.state}`} key={agent.id}><button type="button" className="ag-alert-main" onClick={() => onSelect(agent.id)}><strong>{agent.displayName}</strong><span>{agent.operation?.reason ?? agent.recovery?.reason ?? "Operation requires review"}</span><small>{resetLabel(agent.operation?.resetAt ?? agent.quota?.resetAt)}</small></button>{!props.onAction || agent.operation?.supportedActions?.length === 0 ? null : <div className="ag-alert-actions">{agent.operation?.supportedActions?.map(action => { const Icon = ACTION_ICONS[action]; return <button type="button" className="ag-control" key={action} onClick={() => onAction?.(action, agent, agent.operation?.inputId)} title={`${action} ${agent.displayName}`}><Icon size={12} />{action}</button>; })}</div>}</article>)}</div></section> : null}
			<div className="ag-board">{groups.map(([key, lane]) => { const closed = folded.has(key); return <section className="ag-lane" key={key}><button type="button" className="ag-lane-toggle" onClick={() => toggle(key)} aria-expanded={!closed}>{closed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<span>{key}</span><small>{lane.length}</small></button>{closed ? null : <div className="ag-lane-track">{lane.map((agent, i) => <div className="ag-node-wrap" key={agent.id}>{i > 0 ? <span className="ag-link" aria-hidden="true" /> : null}<AgentNode agent={agent} progress={progress.get(agent.id)} lifecycle={lifecycle.get(agent.id)} selected={selectedId === agent.id} onSelect={onSelect} /></div>)}</div>}</section>; })}</div>
			{agents.length === 0 ? <div className="ag-empty"><strong>Deck is quiet</strong><span>Agents appear here as operations are dispatched.</span></div> : null}
		</section>
	);
}
