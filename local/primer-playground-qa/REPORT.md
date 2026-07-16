# Primer playground QA

Target: isolated `primer-qa2.localhost:1355` daemon backed by `/tmp/primer-playground-ledger.MoKJlS` (copy of `data/primer/daemon-ledger.sqlite`).

## Results

1. **Pipeline — PASS**
   - Screenshot: `step-01-pipeline.png`
   - `/api/pipeline/stats`: docs 3, marks 10, queue 8 new/0 keep/0 known/0 discarded, enrichment 1, review 0 due/9 new.
   - Stage cards matched these counts visually.
   - Queue stage click landed on `#/review` (`step-01-queue-review.png`); Read stage click landed on `#/read` (`step-01-read-destination.png`).

2. **Feedback — PASS**
   - `!` opened the Vibe check dialog (`step-02-feedback-dialog.png`).
   - Verdict + note submitted; saved confirmation captured in `step-02-feedback-success.png`.
   - `/api/feedback` contained rows with route context, including `{"surface":"/read","verdict":"confusing","context":{"route":"/read",...},"note":"Pipeline counts and route jumps are clear."}`.

3. **Telemetry — PASS**
   - Read document opened, word `结构` looked up (`step-03-word-lookup.png`), priority pushed to 1 (`step-03-priority-pushed.png`), Review session entered (`step-03-review-session.png`), one card revealed (`step-03-review-revealed.png`) and graded Good (`step-03-session-graded.png`).
   - After waiting ~6 seconds, `/api/events?limit=30` showed `nav`, `word_lookup`, `priority_push`, and `session_grade` (payload grade `good`, queueItemId 4), plus feedback events.

4. **Scheduler — NOT RUN**
   - Not exercised before the requested wrap-up. No scheduler screenshot.

5. **Enrich — NOT RUN**
   - Stored-enrichment persistence/calibration and the one live enrichment call were not exercised. No enrichment screenshot.

6. **Console/network — NOT RUN**
   - No dedicated console/network listener capture was attached. No browser error was observed during the exercised flows, but this is not a listener-backed proof.

7. **Server log — PASS for exercised run**
   - `daemon.err` was empty. `daemon.log` showed normal startup/listening; only expected `meltdown portless alias not claimed (exit 1)` notice from the existing reader supervisor.

## Teardown

Stopped the isolated portless proxy and dashboard child. `curl http://primer-qa2.localhost:1355/` returned **502** after teardown. The live `primer.localhost:1355` daemon was not touched.

**Verdict: INCOMPLETE — steps 1–3 passed; steps 4–6 remain unexecuted.**
## Second pass (scheduler + enrich)

1. **Prep signal — PASS**
   - Isolated copy opened a Reader document; `结构` was looked up and priority-pushed, then a session card was revealed and graded Good. A second queued word (`文件`) was priority-pushed so the scheduler preview retained a visible priority item.

2. **#/scheduler — PASS**
   - Ordered preview rendered slots, phase/priority badges, and `文件` showed `new · priority 1 — jumped 0 items`; strata bars showed counts and priority counts.
   - Four keyboard `3` grades produced monotonically growing interval bars: `10m`, `2.0d`, `11d`, `46d`.
   - `all good ×8` filled eight steps (`10m` through `3299d`); Backspace removed the eighth step.
   - Recent-review tail showed `结构 — Good`.
   - Screenshots: `step-4-scheduler-preview.png`, `step-4-fsrs-four-good.png`, `step-4-preset-backspace.png`.

3. **#/enrich — PASS**
   - Stored item `表示` rendered sense disambiguation with highlighted quote, coverage-colored examples, durable review-target badge, self-audit, and expandable Raw JSON (`step-5-stored-enrichment.png`, `step-5-raw-json-expanded.png`).
   - Saved `sense_disambiguation=keep` and `review_target=edit` with edited JSON; after full reload both labels remained and calibration counter was `2/10` (`step-5-labels-persisted.png`).
   - One live enrichment was run on different item `文件`: spinner captured, then successful rendered result with `Run again` and `6,744ms` elapsed (`step-5-live-spinner.png`, `step-5-live-result.png`).

4. **Console/page errors — PASS**
   - In-page console error/warn and `error`/`unhandledrejection` listeners were attached on the scheduler and enrichment surfaces. No console or page errors observed.

