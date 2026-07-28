export const SCRAPING_DESKTOP_SKILLS = ["background-browser-automation", "playwright"] as const;

export const LOOPED_SCRAPING_COMMANDS = ["curl", "wget", "playwright", "puppeteer"] as const;

export const KNOWN_CRAWL_SCRIPTS = [
	"browser-hn-scraper.js",
	"packages/twitter-archive/src/corpus/scraper.ts",
] as const;

export const SCRAPING_DESKTOP_REMINDER_STATE_TYPE = "scraping-desktop-reminder-state";
export const SCRAPING_DESKTOP_REMINDER_MESSAGE_TYPE = "scraping-desktop-reminder";

export const SCRAPING_DESKTOP_REMINDER = [
	"<system-reminder>",
	"Scraping-class work is starting on this Mac. Prefer the Ubuntu desktop lane for sustained scraping: use the gpu-workload-dispatch and remote-chrome-control skills, targeting ssh desktop.eth.",
	"This is advisory only; continue locally when appropriate.",
	"</system-reminder>",
].join("\n");

const DESKTOP_HOSTNAMES: Record<string, true> = { desktop: true, "desktop.eth": true };
const LOOPED_COMMAND_PATTERN = new RegExp(
	`\\b(?:for|while|until)\\b[\\s\\S]*?\\bdo\\b[\\s\\S]*?\\b(?:${LOOPED_SCRAPING_COMMANDS.join("|")})\\b[\\s\\S]*?\\bdone\\b`,
);

type ScrapingDesktopRuntime = {
	platform: NodeJS.Platform;
	hostname: string;
	cwd: string;
};

export type ScrapingDesktopActivity =
	| { type: "tool"; toolName: string; args: unknown; browserOpenCount: number }
	| { type: "skill"; skillName: string };

export type ScrapingDesktopReminderInput = ScrapingDesktopRuntime & {
	activity: ScrapingDesktopActivity;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isLocalDarwinRuntime(runtime: ScrapingDesktopRuntime): boolean {
	if (runtime.platform !== "darwin" || !runtime.cwd.startsWith("/")) return false;
	const hostname = runtime.hostname.toLowerCase().replace(/\.$/, "");
	return DESKTOP_HOSTNAMES[hostname] !== true;
}

function isScrapingToolActivity(activity: Extract<ScrapingDesktopActivity, { type: "tool" }>): boolean {
	if (!isRecord(activity.args)) return false;

	if (activity.toolName === "browser") {
		return activity.args.action === "open" && activity.browserOpenCount > 2;
	}

	if (activity.toolName === "bash") {
		const command = activity.args.command;
		return (
			typeof command === "string" &&
			(KNOWN_CRAWL_SCRIPTS.some(script => command.includes(script)) || LOOPED_COMMAND_PATTERN.test(command))
		);
	}

	if (activity.toolName === "read") {
		const path = activity.args.path;
		return (
			typeof path === "string" &&
			SCRAPING_DESKTOP_SKILLS.some(skill => path === `skill://${skill}` || path.startsWith(`skill://${skill}/`))
		);
	}

	return false;
}

export function shouldInjectScrapingDesktopReminder(input: ScrapingDesktopReminderInput): boolean {
	if (!isLocalDarwinRuntime(input)) return false;
	const activity = input.activity;
	if (activity.type === "skill") {
		return SCRAPING_DESKTOP_SKILLS.some(skill => activity.skillName === skill);
	}
	return isScrapingToolActivity(activity);
}
