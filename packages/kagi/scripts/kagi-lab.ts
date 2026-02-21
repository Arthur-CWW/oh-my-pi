#!/usr/bin/env bun

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import {
	captureSessionFromChrome,
	discoverLenses,
	loadSession,
	parseVideoRuleTargetFromDomain,
	runAdvancedSearchRedirect,
	runDomainRuleBulk,
	runDomainRuleDelete,
	runDomainRuleSet,
	runSocketSearchWithAutoRefresh,
	runVideoRuleDelete,
	runVideoRuleSet,
	saveSession,
	SimpleRateLimiter,
	type KagiRuleKind,
	type KagiSearchOptions,
} from "../src/kagi-client.js";
import { queryRuns, saveSearchRun, writeJsonSnapshot } from "../src/kagi-log.js";

const DEFAULT_SESSION_PATH = "packages/kagi/storage/session.json";
const DEFAULT_RUNS_DIR = "packages/kagi/output/runs";
const DEFAULT_BROWSER_URL = "http://localhost:9222";

const parsed = parseCli(process.argv.slice(2));
const command = parsed.positionals[0] ?? "help";

switch (command) {
	case "help":
		printHelp();
		break;
	case "session:refresh":
		await cmdSessionRefresh(parsed);
		break;
	case "search":
		await cmdSearch(parsed);
		break;
	case "lenses:list":
		await cmdLensesList(parsed);
		break;
	case "advanced:redirect":
		await cmdAdvancedRedirect(parsed);
		break;
	case "rules:domain:set":
		await cmdDomainRuleSet(parsed);
		break;
	case "rules:domain:bulk":
		await cmdDomainRuleBulk(parsed);
		break;
	case "rules:domain:delete":
		await cmdDomainRuleDelete(parsed);
		break;
	case "rules:video:set":
		await cmdVideoRuleSet(parsed);
		break;
	case "rules:video:import":
		await cmdVideoRuleImport(parsed);
		break;
	case "rules:video:delete":
		await cmdVideoRuleDelete(parsed);
		break;
	case "runs:list":
		await cmdRunsList(parsed);
		break;
	case "a11y:capture":
		await cmdA11yCapture(parsed);
		break;
	default:
		console.error(`Unknown command: ${command}`);
		printHelp();
		process.exitCode = 1;
}

async function cmdSessionRefresh(cli: ParsedCli): Promise<void> {
	const browserUrl = flagValue(cli, "browser-url") ?? DEFAULT_BROWSER_URL;
	const outPath = flagValue(cli, "out") ?? DEFAULT_SESSION_PATH;
	const session = await captureSessionFromChrome(browserUrl);
	const saved = saveSession(session, outPath);
	console.log(JSON.stringify({ command: "session:refresh", saved, capturedAt: session.capturedAt }, null, 2));
}

async function cmdSearch(cli: ParsedCli): Promise<void> {
	const query = requiredFlag(cli, "query");
	const sessionPath = flagValue(cli, "session") ?? DEFAULT_SESSION_PATH;
	const browserUrl = flagValue(cli, "browser-url") ?? DEFAULT_BROWSER_URL;
	const outputDir = flagValue(cli, "out-dir") ?? DEFAULT_RUNS_DIR;
	const minIntervalMs = asNumber(flagValue(cli, "min-interval-ms"), 1600);
	const jitterMs = asNumber(flagValue(cli, "jitter-ms"), 350);
	const maxResponseBytes = asNumber(flagValue(cli, "max-response-bytes"), 2_500_000);
	const tags = flagValues(cli, "tag");
	const additionalParams = parseKeyValueFlags(flagValues(cli, "param"));
	const liveOutPath = flagValue(cli, "live-out") ?? `${outputDir}/live-${Date.now()}.sse.txt`;

	mkdirSync(dirname(resolve(liveOutPath)), { recursive: true });
	writeFileSync(resolve(liveOutPath), "", "utf8");

	const rateLimiter = new SimpleRateLimiter({ minIntervalMs, jitterMs });
	const searchOptions: KagiSearchOptions = {
		query,
		region: flagValue(cli, "region") ?? undefined,
		lens: flagValue(cli, "lens") ?? undefined,
		dateRange: asDateRange(flagValue(cli, "date-range")),
		fromDate: flagValue(cli, "from-date") ?? undefined,
		toDate: flagValue(cli, "to-date") ?? undefined,
		order: asOrder(flagValue(cli, "order")),
		direction: asDirection(flagValue(cli, "direction")),
		verbatim: asOptionalBool(flagValue(cli, "verbatim")),
		personalized: asOptionalBool(flagValue(cli, "personalized")),
		additionalParams,
		maxResponseBytes,
		onSseChunk: (chunk) => appendFileSync(resolve(liveOutPath), chunk),
	};
	const discoverLensesForSearch = asOptionalBool(flagValue(cli, "discover-lenses")) ?? true;

	const result = await runSocketSearchWithAutoRefresh(searchOptions, {
		sessionPath,
		browserUrl,
		rateLimiter,
		discoverLenses: discoverLensesForSearch,
	});
	const record = saveSearchRun(result, {
		query,
		outputDir,
		prefix: "kagi-search",
	});

	const summary = {
		command: "search",
		query,
		lens: searchOptions.lens ?? "all",
		discoverLenses: discoverLensesForSearch,
		status: result.status,
		ok: result.ok,
		requestUrl: result.requestUrl,
		eventCount: result.parsedEvents.length,
		tags: [...new Set([...record.tags, ...tags])],
		recordPath: record.resultPath,
		rawSsePath: record.rawSsePath,
		liveOutPath: resolve(liveOutPath),
	};

	const latestPath = writeJsonSnapshot(`${outputDir}/latest-summary.json`, summary);
	console.log(JSON.stringify({ ...summary, latestPath }, null, 2));
}