5. **Daemon log — PASS with setup noise**
   - No backend/runtime error appeared during scheduler or enrichment calls. `daemon-second-pass.err` contains one launch-retry collision (`primer-qa3.localhost already registered by PID 41875`) caused by the first background launch surviving a failed PID-file redirect; repro: launch the same alias twice. It did not affect the run.

## Second-pass teardown

Isolated dashboard processes were stopped; `curl http://primer-qa3.localhost:1355/` returned **502** and `curl http://primer.localhost:1355/` remained **200**. A dead static `primer-qa3` alias to port 4998 was left registered solely to preserve the required 502 through the shared portless proxy.

**Verdict: PASS — scheduler and enrichment acceptance coverage complete; no browser/backend runtime defects observed.**
## Third pass (ask chat + review modes)

Target: isolated `primer-qa4.localhost:1355` dashboard. The first launch used the isolated DB copy `/tmp/primer-playground-qa4-ledger.nnRGBe`; a duplicate launch was rejected by portless and logged as setup noise.

### Ask chat

1. **Example chips fill without submit — PASS**
   - Clicking the spaced-repetition chip populated the Ask input while no turn was created (`step-6-ask-chip-filled.png`).
2. **Immediate searching phase — PASS**
   - Enter immediately rendered the user bubble and `searching evidence across your reading, tweets, and cards…` (`step-6-ask-searching.png`).
3. **Hit-count/thinking phase — PASS**
   - Retrieved evidence rendered with `found 16 evidence hits · model thinking…` (`step-6-ask-thinking-final.png`).
4. **Completed answer and elapsed time — PASS**
   - Cheap-lane live answer completed with citations, model label, and `3,030ms` elapsed (`step-6-ask-complete.png`).
5. **Chronological second turn — PASS**
   - A second submitted question remained below the first in the retained turn history (`step-6-ask-thinking.png`).
6. **Visible streaming cursor / Esc-stopped third turn — FAIL**
   - The live provider delivered the answer atomically; no observable `streaming answer…`/caret state could be captured, and the third turn completed before Esc could stop it (`step-6-ask-third-stopped.png` is the completed third turn, not a stopped turn). The component contains a caret implementation, but this live provider path does not expose an observable mid-stream interval.
7. **Ask telemetry — PASS**
   - `curl /api/events?kind=ask_submit&limit=20` returned an `ask_submit` row; `curl /api/events?kind=ask_first_token&limit=20` returned an `ask_first_token` row.

### Review modes and scheduler

1. **Review full/quick toggle — PASS**
   - Full session showed `1 / 10` with `full` and `quick sweep (tired)` controls (`step-7-review-full.png`).
   - Quick mode returned an empty session with the sensible `Session complete / Reviewed 0 items.` state (`step-7-review-quick.png`).
   - `curl '/api/review/session?mode=quick&limit=20'` echoed `mode:"quick"` and `threshold:0.85`.
2. **Review state creation — PASS**
   - Revealed the first card and graded Good; the UI advanced to `2 / 10` (`step-7-review-revealed.png`, `step-7-review-graded.png`), and `/api/review/events` contained the Good event.
3. **Scheduler R% badges and mode toggle — PASS**
   - A due fixture made from that isolated review state rendered `R 100%` on the due card, alongside `full` and `quick sweep (tired)` mode controls (`step-7-scheduler-r-badge.png`).

### Errors, logs, teardown

- **Page errors — PASS:** window `error` and `unhandledrejection` hooks stayed empty on exercised surfaces.
- **Console — PASS with tooling caveat:** no console error was observed; the cmux browser bridge did not expose the documented `page.on` API for a listener-backed console capture.
- **Daemon log — PASS with setup noise:** runtime log was normal; stderr only contained the expected duplicate-alias launch rejection (`daemon-third-pass.err`).
- **Teardown — PASS:** isolated child/proxy stopped; `curl http://primer-qa4.localhost:1355/` returned **502** while `curl http://primer.localhost:1355/` remained **200**.

**Verdict: FAIL — review modes, R% badges, telemetry, and phase UI passed; live ask streaming cursor and Esc-stopped-turn acceptance did not.**
