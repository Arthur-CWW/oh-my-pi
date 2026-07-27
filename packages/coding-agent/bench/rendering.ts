import { initTheme } from "../src/modes/theme/theme";
import { truncateToVisualLines } from "../src/modes/components/visual-truncate";
import { WelcomeComponent } from "../src/modes/components/welcome";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { Editor } from "@oh-my-pi/pi-tui";
import { AssistantMessageComponent } from "../src/modes/components/assistant-message";
import { TranscriptContainer } from "../src/modes/components/transcript-container";
import { Settings } from "../src/config/settings";
import { getEditorTheme } from "../src/modes/theme/theme";
import { buildDisplayMessage, nextStep, visibleUnits } from "../src/modes/controllers/streaming-reveal";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { ReadTool } from "../src/tools/read";
import type { ToolSession } from "../src/tools";

const ITERATIONS = 500;
const WIDTH = 100;

const longText = Array.from({ length: 200 })
	.map((_, i) => `Line ${i + 1}: \x1b[32mcolored content\x1b[0m with emojis 🚀✨ and extra padding`)
	.join("\n");

function bench(name: string, fn: () => void): number {
	const start = Bun.nanoseconds();
	for (let i = 0; i < ITERATIONS; i++) {
		fn();
	}
	const elapsed = (Bun.nanoseconds() - start) / 1e6;
	const perOp = (elapsed / ITERATIONS).toFixed(6);
	console.log(`${name}: ${elapsed.toFixed(2)}ms total (${perOp}ms/op)`);
	return elapsed;
}

await Settings.init({ inMemory: true });
await initTheme("dark");

console.log(`Rendering benchmark (${ITERATIONS} iterations)\n`);

bench("truncateToVisualLines", () => {
	truncateToVisualLines(longText, 20, WIDTH, 1);
});

const welcome = new WelcomeComponent("8.12.3", "claude-3.7", "anthropic",	[
	{ name: "Test session", timeAgo: "2m" },
	{ name: "Another session", timeAgo: "1h" },
], [
	{ name: "tsserver", status: "ready", fileTypes: ["ts", "tsx", "js"] },
	{ name: "rust-analyzer", status: "connecting", fileTypes: ["rs"] },
]);

bench("WelcomeComponent.render", () => {
	welcome.render(WIDTH);
});

// ── A2: streaming reveal + editor render baselines ──────────────────────────
//
// Diagnostic series, not a fixed-iteration micro-op. `streamingReveal` proves
// or refutes the O(N^2) reveal hypothesis: per-step cost (visibleUnits +
// buildDisplayMessage, the work every stream delta/30fps tick does) is sampled
// at growing revealed lengths. Rising per-step ms => O(N) per tick => O(N^2)
// over the message. Flat per-step => already linear.

function makeMarkdownCorpus(targetGraphemes: number): string {
	const para =
		"The quick brown fox jumps over the lazy dog while 🚀 emoji and a `code span` " +
		"plus **bold** and _italic_ text exercise the markdown lexer and the grapheme segmenter. ";
	const codeBlock = "\n```ts\nconst x: number = compute(a, b) + delta;\nreturn x.toFixed(2);\n```\n\n";
	const list = "\n- first bullet item\n- second bullet item with `inline`\n- third\n\n";
	let out = "";
	let i = 0;
	while (out.length < targetGraphemes) {
		out += `## Section ${++i}\n\n${para}${para}${codeBlock}${list}`;
	}
	return out.slice(0, targetGraphemes);
}

function makeTextMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "bench",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "stop",
		timestamp: 0,
	};
}

/** Average ms for one call of `fn`, over `reps` repeats. */
function benchStep(reps: number, fn: () => void): number {
	const start = Bun.nanoseconds();
	for (let i = 0; i < reps; i++) fn();
	return (Bun.nanoseconds() - start) / 1e6 / reps;
}

/** Average ms for one awaited call of `fn`, over `reps` repeats. */
async function benchStepAsync(reps: number, fn: () => Promise<unknown>): Promise<number> {
	const start = Bun.nanoseconds();
	for (let i = 0; i < reps; i++) await fn();
	return (Bun.nanoseconds() - start) / 1e6 / reps;
}

const REVEAL_CORPUS = makeMarkdownCorpus(6000);
const REVEAL_CHECKPOINTS = [1000, 2000, 3000, 4000, 5000, 6000];
const STEP_REPS = 40;

console.log("\nstreamingReveal (isolated C1: visibleUnits + buildDisplayMessage per delta):");
for (const n of REVEAL_CHECKPOINTS) {
	const msg = makeTextMessage(REVEAL_CORPUS.slice(0, n));
	const revealed = Math.floor(n * 0.9);
	const ms = benchStep(STEP_REPS, () => {
		visibleUnits(msg, false);
		buildDisplayMessage(msg, revealed, false);
	});
	console.log(`  len=${n}: ${ms.toFixed(4)}ms/step`);
}

