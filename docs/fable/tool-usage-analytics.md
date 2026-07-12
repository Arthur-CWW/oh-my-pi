# Tool-usage analytics

Status: seven-day observational baseline captured 2026-07-12  
Scope: every JSONL below `/Users/arthur/.omp/agent/sessions/`, across all project directories

## Executive finding

The stack has two different problems. High-volume core tools are mostly distinct, but their failed calls are expensive: explicit failures alone returned about 799,000 tokens, led by `bash` (583,382), `read` (81,257), and `edit` (66,506). The genuine duplication is concentrated in browser/web dispatch and in globally visible skills. Agents also attempted 19 malformed or nonexistent tool names; all 19 failed.

Do not delete `read`, `search`, `bash`, or `edit` because they are large. Their volume reflects work. Consolidate chooser surfaces, demote broken/unused capabilities, and preserve separate truth surfaces behind one router.

## Method

- Window: exact rolling seven days, 2026-07-05 12:43:22 UTC through 2026-07-12 12:43:22 UTC.
- Corpus: 3,485 JSONL files scanned; 1,391 files contained in-window events; 399,770 physical lines visited. Events without a parseable timestamp were excluded.
- Calls: assistant content entries of type `toolCall`, grouped by exact tool name.
- Results/errors: matching `toolResult` messages. An error is counted only when the persisted result explicitly sets `isError`; text heuristics are not used.
- Result tokens: `round(total UTF-8 text characters / 4)`. This is a consistent size proxy, not provider-billed tokens. Binary/image payloads and model prompt tax are not represented.
- Skills: explicit `read` calls whose path begins `skill://`. Automatic skill injection cannot be recovered from this signal.
- The session tree was live during capture, so this is a frozen directional baseline rather than an accounting ledger.

## Usage and result weight

| Tool | Calls | Explicit errors | Error rate | Result chars | Approx. result tokens |
|---|---:|---:|---:|---:|---:|
| `read` | 26,006 | 457 | 1.8% | 135,306,679 | 33,826,670 |
| `search` | 8,803 | 112 | 1.3% | 51,103,642 | 12,775,910 |
| `edit` | 6,570 | 508 | 7.7% | 6,266,695 | 1,566,674 |
| `bash` | 6,269 | 1,283 | 20.5% | 14,405,958 | 3,601,490 |
| `irc` | 6,048 | 193 | 3.2% | 2,508,129 | 627,032 |
| `find` | 2,446 | 172 | 7.0% | 1,828,322 | 457,080 |
| `job` | 2,222 | 1 | <0.1% | 284,655 | 71,164 |
| `browser` | 2,077 | 302 | 14.5% | 1,821,131 | 455,283 |
| `yield` | 1,901 | 3 | 0.2% | 52,489 | 13,122 |
| `write` | 1,196 | 50 | 4.2% | 449,870 | 112,468 |
| `web_search` | 1,157 | 5 | 0.4% | 2,733,922 | 683,480 |
| `mcp__node_repl_js` | 1,109 | 377 | 34.0% | 3,394,367 | 848,592 |
| `task` | 839 | 10 | 1.2% | 752,231 | 188,058 |
| `eval` | 645 | 62 | 9.6% | 1,640,491 | 410,123 |
| `todo` | 397 | 3 | 0.8% | 82,230 | 20,558 |
| `report_tool_issue` | 383 | 1 | 0.3% | 5,848 | 1,462 |
| `lsp` | 344 | 1 | 0.3% | 28,085 | 7,021 |
| `inspect_image` | 298 | 12 | 4.0% | 188,156 | 47,039 |
| `mcp__fetch_fetch` | 293 | 80 | 27.3% | 2,607,801 | 651,950 |
| `ast_grep` | 150 | 1 | 0.7% | 953,924 | 238,481 |
| `goal` | 63 | 6 | 9.5% | 5,402 | 1,350 |
| `ast_edit` | 44 | 0 | 0% | 55,283 | 13,821 |
| `mcp__node_repl_js_reset` | 41 | 0 | 0% | 615 | 154 |
| `github` | 38 | 2 | 5.3% | 24,255 | 6,064 |
| `ncode_delegate` | 31 | 31 | 100% | 6,493 | 1,623 |
| `ask` | 18 | 5 | 27.8% | 2,019 | 505 |
| `mcp__node_repl_js_add_node_module_dir` | 13 | 0 | 0% | 56 | 14 |
| `render_mermaid` | 5 | 0 | 0% | 16,960 | 4,240 |
| `debug` | 2 | 1 | 50% | 42 | 10 |
| `generate_image` | 1 | 1 | 100% | 71 | 18 |

