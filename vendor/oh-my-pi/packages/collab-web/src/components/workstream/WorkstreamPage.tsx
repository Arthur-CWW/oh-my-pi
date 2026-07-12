import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { GuestClient, GuestSnapshot } from "../../lib/client";
import "./workstream.css";

type AgentState = "running" | "idle" | "completed" | "parked";
interface WorkAgent {
	id: string;
	name: string;
	state: AgentState;
	model?: string;
	tail: string[];
	at: number;
}
interface Delivery {
	id: string;
	target: string;
	state: "queued" | "delivered" | "woken" | "failed";
	detail: string;
}
const asRecord = (value: unknown): Record<string, unknown> | null =>
	typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const clipped = (value: unknown, max = 180): string => {
	const raw = text(value) || JSON.stringify(value);
	return raw.length > max ? `${raw.slice(0, max)}…` : raw;
};

function transcriptAgents(entries: readonly unknown[], mainModel: string): WorkAgent[] {
	const agents = new Map<string, WorkAgent>();
	agents.set("Main", {
		id: "Main",
		name: "Main",
		state: "running",
		model: mainModel || undefined,
		tail: [],
		at: Date.now(),
	});
	for (let index = 0; index < entries.length; index++) {
		const raw = entries[index];
		const json = JSON.stringify(raw);
		if (!/\b(task|agent|subagent)\b/i.test(json)) continue;
		const rec = asRecord(raw);
		const candidate = text(rec?.agent) || text(rec?.id) || text(asRecord(rec?.payload)?.agent);
		const matches = [...json.matchAll(/"(?:agent|id)":"([A-Za-z][A-Za-z0-9_.-]{1,63})"/g)];
		for (const id of [candidate, ...matches.map(match => match[1] ?? "")]) {
			if (!id || ["assistant", "user", "tool", "task"].includes(id.toLowerCase())) continue;
			const lower = json.toLowerCase();
			const state: AgentState = lower.includes("parked")
				? "parked"
				: lower.includes("completed") || lower.includes("failed") || lower.includes("aborted")
					? "completed"
					: lower.includes("idle")
						? "idle"
						: "running";
			const previous = agents.get(id);
			const model = json.match(/"resolvedModel":"([^"]+)"/)?.[1] ?? previous?.model;
			agents.set(id, {
				id,
				name: id,
				state,
				model,
				at: index,
				tail: [...(previous?.tail ?? []), clipped(raw)].slice(-6),
			});
		}
	}
	return [...agents.values()];
}

function transcriptDeliveries(entries: readonly unknown[]): Delivery[] {
	const found: Delivery[] = [];
	for (let index = 0; index < entries.length; index++) {
		const raw = entries[index];
		const json = JSON.stringify(raw);
		if (!/\birc\b|"op":"send"/.test(json)) continue;
		const target = json.match(/"to":"([^"]+)"/)?.[1] ?? "agent";
		const state: Delivery["state"] = /failed|error/i.test(json)
			? "failed"
			: /woken|revived/i.test(json)
				? "woken"
				: /delivered|injected|receipt/i.test(json)
					? "delivered"
					: "queued";
		found.push({ id: `${index}-${target}`, target, state, detail: clipped(raw) });
	}
	return found.slice(-12).reverse();
}