// Real streaming cost: text GROWS every tick, so Markdown's text-keyed cache
// misses each step (the actual interactive path). Total ms to fully reveal an
// N-grapheme message in nextStep increments — the number C1+C2 reduce.
console.log("\nstreamingRevealFull (C1+C2: full incremental reveal, growing text => cache-miss/tick):");
try {
	for (const n of REVEAL_CHECKPOINTS) {
		const full = makeTextMessage(REVEAL_CORPUS.slice(0, n));
		const total = visibleUnits(full, false);
		const component = new AssistantMessageComponent();
		const start = Bun.nanoseconds();
		let revealed = 0;
		let steps = 0;
		while (revealed < total) {
			revealed = Math.min(total, revealed + nextStep(total - revealed));
			component.updateContent(buildDisplayMessage(full, revealed, false));
			component.render(WIDTH);
			steps++;
		}
		const ms = (Bun.nanoseconds() - start) / 1e6;
		console.log(`  len=${n}: ${ms.toFixed(2)}ms total over ${steps} steps (${(ms / steps).toFixed(4)}ms/step)`);
	}
} catch (err) {
	console.log(`  (skipped: ${(err as Error).message})`);
}

// Multi-block variant: a finalized thinking block (stable) precedes the growing
// text block — the shape C2 targets. Current code re-lexes BOTH every tick;
// after C2 the finalized thinking block stays L1-cached and only the tail re-lexes.
function makeThinkingPlusText(thinking: string, text: string): AssistantMessage {
	return { ...makeTextMessage(text), content: [{ type: "thinking", thinking }, { type: "text", text }] };
}
console.log("\nstreamingRevealMultiBlock (C2: finalized thinking block + growing text):");
try {
	const thinking = makeMarkdownCorpus(2500);
	for (const n of [2000, 4000, 6000]) {
		const full = makeThinkingPlusText(thinking, REVEAL_CORPUS.slice(0, n));
		const total = visibleUnits(full, false);
		const component = new AssistantMessageComponent();
		const start = Bun.nanoseconds();
		let revealed = 0;
		let steps = 0;
		while (revealed < total) {
			revealed = Math.min(total, revealed + nextStep(total - revealed));
			component.updateContent(buildDisplayMessage(full, revealed, false));
			component.render(WIDTH);
			steps++;
		}
		const ms = (Bun.nanoseconds() - start) / 1e6;
		console.log(`  text=${n} (+2500 thinking): ${ms.toFixed(2)}ms total over ${steps} steps (${(ms / steps).toFixed(4)}ms/step)`);
	}
} catch (err) {
	console.log(`  (skipped: ${(err as Error).message})`);
}

console.log("\neditorKeystroke (C3: layout recompute vs no-mutation render):");
try {
	const buffer = Array.from({ length: 50 })
		.map((_, i) => `Line ${i + 1}: some editor content with words to wrap at width ${WIDTH} and more text here`)
		.join("\n");

	const e1 = new Editor(getEditorTheme());
	e1.setText(buffer);
	e1.render(WIDTH); // warm
	const noMutMs = benchStep(200, () => {
		e1.render(WIDTH);
	});
	console.log(`  no-mutation render: ${noMutMs.toFixed(4)}ms/render`);

	const e2 = new Editor(getEditorTheme());
	e2.setText(buffer);
	e2.render(WIDTH); // warm
	const editMs = benchStep(200, () => {
		e2.insertText("x");
		e2.render(WIDTH);
	});
	console.log(`  edit + render: ${editMs.toFixed(4)}ms/op`);
} catch (err) {
	console.log(`  (skipped: ${(err as Error).message})`);
}

// ── E3: long-transcript frame cost ──────────────────────────────────────────
//
// Each series has finalized history plus one unfinalized growing tail. Alongside
// frame time, report how many history blocks and rows were rendered per frame:
// a prefix cache should drive both to zero. `prefixValidationBlocksPerFrame`
// remains explicit because versioned finalized blocks are checked for late
// post-finalize mutations before their immutable rows are reused.
class MeasuredAssistantMessageComponent extends AssistantMessageComponent {
	renderCalls = 0;
	renderedRows = 0;
	versionReads = 0;

	override getTranscriptBlockVersion(): number {
		this.versionReads++;
		return super.getTranscriptBlockVersion();
	}

	override render(width: number): readonly string[] {
		const rows = super.render(width);
		this.renderCalls++;
		this.renderedRows += rows.length;
		return rows;
	}

	resetMeasurements(): void {
		this.renderCalls = 0;
		this.renderedRows = 0;
		this.versionReads = 0;
	}
}