async function cmdLensesList(cli: ParsedCli): Promise<void> {
	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const includeFallback = asOptionalBool(flagValue(cli, "include-fallback")) ?? true;
	const query = flagValue(cli, "query") ?? "lens discovery";
	const result = await discoverLenses(session, { query, includeFallback });
	console.log(
		JSON.stringify(
			{
				command: "lenses:list",
				query,
				includeFallback,
				status: result.status,
				ok: result.ok,
				requestUrl: result.requestUrl,
				count: result.lenses.length,
				lenses: result.lenses,
			},
			null,
			2,
		),
	);
}

async function cmdAdvancedRedirect(cli: ParsedCli): Promise<void> {
	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const result = await runAdvancedSearchRedirect(session, {
		allWords: flagValue(cli, "all-words") ?? undefined,
		exactWords: flagValue(cli, "exact-words") ?? undefined,
		anyWords: flagValue(cli, "any-words") ?? undefined,
		noneWords: flagValue(cli, "none-words") ?? undefined,
		region: flagValue(cli, "region") ?? undefined,
		lastUpdate: asDateRange(flagValue(cli, "last-update")),
		fromDate: flagValue(cli, "from-date") ?? undefined,
		toDate: flagValue(cli, "to-date") ?? undefined,
		site: flagValue(cli, "site") ?? undefined,
		termsAppearing: (flagValue(cli, "terms-appearing") as "any" | "url" | "title" | undefined) ?? undefined,
		fileType: flagValue(cli, "file-type") ?? undefined,
	});
	console.log(JSON.stringify({ command: "advanced:redirect", ...result }, null, 2));
}

async function cmdDomainRuleSet(cli: ParsedCli): Promise<void> {
	const domain = requiredFlag(cli, "domain");
	const kind = asRuleKind(requiredFlag(cli, "kind"));
	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const result = await runDomainRuleSet(session, domain, kind);
	console.log(JSON.stringify({ command: "rules:domain:set", domain, kind, ...result }, null, 2));
}

async function cmdDomainRuleBulk(cli: ParsedCli): Promise<void> {
	const kind = asRuleKind(requiredFlag(cli, "kind"));
	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const domains = [
		...flagValues(cli, "domain"),
		...readListFile(flagValue(cli, "file")),
	].filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

	if (domains.length === 0) {
		throw new Error("Provide at least one domain via --domain or --file");
	}

	const result = await runDomainRuleBulk(session, domains, kind, "/settings/user_ranked");
	console.log(
		JSON.stringify({ command: "rules:domain:bulk", kind, count: domains.length, domains, ...result }, null, 2),
	);
}

async function cmdDomainRuleDelete(cli: ParsedCli): Promise<void> {
	const domain = requiredFlag(cli, "domain");
	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const result = await runDomainRuleDelete(session, domain);
	console.log(JSON.stringify({ command: "rules:domain:delete", domain, ...result }, null, 2));
}

async function cmdVideoRuleSet(cli: ParsedCli): Promise<void> {
	const kind = asRuleKind(requiredFlag(cli, "kind"));
	const creatorName = flagValue(cli, "creator-name") ?? undefined;
	const channel = flagValue(cli, "channel");
	const platformId = flagValue(cli, "platform-id");
	const creatorId = flagValue(cli, "creator-id");

	const target = channel
		? parseVideoRuleTargetFromDomain(channel, creatorName)
		: {
				platformId: requiredValue(platformId, "platform-id"),
				creatorId: requiredValue(creatorId, "creator-id"),
				creatorName: requiredValue(creatorName, "creator-name"),
			};

	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const result = await runVideoRuleSet(session, target, kind);
	console.log(JSON.stringify({ command: "rules:video:set", target, kind, ...result }, null, 2));
}

