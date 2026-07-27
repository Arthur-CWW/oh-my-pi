import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import * as CliErr from "effect/unstable/cli/CliError";
import { NodeServices } from "@effect/platform-node";

import { getToolDefinitions, handleToolCall, type ToolArguments, type ToolDefinition } from "./mcp-tools";

export interface JsonRpcRequest {
	readonly jsonrpc?: string;
	readonly id?: string | number | null;
	readonly method?: string;
	readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
	readonly jsonrpc: "2.0";
	readonly id: string | number | null;
	readonly result?: unknown;
	readonly error?: { readonly code: number; readonly message: string };
}

export interface ListToolsResponse {
	readonly tools: readonly ToolDefinition[];
}

export interface CallToolContent {
	readonly type: "text";
	readonly text: string;
}

export interface CallToolResponse {
	readonly content: readonly CallToolContent[];
	readonly isError?: boolean;
}

export interface WritableOutput {
	write(chunk: string): unknown;
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function err(id: string | number | null, code: number, message: string): JsonRpcResponse {
	return { jsonrpc: "2.0", id, error: { code, message } };
}

function requestId(request: JsonRpcRequest): string | number | null {
	return typeof request.id === "string" || typeof request.id === "number" || request.id === null ? request.id : null;
}

function hasRequestId(request: JsonRpcRequest): boolean {
	return Object.hasOwn(request, "id");
}

export function listToolsJson(): ListToolsResponse {
	return { tools: getToolDefinitions() };
}

export async function callToolJson(name: string, args: ToolArguments = {}): Promise<CallToolResponse> {
	try {
		const result = await handleToolCall(name, args);
		return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			content: [{ type: "text", text: JSON.stringify({ status: "error", message }, null, 2) }],
			isError: true,
		};
	}
}

export async function handleJsonRpc(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
	const method = request.method ?? "";
	if (method.startsWith("notifications/") || !hasRequestId(request)) return null;
	const id = requestId(request);
	if (method === "initialize") {
		return ok(id, {
			protocolVersion: "2024-11-05",
			serverInfo: { name: "mnemopi", version: "3.1.2" },
			capabilities: { tools: {} },
		});
	}
	if (method === "tools/list") return ok(id, listToolsJson());
	if (method === "tools/call") {
		const params = request.params ?? {};
		const name = typeof params.name === "string" ? params.name : "";
		const args =
			params.arguments !== null && typeof params.arguments === "object" && !Array.isArray(params.arguments)
				? (params.arguments as ToolArguments)
				: {};
		if (name.length === 0) return err(id, -32602, "tools/call requires params.name");
		return ok(id, await callToolJson(name, args));
	}
	return err(id, -32601, `Unknown method: ${method}`);
}

export async function runStdio(
	input: ReadableStream<Uint8Array> = Bun.stdin.stream(),
	output: WritableOutput = Bun.stdout,
): Promise<void> {
	const reader = input.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
			let newline = buffer.indexOf("\n");
			while (newline >= 0) {
				const line = buffer.slice(0, newline).trim();
				buffer = buffer.slice(newline + 1);
				if (line.length > 0) {
					let parsed: unknown;
					try {
						parsed = JSON.parse(line);
					} catch {
						output.write(`${JSON.stringify(err(null, -32700, "Parse error"))}\n`);
						newline = buffer.indexOf("\n");
						continue;
					}
					const response = await handleJsonRpc(parsed as JsonRpcRequest);
					if (response !== null) output.write(`${JSON.stringify(response)}\n`);
				}
				newline = buffer.indexOf("\n");
			}
		}
	} finally {
		reader.releaseLock();
	}
}

export function runMcpServer(
	transport = "stdio",
	options: { port?: number; bank?: string; host?: string } = {},
): Promise<void> {
	if (options.bank !== undefined && options.bank.length > 0) process.env.MNEMOPI_MCP_BANK = options.bank;
	if (transport !== "stdio") throw new Error("Only stdio transport is implemented in the TypeScript port");
	return runStdio();
}

// ── Effect CLI command for standalone execution ──────────────────────────────

export const mcpServerCommand = Command.make(
	"mnemopi-mcp",
	{
		transport: Flag.string("transport").pipe(Flag.withDefault("stdio"), Flag.withDescription("Transport protocol")),
		port: Flag.integer("port").pipe(Flag.optional, Flag.withDescription("Server port")),
		bank: Flag.string("bank").pipe(Flag.optional, Flag.withDescription("Memory bank")),
		host: Flag.string("host").pipe(Flag.optional, Flag.withDescription("Server host")),
	},
	config =>
		Effect.promise(() =>
			runMcpServer(config.transport, {
				port: Option.getOrUndefined(config.port),
				bank: Option.getOrUndefined(config.bank),
				host: Option.getOrUndefined(config.host),
			}),
		),
).pipe(Command.withDescription("Mnemopi MCP Server"));

if (import.meta.main) {
	const program = Command.runWith(mcpServerCommand, { version: "16.0.1" })(Bun.argv.slice(2));
	Effect.runPromise(program.pipe(Effect.provide(NodeServices.layer))).catch((error: unknown) => {
		if (!CliErr.isCliError(error)) console.error("Error:", error);
		process.exit(1);
	});
}
