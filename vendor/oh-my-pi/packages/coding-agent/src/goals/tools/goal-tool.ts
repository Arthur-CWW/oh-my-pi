import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import type { Component } from "@oh-my-pi/pi-tui";
import { Text } from "@oh-my-pi/pi-tui";
import { formatNumber, prompt } from "@oh-my-pi/pi-utils";
import { z } from "zod/v4";
import type { RenderResultOptions } from "../../extensibility/custom-tools/types";
import type { Theme, ThemeColor } from "../../modes/theme/theme";
import goalDescription from "../../prompts/tools/goal.md" with { type: "text" };
import { formatDuration } from "../../slash-commands/helpers/format";
import { decodeSessionWorkstream } from "../../session/session-entries";
import type { ToolSession } from "../../tools";
import { formatErrorDetail, TRUNCATE_LENGTHS } from "../../tools/render-utils";
import { ToolError } from "../../tools/tool-errors";
import { framedBlock, renderStatusLine, truncateToWidth } from "../../tui";
import { completionBudgetReport, remainingTokens } from "../runtime";
import type { Goal, GoalStatus, GoalToolDetails, GoalWorkstreamReference } from "../state";

const goalSchema = z.object({
	op: z.enum(["create", "update", "get", "complete", "resume", "drop"]).describe("goal operation"),
	objective: z.string().describe("goal objective").optional(),
	token_budget: z.number().int().describe("token budget").optional(),
	workstream: z.string().describe('workstream slug, or "adhoc"').optional(),
});

export type GoalToolInput = z.infer<typeof goalSchema>;

export interface GoalToolResponse {
	goal: Goal | null;
	workstream: GoalWorkstreamReference | undefined;
	remainingTokens: number | null;
	completionBudgetReport: string | null;
}

export function buildGoalToolResponse(
	goal: Goal | null | undefined,
	options?: { includeCompletionReport?: boolean; workstream?: GoalWorkstreamReference },
): GoalToolResponse {
	const resolvedGoal = goal ?? null;
	return {
		goal: resolvedGoal,
		workstream: options?.workstream,
		remainingTokens: remainingTokens(resolvedGoal),
		completionBudgetReport:
			options?.includeCompletionReport && resolvedGoal?.status === "complete"
				? completionBudgetReport(resolvedGoal)
				: null,
	};
}

function validateWriteParams(
	params: GoalToolInput,
	op: "create" | "update",
): { objective: string; tokenBudget?: number; workstream?: string } {
	const objective = params.objective?.trim();
	if (!objective) {
		throw new ToolError(`objective is required when op=${op}`);
	}
	const tokenBudget = params.token_budget;
	if (tokenBudget !== undefined && (!Number.isInteger(tokenBudget) || tokenBudget <= 0)) {
		throw new ToolError("token_budget must be a positive integer when provided");
	}
	const workstream = params.workstream?.trim();
	if (params.workstream !== undefined && !workstream) {
		throw new ToolError('workstream must be a stream slug or "adhoc"');
	}
	if (
		workstream !== undefined &&
		!decodeSessionWorkstream(workstream === "adhoc" ? { kind: "adhoc" } : { kind: "workstream", id: workstream })
	) {
		throw new ToolError('workstream must be "adhoc" or a lowercase kebab-case stream slug');
	}
	return workstream === undefined ? { objective, tokenBudget } : { objective, tokenBudget, workstream };
}

export class GoalTool implements AgentTool<typeof goalSchema, GoalToolDetails> {
	readonly name = "goal";
	readonly label = "Goal";
	readonly description = prompt.render(goalDescription);
	readonly parameters = goalSchema;
	readonly strict = true;
	readonly intent = "omit" as const;
	readonly #session: ToolSession;

	constructor(session: ToolSession) {
		this.#session = session;
	}

