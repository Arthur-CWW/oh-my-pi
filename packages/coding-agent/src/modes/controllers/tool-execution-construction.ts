import { settings } from "../../config/settings";
import { getFileSnapshotStore } from "../../edit/file-snapshot-store";
import { ToolExecutionComponent, type ToolExecutionOptions } from "../components/tool-execution";
import type { InteractiveModeContext } from "../types";

function buildToolExecutionOptions(ctx: InteractiveModeContext, useLiveRegion: boolean): ToolExecutionOptions {
	const options: ToolExecutionOptions = {
		snapshots: getFileSnapshotStore(ctx.viewSession),
		showImages: settings.get("terminal.showImages"),
		editFuzzyThreshold: settings.get("edit.fuzzyThreshold"),
		editAllowFuzzy: settings.get("edit.fuzzyMatch"),
		transcriptDisplay: ctx,
	};
	if (useLiveRegion) options.liveRegion = ctx.chatContainer;
	return options;
}

export function addToolExecutionComponent(
	ctx: InteractiveModeContext,
	toolName: string,
	args: object,
	toolCallId: string,
	useLiveRegion: boolean,
): ToolExecutionComponent {
	const component = new ToolExecutionComponent(
		toolName,
		args,
		buildToolExecutionOptions(ctx, useLiveRegion),
		ctx.viewSession.getToolByName(toolName),
		ctx.ui,
		ctx.sessionManager.getCwd(),
		toolCallId,
	);
	component.setExpanded(ctx.toolOutputExpanded);
	ctx.chatContainer.addChild(component);
	ctx.pendingTools.set(toolCallId, component);
	return component;
}
