export interface StructuredKagiSearchQuery {
	readonly originalQuery: string;
	readonly baseQuery: string;
	readonly normalizedQuery: string;
	readonly domainFilter: ReadonlyArray<string>;
	readonly includeSites: ReadonlyArray<string>;
	readonly excludeSites: ReadonlyArray<string>;
	readonly fileTypes: ReadonlyArray<string>;
	readonly titleTerms: ReadonlyArray<string>;
	readonly urlTerms: ReadonlyArray<string>;
	readonly textTerms: ReadonlyArray<string>;
	readonly exactPhrases: ReadonlyArray<string>;
	readonly excludedTerms: ReadonlyArray<string>;
	readonly unsupportedOperators: ReadonlyArray<string>;
	readonly unmappedDateOperators: ReadonlyArray<string>;
	readonly fromDate?: string;
	readonly toDate?: string;
}

const BOOLEAN_OPERATORS = new Set(["OR", "AND"]);
const SUPPORTED_OPERATOR_NAMES = new Set([
	"site",
	"before",
	"after",
	"filetype",
	"ext",
	"intitle",
	"allintitle",
	"inurl",
	"allinurl",
	"intext",
	"allintext",
]);

function tokenizeQuery(query: string): string[] {
	return query.match(/"[^"]*"|\S+/g) ?? [];
}

function stripWrappingQuotes(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim();
	}
	return trimmed;
}

function stripWrappingCharacters(value: string): string {
	return value.replace(/^[([{]+/, "").replace(/[)\]}]+$/, "").trim();
}

function hasUnclosedDoubleQuote(value: string): boolean {
	const quoteCount = (value.match(/"/g) ?? []).length;
	return quoteCount % 2 === 1;
}

function consumePossiblyQuotedValue(
	tokens: readonly string[],
	startIndex: number,
	initialValue: string,
): { readonly value: string; readonly nextIndex: number } {
	let value = initialValue;
	let nextIndex = startIndex;
	while (hasUnclosedDoubleQuote(value) && nextIndex + 1 < tokens.length) {
		nextIndex += 1;
		value = `${value} ${tokens[nextIndex] ?? ""}`.trim();
	}
	return { value, nextIndex };
}

function normalizeGoogleDate(raw: string): string | undefined {
	const trimmed = stripWrappingQuotes(stripWrappingCharacters(raw)).replace(/[.,;:!?]+$/, "").trim();
	const normalized = trimmed.replace(/\//g, "-");
	const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) {
		return undefined;
	}

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const parsed = new Date(Date.UTC(year, month - 1, day));
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() + 1 !== month ||
		parsed.getUTCDate() !== day
	) {
		return undefined;
	}

	return `${match[1]}-${match[2]}-${match[3]}`;
}

function normalizeSiteFilterValue(raw: string): string | null {
	let value = stripWrappingQuotes(stripWrappingCharacters(raw));
	value = value.replace(/[.,;:!?]+$/, "").trim();
	if (!value) {
		return null;
	}

	if (value.startsWith("http://") || value.startsWith("https://")) {
		try {
			const parsed = new URL(value);
			const pathname = parsed.pathname.replace(/\/+$/, "");
			value = `${parsed.hostname}${pathname === "/" ? "" : pathname}`;
		} catch {
			return null;
		}
	}

	value = value.replace(/^www\./i, "").replace(/\/+$/, "").trim();
	if (!value || /\s/.test(value)) {
		return null;
	}
	return value;
}

function normalizeDomainFilterEntry(raw: string): string | null {
	const trimmed = raw.trim();
	if (!trimmed) {
		return null;
	}

	const excludes = trimmed.startsWith("-");
	const unsigned = excludes ? trimmed.slice(1) : trimmed;
	const withoutSitePrefix = unsigned.replace(/^site:/i, "");
	const normalizedValue = normalizeSiteFilterValue(withoutSitePrefix);
	if (!normalizedValue) {
		return null;
	}
	return excludes ? `-${normalizedValue}` : normalizedValue;
}

export function normalizeDomainFilters(domains: ReadonlyArray<string>): string[] {
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const domain of domains) {
		const normalized = normalizeDomainFilterEntry(domain);
		if (!normalized) {
			continue;
		}
		const key = normalized.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(normalized);
	}
	return unique;
}

function normalizeScopedTermValue(raw: string): string | null {
	const cleaned = stripWrappingQuotes(stripWrappingCharacters(raw)).replace(/[.,;:!?]+$/, "").trim();
	if (!cleaned) {
		return null;
	}
	return cleaned;
}