Other persisted names were `report_finding` (167 calls, 6,742 result-token proxy) plus 19 malformed/nonexistent names such as `_`, `_search`, `Read`, `Timeout`, and `grep_with_context_fetch`; every malformed call failed. They should not be treated as real tools.

### Explicit failure waste

| Rank | Tool | Failed calls | Approx. tokens in failed results |
|---:|---|---:|---:|
| 1 | `bash` | 1,283 | 583,382 |
| 2 | `read` | 457 | 81,257 |
| 3 | `edit` | 508 | 66,506 |
| 4 | `browser` | 302 | 25,123 |
| 5 | `mcp__node_repl_js` | 377 | 14,563 |
| 6 | `eval` | 62 | 11,175 |
| 7 | `irc` | 193 | 6,597 |
| 8 | `find` | 172 | 4,539 |
| 9 | `search` | 112 | 2,966 |
| 10 | `mcp__fetch_fetch` | 80 | 2,131 |

The largest individual results reinforce the risk: two `mcp__fetch_fetch` results were 490,271 characters each; another was 188,166. Multiple `read` results were about 149,000–153,000 characters, largely session-transcript mining. A `mcp__node_repl_js` result reached 197,257 characters. Result caps and artifact references matter more than shaving a few low-volume tools.

## Skill invocations

| Skill | Explicit loads |
|---|---:|
| `playwright` | 32 |
| `browser-control` | 28 |
| `background-browser-automation` | 19 |
| `arthur-high-level-first` | 17 |
| `impeccable` | 17 |
| `proof-of-work-qa` | 11 |
| `omp-irc` | 10 |
| `sideline-annotation-card` | 10 |
| `arthur-primer-workflow` | 9 |
| `cua-driver` | 7 |
| `source-archive` | 9 |
| `cmux-browser-drive` | 8 |
| `librarian` | 8 |
| `rubber-duck-adversarial` | 8 |
| `gmcli`, `transcribe` | 4 each |
| `meta-setup`, `writing-without-ai-tells` | 3 each |
| `browser-tools` | 2 |
| `borges-library`, `youtube-transcript`, `twitter-x-context`, `impeccable-design-review` | 1 each |
| `gdcli`, `gccli`, `cloudflare-deploy`, `find-skills` | 0 explicit loads |

This directly contradicts treating browser guidance as a clean three-skill hierarchy: at least six names were loaded (`browser-control`, `playwright`, `background-browser-automation`, `cua-driver`, `cmux-browser-drive`, `browser-tools`). `impeccable` also logged 17 loads despite being described elsewhere as archived/disabled; visibility and archive state need reconciliation.

## Near-duplicate surfaces

| Family | Observed calls/loads | Decision |
|---|---|---|
| Interactive browser | `browser` 2,077; browser-related skill loads 96 | Expose one chooser. Keep CDP, cmux, and native UI implementations behind it, not as peer choices. |
| Node browser/computer-use bridge | `mcp__node_repl_js` 1,109, 34.0% error; `browser` 14.5% error | Keep Node REPL for JavaScript computation, but stop advertising it as a second general browser entry. Route browser work through `browser-control`. |
| Web retrieval | `web_search` 1,157; `mcp__fetch_fetch` 293 | One search/discovery entry and one URL-reader execution path. Prefer built-in `read(URL)` for static URLs; hide raw MCP fetch unless its special behavior is required. |
| Code discovery | `search` 8,803; `ast_grep` 150; `lsp` 344; `find` 2,446 | Not implementation duplicates. Keep, but one concise chooser must distinguish filename, text, syntax, and symbol operations. |
| Mutation | `edit` 6,570; `ast_edit` 44; `write` 1,196 | Not duplicates. Keep surgical text, structural codemod, and create/overwrite boundaries; remove repeated descriptions from prompt layers. |
| Compute/terminal | `bash` 6,269; `eval` 645; Node REPL 1,109 | Keep separate runtimes, but expose a single dispatch rule. Bash failures alone cost about 583k result tokens. |
| Google Workspace skills | `gmcli` 4; `gdcli` 0; `gccli` 0 | One opt-in `google-workspace` chooser; retain the CLIs behind it. |

