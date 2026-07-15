# Primer Chinese review-loop QA

Isolated ledger: `/tmp/primer-qa-ledger-yHIksV`  
Isolated URL: `http://primer-qa.localhost:1355`

## Results

| Step | Verdict | Evidence |
|---|---|---|
| 1. Reader library and doc open | PASS | Three seeded Rust By Example docs were listed: 文件 I/O, 迭代器, 错误处理. Opened doc 1 (文件 I/O). Screenshots: `step-01-read-library.png`, `step-01-doc-open.png`. |
| 2. Dictionary lookup and queue | PASS | Clicking 结构体 opened a popup with pinyin `ji gou` and glosses; queued badge appeared and reader showed the mark/underline state. Screenshot: `step-02-word-popup-queued.png`. |
| 3. Priority push/increment | PASS | `p` changed the popup to `priority ↑1`; a second `p` changed it in place to `priority ↑2` without reload. Screenshots: `step-03-priority-one.png`, `step-03-priority-two.png`. |
| 4. Fill queue | PASS | Four additional distinct words were clicked; reader showed 5 marks total. Screenshot: `step-04-queue-filled.png`. |
| 5. Triage keyboard/tabs | PASS | `g` + `s` set keep, `j` + `m` set known, `j` + `x` set discarded. New/Keep/Known/Discarded/All tabs were exercised. Screenshots: `step-05-review-triage-initial.png`, `step-05-triage-keys.png`, `step-05-triage-tabs.png`. |
| 6. Session ordering/card UI | PASS | Session opened with large hanzi 结构体, phase `new`, `priority 2`, provenance `Rust By Example · 文件 I/O`, and `1 / 2`; the priority-pushed word was first among NEW items. Screenshot: `step-06-session-first-card.png`. |
| 7. Reveal, grading, completion | PASS | Spacebar revealed pinyin/gloss. Graded first card Easy (4), second Hard (2); session advanced and ended with Reviewed 2 items, Hard 1, Easy 1. Screenshots: `step-07-card-revealed.png`, `step-07-card-two.png`, `step-07-session-complete.png`. |
| 8. Provenance | FAIL (partial) | Source opened the correct Rust By Example · 文件 I/O reader document and showed the marked text. However, the review UI navigates only to `#/read/<docId>` and drops `paragraphIdx/start/end`; a mark in any non-first paragraph will open at the document top rather than the exact paragraph. Screenshot: `step-08-provenance-reader.png`. Exact repro: queue a word in paragraph 2+, focus it in Review, press `o`/Source; URL has no `?mark=<id>` and reader does not anchor to that mark. |
| 9. API checks | PASS | `GET /api/review/session` returned review objects including `itemKind` (verified with enrolled card). Invalid-grade POST returned HTTP 400; negative-priority POST returned HTTP 400. Screenshot: `step-09-api-session.png`. |
| 10. CLI/enrollment | PASS | `PRIMER_LEDGER_DB=/tmp/primer-qa-ledger-yHIksV bun src/cli.ts review due` printed `due now: 0`, `new available: 1`, `enrolled cards: 0`, consistent with the graded session. Approved candidate id 1 was enrolled; next session returned `itemKind: "card_candidate"` with populated `front` and `back`. Screenshot: `step-10-enrolled-card-session.png`. |
| 11. Console/network | PASS | Browser error/page-error/request-failed listeners were attached while reloading `#/read` and `#/review`; no console errors, page errors, or failed requests were observed. Screenshot: `step-11-console-network-check.png`. |

## Defects

1. **Provenance loses paragraph anchor (Step 8).** `ReviewView` calls `readerUrl(docId)` instead of passing the provenance mark/position, so non-first-paragraph sources cannot land at the right paragraph. Repro is documented above.
2. **Dashboard emits an isolated-startup alias error.** The server log recorded `Failed to register meltdown portless alias: exit 1` because `src/dashboard.ts` attempts to register a hard-coded `meltdown` alias whenever `PORTLESS_URL` is set. The dashboard itself remained usable after the requested `primer-qa` route was active, but this is noisy and can conflict with an existing process.

## Teardown

Killed the isolated portless/dashboard processes (PIDs 56582 and 56583). Verification request to `http://primer-qa.localhost:1355/api/review/session` returned HTTP 502 afterward, confirming `primer-qa` no longer serves.

**Verdict: PASS with one functional provenance-anchor defect and one startup alias defect.**
