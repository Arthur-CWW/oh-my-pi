import { describe, expect, it } from "bun:test";
import * as path from "node:path";

type ExportedDeclaration = {
	kind: "interface" | "type" | "class";
	name: string;
	source: string;
};

const declarationPattern =
	/\bexport\s+(interface|type|class)\s+([A-Za-z_$][\w$]*)/g;

function skipTrivia(source: string, index: number): number {
	let cursor = index;
	while (cursor < source.length) {
		if (source.startsWith("//", cursor)) {
			const newline = source.indexOf("\n", cursor + 2);
			cursor = newline === -1 ? source.length : newline + 1;
			continue;
		}
		if (source.startsWith("/*", cursor)) {
			const close = source.indexOf("*/", cursor + 2);
			cursor = close === -1 ? source.length : close + 2;
			continue;
		}
		const quote = source[cursor];
		if (quote === "'" || quote === '"' || quote === "`") {
			let end = cursor + 1;
			while (end < source.length) {
				if (source[end] === quote && source[end - 1] !== "\\") break;
				end += 1;
			}
			cursor = end < source.length ? end + 1 : source.length;
			continue;
		}
		break;
	}
	return cursor;
}

function findCodeCharacter(source: string, start: number, character: string): number {
	for (let cursor = start; cursor < source.length; cursor += 1) {
		const next = skipTrivia(source, cursor);
		if (next !== cursor) {
			cursor = next - 1;
			continue;
		}
		if (source[cursor] === character) return cursor;
	}
	return -1;
}

function findDeclarationEnd(source: string, kind: ExportedDeclaration["kind"], afterName: number): number {
	if (kind === "interface" || kind === "class") {
		const bodyStart = findCodeCharacter(source, afterName, "{");
		if (bodyStart === -1) return source.length;
		let depth = 0;
		for (let cursor = bodyStart; cursor < source.length; cursor += 1) {
			const next = skipTrivia(source, cursor);
			if (next !== cursor) {
				cursor = next - 1;
				continue;
			}
			if (source[cursor] === "{") depth += 1;
			else if (source[cursor] === "}" && --depth === 0) return cursor + 1;
		}
		return source.length;
	}

	let braces = 0;
	let brackets = 0;
	let parentheses = 0;
	for (let cursor = afterName; cursor < source.length; cursor += 1) {
		const next = skipTrivia(source, cursor);
		if (next !== cursor) {
			cursor = next - 1;
			continue;
		}
		switch (source[cursor]) {
			case "{":
				braces += 1;
				break;
			case "}":
				braces -= 1;
				break;
			case "[":
				brackets += 1;
				break;
			case "]":
				brackets -= 1;
				break;
			case "(":
				parentheses += 1;
				break;
			case ")":
				parentheses -= 1;
				break;
			case ";":
				if (braces === 0 && brackets === 0 && parentheses === 0) return cursor + 1;
				break;
		}
	}
	return source.length;
}

function withoutTrivia(source: string): string {
	let result = "";
	let cursor = 0;
	while (cursor < source.length) {
		if (source.startsWith("//", cursor)) {
			const newline = source.indexOf("\n", cursor + 2);
			result += newline === -1 ? "" : "\n";
			cursor = newline === -1 ? source.length : newline + 1;
			continue;
		}
		if (source.startsWith("/*", cursor)) {
			const close = source.indexOf("*/", cursor + 2);
			const end = close === -1 ? source.length : close + 2;
			result += source.slice(cursor, end).replace(/[^\n]/g, " ");
			cursor = end;
			continue;
		}
		const quote = source[cursor];
		if (quote === "'" || quote === '"' || quote === "`") {
			let end = cursor + 1;
			while (end < source.length) {
				if (source[end] === quote && source[end - 1] !== "\\") {
					end += 1;
					break;
				}
				end += 1;
			}
			result += source.slice(cursor, end).replace(/[^\n]/g, " ");
			cursor = end;
			continue;
		}
		result += source[cursor];
		cursor += 1;
	}
	return result;
}

function exportedDeclarations(source: string): ExportedDeclaration[] {
	const declarations: ExportedDeclaration[] = [];
	for (const match of source.matchAll(declarationPattern)) {
		const kind = match[1] as ExportedDeclaration["kind"];
		const name = match[2];
		const start = match.index ?? 0;
		const end = findDeclarationEnd(source, kind, start + match[0].length);
		const declarationSource = source.slice(start, end);
		if (/(?:Model|Msg|Message|State)$/.test(name) || /\b_tag\s*:/.test(declarationSource)) {
			declarations.push({ kind, name, source: declarationSource });
		}
	}
	return declarations;
}

const coreFiles = [
	"schema.ts",
	"keymap-registry.ts",
	"selector.ts",
	"keyed-view.ts",
	"tree.ts",
	"modal.ts",
	"status.ts",
].map(file => path.join(import.meta.dir, "../src/modes/mvu", file));

async function readModelCore() {
	return Promise.all(
		coreFiles.map(async file => {
			const source = await Bun.file(file).text();
			return { file, source, declarations: exportedDeclarations(source) };
		}),
	);
}

describe("MVU boundary constraints", () => {
	it("keeps exported Model/Msg/tagged-state declarations free of domain/service/renderer imports", async () => {
		for (const { file, source, declarations } of await readModelCore()) {
			if (declarations.length === 0) continue;
			expect(source, file).not.toMatch(/from ["'](?:\.\.\/){2,}(?:session|fleet|irc|services)/);
			const declarationSource = withoutTrivia(declarations.map(declaration => declaration.source).join("\n"));
			expect(declarationSource, file).not.toMatch(/\b(?:any|unknown)\b/);
		}
	});

	it("does not place Effect, Promise, Component, callbacks, or services in model declarations", async () => {
		for (const { file, declarations } of await readModelCore()) {
			const declarationSource = withoutTrivia(declarations.map(declaration => declaration.source).join("\n"));
			expect(declarationSource, file).not.toMatch(
				/(?:readonly\s+)?\w+\??\s*:\s*(?:Effect|Promise|Component|Service|Renderer)\b/,
			);
			expect(declarationSource, file).not.toMatch(
				/(?:readonly\s+)?\w+\??\s*:\s*(?:<[^>]*>\s*)?\([^;{}]*\)\s*=>/,
			);
		}
	});
});
