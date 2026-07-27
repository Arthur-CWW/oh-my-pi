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
import { completionUsageReport } from "../runtime";
import type { Goal, GoalStatus, GoalToolDetails, GoalWorkstreamReference } from "../state";

const goalSchema = z.object({
	op: z.enum(["create", "update", "get", "complete", "resume", "drop"]).describe("goal operation"),
	objective: z.string().describe("goal objective").optional(),
	workstream: z.string().describe('workstream slug, or "adhoc"').optional(),
});

export type GoalToolInput = z.infer<typeof goalSchema>;

export interface GoalToolResponse {
	goal: Goal | null;
	workstream?: GoalWorkstreamReference;
	completionUsageReport: string | null;
}

export function buildGoalToolResponse(
	goal: Goal | null | undefined,
	options?: { includeCompletionReport?: boolean; workstream?: GoalWorkstreamReference },
): GoalToolResponse {
	const resolvedGoal = goal ?? null;
	return {
		goal: resolvedGoal,
		...(options?.workstream ? { workstream: options.workstream } : {}),
		completionUsageReport:
			options?.includeCompletionReport && resolvedGoal?.status === "complete"
				? completionUsageReport(resolvedGoal)
				: null,
	};
}

function validateWriteParams(
	params: GoalToolInput,
	op: "create" | "update",
): { objective: string; workstream?: string } {
	const objective = params.objective?.trim();
	if (!objective) {
		throw new ToolError(`objective is required when op=${op}`);
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
	return workstream === undefined ? { objective } : { objective, workstream };
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
			if (response.workstream) {
				text +=
					response.workstream.kind === "adhoc"
						? "\nWorkstream: adhoc"
						: `\nWorkstream: ${response.workstream.id} · ${response.workstream.charterPath}`;
			}
			if (response.completionUsageReport) {
				text += `\n\n${response.completionUsageReport}`;
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
				completionUsageReport: response.completionUsageReport,
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
		const metaParts = [`${used} tokens`];
		if (goal.timeUsedSeconds > 0) {
			metaParts.push(`${formatDuration(goal.timeUsedSeconds * 1000)} elapsed`);
		}
		lines.push(uiTheme.fg("dim", metaParts.join(" · ")));

		const report = details?.completionUsageReport;
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