	async execute(
		_toolCallId: string,
		params: GoalToolInput,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback<GoalToolDetails>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<GoalToolDetails>> {
		const runtime = this.#session.getGoalRuntime?.();
		if (!runtime) {
			throw new ToolError("Goal mode is not active.");
		}

		let response: GoalToolResponse;
		if (params.op === "create") {
			const created = await runtime.createGoal(validateWriteParams(params, "create"));
			response = buildGoalToolResponse(created.goal, { workstream: runtime.getWorkstreamReference() });
		} else if (params.op === "update") {
			const updated = await runtime.replaceGoal(validateWriteParams(params, "update"));
			response = buildGoalToolResponse(updated.goal, { workstream: runtime.getWorkstreamReference() });
		} else if (params.op === "get") {
			const state = this.#session.getGoalModeState?.();
			response = buildGoalToolResponse(state?.goal ?? null, { workstream: runtime.getWorkstreamReference() });
		} else if (params.op === "resume") {
			const resumed = await runtime.resumeGoal();
			response = buildGoalToolResponse(resumed.goal, { workstream: runtime.getWorkstreamReference() });
		} else if (params.op === "drop") {
			const dropped = await runtime.dropGoal();
			response = buildGoalToolResponse(dropped ?? null, { workstream: runtime.getWorkstreamReference() });
		} else {
			const completed = await runtime.completeGoalFromTool();
			response = buildGoalToolResponse(completed, {
				includeCompletionReport: true,
				workstream: runtime.getWorkstreamReference(),
			});
		}
		let text: string;
		if (response.goal) {
			text = `Goal: ${response.goal.objective}\nStatus: ${response.goal.status}\nTokens: ${response.goal.tokensUsed} used`;
			if (response.goal.tokenBudget !== undefined) {
				text += ` / ${response.goal.tokenBudget} budget`;
			}
			if (response.remainingTokens !== null) {
				text += `\nRemaining tokens: ${response.remainingTokens}`;
			}
			if (response.workstream) {
				text +=
					response.workstream.kind === "adhoc"
						? "\nWorkstream: adhoc"
						: `\nWorkstream: ${response.workstream.id} · ${response.workstream.charterPath}`;
			}
			if (response.completionBudgetReport) {
				text += `\n\n${response.completionBudgetReport}`;
			}
		} else {
			text = "No active goal.";
		}
		return {
			content: [{ type: "text", text }],
			details: {
				op: params.op,
				goal: response.goal,
				workstream: response.workstream,
				remainingTokens: response.remainingTokens,
				completionBudgetReport: response.completionBudgetReport,
			},
		};
	}
}

function describeOp(op: string | undefined): string {
	switch (op) {
		case "create":
			return "set";
		case "update":
			return "update";
		case "complete":
			return "complete";
		case "get":
			return "check";
		case "resume":
			return "resume";
		case "drop":
			return "drop";
		default:
			return op ?? "?";
	}
}

function goalBadgeColor(status: GoalStatus): ThemeColor {
	switch (status) {
		case "complete":
			return "success";
		case "budget-limited":
			return "warning";
		case "paused":
		case "dropped":
			return "muted";
		default:
			return "accent";
	}
}

interface GoalRenderArgs {
	op?: GoalToolInput["op"];
	objective?: string;
	token_budget?: number;
}

export const goalToolRenderer = {
	renderCall(args: GoalRenderArgs, _options: RenderResultOptions, uiTheme: Theme): Component {
		const description = describeOp(args.op);
		const meta: string[] = [];
		const trimmedObjective = args.objective?.trim();
		if ((args.op === "create" || args.op === "update") && trimmedObjective) {
			const objective = truncateToWidth(trimmedObjective, TRUNCATE_LENGTHS.TITLE);
			meta.push(uiTheme.italic(uiTheme.fg("muted", `"${objective}"`)));
		}
		if ((args.op === "create" || args.op === "update") && args.token_budget !== undefined) {
			meta.push(`budget ${formatNumber(args.token_budget)}`);
		}
		return new Text(renderStatusLine({ icon: "pending", title: "Goal", description, meta }, uiTheme), 0, 0);
	},

	renderResult(
		result: { content: Array<{ type: string; text?: string }>; details?: GoalToolDetails; isError?: boolean },
		_options: RenderResultOptions,
		uiTheme: Theme,
		args?: GoalRenderArgs,
	): Component {
		const fallbackText = result.content?.find(c => c.type === "text")?.text ?? "";
		const details = result.details;
		const op = details?.op ?? args?.op;
		const description = describeOp(op);

		if (result.isError) {
			const header = renderStatusLine({ icon: "error", title: "Goal", description }, uiTheme);
			return framedBlock(uiTheme, width => ({
				header,
				sections: [{ lines: formatErrorDetail(fallbackText || "Goal tool failed", uiTheme).split("\n") }],
				state: "error",
				borderColor: "error",
				width,
			}));
		}

		const goal = details?.goal ?? null;
		if (!goal) {
			return new Text(
				renderStatusLine({ icon: "warning", title: "Goal", description, meta: ["no active goal"] }, uiTheme),
				0,
				0,
			);
		}

		const header = renderStatusLine(
			{
				iconOverride: uiTheme.styledSymbol("tool.goal", "accent"),
				title: "Goal",
				description,
				badge: { label: goal.status, color: goalBadgeColor(goal.status) },
			},
			uiTheme,
		);

		const lines: string[] = [];
		const objectiveText = truncateToWidth(goal.objective.trim(), TRUNCATE_LENGTHS.LONG);
		lines.push(uiTheme.italic(uiTheme.fg("muted", `"${objectiveText}"`)));

		const used = formatNumber(goal.tokensUsed);
		const tokensLine =
			goal.tokenBudget !== undefined
				? `${used} / ${formatNumber(goal.tokenBudget)} tokens (${formatNumber(Math.max(0, goal.tokenBudget - goal.tokensUsed))} left)`
				: `${used} tokens`;
		const metaParts = [tokensLine];
		if (goal.timeUsedSeconds > 0) {
			metaParts.push(`${formatDuration(goal.timeUsedSeconds * 1000)} elapsed`);
		}
		lines.push(uiTheme.fg("dim", metaParts.join(" · ")));

		const report = details?.completionBudgetReport;
		const sections: Array<{ label?: string; lines: string[] }> = [{ lines }];
		if (report) {
			sections.push({ label: "Report", lines: report.split("\n").map(line => uiTheme.fg("muted", line)) });
		}

		return framedBlock(uiTheme, width => ({
			header,
			sections,
			state: "success",
			borderColor: "borderMuted",
			width,
		}));
	},

	mergeCallAndResult: true,
};
