/**
 * MCP Add Wizard
 *
 * The route model below is the sole authority for wizard state. The component
 * is a committed projection: it never handles input or performs effects.
 */
import type { Component, Keybinding } from "@oh-my-pi/pi-tui";
import { Container, replaceTabs, Spacer, Text, TruncatedText, truncateToWidth } from "@oh-my-pi/pi-tui";
import { getMCPConfigPath, getProjectDir } from "@oh-my-pi/pi-utils";
import * as Schema from "effect/Schema";
import { validateServerName } from "../../mcp/config-writer";
import type { MCPHttpServerConfig, MCPServerConfig, MCPSseServerConfig, MCPStdioServerConfig } from "../../mcp/types";
import { shortenPath } from "../../tools/render-utils";
import {
	makeTextDraftMap,
	type TextDraftMap,
	type TextDraftModel,
	textDraftMsgFromEvent,
	updateTextDraftAt,
} from "../mvu/form-input";
import type { MvuEnvelope } from "../mvu/input-lease";
import {
	type ComponentId,
	KeyEventSchema,
	makeComponentId,
	type RouteStamp,
	RouteStampSchema,
	type Transition,
} from "../mvu/schema";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { keyHint } from "./keybinding-hints";

export type MCPAddTransport = "stdio" | "http" | "sse";
export type MCPAddAuthMethod = "none" | "oauth" | "manual";
export type MCPAddAuthLocation = "env" | "header";
export type MCPAddScope = "user" | "project";
export type MCPAddWizardStep =
	| "name"
	| "transport"
	| "command"
	| "args"
	| "url"
	| "auth-method"
	| "oauth-error"
	| "oauth-auth-url"
	| "oauth-token-url"
	| "oauth-client-id"
	| "oauth-client-secret"
	| "oauth-scopes"
	| "apikey"
	| "auth-location"
	| "env-var-name"
	| "header-name"
	| "scope"
	| "confirm";

export type MCPAddWizardInputStep = Extract<
	MCPAddWizardStep,
	| "name"
	| "command"
	| "args"
	| "url"
	| "oauth-auth-url"
	| "oauth-token-url"
	| "oauth-client-id"
	| "oauth-client-secret"
	| "oauth-scopes"
	| "apikey"
	| "env-var-name"
	| "header-name"
>;

const INPUT_STEPS = [
	"name",
	"command",
	"args",
	"url",
	"oauth-auth-url",
	"oauth-token-url",
	"oauth-client-id",
	"oauth-client-secret",
	"oauth-scopes",
	"apikey",
	"env-var-name",
	"header-name",
] as const satisfies readonly MCPAddWizardInputStep[];

export const MCP_ADD_COMPONENT_ID = makeComponentId("mcp.add");

export interface MCPAddWizardOAuthResult {
	credentialId: string;
	clientId?: string;
	resource?: string;
}

export interface MCPAddWizardOAuthOptions {
	serverUrl?: string;
	resource?: string;
}

export type MCPAddWizardOperation = "connection-test" | "oauth" | "complete" | "cancel";

export type MCPAddWizardReceipt =
	| { readonly _tag: "Idle" }
	| {
			readonly _tag: "Pending";
			readonly operation: MCPAddWizardOperation;
			readonly requestGeneration: number;
			readonly stamp: RouteStamp;
	  }
	| {
			readonly _tag: "Succeeded";
			readonly operation: MCPAddWizardOperation;
			readonly requestGeneration: number;
			readonly stamp: RouteStamp;
	  }
	| {
			readonly _tag: "Failed";
			readonly operation: MCPAddWizardOperation;
			readonly requestGeneration: number;
			readonly stamp: RouteStamp;
			readonly error: string;
	  };

export type MCPAddWizardOutcome =
	| { readonly _tag: "ConnectionReady"; readonly message: string }
	| { readonly _tag: "AuthenticationRequired"; readonly message: string }
	| { readonly _tag: "ConnectionFailed"; readonly message: string }
	| { readonly _tag: "OAuthReady"; readonly message: string; readonly healthError?: string }
	| { readonly _tag: "OAuthFailed"; readonly message: string };

export interface MCPAddWizardModel {
	readonly componentId: ComponentId;
	readonly leaseGeneration: number;
	readonly sourceRevision: number;
	readonly requestGeneration: number;
	readonly currentStep: MCPAddWizardStep;
	readonly drafts: TextDraftMap<MCPAddWizardInputStep>;
	readonly transport: MCPAddTransport | null;
	readonly authMethod: MCPAddAuthMethod;
	readonly oauthResource: string;
	readonly oauthCredentialId: string | null;
	readonly authLocation: MCPAddAuthLocation | null;
	readonly scope: MCPAddScope | null;
	readonly selection: number;
	readonly validation: string | null;
	readonly receipt: MCPAddWizardReceipt;
	readonly outcome: MCPAddWizardOutcome | null;
}

