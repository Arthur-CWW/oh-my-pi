#!/usr/bin/env bun
/** A real stdio MCP peer controlled by test-local state, with no list_changed notifications. */
import * as fs from "node:fs/promises";
import * as readline from "node:readline";

export const RETAINED_TOOL = "retained.tool";
export const ANNOTATION_TOOL = "annotation_only";
export const STABLE_TOOL = "stable";
export const REMOVED_TOOL = "removed/tool";
export const ADDED_TOOL = "added/tool";
export const LIST_FAILURE = "fixture tools/list failure";

export interface RefreshFixtureState {
	revision: 1 | 2 | 3;
	failList?: boolean;
	failInitialize?: boolean;
	noTools?: boolean;
	deferCalls?: boolean;
	deferList?: boolean;
}

export interface RefreshFixtureRequest {
	method: string;
	name?: string;
	arguments?: Record<string, unknown>;
	revision: number;
	pid: number;
}

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: { name?: string; arguments?: Record<string, unknown> };
}

function catalog(revision: RefreshFixtureState["revision"]): Record<string, unknown>[] {
	const initial = revision === 1;
	const retained = {
		name: RETAINED_TOOL,
		description: initial ? "Accept the original string value." : "Accept the revised numeric value.",
		inputSchema: {
			type: "object",
			properties: { value: { type: initial ? "string" : "number" } },
			required: ["value"],
			additionalProperties: false,
		},
		annotations: { readOnlyHint: true },
	};
	const annotationOnly = {
		name: ANNOTATION_TOOL,
		description: "Only its MCP annotations change between catalogs.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: initial, destructiveHint: !initial },
	};
	// Same descriptor, deliberately reordered JSON keys. Its remote implementation
	// changes with every revision; neither key order nor implementation is a delta.
	const stable = initial
		? {
				name: STABLE_TOOL,
				description: "Stable public descriptor with a replaceable remote implementation.",
				inputSchema: { type: "object", properties: {}, additionalProperties: false },
				annotations: { readOnlyHint: true, idempotentHint: true },
			}
		: {
				annotations: { idempotentHint: true, readOnlyHint: true },
				inputSchema: { additionalProperties: false, properties: {}, type: "object" },
				description: "Stable public descriptor with a replaceable remote implementation.",
				name: STABLE_TOOL,
			};
	const membership = {
		name: initial ? REMOVED_TOOL : ADDED_TOOL,
		description: initial ? "Removed in the revised catalog." : "Added in the revised catalog.",
		inputSchema: { type: "object", properties: {}, additionalProperties: false },
		annotations: { readOnlyHint: true },
	};
	return initial ? [retained, annotationOnly, stable, membership] : [membership, stable, annotationOnly, retained];
}

async function waitForRelease(filePath: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (!(await Bun.file(filePath).exists())) {
		if (Date.now() >= deadline) throw new Error("fixture release gate timed out");
		await Bun.sleep(10);
	}
}

function startServer(): void {
	const statePath = process.env.REFRESH_FIXTURE_STATE;
	const requestsPath = process.env.REFRESH_FIXTURE_REQUESTS;
	const callsGate = process.env.REFRESH_FIXTURE_CALLS_GATE;
	const listGate = process.env.REFRESH_FIXTURE_LIST_GATE;
	if (!statePath || !requestsPath || !callsGate || !listGate) {
		throw new Error("refresh fixture requires its state, request log, and release gate paths");
	}
	const lines = readline.createInterface({ input: process.stdin });
	lines.on("line", line => {
		void (async () => {
			let request: JsonRpcRequest;
			try {
				request = JSON.parse(line) as JsonRpcRequest;
			} catch {
				return;
			}
			if (request.id === undefined || request.id === null) return;
			try {
				const state = (await Bun.file(statePath).json()) as RefreshFixtureState;
				const observed: RefreshFixtureRequest = {
					method: request.method,
					name: request.params?.name,
					arguments: request.params?.arguments,
					revision: state.revision,
					pid: process.pid,
				};
				await fs.appendFile(requestsPath, `${JSON.stringify(observed)}\n`);
				let result: Record<string, unknown>;
				switch (request.method) {
					case "initialize":
						if (state.failInitialize) throw new Error("fixture initialize failure");
						result = {
							protocolVersion: "2025-03-26",
							serverInfo: { name: "scoped-refresh-fixture", version: "1.0.0" },
							capabilities: state.noTools ? {} : { tools: {} },
						};
						break;
					case "tools/list":
						if (state.deferList) await waitForRelease(listGate);
						if (state.failList) throw new Error(LIST_FAILURE);
						result = { tools: catalog(state.revision) };
						break;
					case "tools/call": {
						if (state.deferCalls) await waitForRelease(callsGate);
						const available = catalog(state.revision).some(tool => tool.name === request.params?.name);
						result = {
							content: [
								{
									type: "text",
									text: available
										? `v${state.revision}:${request.params?.name}:${String(request.params?.arguments?.value ?? "ok")}`
										: `fixture tool unavailable: ${request.params?.name}`,
								},
							],
							isError: !available,
						};
						break;
					}
					default:
						result = {};
				}
				process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				process.stdout.write(
					`${JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } })}\n`,
				);
			}
		})();
	});
	lines.on("close", () => process.exit(0));
}

if (import.meta.main) startServer();