console.log("\nlongTranscriptFrame (E3: finalized prefix + growing tail):");
try {
	const historyText = "Finalized history with `inline` code.\n```ts\nconst settled = true;\n```";
	const tailCorpus = makeMarkdownCorpus(1200);
	const results: Array<{
		finalizedMessages: number;
		frameMs: number;
		historyRenderCallsPerFrame: number;
		historyRenderedRowsPerFrame: number;
		mutableRenderedRowsPerFrame: number;
		prefixValidationBlocksPerFrame: number;
		retained: {
			assembledRows: number;
			segments: number;
			segmentRawRowRefs: number;
			segmentContributionRowRefs: number;
			liveSnapshots: number;
			liveSnapshotRowRefs: number;
			historyPrefixCacheEntries: 0 | 1;
			historyPrefixSegmentRefs: 0;
		};
		beforeEditStructuralModel: {
			/** Derived from the replaced cache shape, not a noisy heap measurement. */
			evidence: "structural-model";
			historyPrefixSegmentRefs: number;
			historyPrefixVersionEntries: number;
			finalizedSnapshotEntries: number;
		};
	}> = [];
	const frames = 60;
	for (const finalizedMessages of [100, 1000, 10_000]) {
		const container = new TranscriptContainer();
		const history: MeasuredAssistantMessageComponent[] = [];
		for (let i = 0; i < finalizedMessages; i++) {
			const block = new MeasuredAssistantMessageComponent();
			block.updateContent(makeTextMessage(historyText));
			block.markTranscriptBlockFinalized();
			container.addChild(block);
			history.push(block);
		}
		const tail = new MeasuredAssistantMessageComponent();
		container.addChild(tail);
		let revealed = Math.floor(tailCorpus.length * 0.5);
		tail.updateContent(makeTextMessage(tailCorpus.slice(0, revealed)));
		container.render(WIDTH); // Build immutable history once before measurement.
		for (const block of history) block.resetMeasurements();
		tail.resetMeasurements();

		const frameMs = benchStep(frames, () => {
			revealed += 20;
			if (revealed > tailCorpus.length) revealed = Math.floor(tailCorpus.length * 0.5);
			tail.updateContent(makeTextMessage(tailCorpus.slice(0, revealed)));
			container.render(WIDTH);
		});
		const historyRenderCalls = history.reduce((total, block) => total + block.renderCalls, 0);
		const historyRenderedRows = history.reduce((total, block) => total + block.renderedRows, 0);
		const prefixVersionReads = history.reduce((total, block) => total + block.versionReads, 0);
		results.push({
			finalizedMessages,
			frameMs,
			historyRenderCallsPerFrame: historyRenderCalls / frames,
			historyRenderedRowsPerFrame: historyRenderedRows / frames,
			mutableRenderedRowsPerFrame: tail.renderedRows / frames,
			prefixValidationBlocksPerFrame: prefixVersionReads / frames,
			retained: container.getRetentionMetrics(),
			beforeEditStructuralModel: {
				evidence: "structural-model",
				historyPrefixSegmentRefs: finalizedMessages,
				historyPrefixVersionEntries: finalizedMessages,
				finalizedSnapshotEntries: finalizedMessages,
			},
		});
	}
	console.log(JSON.stringify({ benchmark: "longTranscriptFrame", width: WIDTH, frames, results }));
} catch (err) {
	console.log(`  (skipped: ${(err as Error).message})`);
}

// ── E4: tool read/parse redundancy ──────────────────────────────────────────
//
// E4 root cause: the read tool re-parses (tree-sitter `summarizeCode`, ~12-18ms
// for a ~1500-line file) on every summary read of the same unchanged file. E4-ii
// memoizes the parse per session keyed on the content hash of the freshly-read
// bytes, so a repeat read of the same file reuses the parse (the file is still
// read fresh, so the result stays correct). A repeated same-session summary read
// should drop from ~17ms to a few ms; a fresh session each call stays full cost.
console.log("\ntoolReadReparse (E4: repeat summary read, memoized parse vs cold):");
try {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-e4-"));
	const file = path.join(dir, "big.ts");
	let src = "";
	for (let i = 0; i < 375; i++) {
		src += `export function fn${i}(a: number, b: string): boolean {\n  const x = a + ${i};\n  return x > 0 && b.length === ${i};\n}\n`;
	}
	fs.writeFileSync(file, src);
	const mkSession = (): ToolSession =>
		({
			cwd: dir,
			hasUI: false,
			getSessionFile: () => path.join(dir, "s.jsonl"),
			getSessionSpawns: () => "*",
			getArtifactsDir: () => path.join(dir, "sess"),
			allocateOutputArtifact: async (t: string) => ({ id: "a", path: path.join(dir, `a.${t}.log`) }),
			settings: Settings.isolated(),
		}) as unknown as ToolSession;
	const sameSession = mkSession();
	const rt = new ReadTool(sameSession);
	for (let i = 0; i < 3; i++) await rt.execute("warm", { path: file });
	const repeatMs = await benchStepAsync(20, () => rt.execute("c", { path: file }));
	const coldMs = await benchStepAsync(20, () => new ReadTool(mkSession()).execute("c", { path: file }));
	console.log(`  same-session repeat read: ${repeatMs.toFixed(3)}ms/call (memoized parse)`);
	console.log(`  fresh-session each read:  ${coldMs.toFixed(3)}ms/call (cold parse)`);
	fs.rmSync(dir, { recursive: true, force: true });
} catch (err) {
	console.log(`  (skipped: ${(err as Error).message})`);
}