export type MCPAddConnectionOutcome =
	| { readonly _tag: "Connected" }
	| {
			readonly _tag: "AuthenticationRequired";
			readonly oauth?: {
				readonly authorizationUrl: string;
				readonly tokenUrl: string;
				readonly clientId?: string;
				readonly scopes?: string;
				readonly resource?: string;
			};
	  }
	| { readonly _tag: "Failed"; readonly error: string };

export type MCPAddWizardMsg =
	| MvuEnvelope
	| {
			readonly _tag: "ConnectionSettled";
			readonly stamp: RouteStamp;
			readonly outcome: MCPAddConnectionOutcome;
	  }
	| {
			readonly _tag: "OAuthSettled";
			readonly stamp: RouteStamp;
			readonly result:
				| {
						readonly _tag: "Succeeded";
						readonly credentialId: string;
						readonly clientId?: string;
						readonly resource?: string;
						readonly healthError?: string;
				  }
				| { readonly _tag: "Failed"; readonly error: string };
	  };

export type MCPAddWizardCommand =
	| { readonly _tag: "Render"; readonly model: MCPAddWizardModel; readonly stamp: RouteStamp }
	| { readonly _tag: "TestConnection"; readonly config: MCPServerConfig; readonly stamp: RouteStamp }
	| {
			readonly _tag: "RunOAuth";
			readonly authUrl: string;
			readonly tokenUrl: string;
			readonly clientId: string;
			readonly clientSecret: string;
			readonly scopes: string;
			readonly options: MCPAddWizardOAuthOptions;
			readonly healthConfig: MCPServerConfig;
			readonly stamp: RouteStamp;
	  }
	| {
			readonly _tag: "Complete";
			readonly name: string;
			readonly config: MCPServerConfig;
			readonly scope: MCPAddScope;
			readonly stamp: RouteStamp;
	  }
	| { readonly _tag: "Cancel"; readonly stamp: RouteStamp };

const ConnectionOutcomeSchema = Schema.Union([
	Schema.Struct({ _tag: Schema.Literal("Connected") }),
	Schema.Struct({
		_tag: Schema.Literal("AuthenticationRequired"),
		oauth: Schema.optional(Schema.Struct({
			authorizationUrl: Schema.String,
			tokenUrl: Schema.String,
			clientId: Schema.optional(Schema.String),
			scopes: Schema.optional(Schema.String),
			resource: Schema.optional(Schema.String),
		})),
	}),
	Schema.Struct({ _tag: Schema.Literal("Failed"), error: Schema.String }),
]);

export const MCPAddWizardMsgSchema: Schema.ConstraintDecoder<MCPAddWizardMsg, never> = Schema.toType(
	Schema.Union([
		Schema.Struct({
			_tag: Schema.Literal("MvuInput"),
			action: Schema.String as Schema.Schema<Keybinding>,
			event: KeyEventSchema,
			stamp: Schema.optional(RouteStampSchema),
		}),
		Schema.Struct({
			_tag: Schema.Literal("ConnectionSettled"),
			stamp: RouteStampSchema,
			outcome: ConnectionOutcomeSchema,
		}),
		Schema.Struct({
			_tag: Schema.Literal("OAuthSettled"),
			stamp: RouteStampSchema,
			result: Schema.Union([
				Schema.Struct({
					_tag: Schema.Literal("Succeeded"),
					credentialId: Schema.String,
					clientId: Schema.optional(Schema.String),
					resource: Schema.optional(Schema.String),
					healthError: Schema.optional(Schema.String),
				}),
				Schema.Struct({ _tag: Schema.Literal("Failed"), error: Schema.String }),
			]),
		}),
	]),
);


export function makeMCPAddWizardModel(initialName?: string): MCPAddWizardModel {
	const normalizedName = initialName?.trim() ?? "";
	return {
		componentId: MCP_ADD_COMPONENT_ID,
		leaseGeneration: 0,
		sourceRevision: 0,
		requestGeneration: 0,
		currentStep: normalizedName.length > 0 ? "transport" : "name",
		drafts: makeTextDraftMap<MCPAddWizardInputStep>(INPUT_STEPS, {
			name: normalizedName,
			"env-var-name": "API_KEY",
			"header-name": "Authorization",
		}),
		transport: null,
		authMethod: "none",
		oauthResource: "",
		oauthCredentialId: null,
		authLocation: null,
		scope: null,
		selection: 0,
		validation: null,
		receipt: { _tag: "Idle" },
		outcome: null,
	};
}

