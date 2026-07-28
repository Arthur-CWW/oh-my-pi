/**
 * Test web search providers.
 */
import { Effect, Option } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { runSearchCommand, type SearchCommandArgs } from "../cli/web-search-cli";
import { SEARCH_PROVIDER_ORDER } from "../web/search/provider";

const PROVIDERS: readonly NonNullable<SearchCommandArgs["provider"]>[] = ["auto", ...SEARCH_PROVIDER_ORDER];
const RECENCY: readonly NonNullable<SearchCommandArgs["recency"]>[] = ["day", "week", "month", "year"];

export default Command.make(
	"search",
	{
		query: Argument.string("query").pipe(
			Argument.withDescription("Search query text"),
			Argument.variadic(),
		),
		provider: Flag.optional(Flag.choice("provider", PROVIDERS).pipe(Flag.withDescription("Search provider"))),
		recency: Flag.optional(Flag.choice("recency", RECENCY).pipe(Flag.withDescription("Recency filter"))),
		limit: Flag.optional(
			Flag.integer("limit").pipe(Flag.withAlias("l"), Flag.withDescription("Max results to return")),
		),
		compact: Flag.boolean("compact").pipe(Flag.withDescription("Render condensed output")),
	},
	config =>
		Effect.promise(() => {
			const cmd: SearchCommandArgs = {
				query: [...config.query].join(" "),
				provider: Option.getOrUndefined(config.provider),
				recency: Option.getOrUndefined(config.recency),
				limit: Option.getOrUndefined(config.limit),
				expanded: !config.compact,
			};
			return runSearchCommand(cmd);
		}),
).pipe(Command.withDescription("Test web search providers"), Command.withAlias("q"));
