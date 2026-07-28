import { getProjectDir } from "@oh-my-pi/pi-utils";
import { settings } from "../../config/settings";
import { clearPluginRootsAndCaches, resolveActiveProjectRegistryPath } from "../../discovery/helpers";
import {
	SettingsSelectorComponent,
	type SettingsCallbacks,
	type StatusLinePreviewSettings,
} from "../components/settings-selector";
import { previewTheme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";

function updateStatusLine(ctx: InteractiveModeContext, preview?: StatusLinePreviewSettings): void {
	ctx.statusLine.updateSettings({
		preset: settings.get("statusLine.preset"),
		leftSegments: settings.get("statusLine.leftSegments"),
		rightSegments: settings.get("statusLine.rightSegments"),
		separator: settings.get("statusLine.separator"),
		showHookStatus: settings.get("statusLine.showHookStatus"),
		sessionAccent: settings.get("statusLine.sessionAccent"),
		transparent: settings.get("statusLine.transparent"),
		...preview,
	});
	ctx.updateEditorTopBorder();
	ctx.ui.requestRender();
}

export function createSettingsSelector(
	ctx: InteractiveModeContext,
	availableThemes: string[],
	onChange: SettingsCallbacks["onChange"],
	onDone: () => void,
): SettingsSelectorComponent {
	return new SettingsSelectorComponent(
		{
			availableThinkingLevels: [...ctx.session.getAvailableThinkingLevels()],
			thinkingLevel: ctx.session.thinkingLevel,
			availableThemes,
			cwd: getProjectDir(),
			model: ctx.session.model,
			imageBudget: ctx.ui.imageBudget,
			requestRender: () => ctx.ui.requestRender(),
		},
		{
			onChange,
			onThemePreview: async themeName => {
				const result = await previewTheme(themeName);
				if (result.success) {
					ctx.statusLine.invalidate();
					ctx.updateEditorTopBorder();
					ctx.ui.invalidate();
					ctx.ui.requestRender();
				}
			},
			onStatusLinePreview: preview => updateStatusLine(ctx, preview),
			getStatusLinePreview: () => {
				const availableWidth = ctx.editor.getTopBorderAvailableWidth(ctx.ui.terminal.columns);
				return ctx.statusLine.getTopBorder(availableWidth).content;
			},
			onPluginsChanged: async () => {
				const projectPath = await resolveActiveProjectRegistryPath(ctx.sessionManager.getCwd());
				clearPluginRootsAndCaches(projectPath ? [projectPath] : undefined);
				await ctx.refreshSlashCommandState();
				await ctx.session.refreshSshTool({ activateIfAvailable: true });
				ctx.ui.requestRender();
			},
			onCancel: () => {
				onDone();
				updateStatusLine(ctx);
			},
		},
	);
}