export function mcpAddWizardStamp(model: MCPAddWizardModel): RouteStamp {
	return {
		componentId: model.componentId,
		leaseGeneration: model.leaseGeneration,
		sourceRevision: model.sourceRevision,
		requestGeneration: model.requestGeneration,
	};
}

function sameStamp(model: MCPAddWizardModel, stamp: RouteStamp): boolean {
	const current = mcpAddWizardStamp(model);
	return stamp.componentId === current.componentId &&
		stamp.leaseGeneration === current.leaseGeneration &&
		stamp.sourceRevision === current.sourceRevision &&
		stamp.requestGeneration === current.requestGeneration;
}

export function isMCPAddWizardInputStep(step: MCPAddWizardStep): step is MCPAddWizardInputStep {
	return (INPUT_STEPS as readonly MCPAddWizardStep[]).includes(step);
}

function draft(model: MCPAddWizardModel, step: MCPAddWizardInputStep): string {
	return model.drafts[step].value.trim();
}

export function buildMCPAddWizardConfig(
	model: MCPAddWizardModel,
	options: { readonly includeAuth?: boolean; readonly connectionTest?: boolean } = {},
): MCPServerConfig {
	const includeAuth = options.includeAuth ?? true;
	const timeout = options.connectionTest ? 5000 : undefined;
	const transport = model.transport ?? "stdio";
	if (transport === "stdio") {
		const config: MCPStdioServerConfig = {
			type: "stdio",
			command: draft(model, "command"),
			...(timeout === undefined ? {} : { timeout }),
		};
		const args = draft(model, "args");
		if (args) config.args = args.split(/\s+/).filter(Boolean);
		if (includeAuth && model.authMethod === "oauth" && model.oauthCredentialId) {
			const tokenUrl = draft(model, "oauth-token-url");
			const clientId = draft(model, "oauth-client-id");
			const clientSecret = draft(model, "oauth-client-secret");
			config.auth = {
				type: "oauth",
				credentialId: model.oauthCredentialId,
				...(tokenUrl ? { tokenUrl } : {}),
				...(model.oauthResource ? { resource: model.oauthResource } : {}),
				...(clientId ? { clientId } : {}),
				...(clientSecret ? { clientSecret } : {}),
			};
		}
		if (includeAuth && model.authMethod === "manual" && draft(model, "apikey")) {
			config.env = { [draft(model, "env-var-name") || "API_KEY"]: draft(model, "apikey") };
		}
		return config;
	}
	const config: MCPHttpServerConfig | MCPSseServerConfig = {
		type: transport,
		url: draft(model, "url"),
		...(timeout === undefined ? {} : { timeout }),
	};
	if (includeAuth && model.authMethod === "oauth" && model.oauthCredentialId) {
		const tokenUrl = draft(model, "oauth-token-url");
		const clientId = draft(model, "oauth-client-id");
		const clientSecret = draft(model, "oauth-client-secret");
		config.auth = {
			type: "oauth",
			credentialId: model.oauthCredentialId,
			...(tokenUrl ? { tokenUrl } : {}),
			...(model.oauthResource ? { resource: model.oauthResource } : {}),
			...(clientId ? { clientId } : {}),
			...(clientSecret ? { clientSecret } : {}),
		};
	}
	if (includeAuth && model.authMethod === "manual" && draft(model, "apikey")) {
		config.headers = { [draft(model, "header-name") || "Authorization"]: draft(model, "apikey") };
	}
	return config;
}

function maxSelection(step: MCPAddWizardStep): number {
	switch (step) {
		case "transport": return 2;
		case "auth-method":
		case "oauth-error":
		case "auth-location":
		case "scope":
		case "confirm": return 1;
		default: return 0;
	}
}

function renderTransition(
	previous: MCPAddWizardModel,
	patch: Partial<MCPAddWizardModel>,
): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	const model: MCPAddWizardModel = {
		...previous,
		...patch,
		sourceRevision: previous.sourceRevision + 1,
	};
	const stamp = mcpAddWizardStamp(model);
	return {
		model,
		commands: [{ _tag: "Render", model, stamp }],
		dirtyKeys: new Set(["mcp.add"]),
	};
}

function noTransition(model: MCPAddWizardModel): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	return { model, commands: [], dirtyKeys: new Set() };
}

function beginOperation(
	model: MCPAddWizardModel,
	operation: MCPAddWizardOperation,
	command: (model: MCPAddWizardModel, stamp: RouteStamp) => MCPAddWizardCommand,
): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	const requestGeneration = model.requestGeneration + 1;
	const sourceRevision = model.sourceRevision + 1;
	const stamp: RouteStamp = {
		componentId: model.componentId,
		leaseGeneration: model.leaseGeneration,
		sourceRevision,
		requestGeneration,
	};
	const next: MCPAddWizardModel = {
		...model,
		sourceRevision,
		requestGeneration,
		validation: null,
		outcome: null,
		receipt: { _tag: "Pending", operation, requestGeneration, stamp },
	};
	return {
		model: next,
		commands: [{ _tag: "Render", model: next, stamp }, command(next, stamp)],
		dirtyKeys: new Set(["mcp.add"]),
	};
}