function normalizeFileTypeValue(raw: string): string | null {
	const normalized = normalizeScopedTermValue(raw)?.toLowerCase().replace(/^\./, "");
	if (!normalized) {
		return null;
	}
	if (!/^[a-z0-9_+-]+$/.test(normalized)) {
		return null;
	}
	return normalized;
}

function isLikelyHttpUrl(token: string): boolean {
	const lower = token.trim().toLowerCase();
	return lower.startsWith("http://") || lower.startsWith("https://");
}

function extractOperatorName(token: string): string | null {
	const candidate = stripWrappingCharacters(token).toLowerCase();
	const match = candidate.match(/^-?([a-z][a-z0-9_+-]*):/);
	if (!match?.[1]) {
		return null;
	}
	return match[1];
}

function isBooleanOperator(value: string): value is "OR" | "AND" {
	return BOOLEAN_OPERATORS.has(value.toUpperCase());
}

function isKnownFilterOperator(token: string): boolean {
	const lower = stripWrappingCharacters(token).toLowerCase();
	return (
		lower.startsWith("site:") ||
		lower.startsWith("-site:") ||
		lower.startsWith("before:") ||
		lower.startsWith("after:") ||
		lower.startsWith("filetype:") ||
		lower.startsWith("ext:") ||
		lower.startsWith("intitle:") ||
		lower.startsWith("allintitle:") ||
		lower.startsWith("inurl:") ||
		lower.startsWith("allinurl:") ||
		lower.startsWith("intext:") ||
		lower.startsWith("allintext:")
	);
}

function cleanBooleanOperators(tokens: ReadonlyArray<string>): string {
	const normalizedTokens = tokens.map((token) => token.trim()).filter((token) => token.length > 0);
	const cleaned: string[] = [];

	for (let index = 0; index < normalizedTokens.length; index += 1) {
		const token = normalizedTokens[index] ?? "";
		if (!isBooleanOperator(token)) {
			cleaned.push(token);
			continue;
		}

		const previous = cleaned.at(-1);
		let nextNonEmpty: string | undefined;
		for (let nextIndex = index + 1; nextIndex < normalizedTokens.length; nextIndex += 1) {
			const candidate = normalizedTokens[nextIndex];
			if (candidate && candidate.length > 0) {
				nextNonEmpty = candidate;
				break;
			}
		}

		if (!previous || !nextNonEmpty) {
			continue;
		}
		if (isBooleanOperator(previous) || isBooleanOperator(nextNonEmpty)) {
			continue;
		}
		cleaned.push(token.toUpperCase());
	}

	while (cleaned.length > 0 && isBooleanOperator(cleaned[0] ?? "")) {
		cleaned.shift();
	}
	while (cleaned.length > 0 && isBooleanOperator(cleaned.at(-1) ?? "")) {
		cleaned.pop();
	}

	return cleaned.join(" ").replace(/\s+/g, " ").trim();
}

function formatScopedOperator(operator: "intitle" | "inurl" | "intext", term: string): string {
	const escaped = term.replace(/"/g, "\\\"");
	if (/\s/.test(escaped)) {
		return `${operator}:"${escaped}"`;
	}
	return `${operator}:${escaped}`;
}

function uniqueValues(values: ReadonlyArray<string>): string[] {
	const unique: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const key = value.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(value);
	}
	return unique;
}

function collectAllScopedTerms(
	tokens: readonly string[],
	startIndex: number,
	initialRaw: string,
): { readonly terms: ReadonlyArray<string>; readonly nextIndex: number } {
	const terms: string[] = [];
	let scanIndex = startIndex;
	const initialValue = consumePossiblyQuotedValue(tokens, startIndex, initialRaw);
	if (initialValue.value.trim().length > 0) {
		const normalizedInitial = normalizeScopedTermValue(initialValue.value);
		if (normalizedInitial) {
			terms.push(normalizedInitial);
		}
	}
	scanIndex = initialValue.nextIndex;

	for (let index = scanIndex + 1; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		if (isBooleanOperator(token) || isKnownFilterOperator(token)) {
			break;
		}

		const value = consumePossiblyQuotedValue(tokens, index, token);
		const normalized = normalizeScopedTermValue(value.value);
		if (normalized) {
			terms.push(normalized);
		}
		scanIndex = value.nextIndex;
		index = value.nextIndex;
	}

	return {
		terms: uniqueValues(terms),
		nextIndex: scanIndex,
	};
}

