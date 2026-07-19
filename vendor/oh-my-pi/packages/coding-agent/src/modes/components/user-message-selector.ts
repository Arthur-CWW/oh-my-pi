import { Container, truncateToWidth, type Keybinding, Spacer, Text } from "@oh-my-pi/pi-tui";
import { makeComponentId } from "../mvu/schema";
import { theme } from "../../modes/theme/theme";
import { DynamicBorder } from "./dynamic-border";
import { SelectorSurface, type SelectorSurfaceMountSpec } from "./selector-adapter";

export interface UserMessageItem {
	id: string;
	text: string;
	timestamp?: string;
}

export class UserMessageSelectorComponent extends Container {
	readonly #surface: SelectorSurface<string, UserMessageItem>;

	constructor(messages: UserMessageItem[], onSelect: (entryId: string) => void, onCancel: () => void) {
		super();
		const selectedId = messages.at(-1)?.id;
		this.#surface = new SelectorSurface<string, UserMessageItem, Keybinding>({
			componentId: makeComponentId("user-message-selector"),
			items: messages,
			keyOf: message => message.id,
			searchText: message => `${message.text} ${message.timestamp ?? ""}`,
			initialSelectedId: selectedId,
			renderRow: (message, context, width) => {
				const cursor = context.selected ? theme.fg("accent", `${theme.nav.cursor} `) : "  ";
				const text = message.text.replace(/\n/g, " ").trim();
				return [
					truncateToWidth(cursor + (context.selected ? theme.bold(text) : text), width),
					theme.fg("muted", `  Message ${context.index + 1} of ${context.totalItems}`),
					"",
				];
			},
			renderEmpty: query => [theme.fg("muted", query ? "  No matching messages" : "  No user messages found")],
			renderStatus: model => {
				if (model.mode._tag !== "Filter") return [];
				const query = model.mode.query.trim();
				return [theme.fg("muted", query ? `  Search: ${model.mode.query}` : "  Type to search")];
			},
			onSelect: message => onSelect(message.id),
			onCancel,
			viewportSize: 10,
		});
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.bold("Branch from Message"), 1, 0));
		this.addChild(new Text(theme.fg("muted", "Select a message to create a new branch from that point"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(this.#surface);
	}
	get mountSpec(): SelectorSurfaceMountSpec<string, UserMessageItem> {
		return this.#surface.mountSpec;
	}
}