function beginConnectionTest(model: MCPAddWizardModel): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	return beginOperation(model, "connection-test", (next, stamp) => ({
		_tag: "TestConnection",
		config: buildMCPAddWizardConfig(next, { includeAuth: false, connectionTest: true }),
		stamp,
	}));
}

function beginOAuth(model: MCPAddWizardModel): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	const authUrl = draft(model, "oauth-auth-url");
	const tokenUrl = draft(model, "oauth-token-url");
	if (!authUrl || !tokenUrl) {
		return renderTransition(model, { validation: "Authorization and Token URLs are required." });
	}
	return beginOperation(model, "oauth", (next, stamp) => {
		const resource = next.oauthResource || (next.transport === "stdio" ? "" : draft(next, "url"));
		const serverUrl = draft(next, "url");
		return {
			_tag: "RunOAuth",
			authUrl,
			tokenUrl,
			clientId: draft(next, "oauth-client-id"),
			clientSecret: draft(next, "oauth-client-secret"),
			scopes: draft(next, "oauth-scopes"),
			options: {
				...(serverUrl ? { serverUrl } : {}),
				...(resource ? { resource } : {}),
			},
			healthConfig: buildMCPAddWizardConfig(next, { includeAuth: true, connectionTest: true }),
			stamp,
		};
	});
}


function beginComplete(model: MCPAddWizardModel): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	if (model.scope === null) return noTransition(model);
	return beginOperation(model, "complete", (next, stamp) => ({
		_tag: "Complete",
		name: draft(next, "name"),
		config: buildMCPAddWizardConfig(next),
		scope: next.scope!,
		stamp,
	}));
}

function goBack(model: MCPAddWizardModel): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	let currentStep: MCPAddWizardStep;
	let selection = model.selection;
	switch (model.currentStep) {
		case "name": return beginOperation(model, "cancel", (_next, stamp) => ({ _tag: "Cancel", stamp }));
		case "transport": currentStep = "name"; break;
		case "command":
		case "url":
			currentStep = "transport";
			selection = model.transport === "stdio" ? 0 : model.transport === "http" ? 1 : 2;
			break;
		case "args": currentStep = "command"; break;
		case "auth-method": currentStep = model.transport === "stdio" ? "args" : "url"; break;
		case "oauth-auth-url":
		case "apikey": currentStep = model.transport === "stdio" ? "args" : "url"; break;
		case "auth-location": currentStep = "apikey"; break;
		case "env-var-name":
		case "header-name":
			currentStep = model.transport === "stdio" ? "apikey" : "auth-location";
			selection = model.authLocation === "env" ? 0 : 1;
			break;
		case "oauth-token-url": currentStep = "oauth-auth-url"; break;
		case "oauth-client-id": currentStep = "oauth-token-url"; break;
		case "oauth-client-secret": currentStep = "oauth-client-id"; break;
		case "oauth-scopes": currentStep = "oauth-client-secret"; break;
		case "scope":
			currentStep = model.authMethod === "oauth"
				? "oauth-scopes"
				: model.authMethod === "manual"
					? model.authLocation === "env" ? "env-var-name" : "header-name"
					: model.transport === "stdio" ? "args" : "url";
			break;
		case "oauth-error": currentStep = "oauth-auth-url"; break;
		case "confirm":
			currentStep = "scope";
			selection = model.scope === "user" ? 0 : 1;
			break;
	}
	return renderTransition(model, {
		currentStep,
		selection,
		validation: null,
		receipt: { _tag: "Idle" },
		outcome: null,
	});
}

