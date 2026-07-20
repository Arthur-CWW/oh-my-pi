/**
 * Render every built-in tool's renderer across its lifecycle states.
 */
import { Effect, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { GALLERY_STATES, runGalleryCommand } from "../cli/gallery-cli";

export default Command.make(
	"gallery",
	{
		tool: Flag.optional(
			Flag.string("tool").pipe(Flag.withAlias("t"), Flag.withDescription("Render a single tool by name")),
		),
		state: Flag.choice("state", GALLERY_STATES).pipe(
			Flag.withAlias("s"),
			Flag.withDescription("Render only the given lifecycle state(s)"),
			Flag.atLeast(0),
		),
		width: Flag.optional(
			Flag.integer("width").pipe(Flag.withAlias("w"), Flag.withDescription("Render width in columns")),
		),
		expanded: Flag.boolean("expanded").pipe(
			Flag.withAlias("e"),
			Flag.withDescription("Render the expanded variant of each renderer"),
			Flag.withDefault(false),
		),
		plain: Flag.boolean("plain").pipe(
			Flag.withDescription("Strip ANSI styling from the output"),
			Flag.withDefault(false),
		),
		screenshot: Flag.boolean("screenshot").pipe(
			Flag.withDescription(
				"Capture the rendered output as PNG screenshot(s) via VHS instead of printing ANSI (requires vhs)",
			),
			Flag.withDefault(false),
		),
		out: Flag.optional(
			Flag.string("out").pipe(
				Flag.withAlias("o"),
				Flag.withDescription(
					"Screenshot output path (with --screenshot); suffixed per image when split across multiple",
				),
			),
		),
		font: Flag.optional(
			Flag.string("font").pipe(
				Flag.withDescription("Screenshot font family (default: JetBrainsMono Nerd Font)"),
			),
		),
		"font-size": Flag.optional(
			Flag.integer("font-size").pipe(Flag.withDescription("Screenshot font size in points (default: 18)")),
		),
	},
	config =>
		Effect.promise(() =>
			runGalleryCommand({
				tool: Option.getOrUndefined(config.tool),
				states: config.state.length > 0 ? [...config.state] : undefined,
				width: Option.getOrUndefined(config.width),
				expanded: config.expanded,
				plain: config.plain,
				screenshot: config.screenshot,
				out: Option.getOrUndefined(config.out),
				font: Option.getOrUndefined(config.font),
				fontSize: Option.getOrUndefined(config["font-size"]),
			}),
		),
).pipe(
	Command.withDescription(
		"Preview tool renderers across streaming, in-progress, success, and failure states",
	),
);