## Top-10 retire/merge queue

Rank uses observed failed-result tokens first, then duplicate-family result volume and explicit-load evidence. “Potential” is not guaranteed savings: family totals include legitimate work.

1. **Merge browser skill dispatch behind `browser-control`.** Six browser skill names were explicitly loaded 96 times. Make only the router globally discoverable; subordinate docs load on demand. This removes chooser/prompt duplication without merging implementations.
2. **Make `read(URL)` the normal static-fetch path; demote `mcp__fetch_fetch`.** Fetch produced about 652k result tokens, 27.3% explicit errors, and the two largest results (about 123k tokens each). Keep an escape hatch for raw/paginated fetches.
3. **Stop presenting Node REPL as a peer browser tool.** Its total results were about 849k tokens and 34.0% of results explicitly failed. Preserve it for JS/Computer Use where required; browser routing should choose it internally.
4. **Fix or retire `ncode_delegate` from the advertised stack until healthy.** Every observed result was an explicit failure (31/31 on the validation pass). Its output waste is small, but the retry and agent-confusion cost is total.
5. **Retire malformed tool-name fallthrough.** Nineteen calls to nonexistent names all failed. Validate tool names before emission and suggest the canonical name; do not register aliases for typos.
6. **Hide `generate_image` until its provider path works.** One call, one explicit 404 failure. A broken advertised capability is worse than an absent one.
7. **Demote `debug` to opt-in/manual discovery.** Two calls, one timeout, no evidence of dependable routine use. Keep implementation available for targeted debugging.
8. **Merge `gmcli`/`gdcli`/`gccli` visibility behind one opt-in Google Workspace skill.** Four, zero, and zero explicit loads respectively. This is a description/router merge, not a CLI merge.
9. **Reconcile and retire the stale global `impeccable` surface.** It was explicitly loaded 17 times despite being classified as archived/disabled. Keep the distinct stream-local `impeccable-design-review` only if that project still owns it.
10. **Demote zero-use global skills rather than deleting source.** `gdcli`, `gccli`, `cloudflare-deploy`, and `find-skills` had zero explicit loads. Move them to on-demand discovery; reassess after four weekly samples.

Do not merge `search` with `ast_grep`/`lsp`, or `edit` with `ast_edit`/`write`: those are different correctness boundaries. Consolidate their instructions, not their implementations.

## Persistent counter wiring plan (not implemented)

A lightweight persistence seam already exists in `packages/control-plane/src/omp-publisher.ts`. `createOmpPublisher` registers `turn_start`, `turn_end`, `message_start`, `message_end`, and `session_entry` hooks. The publisher appends monotonic, schema-validated envelopes to the existing per-session outbox. Turn envelopes already store `toolCalls` and a serialized `toolCallSummary` when supplied (`onTurn`, around lines 228–273).

The minimal future wiring is therefore:

1. Derive a compact per-turn summary from tool-call/result session entries: `{name, calls, errors, resultChars}`; never persist arguments or result bodies.
2. Feed that summary into the existing `toolCallSummary` field on the `turn` envelope rather than creating a second telemetry file or service.
3. Aggregate at outbox ingestion by day/project/tool, with schema versioning and bounded cardinality; skill loads can be counted as `read(skill://…)` in the same summary.
4. Keep the JSONL miner as a backfill/audit path and compare one week of outbox totals before relying on the counter.

No runtime code was changed in this slice.

## Consolidation consequence

The immediate stack decision is not “fewer implementations at any cost.” It is one discoverable chooser per intent, bounded outputs, and distinct truth surfaces behind that chooser. This baseline should be rerun weekly for four weeks before deleting any merely unused source.