function submitInput(model: MCPAddWizardModel): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	if (!isMCPAddWizardInputStep(model.currentStep)) return noTransition(model);
	const value = draft(model, model.currentStep);
	const drafts = updateTextDraftAt(model.drafts, model.currentStep, { _tag: "Replace", value });
	switch (model.currentStep) {
		case "name": {
			const validation = validateServerName(value);
			return validation
				? renderTransition(model, { drafts, validation })
				: renderTransition(model, { drafts, currentStep: "transport", selection: 0, validation: null });
		}
		case "command":
			return value
				? renderTransition(model, { drafts, currentStep: "args", validation: null })
				: renderTransition(model, { drafts, validation: "Command is required" });
		case "args": return beginConnectionTest({ ...model, drafts });
		case "url": {
			if (!value) return renderTransition(model, { drafts, validation: "URL is required" });
			let parsed: URL;
			try {
				parsed = new URL(value);
			} catch {
				return renderTransition(model, { drafts, validation: "Invalid URL format (must start with http:// or https://)" });
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				return renderTransition(model, { drafts, validation: "URL must use http:// or https:// scheme" });
			}
			return beginConnectionTest({ ...model, drafts, validation: null });
		}
		case "oauth-auth-url":
			return value ? renderTransition(model, { drafts, currentStep: "oauth-token-url", validation: null }) : noTransition(model);
		case "oauth-token-url":
			return value ? renderTransition(model, { drafts, currentStep: "oauth-client-id", validation: null }) : noTransition(model);
		case "oauth-client-id":
			return value ? renderTransition(model, { drafts, currentStep: "oauth-client-secret", validation: null }) : noTransition(model);
		case "oauth-client-secret": return renderTransition(model, { drafts, currentStep: "oauth-scopes", validation: null });
		case "oauth-scopes": return beginOAuth({ ...model, drafts, validation: null });
		case "apikey":
			if (!value) return renderTransition(model, { drafts, validation: "API key is required" });
			return renderTransition(model, {
				drafts,
				authMethod: "manual",
				currentStep: model.transport === "stdio" ? "env-var-name" : "auth-location",
				selection: 0,
				validation: null,
			});
		case "env-var-name":
			return value
				? renderTransition(model, { drafts, authLocation: "env", currentStep: "scope", selection: 0, validation: null })
				: renderTransition(model, { drafts, validation: "Environment variable name is required" });
		case "header-name":
			return value
				? renderTransition(model, { drafts, authLocation: "header", currentStep: "scope", selection: 0, validation: null })
				: renderTransition(model, { drafts, validation: "Header name is required" });
	}
}

function selectCurrent(model: MCPAddWizardModel): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	switch (model.currentStep) {
		case "transport": {
			const transport = (["stdio", "http", "sse"] as const)[model.selection] ?? "stdio";
			return renderTransition(model, { transport, currentStep: transport === "stdio" ? "command" : "url", validation: null });
		}
		case "auth-method": {
			const authMethod = (["oauth", "manual"] as const)[model.selection] ?? "oauth";
			return renderTransition(model, { authMethod, currentStep: authMethod === "oauth" ? "oauth-auth-url" : "apikey" });
		}
		case "oauth-error": return model.selection === 0 ? beginOAuth(model) : renderTransition(model, { currentStep: "oauth-auth-url", validation: null });
		case "auth-location": {
			const authLocation = (["env", "header"] as const)[model.selection] ?? "env";
			return renderTransition(model, { authLocation, currentStep: authLocation === "env" ? "env-var-name" : "header-name" });
		}
		case "scope": {
			const scope = (["user", "project"] as const)[model.selection] ?? "user";
			return renderTransition(model, { scope, currentStep: "confirm", selection: 0 });
		}
		case "confirm": return model.selection === 0 ? beginComplete(model) : renderTransition(model, { currentStep: "scope", selection: model.scope === "user" ? 0 : 1 });
		default: return noTransition(model);
	}
}

function settleConnection(
	model: MCPAddWizardModel,
	message: Extract<MCPAddWizardMsg, { readonly _tag: "ConnectionSettled" }>,
): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	if (!sameStamp(model, message.stamp) || model.receipt._tag !== "Pending" || model.receipt.operation !== "connection-test") {
		return noTransition(model);
	}
	if (message.outcome._tag === "Connected") {
		return renderTransition(model, {
			authMethod: "none",
			currentStep: "scope",
			selection: 0,
			receipt: { _tag: "Succeeded", operation: "connection-test", requestGeneration: model.requestGeneration, stamp: message.stamp },
			outcome: { _tag: "ConnectionReady", message: "Connection successful; no authentication required." },
		});
	}
	if (message.outcome._tag === "Failed") {
		return renderTransition(model, {
			authMethod: "none",
			currentStep: "scope",
			selection: 0,
			receipt: { _tag: "Failed", operation: "connection-test", requestGeneration: model.requestGeneration, stamp: message.stamp, error: message.outcome.error },
			outcome: { _tag: "ConnectionFailed", message: `Connection failed; the server can still be saved: ${message.outcome.error}` },
		});
	}
	const oauth = message.outcome.oauth;
	if (oauth === undefined) {
		return renderTransition(model, {
			authMethod: "manual",
			currentStep: "apikey",
			receipt: { _tag: "Succeeded", operation: "connection-test", requestGeneration: model.requestGeneration, stamp: message.stamp },
			outcome: { _tag: "AuthenticationRequired", message: "Authentication is required; provide an API key or token." },
		});
	}
	let drafts = updateTextDraftAt<MCPAddWizardInputStep>(model.drafts, "oauth-auth-url", { _tag: "Replace", value: oauth.authorizationUrl });
	drafts = updateTextDraftAt<MCPAddWizardInputStep>(drafts, "oauth-token-url", { _tag: "Replace", value: oauth.tokenUrl });
	drafts = updateTextDraftAt<MCPAddWizardInputStep>(drafts, "oauth-client-id", { _tag: "Replace", value: oauth.clientId ?? "" });
	drafts = updateTextDraftAt<MCPAddWizardInputStep>(drafts, "oauth-scopes", { _tag: "Replace", value: oauth.scopes ?? "" });
	return beginOAuth({
		...model,
		drafts,
		authMethod: "oauth",
		oauthResource: oauth.resource ?? (model.transport === "stdio" ? "" : draft(model, "url")),
		receipt: { _tag: "Succeeded", operation: "connection-test", requestGeneration: model.requestGeneration, stamp: message.stamp },
		outcome: { _tag: "AuthenticationRequired", message: "OAuth detected; launching authorization." },
	});
}

