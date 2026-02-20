import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { search } from "../src/effect/gemini-search.ts";
import { isGeminiWebAvailable } from "../src/old/gemini-web.ts";

function ok(message: string): void {
	console.log(`✅ ${message}`);
}

function timestamp(): string {
	return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeTestOutput(data: {
	query: string;
	passed: boolean;
	error?: string;
	cookieCount: number;
	answer?: string;
	sources?: Array<{ title: string; url: string; snippet: string }>;
}): string {
	const outDir = join(process.cwd(), "test-output");
	mkdirSync(outDir, { recursive: true });

	const base = `e2e-search-gemini-effect-${timestamp()}`;
	const jsonPath = join(outDir, `${base}.json`);
	const mdPath = join(outDir, `${base}.md`);

	writeFileSync(
		jsonPath,
		JSON.stringify(
			{
				createdAt: new Date().toISOString(),
				...data,
			},
			null,
			2,
		) + "\n",
	);

	const md = [
		"# E2E Gemini Search Result (Effect)",
		"",
		`- **Passed:** ${data.passed ? "yes" : "no"}`,
		`- **Created:** ${new Date().toISOString()}`,
		`- **Query:** ${data.query}`,
		`- **Gemini cookies found:** ${data.cookieCount}`,
		data.error ? `- **Error:** ${data.error}` : "",
		"",
		"## Sources",
		"",
		...(data.sources?.length
			? data.sources.map((s, i) => `${i + 1}. [${s.title || "(untitled)"}](${s.url})`)
			: ["(none)"]),
		"",
		"## Answer",
		"",
		data.answer || "(none)",
		"",
	].join("\n");

	writeFileSync(mdPath, md);
	return outDir;
}

async function main() {
	const query = process.argv.slice(2).join(" ") || "What is Bun runtime?";

	console.log("\npi-web-access e2e Gemini search test (Effect)\n");
	console.log(`Query: ${query}\n`);

	let cookieCount = 0;

	try {
		const cookies = await isGeminiWebAvailable();
		cookieCount = cookies ? Object.keys(cookies).length : 0;
		ok(`Gemini Web cookies ${cookies ? `available (${cookieCount})` : "not available"}`);

		const result = await search(query, { provider: "gemini", numResults: 5 });

		if (!result.answer?.trim()) throw new Error("Search returned empty answer");
		if (!Array.isArray(result.results) || result.results.length === 0) {
			throw new Error("Search returned no sources");
		}

		ok(`Search returned answer (${result.answer.length} chars)`);
		ok(`Retrieved ${result.results.length} sources`);

		const outputDir = writeTestOutput({
			query,
			passed: true,
			cookieCount,
			answer: result.answer,
			sources: result.results,
		});
		console.log(`\n📁 Test output written to: ${outputDir}`);
		console.log("🎉 E2E passed: Effect gemini search returned answer + sources\n");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const outputDir = writeTestOutput({ query, passed: false, error: message, cookieCount });
		console.error(`❌ Unhandled error: ${message}`);
		console.error(`📁 Test output written to: ${outputDir}`);
		process.exit(1);
	}
}

main();
