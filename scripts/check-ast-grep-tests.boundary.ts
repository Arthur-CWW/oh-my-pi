#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

const rulesDir = "tools/ast-grep/rules";
const testsDir = "tools/ast-grep/rule-tests";

const ruleFiles = listYamlFiles(rulesDir);
const testFiles = existsSync(testsDir) ? listYamlFiles(testsDir) : [];
const testIds = new Set(testFiles.map(readRequiredRuleId));
const missing: string[] = [];
const badFiles: string[] = [];

for (const file of ruleFiles) {
	const id = readTopLevelId(file);
	if (!id) {
		badFiles.push(`${file}: missing top-level id`);
		continue;
	}
	if (!testIds.has(id)) missing.push(`${id} (${file})`);
}

if (badFiles.length > 0 || missing.length > 0) {
	console.error("ast-grep rule test coverage failed.");
	for (const file of badFiles) console.error(`- ${file}`);
	for (const rule of missing) console.error(`- missing rule test for ${rule}`);
	console.error("Add tools/ast-grep/rule-tests/<rule-id>-test.yml with valid and invalid cases.");
	process.exit(1);
}

console.log(`ast-grep rule test coverage passed: ${ruleFiles.length} rule(s).`);

function listYamlFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
		.map((entry) => join(dir, entry.name))
		.sort();
}

function readRequiredRuleId(file: string): string {
	return readTopLevelId(file) ?? basename(file).replace(/\.ya?ml$/, "").replace(/-test$/, "");
}

function readTopLevelId(file: string): string | null {
	const contents = readFileSync(file, "utf8");
	const match = contents.match(/^id:\s*["']?([^\s"'#]+)["']?\s*$/m);
	return match?.[1] ?? null;
}
