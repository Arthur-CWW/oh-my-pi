import { Schema } from "effect";

const CmuxSurfaceSchema = Schema.Struct({
	id: Schema.optional(Schema.String),
	ref: Schema.optional(Schema.String),
	focused: Schema.Boolean,
});

const CmuxSurfaceListSchema = Schema.Struct({
	surfaces: Schema.Array(CmuxSurfaceSchema),
});

type CmuxSurfaceList = typeof CmuxSurfaceListSchema.Type;

export type CmuxAskBridgeCommandReceipt = {
	readonly argv: readonly string[];
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export type CmuxAskBridgePlan = {
	readonly workspaceRef: string;
	readonly surfaceRef: string;
	readonly queryArgv: readonly string[];
	readonly notifyArgv: readonly string[];
};

export type CmuxAskBridgeReceipt =
	| {
			readonly schemaVersion: 1;
			readonly status: "skipped";
			readonly reason: "not-cmux";
			readonly commands: readonly [];
		}
	| {
			readonly schemaVersion: 1;
			readonly status: "focused";
			readonly commands: readonly [CmuxAskBridgeCommandReceipt];
		}
	| {
			readonly schemaVersion: 1;
			readonly status: "notified";
			readonly commands: readonly [CmuxAskBridgeCommandReceipt, CmuxAskBridgeCommandReceipt];
		}
	| {
			readonly schemaVersion: 1;
			readonly status: "failed";
			readonly reason: string;
			readonly commands: readonly CmuxAskBridgeCommandReceipt[];
		};


async function runCommand(
	argv: readonly string[],
	env: Readonly<Record<string, string | undefined>>,
): Promise<CmuxAskBridgeCommandReceipt> {
	const child = Bun.spawn({
		cmd: [...argv],
		env: Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined)),
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdoutPromise = new Response(child.stdout).text();
	const stderrPromise = new Response(child.stderr).text();
	const exitCode = await child.exited;
	const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
	return { argv, exitCode, stdout, stderr };
}

export function buildCmuxAskBridgePlan(
	question: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): CmuxAskBridgePlan | undefined {
	const workspaceRef = env.CMUX_WORKSPACE_ID?.trim();
	const surfaceRef = env.CMUX_SURFACE_ID?.trim();
	if (!workspaceRef || !surfaceRef) return undefined;
	return {
		workspaceRef,
		surfaceRef,
		queryArgv: ["cmux", "list-panels", "--workspace", workspaceRef, "--json"],
		notifyArgv: ["cmux", "notify", "--surface", surfaceRef, "--title", "Oh My Pi", "--body", question],
	};
}

export async function notifyCmuxAsk(
	question: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<CmuxAskBridgeReceipt> {
	const plan = buildCmuxAskBridgePlan(question, env);
	if (!plan) return { schemaVersion: 1, status: "skipped", reason: "not-cmux", commands: [] };

	let query: CmuxAskBridgeCommandReceipt;
	try {
		query = await runCommand(plan.queryArgv, env);
	} catch (error) {
		return {
			schemaVersion: 1,
			status: "failed",
			reason: `cmux focus query failed: ${error instanceof Error ? error.message : String(error)}`,
			commands: [],
		};
	}
	if (query.exitCode !== 0) {
		return {
			schemaVersion: 1,
			status: "failed",
			reason: `cmux focus query exited ${query.exitCode}: ${(query.stderr || query.stdout).trim()}`,
			commands: [query],
		};
	}

	let surfaceList: CmuxSurfaceList;
	try {
		surfaceList = Schema.decodeUnknownSync(CmuxSurfaceListSchema)(JSON.parse(query.stdout));
	} catch (error) {
		return {
			schemaVersion: 1,
			status: "failed",
			reason: `cmux focus query returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
			commands: [query],
		};
	}
	const focusedSurface = surfaceList.surfaces.find((surface) => surface.focused);
	if (focusedSurface?.id === plan.surfaceRef || focusedSurface?.ref === plan.surfaceRef) {
		return { schemaVersion: 1, status: "focused", commands: [query] };
	}

	let notification: CmuxAskBridgeCommandReceipt;
	try {
		notification = await runCommand(plan.notifyArgv, env);
	} catch (error) {
		return {
			schemaVersion: 1,
			status: "failed",
			reason: `cmux notify failed: ${error instanceof Error ? error.message : String(error)}`,
			commands: [query],
		};
	}
	if (notification.exitCode !== 0) {
		return {
			schemaVersion: 1,
			status: "failed",
			reason: `cmux notify exited ${notification.exitCode}: ${(notification.stderr || notification.stdout).trim()}`,
			commands: [query, notification],
		};
	}
	return { schemaVersion: 1, status: "notified", commands: [query, notification] };
}
