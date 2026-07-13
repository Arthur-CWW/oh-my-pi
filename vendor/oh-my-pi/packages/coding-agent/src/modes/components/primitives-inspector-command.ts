import type { SlashCommandSpec } from "../../slash-commands/types";
import { PRIMITIVE_CATEGORY_IDS, resolvePrimitiveCategory } from "./primitives-inspector-state";

export const PRIMITIVES_INSPECTOR_SLASH_COMMAND: SlashCommandSpec = {
	name: "inspect",
	description: "Open the read-only primitives inspector",
	inlineHint: "[category]",
	allowArgs: true,
	handleTui: async (command, runtime) => {
		const argument = command.args.trim();
		const initialCategory = resolvePrimitiveCategory(argument);
		if (argument && !initialCategory) {
			runtime.ctx.showStatus(
				`Unknown inspector category "${argument}". Valid categories: ${PRIMITIVE_CATEGORY_IDS.join(", ")}.`,
			);
		}
		runtime.ctx.editor.setText("");
		await runtime.ctx.showPrimitivesInspector(initialCategory);
	},
};