export function WorkstreamPage({
	client,
	snapshot,
	onLeave,
}: {
	client: GuestClient;
	snapshot: GuestSnapshot;
	onLeave(): void;
}): ReactNode {
	const runner = snapshot.runner;
	const session = asRecord(runner?.session);
	const identity = asRecord(session?.runnerIdentity);
	const build = asRecord(identity?.buildRevision);
	const instance = asRecord(identity?.runnerInstance);
	const modelRecord = asRecord(runner?.model);
	const currentModel = text(modelRecord?.model);
	const entries = snapshot.entries as readonly unknown[];
	const agents = useMemo(() => transcriptAgents(entries, currentModel), [entries, currentModel]);
	const deliveries = useMemo(() => transcriptDeliveries(entries), [entries]);
	const [selected, setSelected] = useState("Main");
	const [parkedOpen, setParkedOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [provider, setProvider] = useState(currentModel.split("/")[0] ?? "");
	const [modelId, setModelId] = useState(currentModel.split("/").slice(1).join("/"));
	const [swap, setSwap] = useState<"idle" | "requested" | "pending" | "applied" | "failed">("idle");
	const [swapDetail, setSwapDetail] = useState("");
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	useEffect(() => {
		if (swap === "pending" && currentModel && currentModel === `${provider}/${modelId}`) setSwap("applied");
	}, [swap, currentModel, provider, modelId]);
	const requestSwap = async () => {
		setSwap("requested");
		setSwapDetail(`${provider}/${modelId}`);
		try {
			setSwap("pending");
			const receipt = await client.setModel(provider.trim(), modelId.trim());
			setSwapDetail(clipped(receipt));
			setSwap("applied");
		} catch (error) {
			setSwapDetail(error instanceof Error ? error.message : String(error));
			setSwap("failed");
		}
	};
	const groups: Record<AgentState, WorkAgent[]> = { running: [], idle: [], completed: [], parked: [] };
	for (const agent of agents) groups[agent.state].push(agent);
	groups.completed = groups.completed.slice(-8).reverse();
	const visibleParked = groups.parked.filter(agent => agent.name.toLowerCase().includes(query.toLowerCase()));
	const chosen = agents.find(agent => agent.id === selected) ?? agents[0];
	const startedAt = Date.parse(text(instance?.startedAt));
	const uptime = Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
	return (
		<div className="ws-shell">
			<header>
				<div>
					<strong>OMP workstream</strong>
					<span className={`ws-phase ws-${snapshot.phase}`}>{snapshot.phase}</span>
				</div>
				<button onClick={onLeave}>Leave</button>
			</header>
			<main className="ws-grid">
				<section data-testid="workstream-roster" className="ws-panel ws-roster">
					<h2>Agent roster</h2>
					{(["running", "idle", "completed"] as const).map(state => (
						<div className="ws-group" key={state}>
							<h3>
								{state === "idle"
									? "Idle — needs attention"
									: state === "completed"
										? "Recent completed"
										: "Running"}
								<b>{groups[state].length}</b>
							</h3>
							{groups[state].map(agent => (
								<button
									className={selected === agent.id ? "selected" : ""}
									key={agent.id}
									onClick={() => setSelected(agent.id)}
								>
									<i className={`dot ${agent.state}`} />
									{agent.name}
									<small>{agent.model ?? agent.state}</small>
								</button>
							))}
						</div>
					))}
					<div className="ws-group">
						<h3>
							<button className="collapse" onClick={() => setParkedOpen(value => !value)}>
								Parked <b>{groups.parked.length}</b> {parkedOpen ? "▾" : "▸"}
							</button>
						</h3>
						{parkedOpen && (
							<>
								<input
									aria-label="Search parked agents"
									placeholder="Search parked"
									value={query}
									onChange={event => setQuery(event.target.value)}
								/>
								{visibleParked.map(agent => (
									<button key={agent.id} onClick={() => setSelected(agent.id)}>
										{agent.name}
									</button>
								))}
							</>
						)}
					</div>
					<aside className="ws-tail">
						<h3>{chosen?.name ?? "Agent"} · live activity</h3>
						{chosen?.tail.length ? (
							chosen.tail.map((line, index) => <pre key={`${chosen.id}-${index}`}>{line}</pre>)
						) : (
							<p>No recent activity exposed.</p>
						)}
					</aside>
				</section>
				<section data-testid="delivery-panel" className="ws-panel">
					<h2>Message delivery</h2>
					{deliveries.length ? (
						deliveries.map(item => (
							<article key={item.id}>
								<span className={`badge ${item.state}`}>{item.state}</span>
								<strong>→ {item.target}</strong>
								<p>{item.detail}</p>
							</article>
						))
					) : (
						<p className="empty">No recent IRC sends in the runner transcript.</p>
					)}
				</section>
				<section data-testid="model-panel" className="ws-panel">
					<h2>Model · Main</h2>
					<p className="current">{currentModel || "Not yet reported"}</p>
					<label>
						Provider
						<input value={provider} onChange={event => setProvider(event.target.value)} />
					</label>
					<label>
						Model ID
						<input value={modelId} onChange={event => setModelId(event.target.value)} />
					</label>
					<button
						className="primary"
						disabled={snapshot.readOnly || !provider.trim() || !modelId.trim() || swap === "pending"}
						onClick={() => void requestSwap()}
					>
						Hot-swap model
					</button>
					<p data-testid="model-swap-receipt" className={`receipt ${swap}`}>
						{swap}
						{swapDetail ? ` · ${swapDetail}` : ""}
					</p>
					{snapshot.readOnly && <p className="warning">Observer link: controls are read-only.</p>}
				</section>
				<section data-testid="revision-panel" className="ws-panel">
					<h2>View / build revision</h2>
					<dl>
						<dt>Binary digest</dt>
						<dd>{text(build?.digest) || "unavailable"}</dd>
						<dt>Version</dt>
						<dd>{text(build?.version) || "unavailable"}</dd>
						<dt>Session</dt>
						<dd>{(snapshot.header?.id ?? text(instance?.runnerInstanceId)) || "unavailable"}</dd>
						<dt>Uptime</dt>
						<dd>{uptime}s</dd>
						<dt>Runner revision</dt>
						<dd>
							{runner?.revision ?? 0} / {runner?.runnerSequence ?? 0}
						</dd>
					</dl>
				</section>
			</main>
		</div>
	);
}