function extractQuotedPhrase(token: string): string | null {
	const trimmed = token.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
		const phrase = stripWrappingQuotes(trimmed);
		return phrase.length > 0 ? phrase : null;
	}
	return null;
}

function extractExcludedTerm(token: string): string | null {
	const trimmed = token.trim();
	if (!trimmed.startsWith("-") || trimmed.length <= 1 || isKnownFilterOperator(trimmed)) {
		return null;
	}
	const normalized = normalizeScopedTermValue(trimmed.slice(1));
	if (!normalized || normalized.includes(":")) {
		return null;
	}
	return normalized;
}

export function parseGoogleStyleQuery(query: string): StructuredKagiSearchQuery {
	const tokens = tokenizeQuery(query);
	const remainingTokens: string[] = [];
	const includeSites: string[] = [];
	const excludeSites: string[] = [];
	const fileTypes: string[] = [];
	const titleTerms: string[] = [];
	const urlTerms: string[] = [];
	const textTerms: string[] = [];
	const unsupportedOperators: string[] = [];
	const unmappedDateOperators: string[] = [];
	let fromDate: string | undefined;
	let toDate: string | undefined;

	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] ?? "";
		const candidate = stripWrappingCharacters(token);

		const siteMatch = candidate.match(/^(-?)site:(.+)$/i);
		if (siteMatch) {
			const sign = siteMatch[1] === "-" ? "-" : "";
			const siteValue = normalizeSiteFilterValue(siteMatch[2] ?? "");
			if (siteValue) {
				if (sign === "-") {
					excludeSites.push(siteValue);
				} else {
					includeSites.push(siteValue);
				}
				continue;
			}
		}

		const beforeMatch = candidate.match(/^before:(.+)$/i);
		if (beforeMatch) {
			const dateValue = consumePossiblyQuotedValue(tokens, index, beforeMatch[1] ?? "");
			const date = normalizeGoogleDate(dateValue.value);
			if (date) {
				toDate = date;
				index = dateValue.nextIndex;
				continue;
			}
			const rawDate = stripWrappingCharacters(dateValue.value).trim();
			if (rawDate.length > 0) {
				unmappedDateOperators.push(`before:${rawDate}`);
			}
		}

		const afterMatch = candidate.match(/^after:(.+)$/i);
		if (afterMatch) {
			const dateValue = consumePossiblyQuotedValue(tokens, index, afterMatch[1] ?? "");
			const date = normalizeGoogleDate(dateValue.value);
			if (date) {
				fromDate = date;
				index = dateValue.nextIndex;
				continue;
			}
			const rawDate = stripWrappingCharacters(dateValue.value).trim();
			if (rawDate.length > 0) {
				unmappedDateOperators.push(`after:${rawDate}`);
			}
		}

		const fileTypeMatch = candidate.match(/^(?:filetype|ext):(.+)$/i);
		if (fileTypeMatch) {
			const fileTypeValue = consumePossiblyQuotedValue(tokens, index, fileTypeMatch[1] ?? "");
			const fileType = normalizeFileTypeValue(fileTypeValue.value);
			if (fileType) {
				fileTypes.push(fileType);
				index = fileTypeValue.nextIndex;
				continue;
			}
		}

		const intitleMatch = candidate.match(/^intitle:(.+)$/i);
		if (intitleMatch) {
			const value = consumePossiblyQuotedValue(tokens, index, intitleMatch[1] ?? "");
			const term = normalizeScopedTermValue(value.value);
			if (term) {
				titleTerms.push(term);
				index = value.nextIndex;
				continue;
			}
		}

		const inurlMatch = candidate.match(/^inurl:(.+)$/i);
		if (inurlMatch) {
			const value = consumePossiblyQuotedValue(tokens, index, inurlMatch[1] ?? "");
			const term = normalizeScopedTermValue(value.value);
			if (term) {
				urlTerms.push(term);
				index = value.nextIndex;
				continue;
			}
		}

		const intextMatch = candidate.match(/^intext:(.+)$/i);
		if (intextMatch) {
			const value = consumePossiblyQuotedValue(tokens, index, intextMatch[1] ?? "");
			const term = normalizeScopedTermValue(value.value);
			if (term) {
				textTerms.push(term);
				index = value.nextIndex;
				continue;
			}
		}

		const allInTitleMatch = candidate.match(/^allintitle:(.*)$/i);
		if (allInTitleMatch) {
			const collected = collectAllScopedTerms(tokens, index, allInTitleMatch[1] ?? "");
			titleTerms.push(...collected.terms);
			index = collected.nextIndex;
			continue;
		}

		const allInUrlMatch = candidate.match(/^allinurl:(.*)$/i);
		if (allInUrlMatch) {
			const collected = collectAllScopedTerms(tokens, index, allInUrlMatch[1] ?? "");
			urlTerms.push(...collected.terms);
			index = collected.nextIndex;
			continue;
		}

		const allInTextMatch = candidate.match(/^allintext:(.*)$/i);
		if (allInTextMatch) {
			const collected = collectAllScopedTerms(tokens, index, allInTextMatch[1] ?? "");
			textTerms.push(...collected.terms);
			index = collected.nextIndex;
			continue;
		}

		const operatorName = extractOperatorName(candidate);
		if (operatorName && !SUPPORTED_OPERATOR_NAMES.has(operatorName) && !isLikelyHttpUrl(candidate)) {
			unsupportedOperators.push(operatorName);
		}

		remainingTokens.push(token);
	}

	const includeSitesNormalized = uniqueValues(includeSites);
	const excludeSitesNormalized = uniqueValues(excludeSites);
	const domainFilter = normalizeDomainFilters([
		...includeSitesNormalized,
		...excludeSitesNormalized.map((site) => `-${site}`),
	]);
	const baseQuery = cleanBooleanOperators(remainingTokens);
	const normalizedQueryParts: string[] = [];
	if (baseQuery.length > 0) {
		normalizedQueryParts.push(baseQuery);
	}

	for (const term of uniqueValues(titleTerms)) {
		normalizedQueryParts.push(formatScopedOperator("intitle", term));
	}
	for (const term of uniqueValues(urlTerms)) {
		normalizedQueryParts.push(formatScopedOperator("inurl", term));
	}
	for (const term of uniqueValues(textTerms)) {
		normalizedQueryParts.push(formatScopedOperator("intext", term));
	}
	for (const fileType of uniqueValues(fileTypes)) {
		normalizedQueryParts.push(`filetype:${fileType}`);
	}

	const exactPhrases = uniqueValues(
		remainingTokens
			.map((token) => extractQuotedPhrase(token))
			.filter((value): value is string => typeof value === "string"),
	);
	const excludedTerms = uniqueValues(
		remainingTokens
			.map((token) => extractExcludedTerm(token))
			.filter((value): value is string => typeof value === "string"),
	);

	return {
		originalQuery: query,
		baseQuery,
		normalizedQuery: normalizedQueryParts.join(" ").trim(),
		domainFilter,
		includeSites: includeSitesNormalized,
		excludeSites: excludeSitesNormalized,
		fileTypes: uniqueValues(fileTypes),
		titleTerms: uniqueValues(titleTerms),
		urlTerms: uniqueValues(urlTerms),
		textTerms: uniqueValues(textTerms),
		exactPhrases,
		excludedTerms,
		unsupportedOperators: uniqueValues(unsupportedOperators),
		unmappedDateOperators: uniqueValues(unmappedDateOperators),
		...(fromDate ? { fromDate } : {}),
		...(toDate ? { toDate } : {}),
	};
}

export function mergeDomainFilters(
	explicitDomains: ReadonlyArray<string> | undefined,
	parsedDomains: ReadonlyArray<string>,
): ReadonlyArray<string> {
	return normalizeDomainFilters([...(explicitDomains ?? []), ...parsedDomains]);
}

export function applyDomainFilterToQuery(query: string, domains: ReadonlyArray<string>): string {
	const normalizedDomains = normalizeDomainFilters(domains);
	if (normalizedDomains.length === 0) {
		return query.trim();
	}

	const includedDomains: string[] = [];
	const excludedDomains: string[] = [];
	for (const domain of normalizedDomains) {
		if (domain.startsWith("-")) {
			excludedDomains.push(domain.slice(1));
			continue;
		}
		includedDomains.push(domain);
	}

	const clauses: string[] = [];
	if (includedDomains.length === 1) {
		clauses.push(`site:${includedDomains[0]}`);
	} else if (includedDomains.length > 1) {
		clauses.push(`(${includedDomains.map((domain) => `site:${domain}`).join(" OR ")})`);
	}
	for (const domain of excludedDomains) {
		clauses.push(`-site:${domain}`);
	}

	return [query.trim(), ...clauses].filter((part) => part.length > 0).join(" ").trim();
}