function settleOAuth(
	model: MCPAddWizardModel,
	message: Extract<MCPAddWizardMsg, { readonly _tag: "OAuthSettled" }>,
): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	if (!sameStamp(model, message.stamp) || model.receipt._tag !== "Pending" || model.receipt.operation !== "oauth") {
		return noTransition(model);
	}
	if (message.result._tag === "Failed") {
		return renderTransition(model, {
			currentStep: "oauth-error",
			selection: 0,
			validation: message.result.error,
			receipt: { _tag: "Failed", operation: "oauth", requestGeneration: model.requestGeneration, stamp: message.stamp, error: message.result.error },
			outcome: { _tag: "OAuthFailed", message: message.result.error },
		});
	}
	const drafts = message.result.clientId === undefined
		? model.drafts
		: updateTextDraftAt<MCPAddWizardInputStep>(model.drafts, "oauth-client-id", { _tag: "Replace", value: message.result.clientId });
	return renderTransition(model, {
		drafts,
		oauthCredentialId: message.result.credentialId,
		oauthResource: message.result.resource ?? model.oauthResource,
		currentStep: "scope",
		selection: 0,
		validation: null,
		receipt: { _tag: "Succeeded", operation: "oauth", requestGeneration: model.requestGeneration, stamp: message.stamp },
		outcome: {
			_tag: "OAuthReady",
			message: message.result.healthError === undefined
				? "Authentication and connection health check succeeded."
				: "Authentication succeeded; the health check failed, but the server can still be saved.",
			...(message.result.healthError === undefined ? {} : { healthError: message.result.healthError }),
		},
	});
}

export function updateMCPAddWizard(
	model: MCPAddWizardModel,
	message: MCPAddWizardMsg,
): Transition<MCPAddWizardModel, MCPAddWizardCommand> {
	if (message._tag === "ConnectionSettled") return settleConnection(model, message);
	if (message._tag === "OAuthSettled") return settleOAuth(model, message);
	const stamp = message.stamp;
	const base = stamp === undefined
		? model
		: { ...model, leaseGeneration: stamp.leaseGeneration };
	if (message.action === "app.interrupt") return beginOperation(base, "cancel", (_next, current) => ({ _tag: "Cancel", stamp: current }));
	if (message.action === "ui.dismiss") return goBack(base);
	if (base.receipt._tag === "Pending") return noTransition(base);
	if (isMCPAddWizardInputStep(base.currentStep)) {
		const draftMessage = textDraftMsgFromEvent(message.event);
		if (draftMessage === undefined) return noTransition(base);
		if (draftMessage._tag === "Submit") return submitInput(base);
		if (draftMessage._tag === "Cancel") return goBack(base);
		const drafts = updateTextDraftAt(base.drafts, base.currentStep, draftMessage);
		return drafts === base.drafts ? noTransition(base) : renderTransition(base, { drafts, validation: null, outcome: null });
	}
	const key = message.event._tag === "Press" ? String(message.event.key) : "";
	if (message.action === "tui.select.confirm" || key === "enter" || key === "return") return selectCurrent(base);
	if (message.action === "tui.select.up" || key === "up") {
		const count = maxSelection(base.currentStep) + 1;
		return renderTransition(base, { selection: (base.selection - 1 + count) % count, outcome: null });
	}
	if (message.action === "tui.select.down" || key === "down") {
		const count = maxSelection(base.currentStep) + 1;
		return renderTransition(base, { selection: (base.selection + 1) % count, outcome: null });
	}
	return noTransition(base);
}

const MAX_DISPLAY_WIDTH = 120;

function sanitize(text: string): string {
	return truncateToWidth(replaceTabs(text), MAX_DISPLAY_WIDTH);
}

