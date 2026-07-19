/**
 * Interactive marketplace plugin selector.
 *
 * Rows are keyed by the plugin and marketplace identity. Selection and filter
 * state live in the shared selector model; this component only projects rows
 * and forwards the installation command.
 */
import { Container, truncateToWidth, type Keybinding } from "@oh-my-pi/pi-tui";
import { makeComponentId } from "../mvu/schema";
import { theme } from "../theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { SelectorSurface, type SelectorSurfaceMountSpec } from "./selector-adapter";

export interface PluginSelectorCallbacks {
	onSelect: (pluginName: string, marketplace: string, scope?: "user" | "project") => void;
	onCancel: () => void;
}

export interface PluginItem {
	plugin: { name: string; version?: string; description?: string };
	marketplace: string;
	/** Scope of this entry. When set, appended to the label and forwarded to onSelect. */
	scope?: "user" | "project";
}

function pluginKey(item: PluginItem): string {
	return `${item.plugin.name}@${item.marketplace}${item.scope ? `#${item.scope}` : ""}`;
}

export class PluginSelectorComponent extends Container {
	readonly #surface: SelectorSurface<string, PluginItem>;

	constructor(
		marketplaceCount: number,
		plugins: PluginItem[],
		installedIds: Set<string>,
		callbacks: PluginSelectorCallbacks,
	) {
		super();
		this.#surface = new SelectorSurface<string, PluginItem, Keybinding>({
			componentId: makeComponentId("plugin-selector"),
			items: plugins,
			keyOf: pluginKey,
			searchText: item => `${item.plugin.name} ${item.plugin.description ?? ""} ${item.marketplace} ${item.scope ?? ""}`,
			renderRow: (item, context, width) => {
				const installed = installedIds.has(`${item.plugin.name}@${item.marketplace}`);
				const version = item.plugin.version ? `@${item.plugin.version}` : "";
				const status = installed ? " [installed]" : "";
				const scope = item.scope ? ` [${item.scope}]` : "";
				const label = `${item.plugin.name}${version}${status}${scope}`;
				const cursor = context.selected ? theme.fg("accent", `${theme.nav.cursor} `) : "  ";
				const description = item.plugin.description ? theme.fg("dim", `  ${item.plugin.description}`) : "";
				return [
					truncateToWidth(cursor + (context.selected ? theme.bold(label) : label), width),
					truncateToWidth(`  ${theme.fg("dim", item.marketplace)}`, width),
					...(description ? [truncateToWidth(description, width)] : []),
				];
			},
			renderEmpty: () => [
				theme.fg("muted", "  No plugins available"),
				theme.fg("dim", marketplaceCount === 0 ? "  Add a marketplace first: /marketplace add <source>" : "  Configured marketplaces have no plugins"),
			],
			onSelect: item => callbacks.onSelect(item.plugin.name, item.marketplace, item.scope),
			onCancel: callbacks.onCancel,
			viewportSize: 20,
		});
		this.addChild(new DynamicBorder());
		this.addChild(this.#surface);
		this.addChild(new DynamicBorder());
	}
	get mountSpec(): SelectorSurfaceMountSpec<string, PluginItem> {
		return this.#surface.mountSpec;
	}

}