async function cmdVideoRuleDelete(cli: ParsedCli): Promise<void> {
	const channel = flagValue(cli, "channel");
	const target = channel
		? parseVideoRuleTargetFromDomain(channel)
		: {
				platformId: requiredFlag(cli, "platform-id"),
				creatorId: requiredFlag(cli, "creator-id"),
				creatorName: "",
			};
	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const result = await runVideoRuleDelete(session, {
		platformId: target.platformId,
		creatorId: target.creatorId,
	});
	console.log(JSON.stringify({ command: "rules:video:delete", target, ...result }, null, 2));
}

async function cmdVideoRuleImport(cli: ParsedCli): Promise<void> {
	const file = requiredFlag(cli, "file");
	const kind = asRuleKind(requiredFlag(cli, "kind"));
	const session = loadSession(flagValue(cli, "session") ?? DEFAULT_SESSION_PATH);
	const minIntervalMs = asNumber(flagValue(cli, "min-interval-ms"), 1200);
	const jitterMs = asNumber(flagValue(cli, "jitter-ms"), 250);
	const limiter = new SimpleRateLimiter({ minIntervalMs, jitterMs });

	const lines = readListFile(file);
	const imported: Array<{ channel: string; creatorName: string; status: number }> = [];
	for (const line of lines) {
		const [channelRaw, creatorNameRaw] = line.split("|").map((part) => part.trim());
		const target = parseVideoRuleTargetFromDomain(channelRaw, creatorNameRaw || undefined);
		await limiter.waitTurn();
		const result = await runVideoRuleSet(session, target, kind);
		imported.push({ channel: channelRaw, creatorName: target.creatorName, status: result.status });
	}

	console.log(
		JSON.stringify(
			{ command: "rules:video:import", kind, count: imported.length, imported, sourceFile: resolve(file) },
			null,
			2,
		),
	);
}

async function cmdRunsList(cli: ParsedCli): Promise<void> {
	const outputDir = flagValue(cli, "out-dir") ?? DEFAULT_RUNS_DIR;
	const status = flagValue(cli, "status") ? asNumber(requiredFlag(cli, "status"), 200) : undefined;
	const queryIncludes = flagValue(cli, "contains") ?? undefined;
	const tag = flagValue(cli, "tag") ?? undefined;
	const runs = queryRuns(outputDir, { status, queryIncludes, tag });
	console.log(JSON.stringify({ command: "runs:list", outputDir: resolve(outputDir), count: runs.length, runs }, null, 2));
}

async function cmdA11yCapture(cli: ParsedCli): Promise<void> {
	const browserUrl = flagValue(cli, "browser-url") ?? DEFAULT_BROWSER_URL;
	const url = flagValue(cli, "url") ?? undefined;
	const outPath = flagValue(cli, "out") ?? `packages/kagi/output/a11y/a11y-${Date.now()}.json`;

	const browser = await puppeteer.connect({ browserURL: browserUrl, defaultViewport: null });
	try {
		const pages = await browser.pages();
		const page = pages.at(-1) ?? (await browser.newPage());
		if (url) {
			await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
		}
		const tree = await page.accessibility.snapshot({ interestingOnly: false });
		const saved = writeJsonSnapshot(outPath, tree);
		console.log(JSON.stringify({ command: "a11y:capture", saved, pageUrl: page.url() }, null, 2));
	} finally {
		await browser.disconnect();
	}
}

interface ParsedCli {
	positionals: string[];
	flags: Map<string, string[]>;
}

function parseCli(args: string[]): ParsedCli {
	const flags = new Map<string, string[]>();
	const positionals: string[] = [];

	for (let i = 0; i < args.length; i += 1) {
		const current = args[i];
		if (!current.startsWith("--")) {
			positionals.push(current);
			continue;
		}
		const key = current.slice(2);
		const next = args[i + 1];
		const value = next && !next.startsWith("--") ? next : "true";
		if (value !== "true") {
			i += 1;
		}
		const existing = flags.get(key) ?? [];
		existing.push(value);
		flags.set(key, existing);
	}

	return { positionals, flags };
}

function flagValue(cli: ParsedCli, key: string): string | undefined {
	return cli.flags.get(key)?.at(-1);
}