function wizardHint(prefix: string, dismissDescription: string): string {
	const lead = prefix ? `[${prefix}, ` : "[";
	return theme.fg("muted", lead) + keyHint("ui.dismiss", dismissDescription) + theme.fg("muted", "]");
}

class CommittedInputRenderer implements Component {
	constructor(readonly model: TextDraftModel) {}

	render(_width: number): readonly string[] {
		const before = replaceTabs(this.model.value.slice(0, this.model.cursor));
		const after = replaceTabs(this.model.value.slice(this.model.cursor));
		return [`> ${before}\u001b[7m${after[0] ?? " "}\u001b[27m${after.slice(after.length > 0 ? 1 : 0)}`];
	}

	invalidate(): void {}
}

export class MCPAddWizard extends Container {
	#model: MCPAddWizardModel;
	readonly #contentContainer = new Container();

	constructor(model: MCPAddWizardModel) {
		super();
		this.#model = model;
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new TruncatedText(theme.bold("Add MCP Server")));
		this.addChild(new Spacer(1));
		this.addChild(this.#contentContainer);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.#renderStep();
	}

	apply(model: MCPAddWizardModel): void {
		if (model === this.#model) return;
		this.#model = model;
		this.#renderStep();
		this.invalidate();
	}

	#addInput(step: MCPAddWizardInputStep): void {
		this.#contentContainer.addChild(new CommittedInputRenderer(this.#model.drafts[step]));
	}

