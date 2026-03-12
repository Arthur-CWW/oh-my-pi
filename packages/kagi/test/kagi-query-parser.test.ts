import { describe, expect, it } from "bun:test";
import {
	applyDomainFilterToQuery,
	mergeDomainFilters,
	parseGoogleStyleQuery,
} from "../src/kagi-query-parser.js";

describe("kagi query parser (gwern-style operators)", () => {
	it("parses site include/exclude examples from gwern", () => {
		const included = parseGoogleStyleQuery("foo site:gwern.net/doc/genetics/");
		expect(included.baseQuery).toBe("foo");
		expect(included.domainFilter).toEqual(["gwern.net/doc/genetics"]);
		expect(included.includeSites).toEqual(["gwern.net/doc/genetics"]);
		expect(included.excludeSites).toEqual([]);

		const includeExclude = parseGoogleStyleQuery("foo site:gwern.net -site:gwern.net/doc/");
		expect(includeExclude.baseQuery).toBe("foo");
		expect(includeExclude.domainFilter).toEqual(["gwern.net", "-gwern.net/doc"]);
		expect(includeExclude.includeSites).toEqual(["gwern.net"]);
		expect(includeExclude.excludeSites).toEqual(["gwern.net/doc"]);
	});

	it("parses boolean and negation query example", () => {
		const parsed = parseGoogleStyleQuery("(foo OR baz) AND (qux OR quux) -bar -garply -waldo -fred");
		expect(parsed.baseQuery).toBe("(foo OR baz) AND (qux OR quux) -bar -garply -waldo -fred");
		expect(parsed.excludedTerms).toEqual(["bar", "garply", "waldo", "fred"]);
		expect(parsed.domainFilter).toEqual([]);
	});

	it("preserves Kagi-documented +, -, wildcard, and grouping operators", () => {
		const parsed = parseGoogleStyleQuery("food +cat -dog best * ever (recipes OR cooking)");
		expect(parsed.baseQuery).toBe("food +cat -dog best * ever (recipes OR cooking)");
		expect(parsed.excludedTerms).toEqual(["dog"]);
		expect(parsed.unsupportedOperators).toEqual([]);
	});

	it("collects exact phrases from quoted-title example", () => {
		const parsed = parseGoogleStyleQuery('"Foo bar" "baz quux"');
		expect(parsed.baseQuery).toBe('"Foo bar" "baz quux"');
		expect(parsed.exactPhrases).toEqual(["Foo bar", "baz quux"]);
	});

	it("parses before/after date filters", () => {
		const parsed = parseGoogleStyleQuery("effect runtime before:2025-01-31 after:2024/01/01");
		expect(parsed.baseQuery).toBe("effect runtime");
		expect(parsed.fromDate).toBe("2024-01-01");
		expect(parsed.toDate).toBe("2025-01-31");
		expect(parsed.unmappedDateOperators).toEqual([]);
	});

	it("does not coerce year-only before/after operators into API date bounds", () => {
		const parsed = parseGoogleStyleQuery("effect runtime after:2025 before:2026");
		expect(parsed.fromDate).toBeUndefined();
		expect(parsed.toDate).toBeUndefined();
		expect(parsed.baseQuery).toBe("effect runtime after:2025 before:2026");
		expect(parsed.unmappedDateOperators).toEqual(["after:2025", "before:2026"]);
	});

	it("parses filetype operators supported by Kagi", () => {
		const parsed = parseGoogleStyleQuery("book title filetype:pdf ext:csv");
		expect(parsed.baseQuery).toBe("book title");
		expect(parsed.fileTypes).toEqual(["pdf", "csv"]);
		expect(parsed.normalizedQuery).toBe("book title filetype:pdf filetype:csv");
	});

	it("parses scoped text operators relevant to Kagi query string", () => {
		const parsed = parseGoogleStyleQuery(
			'intitle:"strict aliasing" inurl:cpp intext:"undefined behavior" allintitle:compiler optimization allinurl:docs reference allintext:memory model',
		);

		expect(parsed.titleTerms).toEqual(["strict aliasing", "compiler", "optimization"]);
		expect(parsed.urlTerms).toEqual(["cpp", "docs", "reference"]);
		expect(parsed.textTerms).toEqual(["undefined behavior", "memory", "model"]);
		expect(parsed.normalizedQuery).toContain('intitle:"strict aliasing"');
		expect(parsed.normalizedQuery).toContain("inurl:cpp");
		expect(parsed.normalizedQuery).toContain('intext:"undefined behavior"');
	});

	it("keeps unsupported operators in the base query and surfaces them as quirks", () => {
		const parsed = parseGoogleStyleQuery("author:foo related:bar Form 990 site:charity.com");
		expect(parsed.baseQuery).toBe("author:foo related:bar Form 990");
		expect(parsed.domainFilter).toEqual(["charity.com"]);
		expect(parsed.unsupportedOperators).toEqual(["author", "related"]);
	});

	it("normalizes site filters and deduplicates equivalent domains", () => {
		const parsed = parseGoogleStyleQuery(
			"foo site:https://www.Example.com/path/ site:example.com/path -site:http://www.example.com/path/",
		);
		expect(parsed.domainFilter).toEqual(["example.com/path", "-example.com/path"]);
	});

	it("merges explicit domain filters with parsed filters", () => {
		const parsed = parseGoogleStyleQuery("effect ts site:bun.com -site:example.com");
		const merged = mergeDomainFilters(["effect.website", "-ads.example"], parsed.domainFilter);
		expect(merged).toEqual(["effect.website", "-ads.example", "bun.com", "-example.com"]);

		const finalQuery = applyDomainFilterToQuery(parsed.normalizedQuery, merged);
		expect(finalQuery).toBe("effect ts (site:effect.website OR site:bun.com) -site:ads.example -site:example.com");
	});
});
