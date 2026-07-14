import type { MarkdownTheme, SymbolTheme } from "@oh-my-pi/pi-tui";
import chalk from "chalk";
import { resolveMermaidAscii } from "./mermaid-cache";
import type { Theme } from "./theme";

type SymbolThemeResolver = (sourceTheme: Theme) => SymbolTheme;
type MarkdownHighlighter = (code: string, language: string | undefined, sourceTheme: Theme) => string | null;
type LanguageSupport = (language: string) => boolean;

let cachedGlobalTheme: MarkdownTheme | undefined;
let cachedGlobalThemeEpoch = -1;
const cachedExplicitThemes = new WeakMap<Theme, MarkdownTheme>();

/**
 * Resolve and cache the Markdown renderer theme for either the active global
 * theme or an explicit Theme instance.
 *
 * The global entry follows the caller's theme epoch. Explicit instances are
 * stable for their lifetime and intentionally ignore global theme changes.
 */
export function getCachedMarkdownTheme(
	sourceTheme: Theme,
	globalTheme: Theme,
	globalThemeEpoch: number,
	getSymbolTheme: SymbolThemeResolver,
	highlightCode: MarkdownHighlighter,
	supportsLanguage: LanguageSupport,
): MarkdownTheme {
	const useGlobalCache = sourceTheme === globalTheme;
	if (useGlobalCache && cachedGlobalTheme !== undefined && cachedGlobalThemeEpoch === globalThemeEpoch) {
		return cachedGlobalTheme;
	}
	if (!useGlobalCache) {
		const cached = cachedExplicitThemes.get(sourceTheme);
		if (cached) return cached;
	}

	const resolvedTheme: MarkdownTheme = {
		heading: (text: string) => sourceTheme.fg("mdHeading", text),
		link: (text: string) => sourceTheme.fg("mdLink", text),
		linkUrl: (text: string) => sourceTheme.fg("mdLinkUrl", text),
		code: (text: string) => sourceTheme.fg("mdCode", text),
		codeBlock: (text: string) => sourceTheme.fg("mdCodeBlock", text),
		codeBlockBorder: (text: string) => sourceTheme.fg("mdCodeBlockBorder", text),
		quote: (text: string) => sourceTheme.fg("mdQuote", text),
		quoteBorder: (text: string) => sourceTheme.fg("mdQuoteBorder", text),
		hr: (text: string) => sourceTheme.fg("mdHr", text),
		listBullet: (text: string) => sourceTheme.fg("mdListBullet", text),
		bold: (text: string) => sourceTheme.bold(text),
		italic: (text: string) => sourceTheme.italic(text),
		underline: (text: string) => sourceTheme.underline(text),
		strikethrough: (text: string) => chalk.strikethrough(text),
		symbols: getSymbolTheme(sourceTheme),
		resolveMermaidAscii,
		highlightCode: (code: string, language?: string): string[] => {
			const validLanguage = language && supportsLanguage(language) ? language : undefined;
			const highlighted = highlightCode(code, validLanguage, sourceTheme);
			if (highlighted !== null) return highlighted.split("\n");
			return code.split("\n").map(line => sourceTheme.fg("mdCodeBlock", line));
		},
	};

	if (useGlobalCache) {
		cachedGlobalTheme = resolvedTheme;
		cachedGlobalThemeEpoch = globalThemeEpoch;
	} else {
		cachedExplicitThemes.set(sourceTheme, resolvedTheme);
	}
	return resolvedTheme;
}
