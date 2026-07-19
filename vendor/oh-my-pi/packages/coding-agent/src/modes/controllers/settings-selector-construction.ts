import { getProjectDir } from "@oh-my-pi/pi-utils";
import { settings } from "../../config/settings";
import { clearPluginRootsAndCaches, resolveActiveProjectRegistryPath } from "../../discovery/helpers";
import { interpretPluginSettingsCommand } from "../components/plugin-settings";
import {
	SettingsSelectorComponent,
	SETTINGS_MODAL_COMPONENT_ID,
	type SettingsCallbacks,
	type SettingsModalCommand,
	type SettingsModalMsg,
	type StatusLinePreviewSettings,
	makeSettingsModalModel,
} from "../components/settings-selector";
import { getCurrentThemeName, previewTheme } from "../theme/theme";
import type { InteractiveModeContext } from "../types";

export const SETTINGS_SELECTOR_ROUTE = {
	componentId: SETTINGS_MODAL_COMPONENT_ID,
	context: "modal.settings",
	makeInitialModel: (
		availableThemes: readonly string[] = [],
		availableThinkingLevels: readonly string[] = [],
	) =>
		makeSettingsModalModel(getCurrentThemeName() ?? settings.get("theme.dark") ?? "titanium", {
			values: {
				defaultThinkingLevel: ["auto", ...availableThinkingLevels],
				"theme.dark": availableThemes,
				"theme.light": availableThemes,
			},
		}),
} as const;

export async function interpretSettingsModalCommand(
	ctx: InteractiveModeContext,
	onChange: SettingsCallbacks["onChange"],
	onDone: () => void,
	command: SettingsModalCommand,
): Promise<SettingsModalMsg | undefined> {
	if (command._tag === "RenderSettings") return undefined;
	switch (command._tag) {
		case "ThemePreviewRequested": {
			const result = await previewTheme(command.theme);
			if (!result.success) return;
			ctx.statusLine.invalidate();
			ctx.updateEditorTopBorder();
			ctx.ui.invalidate();
			ctx.ui.requestRender();
			return;
		}
		case "ThemeRollbackRequested":
			await previewTheme(command.theme);
			updateStatusLine(ctx);
			return;
		case "PersistSettingRequested":
			onChange(command.path, command.value);
			return;
		case "CloseRequested":
			onDone();
			updateStatusLine(ctx);
			return;
		case "PluginSettingsCommand": {
			const message = await interpretPluginSettingsCommand(getProjectDir(), command.command);
			if (message._tag === "ActionSucceeded") await refreshPluginRuntime(ctx);
			return { _tag: "PluginSettings", message };
		}
	}
}

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

async function refreshPluginRuntime(ctx: InteractiveModeContext): Promise<void> {
	const projectPath = await resolveActiveProjectRegistryPath(ctx.sessionManager.getCwd());
	clearPluginRootsAndCaches(projectPath ? [projectPath] : undefined);
	await ctx.refreshSlashCommandState();
	await ctx.session.refreshSshTool({ activateIfAvailable: true });
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
			onCancel: () => {
				onDone();
				updateStatusLine(ctx);
			},
		},
	);
}