function flagValues(cli: ParsedCli, key: string): string[] {
	return cli.flags.get(key) ?? [];
}

function requiredFlag(cli: ParsedCli, key: string): string {
	return requiredValue(flagValue(cli, key), key);
}

function requiredValue(value: string | undefined, label: string): string {
	if (!value) {
		throw new Error(`Missing required --${label}`);
	}
	return value;
}

function asNumber(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const number = Number(value);
	if (!Number.isFinite(number)) {
		return fallback;
	}
	return number;
}

function asDateRange(value: string | undefined): 1 | 2 | 3 | 4 | undefined {
	if (!value) {
		return undefined;
	}
	if (value === "1" || value === "2" || value === "3" || value === "4") {
		return Number(value) as 1 | 2 | 3 | 4;
	}
	return undefined;
}

function asOrder(value: string | undefined): 2 | 3 | 4 | undefined {
	if (!value) {
		return undefined;
	}
	if (value === "2" || value === "3" || value === "4") {
		return Number(value) as 2 | 3 | 4;
	}
	return undefined;
}

function asDirection(value: string | undefined): "asc" | "desc" | undefined {
	if (value === "asc" || value === "desc") {
		return value;
	}
	return undefined;
}

function asOptionalBool(value: string | undefined): boolean | undefined {
	if (!value) {
		return undefined;
	}
	if (value === "1" || value.toLowerCase() === "true") {
		return true;
	}
	if (value === "0" || value.toLowerCase() === "false") {
		return false;
	}
	return undefined;
}

function asRuleKind(value: string): KagiRuleKind {
	if (value === "-2" || value === "-1" || value === "0" || value === "1" || value === "2") {
		return Number(value) as KagiRuleKind;
	}
	throw new Error(`Invalid kind: ${value}. Expected one of -2,-1,0,1,2`);
}

function parseKeyValueFlags(values: string[]): Record<string, string> | undefined {
	if (values.length === 0) {
		return undefined;
	}
	const parsed: Record<string, string> = {};
	for (const entry of values) {
		const split = entry.indexOf("=");
		if (split <= 0) {
			continue;
		}
		const key = entry.slice(0, split);
		const value = entry.slice(split + 1);
		parsed[key] = value;
	}
	return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function readListFile(filePath: string | undefined): string[] {
	if (!filePath) {
		return [];
	}
	const content = readFileSync(resolve(filePath), "utf8");
	return content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.filter((line) => !line.startsWith("#"));
}

function printHelp(): void {
	console.log(`Kagi lab CLI

Commands:
  session:refresh      Refresh local session from Chrome remote-debugging profile
  search               Run /socket/search with request mimic + local event capture
  lenses:list          Discover available lenses from your current account/session
  advanced:redirect    Submit /search/advanced payload and return redirect URL
  rules:domain:set     Set domain rule (kind -2|-1|0|1|2)
  rules:domain:bulk    Bulk set domains using /esr/user_rules/bulk
  rules:domain:delete  Delete domain rule
  rules:video:set      Set video channel rule
  rules:video:import   Import channel rules from file (channel|creator_name per line)
  rules:video:delete   Delete video channel rule
  runs:list            Query saved run records
  a11y:capture         Save full accessibility tree JSON

Examples:
  bun packages/kagi/scripts/kagi-lab.ts session:refresh
  bun packages/kagi/scripts/kagi-lab.ts search --query "c++ strict aliasing examples" --lens programming --discover-lenses 1 --date-range 3 --out-dir packages/kagi/output/runs --param personalized=0
  bun packages/kagi/scripts/kagi-lab.ts lenses:list --query "c++ UB" --include-fallback 1
  bun packages/kagi/scripts/kagi-lab.ts advanced:redirect --site myanimelist.net --terms-appearing title --file-type pdf --last-update 3 --region us
  bun packages/kagi/scripts/kagi-lab.ts rules:domain:set --domain github.com --kind 1
  bun packages/kagi/scripts/kagi-lab.ts rules:domain:bulk --file domains.txt --kind -2
  bun packages/kagi/scripts/kagi-lab.ts rules:video:set --channel youtube.com/channel/UCSJ4gkVC6NrvII8umztf0Ow --creator-name "Lofi Girl" --kind -1
  bun packages/kagi/scripts/kagi-lab.ts rules:video:import --file channels.txt --kind -1
  bun packages/kagi/scripts/kagi-lab.ts runs:list --contains "c++" --tag search.info
  bun packages/kagi/scripts/kagi-lab.ts a11y:capture --url https://kagi.com/settings/search --out packages/kagi/output/a11y/settings-search.json
`);
}