	#renderOutcome(): void {
		const outcome = this.#model.outcome;
		if (outcome === null) return;
		const color = outcome._tag === "ConnectionFailed" || outcome._tag === "OAuthFailed" ? "warning" : "success";
		this.#contentContainer.addChild(new Text(theme.fg(color, sanitize(outcome.message)), 0, 0));
		if (outcome._tag === "OAuthReady" && outcome.healthError !== undefined) {
			this.#contentContainer.addChild(new Text(theme.fg("muted", sanitize(outcome.healthError)), 0, 0));
		}
		this.#contentContainer.addChild(new Spacer(1));
	}

	#renderPending(): boolean {
		if (this.#model.receipt._tag !== "Pending") return false;
		const labels: Record<MCPAddWizardOperation, string> = {
			"connection-test": "Testing connection...",
			oauth: "Running OAuth authorization and health check...",
			complete: "Saving MCP server configuration...",
			cancel: "Closing MCP server wizard...",
		};
		this.#contentContainer.addChild(new Text(theme.fg("accent", labels[this.#model.receipt.operation]), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(wizardHint("", "go back"), 0, 0));
		return true;
	}

	#renderStep(): void {
		this.#contentContainer.clear();
		if (this.#renderPending()) return;
		this.#renderOutcome();
		switch (this.#model.currentStep) {
			case "name": this.#renderInput("Step 1: Server Name", "Enter a unique name for this server:", "name", "cancel", "[Only letters, numbers, dash, underscore, dot, colon]"); break;
			case "transport": this.#renderOptions("Step 2: Transport Type", "Select the transport type:", ["stdio (Local process)", "http (HTTP server)", "sse (Server-Sent Events)"], "cancel"); break;
			case "command": this.#renderInput("Step 3: Command", "Enter the command to run:", "command", "go back"); break;
			case "args": this.#renderInput("Step 4: Arguments (Optional)", "Enter command arguments (space-separated):", "args", "go back", "[Press Enter to skip or continue]"); break;
			case "url": this.#renderInput("Step 3: Server URL", "Enter the server URL:", "url", "go back", "[Must start with http:// or https://]"); break;
			case "auth-method": this.#renderOptions("Step: Authentication Method", "Choose an authentication method:", ["OAuth flow (web-based)", "Manual API key/token"], "go back"); break;
			case "oauth-error": this.#renderOptions("OAuth authentication failed", this.#model.validation ?? "Choose next action:", ["Retry OAuth authentication", "Edit OAuth settings"], "go back", true); break;
			case "oauth-auth-url": this.#renderInput("OAuth: Authorization URL", "Enter the OAuth authorization endpoint:", "oauth-auth-url", "go back", "e.g., https://auth.example.com/oauth/authorize"); break;
			case "oauth-token-url": this.#renderInput("OAuth: Token URL", "Enter the OAuth token endpoint:", "oauth-token-url", "go back", "e.g., https://auth.example.com/oauth/token"); break;
			case "oauth-client-id": this.#renderInput("OAuth: Client ID", "Enter your OAuth client ID:", "oauth-client-id", "go back"); break;
			case "oauth-client-secret": this.#renderInput("OAuth: Client Secret (Optional)", "Enter your OAuth client secret:", "oauth-client-secret", "go back", "(Leave empty for PKCE-only flows)"); break;
			case "oauth-scopes": this.#renderInput("OAuth: Scopes (Optional)", "Enter OAuth scopes (space-separated):", "oauth-scopes", "go back", "e.g., read write"); break;
			case "apikey": this.#renderInput("API Key Required", "Enter your API key or token:", "apikey", "go back", "(Supports !command for password manager)"); break;
			case "auth-location": this.#renderOptions("Step: How to provide the key?", "", ["Environment variable", "HTTP header"], "go back"); break;
			case "env-var-name": this.#renderInput("Step: Environment Variable Name", "Enter the environment variable name:", "env-var-name", "go back"); break;
			case "header-name": this.#renderInput("Step: HTTP Header Name", "Enter the HTTP header name:", "header-name", "go back"); break;
			case "scope": this.#renderScope(); break;
			case "confirm": this.#renderConfirm(); break;
		}
	}

	#renderInput(title: string, prompt: string, step: MCPAddWizardInputStep, dismiss: string, hint?: string): void {
		this.#contentContainer.addChild(new Text(theme.fg("accent", title), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(prompt, 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		this.#addInput(step);
		this.#contentContainer.addChild(new Spacer(1));
		if (this.#model.validation !== null) {
			this.#contentContainer.addChild(new Text(theme.fg("error", `✗ ${sanitize(this.#model.validation)}`), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}
		if (hint !== undefined) this.#contentContainer.addChild(new Text(theme.fg("muted", hint), 0, 0));
		this.#contentContainer.addChild(new Text(wizardHint("Enter to continue", dismiss), 0, 0));
	}

	#renderOptions(title: string, prompt: string, options: readonly string[], dismiss: string, error = false): void {
		this.#contentContainer.addChild(new Text(theme.fg(error ? "error" : "accent", title), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		if (prompt) {
			this.#contentContainer.addChild(new Text(sanitize(prompt), 0, 0));
			this.#contentContainer.addChild(new Spacer(1));
		}
		for (let index = 0; index < options.length; index++) {
			const selected = index === this.#model.selection;
			const prefix = selected ? theme.fg("accent", `${theme.nav.cursor} `) : "  ";
			this.#contentContainer.addChild(new Text(prefix + (selected ? theme.fg("accent", options[index]!) : options[index]!), 0, 0));
		}
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(wizardHint("↑↓ to navigate, Enter to select", dismiss), 0, 0));
	}

	#renderScope(): void {
		const cwd = getProjectDir();
		this.#renderOptions(
			"Step: Configuration Scope",
			"",
			[
				`User level (${shortenPath(getMCPConfigPath("user", cwd))})`,
				`Project level (${shortenPath(getMCPConfigPath("project", cwd))})`,
			],
			"go back",
		);
	}

	#renderConfirm(): void {
		this.#contentContainer.addChild(new Text(theme.fg("accent", "Review Configuration"), 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(`Name: ${theme.fg("accent", draft(this.#model, "name"))}`, 0, 0));
		this.#contentContainer.addChild(new Text(`Type: ${this.#model.transport}`, 0, 0));
		if (this.#model.transport === "stdio") {
			this.#contentContainer.addChild(new Text(`Command: ${draft(this.#model, "command")}`, 0, 0));
			if (draft(this.#model, "args")) this.#contentContainer.addChild(new Text(`Args: ${draft(this.#model, "args")}`, 0, 0));
		} else {
			this.#contentContainer.addChild(new Text(`URL: ${sanitize(draft(this.#model, "url"))}`, 0, 0));
		}
		if (this.#model.authMethod === "none") this.#contentContainer.addChild(new Text("Auth: None", 0, 0));
		else if (this.#model.authMethod === "oauth") this.#contentContainer.addChild(new Text("Auth: OAuth (authenticated)", 0, 0));
		else if (this.#model.authLocation === "env") this.#contentContainer.addChild(new Text(`Auth: API key via env (${draft(this.#model, "env-var-name")})`, 0, 0));
		else this.#contentContainer.addChild(new Text(`Auth: API key via header (${draft(this.#model, "header-name")})`, 0, 0));
		this.#contentContainer.addChild(new Text(`Scope: ${this.#model.scope === "user" ? "User level" : "Project level"}`, 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text("Save this configuration?", 0, 0));
		this.#contentContainer.addChild(new Spacer(1));
		for (let index = 0; index < 2; index++) {
			const label = index === 0 ? "Yes" : "No";
			const selected = index === this.#model.selection;
			this.#contentContainer.addChild(new Text((selected ? theme.fg("accent", `${theme.nav.cursor} ${label}`) : `  ${label}`), 0, 0));
		}
		this.#contentContainer.addChild(new Spacer(1));
		this.#contentContainer.addChild(new Text(wizardHint("↑↓ to navigate, Enter to select", "go back"), 0, 0));
	}
}
