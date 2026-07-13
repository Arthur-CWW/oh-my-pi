import type { SlashCommandSpec } from "../../slash-commands/types";

export const PRIMITIVES_INSPECTOR_SLASH_COMMAND: SlashCommandSpec = {
	name: "inspect",
	description: "Open the read-only primitives inspector",
	handleTui: async (_command, runtime) => {
		runtime.ctx.editor.setText("");
		await runtime.ctx.showPrimitivesInspector();
	},
};
