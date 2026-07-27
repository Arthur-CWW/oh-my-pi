/**
 * Get the API key or OAuth token for a provider.
 */

import { PROVIDER_REGISTRY } from "@oh-my-pi/pi-ai";
import { Effect } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import chalk from "chalk";
import { isAuthenticated, ModelRegistry } from "../config/model-registry";
import { discoverAuthStorage } from "../sdk";

export default Command.make(
	"token",
	{
		provider: Argument.string("provider").pipe(Argument.withDescription("Provider ID (e.g. anthropic, openai)")),
		raw: Flag.boolean("raw").pipe(
			Flag.withDescription("Output the raw credential value without parsing nested JSON structures"),
			Flag.withDefault(false),
		),
		"force-refresh": Flag.boolean("force-refresh").pipe(
			Flag.withDescription("Force refresh the OAuth token even if it has not expired"),
			Flag.withDefault(false),
		),
	},
	config =>
		Effect.promise(async () => {
			const providerName = config.provider;
			const provider = providerName.toLowerCase();

			const authStorage = await discoverAuthStorage();
			const modelRegistry = new ModelRegistry(authStorage);

			// Resolve the API key / token
			const apiKey = await modelRegistry.getApiKeyForProvider(provider, undefined, {
				forceRefresh: config["force-refresh"],
			});

			if (!isAuthenticated(apiKey)) {
				// Find all active/configured providers
				const activeProviders = new Set<string>();
				for (const p of PROVIDER_REGISTRY) {
					if (authStorage.hasAuth(p.id)) {
						activeProviders.add(p.id);
					}
				}
				const all = authStorage.getAll();
				for (const p in all) {
					if (authStorage.hasAuth(p)) {
						activeProviders.add(p);
					}
				}

				const msg = `No active credential found for provider "${providerName}".`;
				process.stderr.write(`${chalk.red(msg)}\n`);
				if (activeProviders.size > 0) {
					process.stderr.write(`Configured providers: ${Array.from(activeProviders).sort().join(", ")}\n`);
				}
				process.exitCode = 1;
				return;
			}

			if (!config.raw) {
				try {
					const parsed: unknown = JSON.parse(apiKey);
					if (
						parsed !== null &&
						typeof parsed === "object" &&
						"token" in parsed &&
						typeof parsed.token === "string"
					) {
						process.stdout.write(`${parsed.token}\n`);
						return;
					}
				} catch {
					// Not a JSON string, print as-is
				}
			}

			process.stdout.write(`${apiKey}\n`);
		}),
).pipe(
	Command.withDescription("Get the API key or OAuth token for a provider"),
	Command.withExamples([
		{ command: "omp token anthropic", description: "Get API key for Anthropic" },
		{ command: "omp token github-copilot --raw", description: "Get raw Copilot credential JSON" },
		{ command: "omp token google-gemini-cli --force-refresh", description: "Force refresh and get Gemini CLI token" },
	]),
);
