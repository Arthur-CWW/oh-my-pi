import type { TabPoolEntry } from "../tools/browser/tab-supervisor";

function clean(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}

export function formatTabs(entries: readonly TabPoolEntry[]): string {
	const lines = ["Browser tab pool", `  tabs: ${entries.length}`];
	for (const entry of entries) {
		lines.push(
			`  ${clean(entry.name)} url=${clean(entry.url)} owner=${clean(entry.ownerSessionId)}/${clean(entry.ownerAgentId)} purpose=${clean(entry.purpose)} backend=${entry.backend} state=${entry.state}${entry.busy ? " busy" : " idle"} idleMs=${entry.idleMs}${entry.exempt ? ` exempt: ${entry.exempt}` : ""}`,
		);
	}
	return lines.join("\n");
}
